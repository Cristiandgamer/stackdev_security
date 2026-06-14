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
from app.routers import auth, usuarios, seguridad, asistencia


def ensure_missing_columns():
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
            ("rondas",          "intervalo_minutos",   "INT DEFAULT 60"),
            ("rondas",          "rondas_por_turno",    "INT DEFAULT 1")
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

# ── API Routers — registrar ANTES del mount de archivos estáticos ─────────────
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
    app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# ── Frontend SPA ──────────────────────────────────────────────────────────────
# El Dockerfile copia el dist en /app/frontend/dist
FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "frontend", "dist",
)

if os.path.exists(FRONTEND_DIST):
    logger.info(f"✓ Frontend encontrado en {FRONTEND_DIST}")

    # Montar assets con hash (JS, CSS generados por Vite)
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # SPA fallback — esta ruta se registra AL FINAL, después de los routers.
    # FastAPI/Starlette resuelve rutas en orden de registro y da prioridad
    # a las rutas más específicas de los routers /api/* sobre este catch-all.
    # Si una request no matchea ningún router (ej: /asistencias, /login,
    # /turnos), cae aquí y se sirve index.html para que React Router
    # maneje la navegación del lado del cliente.
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        clean = full_path.lstrip("/")

        # ── Protección Path Traversal (OWASP A01/A05) ──────────────
        # Resuelve la ruta absoluta y verifica que siga dentro de FRONTEND_DIST.
        # Bloquea intentos como /../../etc/passwd, /..%2f.., rutas con \0, etc.
        if clean:
            requested_path = os.path.abspath(os.path.join(FRONTEND_DIST, clean))
            frontend_root = os.path.abspath(FRONTEND_DIST)
            if not requested_path.startswith(frontend_root + os.sep):
                # Intento de escapar del directorio del frontend
                if clean.startswith("api") or clean.startswith("uploads"):
                    return JSONResponse({"detail": "Not Found"}, status_code=404)
                return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

            if os.path.isfile(requested_path):
                return FileResponse(requested_path)

        # Cualquier ruta de API que llegue hasta aquí significa que no
        # matcheó ningún router → 404 JSON real, nunca HTML
        if clean.startswith("api") or clean.startswith("uploads"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)

        # Rutas del SPA (/asistencias, /turnos, /login, etc.) → index.html
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

else:
    logger.warning(f"⚠ Frontend dist no encontrado en {FRONTEND_DIST}")
