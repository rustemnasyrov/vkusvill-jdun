from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://courier:courier@localhost:5432/courier_shifts"

    admin_username: str = "admin"
    admin_password: str = Field(
        default="dev-password-change-me",
        description="Пароль для POST /auth/admin/login",
    )
    jwt_secret: str = Field(
        default="dev-jwt-secret-change-me",
        description="Секрет подписи JWT администратора",
    )
    jwt_expire_hours: int = 24
    admin_legacy_token: str | None = Field(
        default=None,
        description="Статический Bearer (legacy): если задан, принимается наряду с JWT.",
        validation_alias=AliasChoices("ADMIN_LEGACY_TOKEN", "ADMIN_TOKEN"),
    )

    default_cancel_deadline_hours: int = 12
    max_shifts_per_week_per_courier: int = 50
    min_hours_between_shifts: int = 0
    cors_origins: str = "http://localhost:9001,http://127.0.0.1:9001"

    @field_validator("admin_legacy_token", mode="before")
    @classmethod
    def empty_legacy_none(cls, v: object) -> object:
        if v == "":
            return None
        return v


settings = Settings()
