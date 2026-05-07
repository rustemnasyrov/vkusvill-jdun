from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.enums import AssignmentStatus
from app.models import Assignment, Courier, ShiftInstance
from app.services.audit import write_audit


class BookingError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


async def _confirmed_assignments_in_week(session: AsyncSession, courier_id: uuid.UUID, week_start: datetime) -> int:
    week_end = week_start + timedelta(days=7)
    q = (
        select(func.count())
        .select_from(Assignment)
        .where(
            Assignment.courier_id == courier_id,
            Assignment.status == AssignmentStatus.confirmed.value,
            Assignment.starts_at >= week_start,
            Assignment.starts_at < week_end,
        )
    )
    return int((await session.execute(q)).scalar_one())


async def _min_gap_violation(
    session: AsyncSession,
    courier_id: uuid.UUID,
    new_start: datetime,
    new_end: datetime,
) -> bool:
    if settings.min_hours_between_shifts <= 0:
        return False
    delta = timedelta(hours=settings.min_hours_between_shifts)
    stmt = select(Assignment).where(
        Assignment.courier_id == courier_id,
        Assignment.status == AssignmentStatus.confirmed.value,
    )
    rows = (await session.execute(stmt)).scalars().all()
    for o in rows:
        if o.ends_at <= new_start:
            if new_start - o.ends_at < delta:
                return True
        elif o.starts_at >= new_end:
            if o.starts_at - new_end < delta:
                return True
    return False


async def create_assignment(
    session: AsyncSession,
    *,
    courier_id: uuid.UUID,
    shift_instance_id: uuid.UUID,
    idempotency_key: str | None,
) -> Assignment:
    if idempotency_key:
        existing = (
            await session.execute(
                select(Assignment).where(Assignment.idempotency_key == idempotency_key)
            )
        ).scalar_one_or_none()
        if existing:
            return existing

    courier = (
        await session.execute(
            select(Courier).options(selectinload(Courier.locations)).where(Courier.id == courier_id)
        )
    ).scalar_one_or_none()
    if not courier or courier.status != "active":
        raise BookingError("courier_inactive", "Курьер не найден или заблокирован", 403)

    now = datetime.now(UTC)

    si_row = await session.execute(
        select(ShiftInstance).where(ShiftInstance.id == shift_instance_id).with_for_update()
    )
    si = si_row.scalar_one_or_none()
    if not si:
        raise BookingError("shift_not_found", "Слот не найден", 404)

    loc_ids = {loc.id for loc in courier.locations}
    if si.location_id not in loc_ids:
        raise BookingError("wrong_location", "Слот недоступен для вашей зоны", 403)

    if si.closed_by_admin:
        raise BookingError("shift_closed", "Слот закрыт администратором", 409)

    if si.booked_count >= si.capacity:
        raise BookingError("capacity_exhausted", "Мест больше нет", 409)

    if si.booking_opens_at is not None and now < si.booking_opens_at:
        raise BookingError("booking_not_open", "Запись на этот слот ещё не открыта", 403)

    if si.booking_closes_at is not None and now > si.booking_closes_at:
        raise BookingError("booking_closed", "Запись на этот слот уже закрыта", 403)

    max_week = settings.max_shifts_per_week_per_courier
    d = si.starts_at.astimezone(UTC).date()
    monday_date = d - timedelta(days=d.weekday())
    week_monday = datetime.combine(monday_date, datetime.min.time(), tzinfo=UTC)
    count_week = await _confirmed_assignments_in_week(session, courier_id, week_monday)
    if count_week >= max_week:
        raise BookingError("weekly_limit", "Достигнут лимит смен за неделю", 409)

    if await _min_gap_violation(session, courier_id, si.starts_at, si.ends_at):
        raise BookingError("min_rest", "Недостаточный интервал отдыха между сменами", 409)

    assignment = Assignment(
        courier_id=courier_id,
        shift_instance_id=shift_instance_id,
        status=AssignmentStatus.confirmed.value,
        starts_at=si.starts_at,
        ends_at=si.ends_at,
        idempotency_key=idempotency_key,
    )
    session.add(assignment)
    si.booked_count += 1

    try:
        await session.flush()
    except IntegrityError as e:
        raise BookingError(
            "conflict",
            "Не удалось забронировать (пересечение смен, дубликат или места заняты)",
            409,
        ) from e

    await write_audit(
        session,
        actor_type="courier",
        actor_id=str(courier_id),
        entity_type="assignment",
        entity_id=str(assignment.id),
        action="created",
        payload={"shift_instance_id": str(shift_instance_id)},
    )

    return assignment


async def cancel_assignment(
    session: AsyncSession,
    *,
    courier_id: uuid.UUID,
    assignment_id: uuid.UUID,
) -> Assignment:
    q = await session.execute(
        select(Assignment).where(Assignment.id == assignment_id).with_for_update()
    )
    a = q.scalar_one_or_none()
    if not a or a.courier_id != courier_id:
        raise BookingError("not_found", "Бронь не найдена", 404)

    if a.status != AssignmentStatus.confirmed.value:
        raise BookingError("already_cancelled", "Бронь уже отменена", 409)

    deadline_hours = settings.default_cancel_deadline_hours
    now = datetime.now(UTC)
    if now > a.starts_at - timedelta(hours=deadline_hours):
        raise BookingError("cancel_deadline", "Отмена позже допустимого дедлайна", 403)

    si_row = await session.execute(
        select(ShiftInstance).where(ShiftInstance.id == a.shift_instance_id).with_for_update()
    )
    si = si_row.scalar_one_or_none()
    if not si:
        raise BookingError("shift_missing", "Слот не найден", 500)

    a.status = AssignmentStatus.cancelled_by_courier.value
    a.cancelled_at = now
    si.booked_count = max(0, si.booked_count - 1)

    await write_audit(
        session,
        actor_type="courier",
        actor_id=str(courier_id),
        entity_type="assignment",
        entity_id=str(a.id),
        action="cancelled_by_courier",
        payload=None,
    )

    return a
