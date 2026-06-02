from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from sqlalchemy import text
import os
import logging

logger = logging.getLogger(__name__)

from app.core.config import settings
from app.core.database import engine, Base
from app.routers import auth, usuarios, seguridad, asistencia   # ← nuevo router


def ensure_missing_columns():
    """Agrega columnas faltantes sin borrar datos existentes."""
    with engine.connect() as conn:
        checks = [
            # ── columnas originales ──────────────────────────────────────
            ("usuarios",   "apellido",   "VARCHAR(100)"),
            ("usuarios",   "username",   "VARCHAR(80)"),
            ("guardias",   "instalacion_id", "INT"),
            ("puntos_control", "ronda_id", "INT"),
            # ── nuevas columnas de asistencia ────────────────────────────
            ("asistencias", "latitud_salida",    "DOUBLE"),
            ("asistencias", "longitud_salida",   "DOUBLE"),
            ("asistencias", "distancia_entrada", "DOUBLE"),
            ("asistencias", "distancia_salida",  "DOUBLE"),
            ("asistencias", "foto_entrada",      "VARCHAR(500)"),
            ("asistencias", "foto_salida",       "VARCHAR(500)"),
            ("asistencias", "estado",            "VARCHAR(20) NOT NULL DEFAULT 'sin_marcar'"),
            ("asistencias", "minutos_retraso",   "INT NOT NULL DEFAULT 0"),
            ("asistencias", "minutos_trabajados","INT"),
            ("asistencias", "horas_extra",       "DOUBLE NOT NULL DEFAULT 0"),
            ("asistencias", "observacion",       "TEXT"),
        ]
        for table, column, ddl_type in checks:
            result = conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_schema = DATABASE() "
                "AND table_name = :table AND column_name = :column"
            ), {"table": table, "column": column})
            if result.scalar_one() == 0:
                logger.info(f"Agregando columna faltante: {table}.{column}")
                conn.execute(text(
                    f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type} NULL"
                ))
        conn.commit()


def seed_config_asistencia():
    """Crea el registro de configuración de asistencia si no existe."""
    from app.models.seguridad import ConfigAsistencia
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        cfg = db.query(ConfigAsistencia).filter(ConfigAsistencia.id == 1).first()
        if not cfg:
            cfg = ConfigAsistencia(
                id=1,
                tolerancia_tardanza_min=settings.TOLERANCIA_TARDANZA_MIN,
                tolerancia_falta_min=settings.TOLERANCIA_FALTA_MIN,
                radio_geofence_metros=settings.CHECKPOINT_RADIO_METROS,
                requiere_foto=True,
                reconocimiento_facial=False,
            )
            db.add(cfg)
            db.commit()
            logger.info("✓ Configuración de asistencia inicializada")
    except Exception as e:
        logger.warning(f"No se pudo inicializar config asistencia: {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine, checkfirst=True)
        ensure_missing_columns()
        seed_config_asistencia()
        logger.info("✓ Tablas verificadas/creadas")
    except Exception as e:
        logger.error(f"Error inicializando BD: {e}")
    try:
        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    except Exception as e:
        logger.warning(f"No se pudo crear directorio uploads: {e}")
    yield


app = FastAPI(
    title="Stack Dev Security API",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,       prefix="/api/auth",       tags=["auth"])
app.include_router(usuarios.router,   prefix="/api/usuarios",   tags=["usuarios"])
app.include_router(seguridad.router,  prefix="/api",            tags=["seguridad"])
app.include_router(asistencia.router, prefix="/api/asistencia", tags=["asistencia"])  # ← nuevo

# Archivos subidos
if os.path.exists(settings.UPLOAD_DIR):
    app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# Frontend SPA
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/health")
    def health():
        return {"status": "ok", "app": "Stack Dev Security"}

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        index = os.path.join(FRONTEND_DIST, "index.html")
        return FileResponse(index)
else:
    @app.get("/health")
    def health():
        return {"status": "ok", "app": "Stack Dev Security", "mode": "api-only"}
