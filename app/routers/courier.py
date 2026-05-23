import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_session
from app.deps import courier_id_header
from app.models import Courier
from app.schemas import AssignmentOut, BookAssignmentBody, CourierAdminOut, CourierLoginBody, ShiftInstanceOut
from app.services.bookings import BookingError, cancel_assignment, create_assignment
from app.services.shifts import list_available_shifts, list_my_assignments

router = APIRouter(prefix="/couriers/me", tags=["courier"])


@router.post("/login", response_model=CourierAdminOut)
async def courier_login(
    body: CourierLoginBody,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    phone = body.phone.strip()
    courier = (
        await session.execute(
            select(Courier).options(selectinload(Courier.locations)).where(Courier.phone == phone)
        )
    ).scalar_one_or_none()
    if not courier or courier.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Курьер с таким телефоном не найден или заблокирован")
    return CourierAdminOut(
        id=courier.id,
        external_ref=courier.external_ref,
        full_name=courier.full_name,
        phone=courier.phone,
        courier_type=courier.courier_type,
        status=courier.status,
        location_ids=[loc.id for loc in courier.locations],
    )


@router.get("/shifts/available", response_model=list[ShiftInstanceOut])
async def get_available_shifts(
    courier_id: Annotated[uuid.UUID, Depends(courier_id_header)],
    session: Annotated[AsyncSession, Depends(get_session)],
    from_: datetime = Query(alias="from"),
    to: datetime = Query(),
    location_id: uuid.UUID | None = None,
):
    return await list_available_shifts(
        session,
        courier_id=courier_id,
        from_dt=from_,
        to_dt=to,
        location_id=location_id,
    )


@router.get("/assignments", response_model=list[AssignmentOut])
async def get_my_assignments(
    courier_id: Annotated[uuid.UUID, Depends(courier_id_header)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await list_my_assignments(session, courier_id)


@router.post("/assignments", response_model=AssignmentOut)
async def book_shift(
    courier_id: Annotated[uuid.UUID, Depends(courier_id_header)],
    session: Annotated[AsyncSession, Depends(get_session)],
    body: BookAssignmentBody,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
):
    if idempotency_key and len(idempotency_key) > 128:
        raise BookingError("bad_idempotency", "Idempotency-Key слишком длинный", 400)
    return await create_assignment(
        session,
        courier_id=courier_id,
        shift_instance_id=body.shift_instance_id,
        idempotency_key=idempotency_key,
    )


@router.delete("/assignments/{assignment_id}", response_model=AssignmentOut)
async def cancel_my_assignment(
    assignment_id: uuid.UUID,
    courier_id: Annotated[uuid.UUID, Depends(courier_id_header)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await cancel_assignment(session, courier_id=courier_id, assignment_id=assignment_id)
