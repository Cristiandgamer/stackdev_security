"""
Router de Asistencia — Stack Dev Security
Maneja: marcaje entrada/salida, foto/selfie, geofence,
        configuración, dashboard admin, exportación Excel/CSV.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_
from typing import List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel
import math, uuid, os, shutil, io, logging

from app.core.database import get_db
from app.core.security import require_any, require_supervisor, require_admin, get_current_user
from app.core.config import settings
from app.models.seguridad import (
    Asistencia, Turno, Guardia, Instalacion,
    ConfigAsistencia, Notificacion
)
from app.models.usuario import Usuario

logger = logging.getLogger(__name__)
router = APIRouter()


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia en metros entre dos puntos GPS."""
    R = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _get_config(db: Session) -> ConfigAsistencia:
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
        db.refresh(cfg)
    return cfg


def _calcular_estado(
    entrada: datetime,
    fecha_inicio_turno: datetime,
    tolerancia_tardanza: int,
) -> tuple[str, int]:
    """Retorna (estado, minutos_retraso)."""
    delta = (entrada - fecha_inicio_turno).total_seconds() / 60
    retraso = max(0, int(delta))
    if delta <= tolerancia_tardanza:
        return "a_tiempo", 0
    return "tardanza", retraso


def _guardar_foto(archivo: UploadFile, prefijo: str = "selfie") -> str:
    """Guarda la foto en /uploads y retorna la ruta relativa."""
    ext = os.path.splitext(archivo.filename or "foto.jpg")[1].lower() or ".jpg"
    nombre = f"{prefijo}_{uuid.uuid4()}{ext}"
    ruta_fisica = os.path.join(settings.UPLOAD_DIR, nombre)
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    archivo.file.seek(0)
    with open(ruta_fisica, "wb") as f:
        shutil.copyfileobj(archivo.file, f)
    return f"/uploads/{nombre}"


def _notificar(db: Session, titulo: str, mensaje: str, tipo: str = "asistencia"):
    """Envía notificación a todos los supervisores y admins."""
    supervisores = db.query(Usuario).filter(
        Usuario.rol.in_(["admin", "supervisor"]),
        Usuario.activo == True,
    ).all()
    for sup in supervisores:
        db.add(Notificacion(
            usuario_id=sup.id,
            titulo=titulo,
            mensaje=mensaje,
            tipo=tipo,
        ))


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMAS INLINE (pequeños, para no saturar schemas.py)
# ══════════════════════════════════════════════════════════════════════════════

class ConfigOut(BaseModel):
    id: int
    tolerancia_tardanza_min: int
    tolerancia_falta_min: int
    radio_geofence_metros: int
    requiere_foto: bool
    reconocimiento_facial: bool
    model_config = {"from_attributes": True}


class ConfigUpdate(BaseModel):
    tolerancia_tardanza_min: Optional[int] = None
    tolerancia_falta_min: Optional[int] = None
    radio_geofence_metros: Optional[int] = None
    requiere_foto: Optional[bool] = None
    reconocimiento_facial: Optional[bool] = None


class AsistenciaOut(BaseModel):
    id: int
    turno_id: int
    guardia_id: int
    entrada: Optional[datetime] = None
    latitud_entrada: Optional[float] = None
    longitud_entrada: Optional[float] = None
    distancia_entrada: Optional[float] = None
    foto_entrada: Optional[str] = None
    salida: Optional[datetime] = None
    latitud_salida: Optional[float] = None
    longitud_salida: Optional[float] = None
    distancia_salida: Optional[float] = None
    foto_salida: Optional[str] = None
    estado: str
    minutos_retraso: int
    minutos_trabajados: Optional[int] = None
    horas_extra: float
    observacion: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}


class ResumenGuardiaOut(BaseModel):
    guardia_id: int
    guardia_nombre: str
    guardia_apellido: str
    turno_id: int
    instalacion_nombre: str
    fecha_inicio: datetime
    fecha_fin: datetime
    estado_turno: str
    asistencia_id: Optional[int]
    estado_asistencia: str
    entrada: Optional[datetime]
    salida: Optional[datetime]
    minutos_retraso: int
    minutos_trabajados: Optional[int]
    foto_entrada: Optional[str]


class EstadisticasAsistenciaOut(BaseModel):
    total_turnos: int
    a_tiempo: int
    tardanzas: int
    faltas: int
    sin_marcar: int
    porcentaje_puntualidad: float
    promedio_minutos_retraso: float
    total_horas_trabajadas: float
    total_horas_extra: float


# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURACIÓN
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/config", response_model=ConfigOut)
def obtener_config(db: Session = Depends(get_db), _=Depends(require_any)):
    return _get_config(db)


@router.put("/config", response_model=ConfigOut)
def actualizar_config(
    data: ConfigUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    cfg = _get_config(db)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(cfg, k, v)
    db.commit()
    db.refresh(cfg)
    return cfg


# ══════════════════════════════════════════════════════════════════════════════
# MARCAJE — GUARDIA
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/entrada", response_model=AsistenciaOut, status_code=201)
async def marcar_entrada(
    turno_id: int,
    lat: float,
    lon: float,
    foto: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Marca la entrada de un guardia.
    - Valida geofence (radio configurable).
    - Guarda selfie si se proporciona.
    - Calcula estado (a_tiempo / tardanza).
    - Notifica al supervisor si hay tardanza.
    """
    cfg = _get_config(db)

    # ── Verificar turno ────────────────────────────────────────────────────
    turno = db.query(Turno).options(joinedload(Turno.instalacion)).filter(
        Turno.id == turno_id
    ).first()
    if not turno:
        raise HTTPException(404, "Turno no encontrado")

    # Solo el guardia dueño del turno puede marcar
    guardia = db.query(Guardia).filter(Guardia.usuario_id == current_user.id).first()
    if not guardia or turno.guardia_id != guardia.id:
        raise HTTPException(403, "No tienes permiso para marcar este turno")

    # ── Ya marcó entrada ───────────────────────────────────────────────────
    existente = db.query(Asistencia).filter(Asistencia.turno_id == turno_id).first()
    if existente and existente.entrada:
        raise HTTPException(400, "Ya registraste la entrada para este turno")

    # ── Geofence ───────────────────────────────────────────────────────────
    inst = turno.instalacion
    if inst and inst.latitud and inst.longitud:
        distancia = _haversine(lat, lon, inst.latitud, inst.longitud)
        if distancia > cfg.radio_geofence_metros:
            raise HTTPException(
                400,
                f"Estás a {distancia:.0f}m de la instalación. "
                f"Debes estar dentro de {cfg.radio_geofence_metros}m para marcar."
            )
    else:
        distancia = None

    # ── Foto ───────────────────────────────────────────────────────────────
    ruta_foto = None
    if foto and foto.filename:
        ruta_foto = _guardar_foto(foto, prefijo="entrada")

    # ── Estado ────────────────────────────────────────────────────────────
    ahora = datetime.utcnow()
    estado, minutos_retraso = _calcular_estado(
        ahora, turno.fecha_inicio, cfg.tolerancia_tardanza_min
    )

    # ── Crear o actualizar asistencia ──────────────────────────────────────
    if existente:
        asistencia = existente
    else:
        asistencia = Asistencia(turno_id=turno_id, guardia_id=guardia.id)
        db.add(asistencia)

    asistencia.entrada = ahora
    asistencia.latitud_entrada = lat
    asistencia.longitud_entrada = lon
    asistencia.distancia_entrada = round(distancia, 2) if distancia else None
    asistencia.foto_entrada = ruta_foto
    asistencia.estado = estado
    asistencia.minutos_retraso = minutos_retraso

    # Cambiar estado del turno
    turno.estado = "en_curso"

    # ── Notificar tardanza ─────────────────────────────────────────────────
    if estado == "tardanza":
        _notificar(
            db,
            titulo=f"⚠️ Tardanza — {guardia.nombre} {guardia.apellido}",
            mensaje=(
                f"El guardia {guardia.nombre} {guardia.apellido} marcó entrada "
                f"con {minutos_retraso} minuto(s) de retraso en "
                f"{inst.nombre if inst else 'instalación desconocida'}."
            ),
            tipo="tardanza",
        )

    db.commit()
    db.refresh(asistencia)
    return asistencia


@router.post("/salida", response_model=AsistenciaOut)
async def marcar_salida(
    turno_id: int,
    lat: float,
    lon: float,
    foto: Optional[UploadFile] = File(None),
    observacion: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Marca la salida. Calcula minutos trabajados y horas extra."""
    cfg = _get_config(db)

    turno = db.query(Turno).options(joinedload(Turno.instalacion)).filter(
        Turno.id == turno_id
    ).first()
    if not turno:
        raise HTTPException(404, "Turno no encontrado")

    guardia = db.query(Guardia).filter(Guardia.usuario_id == current_user.id).first()
    if not guardia or turno.guardia_id != guardia.id:
        raise HTTPException(403, "No tienes permiso para marcar este turno")

    asistencia = db.query(Asistencia).filter(
        Asistencia.turno_id == turno_id,
        Asistencia.guardia_id == guardia.id,
    ).first()
    if not asistencia or not asistencia.entrada:
        raise HTTPException(400, "Debes registrar la entrada primero")
    if asistencia.salida:
        raise HTTPException(400, "Ya registraste la salida para este turno")

    # ── Geofence salida ────────────────────────────────────────────────────
    inst = turno.instalacion
    distancia = None
    if inst and inst.latitud and inst.longitud:
        distancia = _haversine(lat, lon, inst.latitud, inst.longitud)
        if distancia > cfg.radio_geofence_metros:
            raise HTTPException(
                400,
                f"Estás a {distancia:.0f}m de la instalación. "
                f"Debes estar dentro de {cfg.radio_geofence_metros}m para marcar salida."
            )

    # ── Foto salida ────────────────────────────────────────────────────────
    ruta_foto = None
    if foto and foto.filename:
        ruta_foto = _guardar_foto(foto, prefijo="salida")

    # ── Calcular tiempo trabajado y horas extra ────────────────────────────
    ahora = datetime.utcnow()
    minutos_trabajados = int((ahora - asistencia.entrada).total_seconds() / 60)

    # Duración programada del turno en minutos
    duracion_programada = int(
        (turno.fecha_fin - turno.fecha_inicio).total_seconds() / 60
    )
    minutos_extra = max(0, minutos_trabajados - duracion_programada)
    horas_extra = round(minutos_extra / 60, 2)

    asistencia.salida = ahora
    asistencia.latitud_salida = lat
    asistencia.longitud_salida = lon
    asistencia.distancia_salida = round(distancia, 2) if distancia else None
    asistencia.foto_salida = ruta_foto
    asistencia.minutos_trabajados = minutos_trabajados
    asistencia.horas_extra = horas_extra
    asistencia.observacion = observacion

    turno.estado = "finalizado"

    db.commit()
    db.refresh(asistencia)
    return asistencia


# ══════════════════════════════════════════════════════════════════════════════
# CONSULTA — GUARDIA (su propio historial)
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/mi-asistencia", response_model=Optional[AsistenciaOut])
def mi_asistencia_turno_activo(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retorna la asistencia del turno activo del guardia conectado, o null."""
    guardia = db.query(Guardia).filter(Guardia.usuario_id == current_user.id).first()
    if not guardia:
        return None
    ahora = datetime.utcnow()
    turno = db.query(Turno).filter(
        Turno.guardia_id == guardia.id,
        Turno.estado.in_(["programado", "en_curso"]),
        Turno.fecha_inicio <= ahora + timedelta(hours=2),
        Turno.fecha_fin >= ahora,
    ).order_by(Turno.fecha_inicio.asc()).first()
    if not turno:
        return None
    return db.query(Asistencia).filter(
        Asistencia.turno_id == turno.id,
        Asistencia.guardia_id == guardia.id,
    ).first()


@router.get("/mi-historial", response_model=List[AsistenciaOut])
def mi_historial(
    skip: int = 0,
    limit: int = 30,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    guardia = db.query(Guardia).filter(Guardia.usuario_id == current_user.id).first()
    if not guardia:
        return []
    return (
        db.query(Asistencia)
        .filter(Asistencia.guardia_id == guardia.id)
        .order_by(Asistencia.created_at.desc())
        .offset(skip).limit(limit).all()
    )


# ══════════════════════════════════════════════════════════════════════════════
# DASHBOARD ADMIN — TIEMPO REAL (polling)
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/dashboard-live", response_model=List[ResumenGuardiaOut])
def dashboard_live(
    fecha: Optional[str] = Query(None, description="YYYY-MM-DD — default hoy"),
    instalacion_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    """
    Retorna el estado de todos los turnos del día con su asistencia.
    Diseñado para polling cada 30s desde el panel admin.
    """
    if fecha:
        try:
            dia = datetime.strptime(fecha, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "Formato de fecha inválido. Use YYYY-MM-DD")
    else:
        dia = datetime.utcnow().date()

    inicio_dia = datetime(dia.year, dia.month, dia.day, 0, 0, 0)
    fin_dia    = datetime(dia.year, dia.month, dia.day, 23, 59, 59)

    q = (
        db.query(Turno)
        .options(
            joinedload(Turno.guardia),
            joinedload(Turno.instalacion),
            joinedload(Turno.asistencia),
        )
        .filter(
            Turno.fecha_inicio >= inicio_dia,
            Turno.fecha_inicio <= fin_dia,
        )
    )
    if instalacion_id:
        q = q.filter(Turno.instalacion_id == instalacion_id)

    turnos = q.order_by(Turno.fecha_inicio.asc()).all()

    resultado = []
    for t in turnos:
        a = t.asistencia
        resultado.append(ResumenGuardiaOut(
            guardia_id=t.guardia_id,
            guardia_nombre=t.guardia.nombre if t.guardia else "—",
            guardia_apellido=t.guardia.apellido if t.guardia else "",
            turno_id=t.id,
            instalacion_nombre=t.instalacion.nombre if t.instalacion else "—",
            fecha_inicio=t.fecha_inicio,
            fecha_fin=t.fecha_fin,
            estado_turno=t.estado,
            asistencia_id=a.id if a else None,
            estado_asistencia=a.estado if a else "sin_marcar",
            entrada=a.entrada if a else None,
            salida=a.salida if a else None,
            minutos_retraso=a.minutos_retraso if a else 0,
            minutos_trabajados=a.minutos_trabajados if a else None,
            foto_entrada=a.foto_entrada if a else None,
        ))
    return resultado


@router.get("/estadisticas", response_model=EstadisticasAsistenciaOut)
def estadisticas(
    fecha_inicio: str = Query(..., description="YYYY-MM-DD"),
    fecha_fin: str    = Query(..., description="YYYY-MM-DD"),
    guardia_id: Optional[int] = None,
    instalacion_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    try:
        fi = datetime.strptime(fecha_inicio, "%Y-%m-%d")
        ff = datetime.strptime(fecha_fin,    "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        raise HTTPException(400, "Formato de fecha inválido. Use YYYY-MM-DD")

    q = (
        db.query(Turno)
        .options(joinedload(Turno.asistencia))
        .filter(Turno.fecha_inicio >= fi, Turno.fecha_inicio <= ff)
    )
    if guardia_id:
        q = q.filter(Turno.guardia_id == guardia_id)
    if instalacion_id:
        q = q.filter(Turno.instalacion_id == instalacion_id)

    turnos = q.all()
    total  = len(turnos)

    conteo = {"a_tiempo": 0, "tardanza": 0, "falta": 0, "sin_marcar": 0}
    total_min_retraso   = 0
    total_min_trabajados = 0
    total_min_extra     = 0

    for t in turnos:
        a = t.asistencia
        est = a.estado if a else "sin_marcar"
        conteo[est] = conteo.get(est, 0) + 1
        if a:
            total_min_retraso   += a.minutos_retraso or 0
            total_min_trabajados += a.minutos_trabajados or 0
            total_min_extra     += int((a.horas_extra or 0) * 60)

    puntualidad = (
        round((conteo["a_tiempo"] / total) * 100, 1) if total > 0 else 0.0
    )
    promedio_retraso = round(total_min_retraso / total, 1) if total > 0 else 0.0

    return EstadisticasAsistenciaOut(
        total_turnos=total,
        a_tiempo=conteo["a_tiempo"],
        tardanzas=conteo["tardanza"],
        faltas=conteo["falta"],
        sin_marcar=conteo["sin_marcar"],
        porcentaje_puntualidad=puntualidad,
        promedio_minutos_retraso=promedio_retraso,
        total_horas_trabajadas=round(total_min_trabajados / 60, 2),
        total_horas_extra=round(total_min_extra / 60, 2),
    )


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN — AJUSTES MANUALES
# ══════════════════════════════════════════════════════════════════════════════

class AjusteManualIn(BaseModel):
    estado: Optional[str] = None
    observacion: Optional[str] = None
    entrada: Optional[datetime] = None
    salida: Optional[datetime] = None


@router.put("/{asistencia_id}/ajuste", response_model=AsistenciaOut)
def ajuste_manual(
    asistencia_id: int,
    data: AjusteManualIn,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    """Permite al admin/supervisor corregir una asistencia manualmente."""
    a = db.query(Asistencia).filter(Asistencia.id == asistencia_id).first()
    if not a:
        raise HTTPException(404, "Asistencia no encontrada")

    if data.estado:
        a.estado = data.estado
    if data.observacion is not None:
        a.observacion = data.observacion
    if data.entrada:
        a.entrada = data.entrada
        # Recalcular retraso
        turno = db.query(Turno).filter(Turno.id == a.turno_id).first()
        if turno:
            cfg = _get_config(db)
            a.estado, a.minutos_retraso = _calcular_estado(
                data.entrada, turno.fecha_inicio, cfg.tolerancia_tardanza_min
            )
    if data.salida:
        a.salida = data.salida
        if a.entrada:
            a.minutos_trabajados = int((data.salida - a.entrada).total_seconds() / 60)

    db.commit()
    db.refresh(a)
    return a


# ══════════════════════════════════════════════════════════════════════════════
# LISTADO ADMIN CON FILTROS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/listar", response_model=List[AsistenciaOut])
def listar_asistencias(
    guardia_id: Optional[int] = None,
    instalacion_id: Optional[int] = None,
    estado: Optional[str] = None,
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    q = db.query(Asistencia)

    if guardia_id:
        q = q.filter(Asistencia.guardia_id == guardia_id)
    if estado:
        q = q.filter(Asistencia.estado == estado)
    if fecha_inicio:
        try:
            fi = datetime.strptime(fecha_inicio, "%Y-%m-%d")
            q = q.filter(Asistencia.entrada >= fi)
        except ValueError:
            pass
    if fecha_fin:
        try:
            ff = datetime.strptime(fecha_fin, "%Y-%m-%d").replace(hour=23, minute=59)
            q = q.filter(Asistencia.entrada <= ff)
        except ValueError:
            pass
    if instalacion_id:
        q = q.join(Turno).filter(Turno.instalacion_id == instalacion_id)

    return q.order_by(Asistencia.created_at.desc()).offset(skip).limit(limit).all()


# ══════════════════════════════════════════════════════════════════════════════
# EXPORTACIÓN — Excel / CSV compatible con cualquier software de nómina
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/exportar")
def exportar_asistencias(
    fecha_inicio: str = Query(..., description="YYYY-MM-DD"),
    fecha_fin: str    = Query(..., description="YYYY-MM-DD"),
    guardia_id: Optional[int] = None,
    instalacion_id: Optional[int] = None,
    formato: str = Query("excel", description="excel | csv"),
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    """
    Exporta el reporte de asistencia en Excel o CSV.
    Columnas: RUT, Nombre, Instalación, Fecha, Entrada, Salida,
              Estado, Min.Retraso, Horas Trabajadas, Horas Extra, Observación.
    Compatible con la mayoría de software de RR.HH. y nómina.
    """
    try:
        fi = datetime.strptime(fecha_inicio, "%Y-%m-%d")
        ff = datetime.strptime(fecha_fin,    "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        raise HTTPException(400, "Formato de fecha inválido. Use YYYY-MM-DD")

    q = (
        db.query(Asistencia)
        .options(
            joinedload(Asistencia.guardia),
            joinedload(Asistencia.turno).joinedload(Turno.instalacion),
        )
        .join(Turno)
        .filter(Turno.fecha_inicio >= fi, Turno.fecha_inicio <= ff)
    )
    if guardia_id:
        q = q.filter(Asistencia.guardia_id == guardia_id)
    if instalacion_id:
        q = q.filter(Turno.instalacion_id == instalacion_id)

    registros = q.order_by(Turno.fecha_inicio.asc()).all()

    def _fmt(dt):
        return dt.strftime("%d/%m/%Y %H:%M") if dt else ""

    def _horas(mins):
        if mins is None:
            return ""
        return f"{mins // 60}h {mins % 60}m"

    filas = []
    for a in registros:
        g   = a.guardia
        t   = a.turno
        ins = t.instalacion if t else None
        filas.append({
            "RUT":              g.rut if g else "",
            "Nombre":           f"{g.nombre} {g.apellido}" if g else "",
            "Instalación":      ins.nombre if ins else "",
            "Fecha":            t.fecha_inicio.strftime("%d/%m/%Y") if t else "",
            "Turno Inicio":     _fmt(t.fecha_inicio) if t else "",
            "Turno Fin":        _fmt(t.fecha_fin)    if t else "",
            "Entrada Real":     _fmt(a.entrada),
            "Salida Real":      _fmt(a.salida),
            "Estado":           a.estado,
            "Min. Retraso":     a.minutos_retraso or 0,
            "Horas Trabajadas": _horas(a.minutos_trabajados),
            "Horas Extra":      f"{a.horas_extra or 0:.2f}",
            "Distancia Entrada (m)": f"{a.distancia_entrada:.0f}" if a.distancia_entrada else "",
            "Observación":      a.observacion or "",
        })

    # ── Excel ──────────────────────────────────────────────────────────────
    if formato == "excel":
        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment
        except ImportError:
            raise HTTPException(
                500,
                "openpyxl no instalado. Añade 'openpyxl' a requirements.txt"
            )

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Asistencias"

        # Encabezado
        cabeceras = list(filas[0].keys()) if filas else [
            "RUT","Nombre","Instalación","Fecha","Turno Inicio","Turno Fin",
            "Entrada Real","Salida Real","Estado","Min. Retraso",
            "Horas Trabajadas","Horas Extra","Distancia Entrada (m)","Observación"
        ]
        header_fill   = PatternFill("solid", fgColor="1E3A5F")
        header_font   = Font(bold=True, color="FFFFFF")
        center_align  = Alignment(horizontal="center", vertical="center")

        for col_idx, cab in enumerate(cabeceras, 1):
            cell = ws.cell(row=1, column=col_idx, value=cab)
            cell.fill   = header_fill
            cell.font   = header_font
            cell.alignment = center_align

        # Colores por estado
        colores_estado = {
            "a_tiempo":   "C6EFCE",
            "tardanza":   "FFEB9C",
            "falta":      "FFC7CE",
            "sin_marcar": "D9D9D9",
        }

        for row_idx, fila in enumerate(filas, 2):
            estado_val = fila.get("Estado", "sin_marcar")
            fill_color = colores_estado.get(estado_val, "FFFFFF")
            row_fill   = PatternFill("solid", fgColor=fill_color)
            for col_idx, (_, valor) in enumerate(fila.items(), 1):
                cell = ws.cell(row=row_idx, column=col_idx, value=valor)
                cell.fill = row_fill

        # Ancho de columnas automático
        for col in ws.columns:
            max_len = max(len(str(c.value or "")) for c in col)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 40)

        # Hoja de resumen
        ws2 = wb.create_sheet("Resumen")
        totales = {
            "Total registros": len(filas),
            "A tiempo":        sum(1 for f in filas if f["Estado"] == "a_tiempo"),
            "Tardanzas":       sum(1 for f in filas if f["Estado"] == "tardanza"),
            "Faltas":          sum(1 for f in filas if f["Estado"] == "falta"),
            "Sin marcar":      sum(1 for f in filas if f["Estado"] == "sin_marcar"),
            "Período":         f"{fecha_inicio} al {fecha_fin}",
        }
        for i, (k, v) in enumerate(totales.items(), 1):
            ws2.cell(row=i, column=1, value=k).font = Font(bold=True)
            ws2.cell(row=i, column=2, value=v)

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        nombre_archivo = f"asistencias_{fecha_inicio}_{fecha_fin}.xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
        )

    # ── CSV (fallback universal) ───────────────────────────────────────────
    import csv
    buf = io.StringIO()
    if filas:
        writer = csv.DictWriter(buf, fieldnames=list(filas[0].keys()))
        writer.writeheader()
        writer.writerows(filas)
    buf.seek(0)
    nombre_archivo = f"asistencias_{fecha_inicio}_{fecha_fin}.csv"
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),  # BOM para Excel español
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )
