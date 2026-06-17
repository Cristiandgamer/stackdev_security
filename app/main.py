from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from contextlib import asynccontextmanager
from sqlalchemy import text
import os
import re
import logging

logger = logging.getLogger(__name__)

from app.core.config import settings
from app.core.database import engine, Base
from app.routers import auth, usuarios, seguridad, asistencia, rondas


def ensure_missing_columns():
    with engine.connect() as conn:
        checks = [
            ("usuarios",        "apellido",            "VARCHAR(100)"),
            ("usuarios",        "username",            "VARCHAR(80)"),
            ("guardias",        "instalacion_id",      "INT"),
            ("puntos_control",  "ronda_id",            "INT"),
            ("puntos_control",  "radio_metros",        "INT DEFAULT 50"),
            ("turnos",          "dias_semana",         "TEXT"),
            ("turnos",          "ronda_id",            "INT"),
            ("turnos",          "tipo",                "VARCHAR(20) DEFAULT 'diurno'"),
            ("asistencias",     "latitud_salida",      "DOUBLE"),
            ("asistencias",     "longitud_salida",     "DOUBLE"),
            ("asistencias",     "distancia_entrada",   "DOUBLE"),
            ("asistencias",     "distancia_salida",    "DOUBLE"),
            ("asistencias",     "foto_entrada",        "VARCHAR(500)"),
            ("asistencias",     "foto_salida",         "VARCHAR(500)"),
            ("asistencias",     "estado",              "VARCHAR(20) NOT NULL DEFAULT 'sin_marcar'"),
            ("asistencias",     "minutos_retraso",     "INT NOT NULL DEFAULT 0"),
            ("asistencias",     "minutos_trabajados",  "INT"),
            ("asistencias",     "horas_extra",         "DOUBLE NOT NULL DEFAULT 0"),
            ("asistencias",     "observacion",         "TEXT"),
            # ── Sistema de rondas reconstruido ──────────────────────────────
            ("instalaciones",   "radio_gps_metros",    "INT DEFAULT 15"),
            ("instalaciones",   "descripcion",         "TEXT"),
            ("instalaciones",   "ciudad",              "VARCHAR(100)"),
            ("instalaciones",   "telefono",            "VARCHAR(30)"),
            ("instalaciones",   "tipo",                "VARCHAR(30)"),
            ("rondas",          "rondas_por_turno",    "INT DEFAULT 1 NOT NULL"),
            ("rondas",          "descanso_entre_rondas_min", "INT DEFAULT 60 NOT NULL"),
            ("rondas",          "tiempo_maximo_ronda_min",   "INT DEFAULT 0 NOT NULL"),
            ("verificaciones_punto", "ejecucion_id",   "INT"),
        ]
        for table, column, ddl_type in checks:
            result = conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_schema = DATABASE() "
                "AND table_name = :table AND column_name = :column"
            ), {"table": table, "column": column})
            if result.scalar_one() == 0:
                logger.info(f"Agregando columna faltante: {table}.{column}")
                ddl_type_sql = ddl_type.strip()
                if not re.search(r"\bNOT\s+NULL\b|\bNULL\b", ddl_type_sql, re.I):
                    ddl_type_sql = f"{ddl_type_sql} NULL"
                conn.execute(text(
                    f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type_sql}"
                ))
        conn.commit()


def fill_null_defaults():
    """
    Rellena columnas que quedaron con NULL tras un ALTER TABLE ADD COLUMN.
    MySQL no aplica el DEFAULT a filas existentes cuando la columna es nullable,
    por eso este paso corre en cada arranque y es idempotente (no toca filas ya con valor).
    """
    updates = [
        ("puntos_control", "radio_metros",            50),
        ("instalaciones",  "radio_gps_metros",        15),
        ("rondas",         "rondas_por_turno",         1),
        ("rondas",         "descanso_entre_rondas_min", 60),
        ("rondas",         "tiempo_maximo_ronda_min",   0),
        ("asistencias",    "minutos_retraso",           0),
        ("asistencias",    "horas_extra",               0),
    ]
    try:
        with engine.connect() as conn:
            for table, column, default_value in updates:
                # Verificar que la columna existe antes de actualizar
                exists = conn.execute(text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() "
                    "AND table_name = :table AND column_name = :column"
                ), {"table": table, "column": column}).scalar_one()
                if exists:
                    conn.execute(text(
                        f"UPDATE {table} SET {column} = :val WHERE {column} IS NULL"
                    ), {"val": default_value})
            conn.commit()
            logger.info("✓ Valores NULL corregidos con defaults")
    except Exception as e:
        logger.warning(f"No se pudieron corregir NULLs: {e}")


def crear_tabla_ronda_ejecuciones():
    """Crea la tabla ronda_ejecuciones si no existe (migración idempotente)."""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ronda_ejecuciones (
                    id                       INT AUTO_INCREMENT PRIMARY KEY,
                    turno_id                 INT NOT NULL,
                    ronda_id                 INT NOT NULL,
                    guardia_id               INT NOT NULL,
                    numero_ronda             INT NOT NULL,
                    estado                   VARCHAR(20) NOT NULL DEFAULT 'pendiente',
                    iniciada_en              DATETIME NULL,
                    completada_en            DATETIME NULL,
                    proxima_ronda_disponible DATETIME NULL,
                    minutos_duracion         INT NULL,
                    puntos_completados       INT NOT NULL DEFAULT 0,
                    puntos_total             INT NOT NULL DEFAULT 0,
                    notas_sistema            TEXT NULL,
                    created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX ix_ronda_ejecuciones_turno_numero (turno_id, numero_ronda),
                    INDEX ix_re_ronda_id (ronda_id),
                    INDEX ix_re_guardia_id (guardia_id)
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            """))
            conn.commit()
            logger.info("✓ Tabla ronda_ejecuciones verificada/creada")
    except Exception as e:
        logger.warning(f"No se pudo crear ronda_ejecuciones: {e}")


def seed_config_asistencia():
    from app.models.seguridad_model import ConfigAsistencia
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
        fill_null_defaults()          # ← NUEVO: corrige NULLs en filas antiguas
        crear_tabla_ronda_ejecuciones()
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
    version="2.1.0",
    lifespan=lifespan,
    docs_url="/api/docs" if os.getenv("ENVIRONMENT") != "production" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if os.getenv("ENVIRONMENT") != "production" else None,
)

# ── 1. ProxyHeadersMiddleware ─────────────────────────────────────────────────
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

# ── 2. TrustedHostMiddleware (OWASP A05) ──────────────────────────────────────
_trusted_hosts = getattr(settings, "TRUSTED_HOSTS", [])
if _trusted_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_trusted_hosts)
else:
    logger.warning("⚠ TRUSTED_HOSTS no configurado")

# ── 3. Security Headers ───────────────────────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "geolocation=(self), microphone=(), camera=(self)",
    )
    forwarded_proto = (
        request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    )
    if request.url.scheme == "https" or forwarded_proto == "https":
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=63072000; includeSubDomains; preload",
        )
    return response

# ── 4. CORS ───────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=settings.ALLOW_CREDENTIALS,
    allow_methods=settings.ALLOWED_METHODS,
    allow_headers=settings.ALLOWED_HEADERS,
)

# ── API Routers ───────────────────────────────────────────────────────────────
# rondas.router ANTES que seguridad.router para evitar que
# /api/rondas/{ronda_id} capture rutas como /api/rondas/turno-activo
app.include_router(auth.router,       prefix="/api/auth",       tags=["auth"])
app.include_router(usuarios.router,   prefix="/api/usuarios",   tags=["usuarios"])
app.include_router(rondas.router,     prefix="/api/rondas",     tags=["rondas"])
app.include_router(seguridad.router,  prefix="/api",            tags=["seguridad"])
app.include_router(asistencia.router, prefix="/api/asistencia", tags=["asistencia"])

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "app": "Stack Dev Security"}

# ── Archivos subidos ──────────────────────────────────────────────────────────
if os.path.exists(settings.UPLOAD_DIR):
    app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# ── Frontend SPA ──────────────────────────────────────────────────────────────
FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "frontend", "dist",
)

if os.path.exists(FRONTEND_DIST):
    logger.info(f"✓ Frontend encontrado en {FRONTEND_DIST}")

    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        clean = full_path.lstrip("/")

        if clean:
            requested_path = os.path.abspath(os.path.join(FRONTEND_DIST, clean))
            frontend_root = os.path.abspath(FRONTEND_DIST)
            if not requested_path.startswith(frontend_root + os.sep):
                if clean.startswith("api") or clean.startswith("uploads"):
                    return JSONResponse({"detail": "Not Found"}, status_code=404)
                return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

            if os.path.isfile(requested_path):
                return FileResponse(requested_path)

        if clean.startswith("api") or clean.startswith("uploads"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)

        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

else:
    logger.warning(f"⚠ Frontend dist no encontrado en {FRONTEND_DIST}")
