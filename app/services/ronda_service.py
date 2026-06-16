"""
Servicio de Rondas — Stack Dev Security

Lógica de negocio:
- GPS verifica que el guardia esté sobre las coordenadas del mapa (no del dispositivo)
- Ciclo: X rondas por turno, con Y minutos de descanso entre rondas
- Si no completa → notificación + registro incompleto
"""
import math
import secrets
import logging
from datetime import datetime, timedelta
from typing import Optional, Tuple
from sqlalchemy.orm import Session

from app.models.seguridad import (
    PuntoControl, VerificacionPunto, RondaEjecucion,
    Ronda, Turno, Guardia, Notificacion
)
from app.models.usuario import Usuario
from app.core.config import settings

logger = logging.getLogger(__name__)


# ── GPS ───────────────────────────────────────────────────────────────────────

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia en metros entre dos coordenadas GPS (fórmula de Haversine)."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def verificar_gps_punto(
    punto: PuntoControl,
    lat_guardia: float,
    lon_guardia: float,
    radio_metros: int,
) -> Tuple[bool, float]:
    """
    Verifica si el guardia está dentro del radio del punto.

    - punto.latitud / punto.longitud = coordenadas definidas en el mapa por el admin
    - lat_guardia / lon_guardia = posición GPS real del guardia
    - radio_metros = radio global de la instalación

    Retorna (valido, distancia_metros)
    """
    distancia = haversine(punto.latitud, punto.longitud, lat_guardia, lon_guardia)
    return distancia <= radio_metros, round(distancia, 2)


def verificar_qr(punto: PuntoControl, token_escaneado: str) -> bool:
    """Verifica que el QR escaneado coincida con el token del punto."""
    return (
        punto.qr_token is not None
        and secrets.compare_digest(punto.qr_token, token_escaneado)
    )


def generar_qr_token() -> str:
    return secrets.token_urlsafe(32)


# ── Ejecuciones de Ronda ──────────────────────────────────────────────────────

def obtener_ejecucion_activa(
    db: Session,
    turno_id: int,
    ronda_id: int,
    guardia_id: int,
) -> Optional[RondaEjecucion]:
    """
    Retorna la ejecución en_progreso del turno, o la siguiente pendiente
    si ya se cumplió el tiempo de descanso.
    """
    # 1. Buscar en_progreso
    en_progreso = (
        db.query(RondaEjecucion)
        .filter(
            RondaEjecucion.turno_id == turno_id,
            RondaEjecucion.estado == "en_progreso",
        )
        .first()
    )
    if en_progreso:
        return en_progreso

    # 2. Buscar pendiente que ya esté disponible
    ahora = datetime.utcnow()
    pendiente = (
        db.query(RondaEjecucion)
        .filter(
            RondaEjecucion.turno_id == turno_id,
            RondaEjecucion.estado == "pendiente",
        )
        .order_by(RondaEjecucion.numero_ronda.asc())
        .first()
    )
    if pendiente:
        # ¿Ya está disponible? (primera ronda siempre disponible)
        if (
            pendiente.proxima_ronda_disponible is None
            or ahora >= pendiente.proxima_ronda_disponible
        ):
            return pendiente

    return None


def iniciar_ejecucion(
    db: Session,
    ejecucion: RondaEjecucion,
) -> RondaEjecucion:
    """Marca una ejecución pendiente como en_progreso."""
    if ejecucion.estado != "pendiente":
        return ejecucion
    ejecucion.estado = "en_progreso"
    ejecucion.iniciada_en = datetime.utcnow()
    db.commit()
    db.refresh(ejecucion)
    return ejecucion


def crear_ejecuciones_turno(
    db: Session,
    turno: Turno,
    ronda: Ronda,
    guardia_id: int,
) -> list[RondaEjecucion]:
    """
    Crea todas las ejecuciones de ronda para un turno de una sola vez.
    La primera está disponible inmediatamente; las siguientes tendrán
    proxima_ronda_disponible = None (se calcula al completar la anterior).
    """
    # Verificar que no existan ya
    existentes = (
        db.query(RondaEjecucion)
        .filter(RondaEjecucion.turno_id == turno.id)
        .count()
    )
    if existentes > 0:
        return db.query(RondaEjecucion).filter(
            RondaEjecucion.turno_id == turno.id
        ).order_by(RondaEjecucion.numero_ronda).all()

    total_puntos = (
        db.query(PuntoControl)
        .filter(
            PuntoControl.ronda_id == ronda.id,
            PuntoControl.activo == True,
        )
        .count()
    )

    ejecuciones = []
    for i in range(1, ronda.rondas_por_turno + 1):
        ej = RondaEjecucion(
            turno_id=turno.id,
            ronda_id=ronda.id,
            guardia_id=guardia_id,
            numero_ronda=i,
            estado="pendiente",
            puntos_total=total_puntos,
            puntos_completados=0,
        )
        db.add(ej)
        ejecuciones.append(ej)

    db.commit()
    for ej in ejecuciones:
        db.refresh(ej)

    return ejecuciones


def completar_ejecucion(
    db: Session,
    ejecucion: RondaEjecucion,
    ronda: Ronda,
) -> RondaEjecucion:
    """
    Marca la ejecución como completada y programa la siguiente ronda.
    """
    ahora = datetime.utcnow()
    ejecucion.estado = "completada"
    ejecucion.completada_en = ahora

    if ejecucion.iniciada_en:
        delta = (ahora - ejecucion.iniciada_en).total_seconds() / 60
        ejecucion.minutos_duracion = int(delta)

    # Calcular cuándo estará disponible la siguiente ronda
    proxima = ahora + timedelta(minutes=ronda.descanso_entre_rondas_min)
    ejecucion.proxima_ronda_disponible = proxima

    # Activar la siguiente ejecución pendiente con la fecha disponible
    siguiente = (
        db.query(RondaEjecucion)
        .filter(
            RondaEjecucion.turno_id == ejecucion.turno_id,
            RondaEjecucion.numero_ronda == ejecucion.numero_ronda + 1,
            RondaEjecucion.estado == "pendiente",
        )
        .first()
    )
    if siguiente:
        siguiente.proxima_ronda_disponible = proxima

    db.commit()
    db.refresh(ejecucion)

    logger.info(
        f"Ronda {ejecucion.numero_ronda}/{ronda.rondas_por_turno} completada. "
        f"Próxima disponible: {proxima.isoformat()}"
    )
    return ejecucion


def marcar_incompleta(
    db: Session,
    ejecucion: RondaEjecucion,
    motivo: str = "Tiempo máximo excedido",
) -> RondaEjecucion:
    """Marca la ejecución como incompleta y notifica supervisores."""
    ejecucion.estado = "incompleta"
    ejecucion.notas_sistema = motivo

    # Notificar a supervisores y admins
    _notificar_supervisores(
        db,
        titulo=f"⚠️ Ronda incompleta — #{ejecucion.numero_ronda}",
        mensaje=(
            f"La ronda #{ejecucion.numero_ronda} del turno #{ejecucion.turno_id} "
            f"fue marcada como incompleta. Motivo: {motivo}. "
            f"Puntos completados: {ejecucion.puntos_completados}/{ejecucion.puntos_total}."
        ),
        tipo="ronda_incompleta",
        referencia_id=ejecucion.id,
    )

    db.commit()
    db.refresh(ejecucion)
    return ejecucion


def puntos_verificados_en_ejecucion(
    db: Session,
    ejecucion_id: int,
) -> set[int]:
    """Retorna IDs de puntos ya verificados en esta ejecución."""
    rows = (
        db.query(VerificacionPunto.punto_control_id)
        .filter(VerificacionPunto.ejecucion_id == ejecucion_id)
        .all()
    )
    return {r[0] for r in rows}


def progreso_ejecucion(
    db: Session,
    ejecucion: RondaEjecucion,
) -> dict:
    verificados = puntos_verificados_en_ejecucion(db, ejecucion.id)
    total = ejecucion.puntos_total
    return {
        "verificados": len(verificados),
        "total": total,
        "porcentaje": round(len(verificados) / total * 100, 1) if total > 0 else 0,
        "ids_verificados": list(verificados),
    }


def segundos_para_proxima_ronda(ejecucion: Optional[RondaEjecucion]) -> Optional[int]:
    """
    Retorna los segundos que faltan para que esté disponible la próxima ronda.
    Negativo = ya está disponible. None = no aplica.
    """
    if ejecucion is None:
        return None
    if ejecucion.proxima_ronda_disponible is None:
        return 0  # disponible ahora
    delta = (ejecucion.proxima_ronda_disponible - datetime.utcnow()).total_seconds()
    return int(delta)


# ── Notificaciones ────────────────────────────────────────────────────────────

def _notificar_supervisores(
    db: Session,
    titulo: str,
    mensaje: str,
    tipo: str = "info",
    referencia_id: Optional[int] = None,
) -> None:
    supervisores = (
        db.query(Usuario)
        .filter(
            Usuario.rol.in_(["admin", "supervisor"]),
            Usuario.activo == True,
        )
        .all()
    )
    for sup in supervisores:
        db.add(Notificacion(
            usuario_id=sup.id,
            titulo=titulo,
            mensaje=mensaje,
            tipo=tipo,
            referencia_id=referencia_id,
            referencia_tipo="ronda_ejecucion",
        ))
