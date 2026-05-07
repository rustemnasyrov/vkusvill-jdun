import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.config import settings


async def courier_id_header(x_courier_id: Annotated[str | None, Header(alias="X-Courier-Id")] = None) -> uuid.UUID:
    if not x_courier_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Заголовок X-Courier-Id обязателен")
    try:
        return uuid.UUID(x_courier_id.strip())
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Некорректный X-Courier-Id") from e


async def admin_bearer(authorization: Annotated[str | None, Header()] = None) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен Bearer-токен администратора")
    token = authorization.removeprefix("Bearer ").strip()
    if token != settings.admin_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав")
