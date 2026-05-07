from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import admin_bearer
from app.models import Courier, Location, ShiftInstance, ShiftTemplate
from app.schemas import (
    CourierCreate,
    GenerateWeekBody,
    LocationCreate,
    ShiftInstanceClosedBody,
    ShiftInstanceCreate,
    ShiftTemplateCreate,
)
from app.services.audit import write_audit

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(admin_bearer)])


def _parse_time(value: str):
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            continue
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "start_time: ожидается HH:MM или HH:MM:SS")


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
    if body.location_ids:
        for lid in body.location_ids:
            if not await session.get(Location, lid):
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"Локация {lid} не найдена")
    c = Courier(external_ref=body.external_ref, status="active")
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
        payload={"external_ref": body.external_ref},
    )
    return {"id": str(c.id)}


@router.put("/couriers/{courier_id}/locations", response_model=dict)
async def set_courier_locations(
    courier_id: uuid.UUID,
    body: CourierCreate,
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
