import enum


class CourierStatus(str, enum.Enum):
    active = "active"
    blocked = "blocked"


class AssignmentStatus(str, enum.Enum):
    confirmed = "confirmed"
    cancelled_by_courier = "cancelled_by_courier"
    cancelled_by_admin = "cancelled_by_admin"


class AuditActorType(str, enum.Enum):
    courier = "courier"
    admin = "admin"
    system = "system"
