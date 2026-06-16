"""
Router de Rondas — Stack Dev Security

Endpoints:
  GET  /rondas/turno-activo            → turno + ejecución activa para el guardia
  POST /rondas/iniciar                 → inicia la ejecución activa
  POST /rondas/verificar-punto         → verifica un punto (GPS o QR)
  GET  /rondas/resumen/{turno_id}      → resumen de rondas para supervisor

  GET  /rondas/plantillas/{inst_id}    → lista plantillas de ronda de instalación
  POST /rondas/plantillas              → crea plantilla (admin)
  PUT  /rondas/plantillas/{id}         → edita plantilla
  DELETE /rondas/plantillas/{id}       → desactiva plantilla

  GET  /puntos-control/{inst_id}       → lista puntos de una instalación
  POST /puntos-control                 → crea punto (coordenadas del mapa)
  PUT  /puntos-control/{id}            → edita punto
  DELETE /puntos-control/{id}          → desactiva punto
  POST /puntos-control/{id}/qr         → regenera QR
  GET  /puntos-control/{id}/qr-imagen  → imagen PNG del QR
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import datetime, timedelta
import io, logging

from app.core.database import get_db
from app.core.security import require_any, require_supervisor, require_admin, get_current_user
from app.models.seguridad import (
    PuntoControl, VerificacionPunto, RondaEjecucion,
    Ronda, Turno, Guardia, Instalacion, Notificacion
)
from app.models.usuario import Usuario
from app.schemas.schemas_ronda import (
    RondaCreate, RondaUpdate, RondaOut, RondaConPuntosOut,
    PuntoControlCreate, PuntoControlUpdate, PuntoControlOut,
    VerificacionCreate, VerificacionOut,
    TurnoActivoOut, EjecucionActivaOut, PuntoConEstadoOut,
    RondaEjecucionOut, ResumenRondasTurnoOut,
)
from app.services.ronda_service import (
    verificar_gps_punto, verificar_qr, generar_qr_token,
    obtener_ejecucion_activa, iniciar_ejecucion,
    crear_ejecuciones_turno, completar_ejecucion, marcar_incompleta,
    puntos_verificados_en_ejecucion, progreso_ejecucion,
    segundos_para_proxima_ronda, _notificar_supervisores,
)
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_guardia_o_404(db: Session, usuario_id: int) -> Guardia:
    g = db.query(Guardia).filter(
        Guardia.usuario_id == usuario_id,
        Guardia.activo == True,
    ).first()
    if not g:
        raise HTTPException(404, "No se encontró guardia asociado al usuario")
    return g


def _get_turno_activo(db: Session, guardia_id: int) -> Turno:
    """Busca el turno activo del guardia (en_curso o asignado/programado en horario)."""
    ahora = datetime.utcnow()

    # 1. Turno en_curso
    turno = (
        db.query(Turno)
        .filter(
            Turno.guardia_id == guardia_id,
            Turno.estado.in_(["en_curso", "activo"]),
        )
        .first()
    )
    if turno:
        return turno

    # 2. Turno programado dentro del horario
    turno = (
        db.query(Turno)
        .filter(
            Turno.guardia_id == guardia_id,
            Turno.estado.in_(["programado", "asignado"]),
            Turno.fecha_inicio <= ahora,
            Turno.fecha_fin >= ahora,
        )
        .order_by(Turno.fecha_inicio.asc())
        .first()
    )
    if turno:
        return turno

    raise HTTPException(404, "No hay turno activo en este momento")


def _build_turno_activo_out(
    db: Session,
    turno: Turno,
    guardia_id: int,
) -> dict:
    """Construye el payload completo para TurnoActivoOut."""
    instalacion = turno.instalacion
    ronda = turno.ronda

    # Si el turno tiene ronda asignada, gestionar ejecuciones
    ejecucion_activa_out = None

    if ronda:
        # Asegurar que existan las ejecuciones para este turno
        ejecuciones = crear_ejecuciones_turno(db, turno, ronda, guardia_id)

        # Obtener ejecución activa (en_progreso o pendiente disponible)
        ejecucion = obtener_ejecucion_activa(db, turno.id, ronda.id, guardia_id)

        # Contar rondas completadas en este turno
        completadas = sum(1 for e in ejecuciones if e.estado == "completada")

        # Preparar puntos con estado de verificación
        puntos_db = (
            db.query(PuntoControl)
            .filter(
                PuntoControl.ronda_id == ronda.id,
                PuntoControl.activo == True,
            )
            .order_by(PuntoControl.orden)
            .all()
        )

        # IDs verificados en la ejecución actual
        ids_verificados: set[int] = set()
        ejecucion_id_out = None
        numero_ronda = completadas + 1
        estado_ej = "pendiente"
        iniciada_en_out = None
        proxima_out = None
        puntos_completados = 0
        seg_proxima = None

        if ejecucion:
            ids_verificados = puntos_verificados_en_ejecucion(db, ejecucion.id)
            ejecucion_id_out = ejecucion.id
            numero_ronda = ejecucion.numero_ronda
            estado_ej = ejecucion.estado
            iniciada_en_out = ejecucion.iniciada_en
            proxima_out = ejecucion.proxima_ronda_disponible
            puntos_completados = len(ids_verificados)
            seg_proxima = segundos_para_proxima_ronda(ejecucion)

        puntos_out = [
            {
                "id": p.id,
                "instalacion_id": p.instalacion_id,
                "ronda_id": p.ronda_id,
                "nombre": p.nombre,
                "descripcion": p.descripcion,
                "latitud": p.latitud,
                "longitud": p.longitud,
                "qr_token": p.qr_token,
                "activo": p.activo,
                "orden": p.orden,
                "created_at": p.created_at,
                "verificado": p.id in ids_verificados,
                "verificado_en": None,
                "distancia_metros": None,
            }
            for p in puntos_db
        ]

        ejecucion_activa_out = {
            "ejecucion_id": ejecucion_id_out,
            "numero_ronda": numero_ronda,
            "estado": estado_ej,
            "iniciada_en": iniciada_en_out,
            "proxima_ronda_disponible": proxima_out,
            "puntos_completados": puntos_completados,
            "puntos_total": len(puntos_db),
            "puntos": puntos_out,
            "rondas_completadas_turno": completadas,
            "rondas_por_turno": ronda.rondas_por_turno,
            "descanso_entre_rondas_min": ronda.descanso_entre_rondas_min,
            "segundos_para_proxima": seg_proxima,
        }

    return {
        "id": turno.id,
        "guardia_id": turno.guardia_id,
        "instalacion_id": turno.instalacion_id,
        "instalacion_nombre": instalacion.nombre if instalacion else "—",
        "instalacion_direccion": instalacion.direccion if instalacion else None,
        "instalacion_latitud": instalacion.latitud if instalacion else None,
        "instalacion_longitud": instalacion.longitud if instalacion else None,
        "radio_gps_metros": instalacion.radio_gps_metros if instalacion else settings.CHECKPOINT_RADIO_METROS,
        "ronda_id": ronda.id if ronda else None,
        "ronda_nombre": ronda.nombre if ronda else None,
        "ronda_descripcion": ronda.descripcion if ronda else None,
        "fecha_inicio": turno.fecha_inicio,
        "fecha_fin": turno.fecha_fin,
        "estado": turno.estado,
        "ejecucion_activa": ejecucion_activa_out,
    }


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS GUARDIA
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/turno-activo", response_model=TurnoActivoOut)
def turno_activo(
    db: Session = Depends(get_db),
    current_user=Depends(require_any),
):
    """Retorna el turno activo del guardia con el estado de su ronda actual."""
    guardia = _get_guardia_o_404(db, current_user.id)
    turno = _get_turno_activo(db, guardia.id)

    # Cargar relaciones
    turno = (
        db.query(Turno)
        .options(
            joinedload(Turno.instalacion),
            joinedload(Turno.ronda).joinedload(Ronda.puntos),
        )
        .filter(Turno.id == turno.id)
        .first()
    )

    return _build_turno_activo_out(db, turno, guardia.id)


@router.post("/iniciar", response_model=EjecucionActivaOut)
def iniciar_ronda(
    db: Session = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    El guardia presiona 'Iniciar ronda'.
    Busca la ejecución pendiente disponible y la pasa a en_progreso.
    """
    guardia = _get_guardia_o_404(db, current_user.id)
    turno = _get_turno_activo(db, guardia.id)

    if not turno.ronda_id:
        raise HTTPException(400, "Este turno no tiene una ronda asignada")

    ronda = db.query(Ronda).filter(Ronda.id == turno.ronda_id).first()
    if not ronda:
        raise HTTPException(404, "Ronda no encontrada")

    # Asegurar que existan ejecuciones
    crear_ejecuciones_turno(db, turno, ronda, guardia.id)

    ejecucion = obtener_ejecucion_activa(db, turno.id, ronda.id, guardia.id)
    if not ejecucion:
        # Verificar si ya completó todas
        completadas = (
            db.query(RondaEjecucion)
            .filter(
                RondaEjecucion.turno_id == turno.id,
                RondaEjecucion.estado == "completada",
            )
            .count()
        )
        if completadas >= ronda.rondas_por_turno:
            raise HTTPException(400, "Ya completaste todas las rondas de este turno. ¡Excelente trabajo!")

        # Hay pendiente pero aún no está disponible
        pendiente = (
            db.query(RondaEjecucion)
            .filter(
                RondaEjecucion.turno_id == turno.id,
                RondaEjecucion.estado == "pendiente",
            )
            .order_by(RondaEjecucion.numero_ronda.asc())
            .first()
        )
        if pendiente and pendiente.proxima_ronda_disponible:
            segundos = int(
                (pendiente.proxima_ronda_disponible - datetime.utcnow()).total_seconds()
            )
            minutos = max(1, segundos // 60)
            raise HTTPException(
                400,
                f"Aún estás en descanso. La siguiente ronda estará disponible "
                f"en {minutos} minuto{'s' if minutos != 1 else ''}."
            )

        raise HTTPException(400, "No hay ronda disponible en este momento")

    if ejecucion.estado == "pendiente":
        ejecucion = iniciar_ejecucion(db, ejecucion)

    # Preparar puntos
    ids_verificados = puntos_verificados_en_ejecucion(db, ejecucion.id)
    puntos_db = (
        db.query(PuntoControl)
        .filter(
            PuntoControl.ronda_id == ronda.id,
            PuntoControl.activo == True,
        )
        .order_by(PuntoControl.orden)
        .all()
    )

    ejecuciones_turno = (
        db.query(RondaEjecucion)
        .filter(RondaEjecucion.turno_id == turno.id)
        .all()
    )
    completadas = sum(1 for e in ejecuciones_turno if e.estado == "completada")

    return {
        "ejecucion_id": ejecucion.id,
        "numero_ronda": ejecucion.numero_ronda,
        "estado": ejecucion.estado,
        "iniciada_en": ejecucion.iniciada_en,
        "proxima_ronda_disponible": ejecucion.proxima_ronda_disponible,
        "puntos_completados": len(ids_verificados),
        "puntos_total": len(puntos_db),
        "puntos": [
            {
                **{c.name: getattr(p, c.name) for c in p.__table__.columns},
                "verificado": p.id in ids_verificados,
                "verificado_en": None,
                "distancia_metros": None,
            }
            for p in puntos_db
        ],
        "rondas_completadas_turno": completadas,
        "rondas_por_turno": ronda.rondas_por_turno,
        "descanso_entre_rondas_min": ronda.descanso_entre_rondas_min,
        "segundos_para_proxima": segundos_para_proxima_ronda(ejecucion),
    }


@router.post("/verificar-punto", response_model=VerificacionOut, status_code=201)
def verificar_punto(
    data: VerificacionCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Verifica un punto de control.

    GPS: compara la posición del guardia con las coordenadas del mapa definidas por el admin.
    QR: como respaldo cuando el GPS falla o no es suficientemente preciso.
    """
    # 1. Validar punto
    punto = db.query(PuntoControl).filter(
        PuntoControl.id == data.punto_control_id,
        PuntoControl.activo == True,
    ).first()
    if not punto:
        raise HTTPException(404, "Punto de control no encontrado o inactivo")

    # 2. Validar turno y guardia
    turno = db.query(Turno).filter(Turno.id == data.turno_id).first()
    if not turno:
        raise HTTPException(404, "Turno no encontrado")

    guardia_id = data.guardia_id or turno.guardia_id
    if not guardia_id:
        raise HTTPException(422, "No se pudo determinar el guardia")

    # 3. Validar ejecución
    ejecucion = None
    if data.ejecucion_id:
        ejecucion = db.query(RondaEjecucion).filter(
            RondaEjecucion.id == data.ejecucion_id,
            RondaEjecucion.turno_id == data.turno_id,
        ).first()
        if not ejecucion:
            raise HTTPException(404, "Ejecución de ronda no encontrada")
        if ejecucion.estado not in ("en_progreso", "pendiente"):
            raise HTTPException(
                400,
                f"La ejecución está en estado '{ejecucion.estado}'. "
                "Solo se puede verificar durante una ronda activa."
            )

    # 4. Verificar que no esté ya verificado en esta ejecución
    if ejecucion:
        ya_verificado = db.query(VerificacionPunto).filter(
            VerificacionPunto.punto_control_id == data.punto_control_id,
            VerificacionPunto.ejecucion_id == ejecucion.id,
        ).first()
        if ya_verificado:
            raise HTTPException(400, "Este punto ya fue verificado en la ronda actual")

    # 5. Obtener radio GPS de la instalación
    instalacion = db.query(Instalacion).filter(
        Instalacion.id == punto.instalacion_id
    ).first()
    radio = instalacion.radio_gps_metros if instalacion else settings.CHECKPOINT_RADIO_METROS

    # 6. Verificar según método
    distancia = None

    if data.metodo == "gps":
        if data.latitud_verificada is None or data.longitud_verificada is None:
            raise HTTPException(422, "Se requiere latitud_verificada y longitud_verificada para GPS")

        valido, distancia = verificar_gps_punto(
            punto,
            data.latitud_verificada,
            data.longitud_verificada,
            radio,
        )
        if not valido:
            raise HTTPException(
                400,
                f"Estás a {distancia:.0f}m del punto de control. "
                f"Debes estar dentro de {radio}m para verificar. "
                f"Acércate más al punto '{punto.nombre}'."
            )

    elif data.metodo == "qr":
        if not data.qr_escaneado:
            raise HTTPException(422, "Se requiere qr_escaneado para verificación QR")
        if not verificar_qr(punto, data.qr_escaneado):
            raise HTTPException(400, "Código QR inválido o expirado para este punto")

    else:
        raise HTTPException(422, "Método debe ser 'gps' o 'qr'")

    # 7. Registrar verificación
    # Si la ejecución estaba pendiente, pasarla a en_progreso
    if ejecucion and ejecucion.estado == "pendiente":
        ejecucion = iniciar_ejecucion(db, ejecucion)

    verif = VerificacionPunto(
        punto_control_id=data.punto_control_id,
        turno_id=data.turno_id,
        guardia_id=guardia_id,
        ejecucion_id=ejecucion.id if ejecucion else None,
        metodo=data.metodo,
        latitud_verificada=data.latitud_verificada,
        longitud_verificada=data.longitud_verificada,
        distancia_metros=distancia,
        qr_escaneado=data.qr_escaneado,
        notas=data.notas,
    )
    db.add(verif)

    # 8. Actualizar contador de la ejecución
    if ejecucion:
        ejecucion.puntos_completados = len(
            puntos_verificados_en_ejecucion(db, ejecucion.id)
        ) + 1  # +1 porque aún no hemos hecho commit

        # ¿Se completaron todos los puntos?
        total_puntos = ejecucion.puntos_total
        if ejecucion.puntos_completados >= total_puntos:
            ronda = db.query(Ronda).filter(Ronda.id == ejecucion.ronda_id).first()
            if ronda:
                db.flush()  # para que el conteo sea correcto
                ejecucion.puntos_completados = len(
                    puntos_verificados_en_ejecucion(db, ejecucion.id)
                )
                completar_ejecucion(db, ejecucion, ronda)

                # Notificar si completó todas las rondas del turno
                completadas_total = (
                    db.query(RondaEjecucion)
                    .filter(
                        RondaEjecucion.turno_id == ejecucion.turno_id,
                        RondaEjecucion.estado == "completada",
                    )
                    .count()
                )
                if completadas_total >= ronda.rondas_por_turno:
                    _notificar_supervisores(
                        db,
                        titulo=f"✅ Rondas completadas — Turno #{ejecucion.turno_id}",
                        mensaje=(
                            f"El guardia completó todas las {ronda.rondas_por_turno} "
                            f"ronda(s) del turno #{ejecucion.turno_id}."
                        ),
                        tipo="ronda_completada",
                        referencia_id=ejecucion.turno_id,
                    )

    db.commit()
    db.refresh(verif)
    return verif


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS SUPERVISOR / ADMIN
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/resumen/{turno_id}", response_model=ResumenRondasTurnoOut)
def resumen_rondas_turno(
    turno_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    """Resumen de ejecuciones de ronda para un turno específico."""
    turno = (
        db.query(Turno)
        .options(joinedload(Turno.guardia), joinedload(Turno.instalacion), joinedload(Turno.ronda))
        .filter(Turno.id == turno_id)
        .first()
    )
    if not turno:
        raise HTTPException(404, "Turno no encontrado")

    ejecuciones = (
        db.query(RondaEjecucion)
        .filter(RondaEjecucion.turno_id == turno_id)
        .order_by(RondaEjecucion.numero_ronda)
        .all()
    )

    completadas = sum(1 for e in ejecuciones if e.estado == "completada")
    ultima = max(
        (e.completada_en for e in ejecuciones if e.completada_en),
        default=None,
    )

    guardia = turno.guardia
    return {
        "turno_id": turno_id,
        "guardia_nombre": f"{guardia.nombre} {guardia.apellido}" if guardia else "—",
        "instalacion_nombre": turno.instalacion.nombre if turno.instalacion else "—",
        "ronda_nombre": turno.ronda.nombre if turno.ronda else None,
        "rondas_completadas": completadas,
        "rondas_por_turno": turno.ronda.rondas_por_turno if turno.ronda else 0,
        "ultima_completada_en": ultima,
        "ejecuciones": ejecuciones,
    }


# ── Plantillas de ronda ───────────────────────────────────────────────────────

@router.get("/plantillas/{instalacion_id}", response_model=List[RondaConPuntosOut])
def listar_plantillas(
    instalacion_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_any),
):
    return (
        db.query(Ronda)
        .options(joinedload(Ronda.puntos))
        .filter(
            Ronda.instalacion_id == instalacion_id,
            Ronda.activa == True,
        )
        .all()
    )


@router.post("/plantillas", response_model=RondaOut, status_code=201)
def crear_plantilla(
    data: RondaCreate,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    # Validar instalación
    inst = db.query(Instalacion).filter(
        Instalacion.id == data.instalacion_id,
        Instalacion.activa == True,
    ).first()
    if not inst:
        raise HTTPException(404, "Instalación no encontrada")

    ronda = Ronda(**data.model_dump())
    db.add(ronda)
    db.commit()
    db.refresh(ronda)
    return ronda


@router.put("/plantillas/{ronda_id}", response_model=RondaOut)
def actualizar_plantilla(
    ronda_id: int,
    data: RondaUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    ronda = db.query(Ronda).filter(Ronda.id == ronda_id).first()
    if not ronda:
        raise HTTPException(404, "Ronda no encontrada")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(ronda, k, v)
    db.commit()
    db.refresh(ronda)
    return ronda


@router.delete("/plantillas/{ronda_id}", status_code=204)
def eliminar_plantilla(
    ronda_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    ronda = db.query(Ronda).filter(Ronda.id == ronda_id).first()
    if not ronda:
        raise HTTPException(404, "Ronda no encontrada")
    ronda.activa = False
    db.commit()


# ── Puntos de control ─────────────────────────────────────────────────────────

@router.get("/puntos/{instalacion_id}", response_model=List[PuntoControlOut])
def listar_puntos(
    instalacion_id: int,
    ronda_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_any),
):
    q = db.query(PuntoControl).filter(
        PuntoControl.instalacion_id == instalacion_id,
        PuntoControl.activo == True,
    )
    if ronda_id:
        q = q.filter(PuntoControl.ronda_id == ronda_id)
    return q.order_by(PuntoControl.orden).all()


@router.post("/puntos", response_model=PuntoControlOut, status_code=201)
def crear_punto(
    data: PuntoControlCreate,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    """
    Crea un punto de control.
    Las coordenadas (latitud, longitud) son donde el admin hizo clic en el mapa,
    NO la posición del dispositivo.
    """
    # Validar instalación
    inst = db.query(Instalacion).filter(
        Instalacion.id == data.instalacion_id,
        Instalacion.activa == True,
    ).first()
    if not inst:
        raise HTTPException(404, "Instalación no encontrada")

    # Validar ronda si se especificó
    if data.ronda_id:
        ronda = db.query(Ronda).filter(Ronda.id == data.ronda_id).first()
        if not ronda:
            raise HTTPException(404, "Ronda no encontrada")

    punto = PuntoControl(
        **data.model_dump(),
        qr_token=generar_qr_token(),
    )
    db.add(punto)
    db.commit()
    db.refresh(punto)
    return punto


@router.put("/puntos/{punto_id}", response_model=PuntoControlOut)
def actualizar_punto(
    punto_id: int,
    data: PuntoControlUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    punto = db.query(PuntoControl).filter(PuntoControl.id == punto_id).first()
    if not punto:
        raise HTTPException(404, "Punto de control no encontrado")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(punto, k, v)
    db.commit()
    db.refresh(punto)
    return punto


@router.delete("/puntos/{punto_id}", status_code=204)
def eliminar_punto(
    punto_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    punto = db.query(PuntoControl).filter(PuntoControl.id == punto_id).first()
    if not punto:
        raise HTTPException(404, "Punto de control no encontrado")
    punto.activo = False
    db.commit()


@router.post("/puntos/{punto_id}/qr")
def regenerar_qr(
    punto_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    punto = db.query(PuntoControl).filter(PuntoControl.id == punto_id).first()
    if not punto:
        raise HTTPException(404, "Punto no encontrado")
    punto.qr_token = generar_qr_token()
    db.commit()
    return {"qr_token": punto.qr_token, "punto_id": punto_id}


@router.get("/puntos/{punto_id}/qr-imagen")
def qr_imagen(
    punto_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    """Genera la imagen PNG del código QR del punto."""
    try:
        import qrcode
    except ImportError:
        raise HTTPException(500, "Instale 'qrcode' en requirements.txt")

    punto = db.query(PuntoControl).filter(PuntoControl.id == punto_id).first()
    if not punto:
        raise HTTPException(404, "Punto no encontrado")
    if not punto.qr_token:
        raise HTTPException(400, "El punto no tiene token QR. Genere uno primero.")

    img = qrcode.make(punto.qr_token)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={"Content-Disposition": f'inline; filename="qr_punto_{punto_id}.png"'},
    )
