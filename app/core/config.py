import os
from pydantic import Field
from pydantic_settings import BaseSettings
from typing import List, Optional


def _build_database_url() -> str:
    mysql_url = os.getenv(
        "MYSQL_URL",
        "mysql+pymysql://stackdev:password@localhost:3306/stackdev_security",
    )
    if mysql_url.startswith("mysql://"):
        mysql_url = mysql_url.replace("mysql://", "mysql+pymysql://", 1)
    return mysql_url


class Settings(BaseSettings):
    # JWT
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # Database
    DATABASE_URL: str = Field(default_factory=_build_database_url)
    # Redis (opcional). Ej: redis://:password@host:6379/0
    REDIS_URL: Optional[str] = None

    # GPS
    CHECKPOINT_RADIO_METROS: int = 50

    # ── Asistencia ─────────────────────────────────────────────────────────
    # Minutos de gracia antes de marcar como "tardanza"
    TOLERANCIA_TARDANZA_MIN: int = 10
    # Minutos desde el inicio del turno para marcar automáticamente como "falta"
    TOLERANCIA_FALTA_MIN: int = 120

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Uploads
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_MB: int = 10

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
