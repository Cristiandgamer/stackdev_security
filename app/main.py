from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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
    # Docs solo en desarrollo — nunca exponer en producción
    docs_url="/api/docs" if os.getenv("ENVIRONMENT") != "production" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if os.getenv("ENVIRONMENT") != "production" else None,
)

# ── 1. ProxyHeadersMiddleware ─────────────────────────────────────────────────
# Railway termina TLS en su propio proxy. Este middleware restaura la IP real
# y el protocolo (https) desde los headers X-Forwarded-For / X-Forwarded-Proto.
# trusted_hosts="*" es seguro aquí porque Railway ya filtra el tráfico externo
# a nivel de infraestructura antes de llegar a nuestro contenedor.
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

# ── 2. TrustedHostMiddleware (OWASP A05 — Security Misconfiguration) ──────────
# Protege contra Host Header Injection. Se configura con el dominio real
# desde la variable de entorno TRUSTED_HOSTS en Railway.
# Valor recomendado en Railway:
#   TRUSTED_HOSTS=["stackdevsecurity-production.up.railway.app","localhost"]
# Si no está configurado, se permiten todos los hosts (menos seguro pero funcional).
_trusted_hosts = getattr(settings, "TRUSTED_HOSTS", [])
if _trusted_hosts:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=_trusted_hosts,
    )
else:
    logger.warning(
        "⚠ TRUSTED_HOSTS no configurado — TrustedHostMiddleware desactivado. "
        "Configura TRUSTED_HOSTS en Railway para mayor seguridad."
    )

# ── 3. Security Headers (OWASP A05) ──────────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    # Evita que el navegador adivine el MIME type (OWASP A05)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    # Protege contra clickjacking (OWASP A04)
    response.headers.setdefault("X-Frame-Options", "DENY")
    # Controla información enviada en Referer
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    # Restringe acceso a hardware sensible (OWASP A05)
    response.headers.setdefault(
        "Permissions-Policy",
        "geolocation=(self), microphone=(), camera=(self)"
    )
    # HSTS solo en HTTPS (OWASP A02)
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
# allow_credentials=False porque usamos JWT en header Authorization,
# no en cookies. Esto evita ataques CSRF.
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

# ── Archivos subidos ──────────────────────────────────────────────────────────
if os.path.exists(settings.UPLOAD_DIR):
    app.mount(
        "/uploads",
        StaticFiles(directory=settings.UPLOAD_DIR),
        name="uploads",
    )

# ── Frontend SPA ──────────────────────────────────────────────────────────────
# El Dockerfile copia el dist en /app/frontend/dist
# __file__ = /app/app/main.py → dirname = /app/app → join frontend/dist = /app/app/frontend/dist
# PERO el Dockerfile hace: COPY --from=frontend-builder /frontend/dist ./frontend/dist
# lo que deja el dist en /app/frontend/dist (relativo al WORKDIR /app)
FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "frontend", "dist"
)

if os.path.exists(FRONTEND_DIST):
    logger.info(f"✓ Sirviendo frontend desde {FRONTEND_DIST}")

    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/favicon.svg")
    def favicon():
        return FileResponse(os.path.join(FRONTEND_DIST, "favicon.svg"))

    @app.get("/manifest.json")
    def manifest():
        return FileResponse(
            os.path.join(FRONTEND_DIST, "manifest.json"),
            media_type="application/json",
        )

    # SPA fallback — todas las rutas del router de React devuelven index.html
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        if full_path.startswith(("api/", "uploads/")):
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
else:
    logger.warning(
        f"⚠ Frontend dist no encontrado en {FRONTEND_DIST} — modo API only"
    )
