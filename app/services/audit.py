from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


async def write_audit(
    session: AsyncSession,
    *,
    actor_type: str,
    actor_id: str | None,
    entity_type: str,
    entity_id: str,
    action: str,
    payload: dict | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_type=actor_type,
            actor_id=actor_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            payload=payload,
        )
    )
