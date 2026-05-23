"""JWT для входа администратора."""

from datetime import UTC, datetime, timedelta

import jwt

from app.config import settings


def issue_admin_token(username: str) -> tuple[str, int]:
    now = datetime.now(UTC)
    exp = now + timedelta(hours=settings.jwt_expire_hours)
    iat_ts = int(now.timestamp())
    exp_ts = int(exp.timestamp())
    payload = {"sub": username, "role": "admin", "iat": iat_ts, "exp": exp_ts}
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return token, exp_ts - iat_ts


def decode_admin_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
