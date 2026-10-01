import time
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

logger = logging.getLogger(__name__)


def create_engine_with_retry(url: str, retries: int = 10, delay: int = 5):
    for attempt in range(1, retries + 1):
        try:
            engine = create_engine(
                url,
                pool_size=10,
                max_overflow=20,
                pool_recycle=280,
                pool_pre_ping=True,
                connect_args={"init_command": "SET time_zone = '+00:00'"},
                echo=False,
            )
            # Verificar conexión real
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info(f"✓ Conectado a MySQL (intento {attempt})")
            return engine
        except Exception as e:
            logger.warning(f"MySQL no disponible (intento {attempt}/{retries}): {e}")
            if attempt < retries:
                time.sleep(delay)
    raise RuntimeError("No se pudo conectar a MySQL después de varios intentos")


engine = create_engine_with_retry(settings.DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
