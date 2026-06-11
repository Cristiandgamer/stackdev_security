from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from contextlib import asynccontextmanager
from sqlalchemy import text
import os
import re
import logging

logger = logging.getLogger(__name__)

from app.core.config import settings
from app.core.database import engine, Base
from app.routers import auth, usuarios, seguridad, asistencia


def ensure_missing_columns():
    """Agrega columnas faltantes sin borrar datos existentes."""
    with engine.connect() as conn:
        checks = [
            ("usuarios",        "apellido",            "VARCHAR(100)"),
            ("usuarios",        "username",            "VARCHAR(80)"),
            ("guardias",        "instalacion_id",      "INT"),
            ("puntos_control",  "ronda_id",            "INT"),
            ("turnos",          "dias_semana",         "TEXT"),
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


def seed_config_asistencia():
    """Crea el registro de configuración de asistencia si no existe."""
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
            logger.info("Configuración de asistencia inicializada")
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
    docs_url="/api/docs" if os.getenv("ENVIRONMENT") != "production" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if os.getenv("ENVIRONMENT") != "production" else None,
)

# ── 1. ProxyHeadersMiddleware ─────────────────────────────────────────────────
# Railway termina TLS en su proxy; esto restaura IP real y proto https.
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

# ── 2. TrustedHostMiddleware (OWASP A05) ──────────────────────────────────────
# Configura en Railway: TRUSTED_HOSTS=["stackdevsecurity-production.up.railway.app","localhost"]
_trusted_hosts = getattr(settings, "TRUSTED_HOSTS", [])
if _trusted_hosts:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=_trusted_hosts,
    )
else:
    logger.warning(
        "⚠ TRUSTED_HOSTS no configurado — TrustedHostMiddleware desactivado. "
        "Agrega TRUSTED_HOSTS en Railway para protección contra Host Header Injection."
    )

# ── 3. Security Headers (OWASP A05) ──────────────────────────────────────────
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

# ── 4. CORS (OWASP A05) ───────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=settings.ALLOW_CREDENTIALS,
    allow_methods=settings.ALLOWED_METHODS,
    allow_headers=settings.ALLOWED_HEADERS,
)

# ── API Routers ───────────────────────────────────────────────────────────────
app.include_router(auth.router,       prefix="/api/auth",       tags=["auth"])
app.include_router(usuarios.router,   prefix="/api/usuarios",   tags=["usuarios"])
app.include_router(seguridad.router,  prefix="/api",            tags=["seguridad"])
app.include_router(asistencia.router, prefix="/api/asistencia", tags=["asistencia"])

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "app": "Stack Dev Security"}

# ── Archivos subidos por usuarios ─────────────────────────────────────────────
if os.path.exists(settings.UPLOAD_DIR):
    app.mount(
        "/uploads",
        StaticFiles(directory=settings.UPLOAD_DIR),
        name="uploads",
    )

# ── Frontend SPA ──────────────────────────────────────────────────────────────
# Dockerfile: WORKDIR /app → COPY --from=frontend-builder /frontend/dist ./frontend/dist
# Resultado en contenedor: /app/frontend/dist
# __file__ = /app/app/main.py → dirname(__file__) = /app/app
# dirname(dirname(__file__)) = /app  →  /app/frontend/dist  ✓
FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "frontend", "dist",
)

if os.path.exists(FRONTEND_DIST):
    logger.info(f"✓ Frontend encontrado en {FRONTEND_DIST}")

    # /assets/** — JS, CSS y otros chunks generados por Vite
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # SPA fallback — debe ir AL FINAL para no interceptar rutas de API
    # Cualquier archivo que exista en dist se sirve directamente (favicon, manifest, etc.)
    # Si no existe → index.html (React Router maneja la ruta)
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # Normalizar path — quitar slash inicial si existe
        clean = full_path.lstrip("/")

        # ── Nunca interceptar rutas de API ni uploads ──────────────
        # Verificar con y sin slash para cubrir todos los casos
        api_prefixes = ("api/", "api", "uploads/", "uploads")
        if any(clean == p or clean.startswith(p + "/") or clean.startswith(p)
               for p in ("api", "uploads")):
            return JSONResponse({"detail": "Not Found"}, status_code=404)

        # ── Servir archivos estáticos que existan en el dist ───────
        # (favicon.svg, manifest.json, robots.txt, etc.)
        if clean:
            file_path = os.path.join(FRONTEND_DIST, clean)
            if os.path.isfile(file_path):
                return FileResponse(file_path)

        # ── Todo lo demás → index.html (React Router) ──────────────
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

else:
    logger.warning(f"Frontend dist no encontrado en {FRONTEND_DIST}")