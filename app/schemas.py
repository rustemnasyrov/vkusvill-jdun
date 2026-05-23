import uuid
from datetime import datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CourierType = Literal["teal", "blue", "amber", "purple"]


class ShiftInstanceOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    location_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    capacity: int
    courier_type: CourierType = "teal"
    booked_count: int
    closed_by_admin: bool


class AssignmentOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    shift_instance_id: uuid.UUID
    status: str
    starts_at: datetime
    ends_at: datetime
    created_at: datetime


class AssignmentAdminOut(AssignmentOut):
    courier_id: uuid.UUID


class BookAssignmentBody(BaseModel):
    shift_instance_id: uuid.UUID


class ShiftTemplateCreate(BaseModel):
    location_id: uuid.UUID
    day_of_week: int = Field(ge=0, le=6)
    start_time: str  # "HH:MM:SS" or "HH:MM"
    duration_minutes: int = Field(gt=0)
    capacity: int = Field(gt=0)
    courier_type: CourierType = "teal"


class ShiftInstanceCreate(BaseModel):
    location_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    capacity: int = Field(gt=0)
    courier_type: CourierType = "teal"
    booking_opens_at: datetime | None = None
    booking_closes_at: datetime | None = None


class ShiftInstanceUpdate(BaseModel):
    location_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    capacity: int = Field(gt=0)
    courier_type: CourierType = "teal"


class GenerateWeekBody(BaseModel):
    week_start: datetime = Field(description="Любой момент недели; берётся понедельник этой календарной недели")
    template_ids: list[uuid.UUID] | None = None


class LocationCreate(BaseModel):
    name: str
    timezone: str = "UTC"


class CourierCreate(BaseModel):
    external_ref: str | None = None
    full_name: str = Field(min_length=1)
    phone: str = Field(min_length=1, max_length=32)
    courier_type: CourierType = "teal"
    location_ids: list[uuid.UUID] = []


class CourierLocationsBody(BaseModel):
    location_ids: list[uuid.UUID] = []


class CourierStatusBody(BaseModel):
    status: Literal["active", "blocked"]


class ShiftInstanceClosedBody(BaseModel):
    closed: bool


class LocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    timezone: str


class ShiftTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    location_id: uuid.UUID
    day_of_week: int
    start_time: time
    duration_minutes: int
    capacity: int
    courier_type: CourierType = "teal"
    is_active: bool


class CourierAdminOut(BaseModel):
    id: uuid.UUID
    external_ref: str | None
    full_name: str
    phone: str | None
    courier_type: CourierType = "teal"
    status: str
    location_ids: list[uuid.UUID]


class AdminLoginBody(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AdminLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
