"""
Router de Asistencia — Stack Dev Security

FIXES en esta version:
1. mi_asistencia_turno_activo: buscaba la asistencia via joinedload del turno,
   lo que provocaba una race condition — el refetch del frontend llegaba antes
   de que el commit de marcar_entrada fuera visible en la nueva sesion de DB,
   devolviendo None aunque la asistencia ya existia. Ahora se busca la
   asistencia directamente por guardia_id + turno_id, y la ventana de busqueda
   del turno se amplio a ±6h para absorber desfases de zona horaria.

2. dashboard_live: usaba datetime.utcnow().date() para determinar "hoy", lo
   que en Chile (UTC-4) produce una fecha incorrecta hasta 4 horas del dia.
   Ahora calcula la fecha local chilena con el offset correcto y luego
   convierte el rango del dia a UTC para compararlo con los turnos en DB.
"""
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, case
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
    Notificacion
)
from app.models.seguridad_model import ConfigAsistencia
from app.models.usuario import Usuario

logger = logging.getLogger(__name__)
router = APIRouter()

# Offset fijo Chile (UTC-4 invierno, UTC-3 verano).
# En junio Chile esta en invierno -> UTC-4.
# Si en el futuro cambia el horario de verano, ajustar este valor
# o leerlo desde una variable de entorno CHILE_UTC_OFFSET=-4
CHILE_UTC_OFFSET = int(os.getenv("CHILE_UTC_OFFSET", "-4"))
CHILE_OFFSET = timedelta(hours=CHILE_UTC_OFFSET)


def ahora_utc() -> datetime:
    """Retorna datetime.utcnow() naive — unico punto de entrada para 'ahora'."""
    return datetime.utcnow()


def fecha_local_chile() -> datetime:
    """Hora actual en zona horaria Chile (naive, sin tzinfo)."""
    return datetime.utcnow() + CHILE_OFFSET


def rango_dia_utc(fecha_chile=None):
    """
    Retorna (inicio_dia_utc, fin_dia_utc) para el dia local Chile dado.
    Los turnos en la DB estan en UTC, asi que el rango debe ser UTC
    equivalente al inicio y fin del dia en Chile.
    """
    if fecha_chile is None:
        fecha_chile = fecha_local_chile().date()
    # Medianoche Chile en UTC = medianoche Chile + offset inverso
    inicio = datetime(fecha_chile.year, fecha_chile.month, fecha_chile.day,
                      0, 0, 0) - CHILE_OFFSET
    fin    = datetime(fecha_chile.year, fecha_chile.month, fecha_chile.day,
                      23, 59, 59) - CHILE_OFFSET
    return inicio, fin


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


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
ALLOWED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_UPLOAD_BYTES = settings.MAX_UPLOAD_MB * 1024 * 1024


def _validar_foto(archivo: UploadFile) -> None:
    ext = os.path.splitext(archivo.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(400, "Formato de imagen no permitido. Solo JPG, PNG, WEBP y GIF.")
    if archivo.content_type and archivo.content_type not in ALLOWED_IMAGE_MIME_TYPES:
        raise HTTPException(400, f"Tipo MIME de imagen no permitido ({archivo.content_type}).")
    try:
        archivo.file.seek(0, os.SEEK_END)
        size = archivo.file.tell()
        archivo.file.seek(0)
    except Exception:
        size = 0
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Imagen demasiado grande. Tamaño máximo: {settings.MAX_UPLOAD_MB} MB")


def _guardar_foto(archivo: UploadFile, prefijo: str = "selfie") -> str:
    """Guarda la foto en /uploads y retorna la ruta relativa."""
    _validar_foto(archivo)
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
# SCHEMAS INLINE
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
    cfg = _get_config(db)

    turno = db.query(Turno).options(joinedload(Turno.instalacion)).filter(
        Turno.id == turno_id
    ).first()
    if not turno:
        raise HTTPException(404, "Turno no encontrado")

    guardia = db.query(Guardia).filter(Guardia.usuario_id == current_user.id).first()
    if not guardia or turno.guardia_id != guardia.id:
        raise HTTPException(403, "No tienes permiso para marcar este turno")

    existente = db.query(Asistencia).filter(Asistencia.turno_id == turno_id).first()
    if existente and existente.entrada:
        raise HTTPException(400, "Ya registraste la entrada para este turno")

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

    ruta_foto = None
    if foto and foto.filename:
        ruta_foto = _guardar_foto(foto, prefijo="entrada")

    ahora = ahora_utc()
    estado, minutos_retraso = _calcular_estado(
        ahora, turno.fecha_inicio, cfg.tolerancia_tardanza_min
    )

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

    turno.estado = "en_curso"

    if estado == "tardanza":
        _notificar(
            db,
            titulo=f"Tardanza — {guardia.nombre} {guardia.apellido}",
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
    observacion: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
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

    ruta_foto = None
    if foto and foto.filename:
        ruta_foto = _guardar_foto(foto, prefijo="salida")

    ahora = ahora_utc()
    minutos_trabajados = int((ahora - asistencia.entrada).total_seconds() / 60)
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
    """
    Retorna la asistencia del turno activo del guardia conectado, o null.

    FIX: antes buscaba la asistencia via joinedload del turno, lo que
    provocaba una race condition — el refetch del frontend llegaba antes
    de que el commit de marcar_entrada fuera visible en la sesion de DB,
    devolviendo None aunque la asistencia ya existia.
    Ahora se busca la asistencia directamente por guardia_id + turno_id.
    La ventana de busqueda se amplio a ±6h para absorber desfases de TZ.
    """
    ahora = ahora_utc()

    # Buscar el guardia del usuario actual
    guardia = db.query(Guardia).filter(Guardia.usuario_id == current_user.id).first()
    if not guardia:
        return None

    # Buscar turno activo con ventana ampliada para cubrir desfase de TZ
    turno = (
        db.query(Turno)
          .filter(
              Turno.guardia_id == guardia.id,
              Turno.estado.in_(["programado", "asignado", "en_curso", "activo"]),
              Turno.fecha_inicio <= ahora + timedelta(hours=6),
              Turno.fecha_fin >= ahora - timedelta(hours=6),
          )
          .order_by(Turno.fecha_inicio.asc())
          .first()
    )
    if not turno:
        return None

    # Buscar asistencia directamente (evita race condition del joinedload)
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
    fecha: Optional[str] = Query(None, description="YYYY-MM-DD en hora local Chile — default hoy Chile"),
    instalacion_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor),
):
    """
    Retorna el estado de todos los turnos del día con su asistencia.

    FIX: antes usaba datetime.utcnow().date() para determinar 'hoy', lo que
    en Chile (UTC-4) produce una fecha incorrecta hasta 4h del dia.
    Ahora calcula la fecha local chilena y convierte el rango a UTC para
    compararlo correctamente con los turnos almacenados en UTC en la DB.
    """
    if fecha:
        try:
            dia = datetime.strptime(fecha, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "Formato de fecha inválido. Use YYYY-MM-DD")
    else:
        # Usar fecha local Chile, no UTC del servidor
        dia = fecha_local_chile().date()

    # Convertir el dia Chile a rango UTC para comparar con turnos en DB
    inicio_dia, fin_dia = rango_dia_utc(dia)

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
        # Interpretar las fechas como fechas locales Chile y convertir a UTC
        fi_date = datetime.strptime(fecha_inicio, "%Y-%m-%d").date()
        ff_date = datetime.strptime(fecha_fin,    "%Y-%m-%d").date()
        fi, _   = rango_dia_utc(fi_date)
        _, ff   = rango_dia_utc(ff_date)
    except ValueError:
        raise HTTPException(400, "Formato de fecha inválido. Use YYYY-MM-DD")

    q = db.query(
        func.count(Turno.id),
        func.sum(case((Asistencia.estado == "a_tiempo", 1), else_=0)),
        func.sum(case((Asistencia.estado == "tardanza", 1), else_=0)),
        func.sum(case((Asistencia.estado == "falta", 1), else_=0)),
        func.sum(case((Asistencia.id == None, 1), else_=0)),
        func.sum(func.coalesce(Asistencia.minutos_retraso, 0)),
        func.sum(func.coalesce(Asistencia.minutos_trabajados, 0)),
        func.sum(func.coalesce(Asistencia.horas_extra, 0) * 60),
    ).outerjoin(Asistencia).filter(Turno.fecha_inicio >= fi, Turno.fecha_inicio <= ff)

    if guardia_id:
        q = q.filter(Turno.guardia_id == guardia_id)
    if instalacion_id:
        q = q.filter(Turno.instalacion_id == instalacion_id)

    result = q.one()
    total = int(result[0] or 0)
    a_tiempo = int(result[1] or 0)
    tardanza = int(result[2] or 0)
    falta = int(result[3] or 0)
    sin_marcar = int(result[4] or 0)
    total_min_retraso = int(result[5] or 0)
    total_min_trabajados = int(result[6] or 0)
    total_min_extra = int(result[7] or 0)

    puntualidad = round((a_tiempo / total) * 100, 1) if total > 0 else 0.0
    promedio_retraso = round(total_min_retraso / total, 1) if total > 0 else 0.0

    return EstadisticasAsistenciaOut(
        total_turnos=total,
        a_tiempo=a_tiempo,
        tardanzas=tardanza,
        faltas=falta,
        sin_marcar=sin_marcar,
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
    a = db.query(Asistencia).filter(Asistencia.id == asistencia_id).first()
    if not a:
        raise HTTPException(404, "Asistencia no encontrada")

    if data.estado:
        a.estado = data.estado
    if data.observacion is not None:
        a.observacion = data.observacion
    if data.entrada:
        a.entrada = data.entrada
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
            fi_date = datetime.strptime(fecha_inicio, "%Y-%m-%d").date()
            fi, _ = rango_dia_utc(fi_date)
            q = q.filter(Asistencia.entrada >= fi)
        except ValueError:
            pass
    if fecha_fin:
        try:
            ff_date = datetime.strptime(fecha_fin, "%Y-%m-%d").date()
            _, ff = rango_dia_utc(ff_date)
            q = q.filter(Asistencia.entrada <= ff)
        except ValueError:
            pass
    if instalacion_id:
        q = q.join(Turno).filter(Turno.instalacion_id == instalacion_id)

    return q.order_by(Asistencia.created_at.desc()).offset(skip).limit(limit).all()


# ══════════════════════════════════════════════════════════════════════════════
# EXPORTACIÓN
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
    try:
        fi_date = datetime.strptime(fecha_inicio, "%Y-%m-%d").date()
        ff_date = datetime.strptime(fecha_fin,    "%Y-%m-%d").date()
        fi, _   = rango_dia_utc(fi_date)
        _, ff   = rango_dia_utc(ff_date)
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
        if not dt:
            return ""
        # Mostrar en hora local Chile para los reportes
        dt_chile = dt + CHILE_OFFSET
        return dt_chile.strftime("%d/%m/%Y %H:%M")

    def _horas(mins):
        if mins is None:
            return ""
        return f"{mins // 60}h {mins % 60}m"

    filas = []
    for a in registros:
        g   = a.guardia
        t   = a.turno
        ins = t.instalacion if t else None
        # Mostrar fecha del turno en hora local Chile
        fecha_turno_chile = (t.fecha_inicio + CHILE_OFFSET) if t else None
        filas.append({
            "RUT":              g.rut if g else "",
            "Nombre":           f"{g.nombre} {g.apellido}" if g else "",
            "Instalación":      ins.nombre if ins else "",
            "Fecha":            fecha_turno_chile.strftime("%d/%m/%Y") if fecha_turno_chile else "",
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

        for col in ws.columns:
            max_len = max(len(str(c.value or "")) for c in col)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 40)

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

    import csv
    buf = io.StringIO()
    if filas:
        writer = csv.DictWriter(buf, fieldnames=list(filas[0].keys()))
        writer.writeheader()
        writer.writerows(filas)
    buf.seek(0)
    nombre_archivo = f"asistencias_{fecha_inicio}_{fecha_fin}.csv"
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )
