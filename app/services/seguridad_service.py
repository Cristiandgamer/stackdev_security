import math
import secrets
from typing import Optional, Tuple
from sqlalchemy.orm import Session
from app.models.seguridad import PuntoControl, VerificacionPunto
from app.core.config import settings


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia en metros entre dos coordenadas GPS (fórmula de Haversine)."""
    R = 6_371_000  # radio tierra en metros
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def generar_qr_token() -> str:
    return secrets.token_urlsafe(32)


def verificar_gps(
    punto: PuntoControl,
    lat: float,
    lon: float
) -> Tuple[bool, float]:
    """Retorna (valido, distancia_metros)."""
    distancia = haversine(punto.latitud, punto.longitud, lat, lon)
    radio = punto.radio_metros or settings.CHECKPOINT_RADIO_METROS
    return distancia <= radio, round(distancia, 2)


def verificar_qr(punto: PuntoControl, token_escaneado: str) -> bool:
    return punto.qr_token is not None and punto.qr_token == token_escaneado


def progreso_ronda(db: Session, turno_id: int) -> dict:
    """Calcula cuántos puntos han sido verificados en el turno actual."""
    from app.models.seguridad import Turno, Instalacion
    turno = db.query(Turno).filter(Turno.id == turno_id).first()
    if not turno:
        return {"total": 0, "verificados": 0, "porcentaje": 0}

    total = db.query(PuntoControl).filter(
        PuntoControl.instalacion_id == turno.instalacion_id,
        PuntoControl.activo == True
    ).count()

    verificados = db.query(VerificacionPunto).filter(
        VerificacionPunto.turno_id == turno_id
    ).distinct(VerificacionPunto.punto_control_id).count()

    return {
        "total": total,
        "verificados": verificados,
        "porcentaje": round(verificados / total * 100, 1) if total > 0 else 0
    }
