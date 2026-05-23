import secrets
import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from jwt.exceptions import InvalidTokenError

from app.admin_security import decode_admin_token
from app.config import settings


async def courier_id_header(x_courier_id: Annotated[str | None, Header(alias="X-Courier-Id")] = None) -> uuid.UUID:
    if not x_courier_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Заголовок X-Courier-Id обязателен")
    try:
        return uuid.UUID(x_courier_id.strip())
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Некорректный X-Courier-Id") from e


async def admin_user(authorization: Annotated[str | None, Header()] = None) -> dict:
    """JWT после входа или (опционально) статический token из ADMIN_TOKEN."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужна авторизация администратора")
    raw = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_admin_token(raw)
        if payload.get("role") != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав")
        return payload
    except InvalidTokenError:
        pass
    legacy = settings.admin_legacy_token
    if legacy is not None:
        try:
            legacy_ok = secrets.compare_digest(raw, legacy)
        except ValueError:
            legacy_ok = False
        if legacy_ok:
            return {"sub": "legacy-admin", "role": "admin"}
    raise HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Недействительный или просроченный токен. Войдите снова через форму входа.",
    )
