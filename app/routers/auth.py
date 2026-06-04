from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_current_user
from app.models.usuario import Usuario
from app.schemas.schemas import Token, LoginRequest
from app.core.config import settings
import hashlib
import logging

logger = logging.getLogger(__name__)

# Optional Redis client (fallback to in-memory if not configured)
redis_client = None
try:
    if settings.REDIS_URL:
        import redis
        redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
except Exception:
    redis_client = None

router = APIRouter()

# Simple in-memory tracker for failed login attempts.
# Keyed by "ip|email" -> {count: int, lock_until: datetime}
from datetime import datetime, timedelta
_login_attempts: dict = {}
MAX_ATTEMPTS = 5
LOCK_SECONDS = 300  # 5 minutes (default)


@router.post("/login", response_model=Token)
def login(form: LoginRequest, request: Request, db: Session = Depends(get_db)):
    # Identify client by IP + email to avoid collision
    client_ip = request.client.host if request.client else '0.0.0.0'
    key = f"{client_ip}|{form.email.lower().strip()}"

    # If Redis is configured, use it for attempt tracking (atomic and shared across processes)
    now = datetime.utcnow()
    if redis_client:
        email_norm = form.email.lower().strip()
        attempts_key = f"login:attempts:{client_ip}:{email_norm}"
        lock_key = f"login:lock:{client_ip}:{email_norm}"

        # Check lock
        if redis_client.exists(lock_key):
            retry_after = redis_client.ttl(lock_key)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"msg": "Demasiados intentos. Intente nuevamente más tarde.", "retry_after": retry_after},
            )

        user = db.query(Usuario).filter(
            Usuario.email == form.email,
            Usuario.activo == True
        ).first()

        if not user or not verify_password(form.password, user.hashed_password):
            identifier = hashlib.sha256(form.email.lower().strip().encode()).hexdigest()[:8]
            logger.warning("Login fallido para %s desde %s", identifier, client_ip)
            attempts = redis_client.incr(attempts_key)
            if attempts == 1:
                redis_client.expire(attempts_key, LOCK_SECONDS)
            if attempts >= MAX_ATTEMPTS:
                redis_client.set(lock_key, 1, ex=LOCK_SECONDS)
                redis_client.delete(attempts_key)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={"msg": "Demasiados intentos. Intente nuevamente más tarde.", "retry_after": LOCK_SECONDS},
                )
            else:
                attempts_left = MAX_ATTEMPTS - attempts
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={"msg": "Credenciales incorrectas", "attempts_left": attempts_left},
                )
    else:
        # Fallback: in-memory tracking (single-process)
        record = _login_attempts.get(key, {"count": 0, "lock_until": None})
        if record.get("lock_until") and now < record["lock_until"]:
            retry_after = int((record["lock_until"] - now).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"msg": "Demasiados intentos. Intente nuevamente más tarde.", "retry_after": retry_after},
            )

        user = db.query(Usuario).filter(
            Usuario.email == form.email,
            Usuario.activo == True
        ).first()

        if not user or not verify_password(form.password, user.hashed_password):
            identifier = hashlib.sha256(form.email.lower().strip().encode()).hexdigest()[:8]
            logger.warning("Login fallido para %s desde %s", identifier, client_ip)
            record["count"] = record.get("count", 0) + 1
            if record["count"] >= MAX_ATTEMPTS:
                record["lock_until"] = now + timedelta(seconds=LOCK_SECONDS)
                _login_attempts[key] = record
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={"msg": "Demasiados intentos. Intente nuevamente más tarde.", "retry_after": LOCK_SECONDS},
                )
            else:
                _login_attempts[key] = record
                attempts_left = MAX_ATTEMPTS - record["count"]
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={"msg": "Credenciales incorrectas", "attempts_left": attempts_left},
                )

    # Login successful -> reset attempts
    email_norm = form.email.lower().strip()
    if redis_client:
        attempts_key = f"login:attempts:{client_ip}:{email_norm}"
        lock_key = f"login:lock:{client_ip}:{email_norm}"
        try:
            redis_client.delete(attempts_key)
            redis_client.delete(lock_key)
        except Exception:
            pass
    else:
        if key in _login_attempts:
            del _login_attempts[key]

    token = create_access_token(data={"sub": str(user.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "nombre": user.nombre,
            "apellido": user.apellido,
            "username": user.username,
            "email": user.email,
            "rol": user.rol,
        }
    }


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    return {
        "id": current_user.id,
        "nombre": current_user.nombre,
        "apellido": current_user.apellido,
        "email": current_user.email,
        "rol": current_user.rol,
    }
