from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_session
from app.deps import admin_user
from app.enums import AssignmentStatus
from app.models import Assignment, Courier, Location, ShiftInstance, ShiftTemplate
from app.schemas import (
    AdminAssignmentCreate,
    AssignmentAdminOut,
    CopyWeekBody,
    CourierAdminOut,
    CourierCreate,
    CourierLocationsBody,
    CourierStatusBody,
    GenerateWeekBody,
    LocationCreate,
    LocationOut,
    ShiftInstanceClosedBody,
    ShiftInstanceCreate,
    ShiftInstanceOut,
    ShiftInstanceUpdate,
    ShiftTemplateCreate,
    ShiftTemplateOut,
)
from app.services.audit import write_audit
from app.services.bookings import create_assignment

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(admin_user)])


@router.get("/locations", response_model=list[LocationOut])
async def list_locations(session: AsyncSession = Depends(get_session)):
    stmt = select(Location).order_by(Location.name)
    rows = (await session.execute(stmt)).scalars().all()
    return rows


@router.get("/shift-templates", response_model=list[ShiftTemplateOut])
async def list_shift_templates(
    session: AsyncSession = Depends(get_session),
    location_id: uuid.UUID | None = None,
):
    stmt = select(ShiftTemplate).order_by(ShiftTemplate.day_of_week, ShiftTemplate.start_time)
    if location_id is not None:
        stmt = stmt.where(ShiftTemplate.location_id == location_id)
    return list((await session.execute(stmt)).scalars().all())


@router.get("/shift-instances", response_model=list[ShiftInstanceOut])
async def list_shift_instances(
    session: AsyncSession = Depends(get_session),
    from_: datetime = Query(alias="from"),
    to: datetime = Query(),
    location_id: uuid.UUID | None = None,
):
    stmt = select(ShiftInstance).where(
        ShiftInstance.starts_at >= from_,
        ShiftInstance.starts_at < to,
    ).order_by(ShiftInstance.starts_at)
    if location_id is not None:
        stmt = stmt.where(ShiftInstance.location_id == location_id)
    return list((await session.execute(stmt)).scalars().all())


@router.get("/couriers", response_model=list[CourierAdminOut])
async def list_couriers(session: AsyncSession = Depends(get_session)):
    stmt = select(Courier).options(selectinload(Courier.locations)).order_by(Courier.id)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        CourierAdminOut(
            id=c.id,
            external_ref=c.external_ref,
            full_name=c.full_name,
            phone=c.phone,
            courier_type=c.courier_type,
            status=c.status,
            location_ids=[loc.id for loc in c.locations],
        )
        for c in rows
    ]


@router.get("/assignments", response_model=list[AssignmentAdminOut])
async def list_assignments(
    session: AsyncSession = Depends(get_session),
    courier_id: uuid.UUID | None = None,
):
    stmt = select(Assignment).order_by(Assignment.starts_at.desc())
    if courier_id is not None:
        stmt = stmt.where(Assignment.courier_id == courier_id)
    return list((await session.execute(stmt)).scalars().all())


@router.post("/assignments", response_model=AssignmentAdminOut)
async def create_admin_assignment(
    body: AdminAssignmentCreate,
    session: AsyncSession = Depends(get_session),
):
    assignment = await create_assignment(
        session,
        courier_id=body.courier_id,
        shift_instance_id=body.shift_instance_id,
        idempotency_key=None,
    )
    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="assignment",
        entity_id=str(assignment.id),
        action="created_by_admin",
        payload={"courier_id": str(body.courier_id), "shift_instance_id": str(body.shift_instance_id)},
    )
    return assignment


@router.delete("/assignments/{assignment_id}", response_model=AssignmentAdminOut)
async def cancel_admin_assignment(
    assignment_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    q = await session.execute(select(Assignment).where(Assignment.id == assignment_id).with_for_update())
    assignment = q.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Назначение не найдено")
    if assignment.status != AssignmentStatus.confirmed.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Назначение уже снято")

    si_row = await session.execute(
        select(ShiftInstance).where(ShiftInstance.id == assignment.shift_instance_id).with_for_update()
    )
    si = si_row.scalar_one_or_none()
    if not si:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Слот не найден")

    assignment.status = AssignmentStatus.cancelled_by_admin.value
    assignment.cancelled_at = datetime.now(UTC)
    si.booked_count = max(0, si.booked_count - 1)
    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="assignment",
        entity_id=str(assignment.id),
        action="cancelled_by_admin",
        payload={"shift_instance_id": str(assignment.shift_instance_id)},
    )
    return assignment


def _parse_time(value: str):
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            continue
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "start_time: ожидается HH:MM или HH:MM:SS")


def _week_monday(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    base_date = value.astimezone(UTC).date()
    monday_date = base_date - timedelta(days=base_date.weekday())
    return datetime.combine(monday_date, datetime.min.time(), tzinfo=UTC)


def _copy_week_start(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


@router.post("/locations", response_model=dict)
async def create_location(
    body: LocationCreate,
    session: AsyncSession = Depends(get_session),
):
    loc = Location(name=body.name, timezone=body.timezone)
    session.add(loc)
    await session.flush()
    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="location",
        entity_id=str(loc.id),
        action="created",
        payload={"name": body.name},
    )
    return {"id": str(loc.id)}


@router.post("/couriers", response_model=dict)
async def create_courier(
    body: CourierCreate,
    session: AsyncSession = Depends(get_session),
):
    phone = body.phone.strip()
    if (
        await session.execute(
            select(Courier.id).where(Courier.phone == phone)
        )
    ).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Курьер с таким телефоном уже есть")
    if body.location_ids:
        for lid in body.location_ids:
            if not await session.get(Location, lid):
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"Локация {lid} не найдена")
    c = Courier(
        external_ref=body.external_ref or phone,
        full_name=body.full_name.strip(),
        phone=phone,
        courier_type=body.courier_type,
        status="active",
    )
    if body.location_ids:
        locs = (await session.execute(select(Location).where(Location.id.in_(body.location_ids)))).scalars().all()
        c.locations = list(locs)
    session.add(c)
    await session.flush()
    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="courier",
        entity_id=str(c.id),
        action="created",
        payload={"phone": phone, "courier_type": body.courier_type},
    )
    return {"id": str(c.id)}


@router.patch("/couriers/{courier_id}/status", response_model=CourierAdminOut)
async def set_courier_status(
    courier_id: uuid.UUID,
    body: CourierStatusBody,
    session: AsyncSession = Depends(get_session),
):
    c = await session.get(Courier, courier_id, options=[selectinload(Courier.locations)])
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Курьер не найден")
    c.status = body.status
    session.add(c)
    await session.flush()
    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="courier",
        entity_id=str(c.id),
        action="status_changed",
        payload={"status": body.status},
    )
    return CourierAdminOut(
        id=c.id,
        external_ref=c.external_ref,
        full_name=c.full_name,
        phone=c.phone,
        courier_type=c.courier_type,
        status=c.status,
        location_ids=[loc.id for loc in c.locations],
    )


@router.put("/couriers/{courier_id}/locations", response_model=dict)
async def set_courier_locations(
    courier_id: uuid.UUID,
    body: CourierLocationsBody,
    session: AsyncSession = Depends(get_session),
):
    c = await session.get(Courier, courier_id)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Курьер не найден")
    for lid in body.location_ids:
        if not await session.get(Location, lid):
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Локация {lid} не найдена")
    locs = (await session.execute(select(Location).where(Location.id.in_(body.location_ids)))).scalars().all()
    c.locations = list(locs)
    session.add(c)
    await session.flush()
    return {"ok": True}


@router.post("/shift-templates", response_model=dict)
async def create_shift_template(
    body: ShiftTemplateCreate,
    session: AsyncSession = Depends(get_session),
):
    if not await session.get(Location, body.location_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Локация не найдена")
    st = _parse_time(body.start_time)
    t = ShiftTemplate(
        location_id=body.location_id,
        day_of_week=body.day_of_week,
        start_time=st,
        duration_minutes=body.duration_minutes,
        capacity=body.capacity,
        courier_type=body.courier_type,
        is_active=True,
    )
    session.add(t)
    await session.flush()
    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="shift_template",
        entity_id=str(t.id),
        action="created",
        payload={"location_id": str(body.location_id), "day_of_week": body.day_of_week},
    )
    return {"id": str(t.id)}


@router.post("/shift-instances", response_model=dict)
async def create_shift_instance(
    body: ShiftInstanceCreate,
    session: AsyncSession = Depends(get_session),
):
    if not await session.get(Location, body.location_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Локация не найдена")
    if body.ends_at <= body.starts_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ends_at должен быть позже starts_at")
    si = ShiftInstance(
        template_id=None,
        location_id=body.location_id,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        capacity=body.capacity,
        courier_type=body.courier_type,
        booked_count=0,
        closed_by_admin=False,
        booking_opens_at=body.booking_opens_at,
        booking_closes_at=body.booking_closes_at,
    )
    session.add(si)
    await session.flush()
    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="shift_instance",
        entity_id=str(si.id),
        action="created",
        payload={"location_id": str(body.location_id)},
    )
    return {"id": str(si.id)}


@router.put("/shift-instances/{instance_id}", response_model=ShiftInstanceOut)
async def update_shift_instance(
    instance_id: uuid.UUID,
    body: ShiftInstanceUpdate,
    session: AsyncSession = Depends(get_session),
):
    si = await session.get(ShiftInstance, instance_id)
    if not si:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Слот не найден")
    if not await session.get(Location, body.location_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Локация не найдена")
    if body.ends_at <= body.starts_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ends_at должен быть позже starts_at")
    if body.capacity < si.booked_count:
        raise HTTPException(status.HTTP_409_CONFLICT, "Нельзя сделать мест меньше уже записанных курьеров")

    si.template_id = None
    si.location_id = body.location_id
    si.starts_at = body.starts_at
    si.ends_at = body.ends_at
    si.capacity = body.capacity
    si.courier_type = body.courier_type
    session.add(si)
    await session.flush()
    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="shift_instance",
        entity_id=str(si.id),
        action="updated",
        payload={"location_id": str(body.location_id), "courier_type": body.courier_type},
    )
    return si


@router.delete("/shift-instances/{instance_id}", response_model=dict)
async def delete_shift_instance(
    instance_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    si = await session.get(ShiftInstance, instance_id)
    if not si:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Слот не найден")
    if si.booked_count > 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Нельзя удалить слот с записанными курьерами")

    await session.delete(si)
    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="shift_instance",
        entity_id=str(instance_id),
        action="deleted",
        payload=None,
    )
    return {"ok": True}


@router.post("/shift-instances/copy-week", response_model=dict)
async def copy_shift_instances_week(
    body: CopyWeekBody,
    session: AsyncSession = Depends(get_session),
):
    source_start = _copy_week_start(body.source_week_start)
    target_start = _copy_week_start(body.target_week_start)
    if source_start == target_start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неделя-получатель должна отличаться от источника")
    source_end = source_start + timedelta(days=7)
    target_end = target_start + timedelta(days=7)

    source_stmt = select(ShiftInstance).where(
        ShiftInstance.starts_at >= source_start,
        ShiftInstance.starts_at < source_end,
    ).order_by(ShiftInstance.starts_at)
    target_stmt = select(ShiftInstance).where(
        ShiftInstance.starts_at >= target_start,
        ShiftInstance.starts_at < target_end,
    ).order_by(ShiftInstance.starts_at)
    if body.location_id is not None:
        if not await session.get(Location, body.location_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Локация не найдена")
        source_stmt = source_stmt.where(ShiftInstance.location_id == body.location_id)
        target_stmt = target_stmt.where(ShiftInstance.location_id == body.location_id)

    source_slots = list((await session.execute(source_stmt)).scalars().all())
    target_slots = list((await session.execute(target_stmt)).scalars().all())

    removed_empty = 0
    kept_booked = 0
    if body.mode == "replace_empty":
        for slot in target_slots:
            if slot.booked_count > 0:
                kept_booked += 1
                continue
            await session.delete(slot)
            removed_empty += 1
        if removed_empty:
            await session.flush()
        target_slots = [slot for slot in target_slots if slot.booked_count > 0]

    existing_keys = {
        (
            slot.location_id,
            (slot.starts_at - target_start).total_seconds(),
            (slot.ends_at - target_start).total_seconds(),
            slot.courier_type,
        )
        for slot in target_slots
    }
    created_ids: list[str] = []
    skipped_existing = 0

    for source in source_slots:
        target_starts_at = target_start + (source.starts_at - source_start)
        target_ends_at = target_start + (source.ends_at - source_start)
        key = (
            source.location_id,
            (target_starts_at - target_start).total_seconds(),
            (target_ends_at - target_start).total_seconds(),
            source.courier_type,
        )
        if body.mode != "append" and key in existing_keys:
            skipped_existing += 1
            continue
        copy = ShiftInstance(
            template_id=None,
            location_id=source.location_id,
            starts_at=target_starts_at,
            ends_at=target_ends_at,
            capacity=source.capacity,
            courier_type=source.courier_type,
            booked_count=0,
            closed_by_admin=False,
            booking_opens_at=None,
            booking_closes_at=None,
        )
        session.add(copy)
        await session.flush()
        created_ids.append(str(copy.id))
        existing_keys.add(key)

    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="shift_instance",
        entity_id=target_start.date().isoformat(),
        action="copy_week",
        payload={
            "source_week": source_start.date().isoformat(),
            "target_week": target_start.date().isoformat(),
            "location_id": str(body.location_id) if body.location_id else None,
            "mode": body.mode,
            "created": len(created_ids),
            "skipped_existing": skipped_existing,
            "removed_empty": removed_empty,
            "kept_booked": kept_booked,
        },
    )
    return {
        "created_instance_ids": created_ids,
        "created": len(created_ids),
        "skipped_existing": skipped_existing,
        "removed_empty": removed_empty,
        "kept_booked": kept_booked,
    }


@router.post("/shifts/generate-week", response_model=dict)
async def generate_week(
    body: GenerateWeekBody,
    session: AsyncSession = Depends(get_session),
):
    stmt = select(ShiftTemplate).where(ShiftTemplate.is_active.is_(True))
    if body.template_ids:
        stmt = stmt.where(ShiftTemplate.id.in_(body.template_ids))
    templates = (await session.execute(stmt)).scalars().all()
    ws = body.week_start
    if ws.tzinfo is None:
        ws = ws.replace(tzinfo=UTC)
    base_date = ws.date()
    monday_date = base_date - timedelta(days=base_date.weekday())
    created_ids: list[str] = []

    for t in templates:
        loc = await session.get(Location, t.location_id)
        if not loc:
            continue
        try:
            tz = ZoneInfo(loc.timezone)
        except Exception:
            tz = UTC
        target_date = monday_date + timedelta(days=t.day_of_week)
        local_start = datetime.combine(target_date, t.start_time, tzinfo=tz)
        starts_at = local_start.astimezone(UTC)
        ends_at = starts_at + timedelta(minutes=t.duration_minutes)
        dup = (
            await session.execute(
                select(ShiftInstance.id).where(
                    ShiftInstance.template_id == t.id,
                    ShiftInstance.starts_at == starts_at,
                )
            )
        ).first()
        if dup:
            continue
        si = ShiftInstance(
            template_id=t.id,
            location_id=t.location_id,
            starts_at=starts_at,
            ends_at=ends_at,
            capacity=t.capacity,
            courier_type=t.courier_type,
            booked_count=0,
            closed_by_admin=False,
            booking_opens_at=None,
            booking_closes_at=None,
        )
        session.add(si)
        await session.flush()
        created_ids.append(str(si.id))

    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="shift_generation",
        entity_id=monday_date.isoformat(),
        action="generate_week",
        payload={"count": len(created_ids)},
    )
    return {"created_instance_ids": created_ids, "week_monday": monday_date.isoformat()}


@router.patch("/shift-instances/{instance_id}/closed", response_model=dict)
async def set_shift_closed(
    instance_id: uuid.UUID,
    body: ShiftInstanceClosedBody,
    session: AsyncSession = Depends(get_session),
):
    si = await session.get(ShiftInstance, instance_id)
    if not si:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Слот не найден")
    closed = body.closed
    si.closed_by_admin = closed
    session.add(si)
    await write_audit(
        session,
        actor_type="admin",
        actor_id=None,
        entity_type="shift_instance",
        entity_id=str(si.id),
        action="closed" if closed else "opened",
        payload={"closed": closed},
    )
    return {"id": str(si.id), "closed_by_admin": closed}
