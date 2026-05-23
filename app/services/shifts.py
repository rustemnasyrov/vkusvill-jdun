from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.enums import AssignmentStatus
from app.models import Assignment, Courier, ShiftInstance


async def list_available_shifts(
    session: AsyncSession,
    *,
    courier_id: uuid.UUID,
    from_dt: datetime,
    to_dt: datetime,
    location_id: uuid.UUID | None,
) -> list[ShiftInstance]:
    courier_stmt = (
        select(Courier)
        .options(selectinload(Courier.locations))
        .where(Courier.id == courier_id)
    )
    courier = (await session.execute(courier_stmt)).scalar_one_or_none()
    if not courier or courier.status != "active":
        return []

    loc_ids = {loc.id for loc in courier.locations}
    if not loc_ids:
        return []

    now = datetime.now(UTC)

    assigned_shift_ids = (
        select(Assignment.shift_instance_id)
        .where(
            Assignment.courier_id == courier_id,
            Assignment.status == AssignmentStatus.confirmed.value,
            Assignment.starts_at >= from_dt,
            Assignment.starts_at < to_dt,
        )
    )
    available = and_(
        ShiftInstance.closed_by_admin.is_(False),
        ShiftInstance.booked_count < ShiftInstance.capacity,
        or_(ShiftInstance.booking_opens_at.is_(None), ShiftInstance.booking_opens_at <= now),
        or_(ShiftInstance.booking_closes_at.is_(None), ShiftInstance.booking_closes_at >= now),
    )

    stmt = (
        select(ShiftInstance)
        .where(
            ShiftInstance.starts_at >= from_dt,
            ShiftInstance.starts_at < to_dt,
            ShiftInstance.location_id.in_(loc_ids),
            ShiftInstance.courier_type == courier.courier_type,
            or_(available, ShiftInstance.id.in_(assigned_shift_ids)),
        )
        .order_by(ShiftInstance.starts_at)
    )
    if location_id is not None:
        if location_id not in loc_ids:
            return []
        stmt = stmt.where(ShiftInstance.location_id == location_id)

    return list((await session.execute(stmt)).scalars().all())


async def list_my_assignments(session: AsyncSession, courier_id: uuid.UUID) -> list[Assignment]:
    stmt = (
        select(Assignment)
        .where(
            Assignment.courier_id == courier_id,
            Assignment.status == AssignmentStatus.confirmed.value,
        )
        .order_by(Assignment.starts_at)
    )
    return list((await session.execute(stmt)).scalars().all())
