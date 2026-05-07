import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import courier_id_header
from app.schemas import AssignmentOut, BookAssignmentBody, ShiftInstanceOut
from app.services.bookings import BookingError, cancel_assignment, create_assignment
from app.services.shifts import list_available_shifts, list_my_assignments

router = APIRouter(prefix="/couriers/me", tags=["courier"])


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
