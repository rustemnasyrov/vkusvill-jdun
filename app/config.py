from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://courier:courier@localhost:5432/courier_shifts"
    admin_token: str = "dev-admin-change-me"
    default_cancel_deadline_hours: int = 12
    max_shifts_per_week_per_courier: int = 50
    min_hours_between_shifts: int = 0
    cors_origins: str = "http://localhost:9001,http://127.0.0.1:9001"


settings = Settings()
