import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    SmallInteger,
    String,
    Table,
    Time,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")


courier_locations = Table(
    "courier_locations",
    Base.metadata,
    Column("courier_id", UUID(as_uuid=True), ForeignKey("couriers.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "location_id",
        UUID(as_uuid=True),
        ForeignKey("locations.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Courier(Base):
    __tablename__ = "couriers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_ref: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")

    locations: Mapped[list["Location"]] = relationship(
        secondary=courier_locations,
        lazy="selectin",
    )


class ShiftTemplate(Base):
    __tablename__ = "shift_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="CASCADE"), nullable=False
    )
    day_of_week: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # 0=Monday
    start_time: Mapped[object] = mapped_column(Time, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ShiftInstance(Base):
    __tablename__ = "shift_instances"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("shift_templates.id", ondelete="SET NULL"), nullable=True
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="CASCADE"), nullable=False
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    booked_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    closed_by_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    booking_opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    booking_closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    courier_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("couriers.id", ondelete="CASCADE"), nullable=False
    )
    shift_instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("shift_instances.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="confirmed")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_type: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
