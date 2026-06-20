from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List
from datetime import datetime
import re


# ── RUT helpers ────────────────────────────────────────────────────────────────

def validar_rut(rut: str) -> bool:
    rut = rut.replace(".", "").replace("-", "").upper().strip()
    if not re.match(r"^\d{7,8}[0-9K]$", rut):
        return False
    body, dv = rut[:-1], rut[-1]
    total, factor = 0, 2
    for digit in reversed(body):
        total += int(digit) * factor
        factor = factor % 7 + 2
    expected = 11 - (total % 11)
    if expected == 11:
        calc_dv = "0"
    elif expected == 10:
        calc_dv = "K"
    else:
        calc_dv = str(expected)
    return dv == calc_dv


def formatear_rut(rut: str) -> str:
    rut = rut.replace(".", "").replace("-", "").upper().strip()
    body, dv = rut[:-1], rut[-1]
    body_fmt = "{:,}".format(int(body)).replace(",", ".")
    return f"{body_fmt}-{dv}"


# ── Auth ───────────────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ── Usuario ────────────────────────────────────────────────────────────────────

class UsuarioBase(BaseModel):
    nombre: str
    apellido: Optional[str] = None
    username: Optional[str] = None
    email: EmailStr
    rol: str = "usuario"


class UsuarioCreate(UsuarioBase):
    username: str
    password: str


class UsuarioUpdate(BaseModel):
    nombre: Optional[str] = None
    apellido: Optional[str] = None
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    rol: Optional[str] = None
    activo: Optional[bool] = None
    password: Optional[str] = None


class UsuarioOut(UsuarioBase):
    id: int
    activo: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Guardia ────────────────────────────────────────────────────────────────────

class GuardiaBase(BaseModel):
    rut: str
    nombre: str
    apellido: str
    telefono: Optional[str] = None
    email: Optional[str] = None
    certificaciones: Optional[str] = None

    @field_validator("rut")
    @classmethod
    def validate_rut(cls, v):
        if v is None:
            return v
        if not validar_rut(v):
            raise ValueError("RUT chileno inválido")
        return formatear_rut(v)


class GuardiaCreate(GuardiaBase):
    rut: Optional[str] = None
    usuario_id: Optional[int] = None
    instalacion_id: Optional[int] = None
    nombre: Optional[str] = None
    apellido: Optional[str] = None


class GuardiaUpdate(BaseModel):
    usuario_id: Optional[int] = None
    instalacion_id: Optional[int] = None
    nombre: Optional[str] = None
    apellido: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    certificaciones: Optional[str] = None
    activo: Optional[bool] = None


class GuardiaOut(GuardiaBase):
    id: int
    usuario_id: Optional[int] = None
    instalacion_id: Optional[int] = None
    activo: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Instalacion ────────────────────────────────────────────────────────────────

class InstalacionBase(BaseModel):
    nombre: str
    direccion: Optional[str] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None


class InstalacionCreate(InstalacionBase):
    pass


class InstalacionUpdate(InstalacionBase):
    activa: Optional[bool] = None


class InstalacionOut(InstalacionBase):
    id: int
    activa: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── PuntoControl ───────────────────────────────────────────────────────────────

class PuntoControlBase(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    latitud: float
    longitud: float
    radio_metros: Optional[int] = 50
    orden: int = 0


class PuntoControlCreate(PuntoControlBase):
    instalacion_id: int
    ronda_id: Optional[int] = None


class PuntoControlUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    radio_metros: Optional[int] = None
    orden: Optional[int] = None
    activo: Optional[bool] = None
    ronda_id: Optional[int] = None


class PuntoControlOut(PuntoControlBase):
    id: int
    instalacion_id: int
    ronda_id: Optional[int] = None
    qr_token: Optional[str] = None
    activo: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Ronda ──────────────────────────────────────────────────────────────────────

class RondaBase(BaseModel):
    nombre: str
    descripcion: Optional[str] = None


class RondaCreate(RondaBase):
    instalacion_id: int
    intervalo_minutos: Optional[int] = 60
    rondas_por_turno: Optional[int] = 1


class RondaUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    activa: Optional[bool] = None
    intervalo_minutos: Optional[int] = None
    rondas_por_turno: Optional[int] = None


class RondaOut(RondaBase):
    id: int
    instalacion_id: int
    activa: bool
    intervalo_minutos: int
    rondas_por_turno: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Verificacion ───────────────────────────────────────────────────────────────

class VerificacionCreate(BaseModel):
    punto_control_id: int
    turno_id: int
    guardia_id: int
    ejecucion_id: Optional[int] = None
    metodo: str  # gps | qr | ambos
    latitud_verificada: Optional[float] = None
    longitud_verificada: Optional[float] = None
    qr_escaneado: Optional[str] = None
    notas: Optional[str] = None


class VerificacionOut(BaseModel):
    id: int
    punto_control_id: int
    turno_id: int
    guardia_id: int
    metodo: str
    distancia_metros: Optional[float] = None
    verificado_en: datetime

    model_config = {"from_attributes": True}


# ── Turno ──────────────────────────────────────────────────────────────────────

# Valores válidos de enums (documentación)
# estado:  asignado | activo | completado | cancelado | inasistencia
# jornada: full-time | part-time | hora-extra | reemplazo
# tipo:    diurno | nocturno | mixto

class TurnoBase(BaseModel):
    guardia_id:    int
    instalacion_id: int
    ronda_id:      Optional[int] = None

    # Planificación teórica — el frontend envía ISO 8601 UTC
    fecha_inicio: datetime
    fecha_fin:    datetime

    # Clasificación operativa
    estado:  str = "asignado"
    jornada: str = "full-time"
    tipo:    str = "diurno"

    # Patrón de repetición opcional
    dias_semana: Optional[List[str]] = None
    notas:       Optional[str] = None


class TurnoCreate(TurnoBase):
    pass


class TurnoUpdate(BaseModel):
    ronda_id:      Optional[int] = None
    fecha_inicio:  Optional[datetime] = None
    fecha_fin:     Optional[datetime] = None
    estado:        Optional[str] = None
    jornada:       Optional[str] = None
    tipo:          Optional[str] = None
    dias_semana:   Optional[List[str]] = None
    notas:         Optional[str] = None
    # Auditoría de asistencia real
    check_in_real:  Optional[datetime] = None
    check_out_real: Optional[datetime] = None


class TurnoOut(TurnoBase):
    id: int
    check_in_real:  Optional[datetime] = None
    check_out_real: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PuntoControlRondaOut(PuntoControlOut):
    verificado: bool = False


class TurnoDetalleOut(TurnoBase):
    id: int
    check_in_real:  Optional[datetime] = None
    check_out_real: Optional[datetime] = None
    created_at: datetime
    instalacion: InstalacionOut
    ronda: Optional[RondaOut] = None
    puntos: List[PuntoControlRondaOut] = []
    progreso: Optional[dict] = None

    model_config = {"from_attributes": True}


# ── Asistencia ─────────────────────────────────────────────────────────────────

class AsistenciaOut(BaseModel):
    id: int
    turno_id:    int
    guardia_id:  int
    entrada:     Optional[datetime] = None
    salida:      Optional[datetime] = None
    observacion: Optional[str] = None
    created_at:  datetime

    model_config = {"from_attributes": True}


# ── ArchivoIncidente ───────────────────────────────────────────────────────────

class ArchivoIncidenteOut(BaseModel):
    id: int
    incidente_id:   int
    nombre_archivo: Optional[str] = None
    ruta:           str
    tipo_mime:      Optional[str] = None
    subido_en:      datetime

    model_config = {"from_attributes": True}


# ── Incidente ──────────────────────────────────────────────────────────────────

class IncidenteBase(BaseModel):
    instalacion_id: int
    guardia_id:     Optional[int] = None
    turno_id:       Optional[int] = None
    titulo:         str
    descripcion:    Optional[str] = None
    severidad:      str = "media"
    latitud:        Optional[float] = None
    longitud:       Optional[float] = None


class IncidenteCreate(IncidenteBase):
    pass


class IncidenteUpdate(BaseModel):
    titulo:      Optional[str] = None
    descripcion: Optional[str] = None
    severidad:   Optional[str] = None
    estado:      Optional[str] = None


class IncidenteOut(IncidenteBase):
    id:          int
    estado:      str
    reportado_en: datetime
    resuelto_en: Optional[datetime] = None
    instalacion: Optional[InstalacionOut] = None
    archivos:    List[ArchivoIncidenteOut] = []

    model_config = {"from_attributes": True}


# ── Notificacion ───────────────────────────────────────────────────────────────

class NotificacionOut(BaseModel):
    id:         int
    titulo:     str
    mensaje:    Optional[str] = None
    leida:      bool
    tipo:       str
    created_at: datetime

    model_config = {"from_attributes": True}
