import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.admin_security import issue_admin_token
from app.config import settings
from app.deps import admin_user
from app.schemas import AdminLoginBody, AdminLoginResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/admin/login", response_model=AdminLoginResponse)
async def admin_login(body: AdminLoginBody):
    if not settings.admin_password:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "На сервере не задан ADMIN_PASSWORD — вход отключён.",
        )
    if body.username.strip() != settings.admin_username:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")
    try:
        pwd_ok = secrets.compare_digest(body.password, settings.admin_password)
    except ValueError:
        pwd_ok = False
    if not pwd_ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")
    token, ttl = issue_admin_token(body.username.strip())
    return AdminLoginResponse(access_token=token, expires_in=ttl)


@router.get("/admin/me")
async def admin_me(admin: Annotated[dict, Depends(admin_user)]):
    return {"username": admin.get("sub", "")}
