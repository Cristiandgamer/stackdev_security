"""
Schemas adicionales para el sistema de rondas reconstruido.
Importar desde app.schemas.schemas_ronda en los routers.
"""
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
import re


# ── Instalación con radio GPS ──────────────────────────────────────────────────

class InstalacionOut(BaseModel):
    id: int
    nombre: str
    descripcion: Optional[str] = None
    direccion: Optional[str] = None
    ciudad: Optional[str] = None
    telefono: Optional[str] = None
    tipo: Optional[str] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    radio_gps_metros: int = 15
    activa: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class InstalacionCreate(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    direccion: Optional[str] = None
    ciudad: Optional[str] = None
    telefono: Optional[str] = None
    tipo: Optional[str] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    radio_gps_metros: Optional[int] = 15


class InstalacionUpdate(InstalacionCreate):
    nombre: Optional[str] = None
    activa: Optional[bool] = None


# ── Punto de Control ──────────────────────────────────────────────────────────

class PuntoControlOut(BaseModel):
    id: int
    instalacion_id: int
    ronda_id: Optional[int] = None
    nombre: str
    descripcion: Optional[str] = None
    latitud: float
    longitud: float
    qr_token: Optional[str] = None
    activo: bool
    orden: int
    created_at: datetime
    model_config = {"from_attributes": True}


class PuntoControlCreate(BaseModel):
    instalacion_id: int
    ronda_id: Optional[int] = None
    nombre: str
    descripcion: Optional[str] = None
    # Coordenadas donde el admin hizo clic en el mapa
    latitud: float
    longitud: float
    orden: int = 0


class PuntoControlUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    orden: Optional[int] = None
    activo: Optional[bool] = None
    ronda_id: Optional[int] = None


# ── Ronda (plantilla) ─────────────────────────────────────────────────────────

class RondaCreate(BaseModel):
    instalacion_id: int
    nombre: str
    descripcion: Optional[str] = None
    rondas_por_turno: int = 1
    descanso_entre_rondas_min: int = 60
    tiempo_maximo_ronda_min: int = 0


class RondaUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    activa: Optional[bool] = None
    rondas_por_turno: Optional[int] = None
    descanso_entre_rondas_min: Optional[int] = None
    tiempo_maximo_ronda_min: Optional[int] = None


class RondaOut(BaseModel):
    id: int
    instalacion_id: int
    nombre: str
    descripcion: Optional[str] = None
    activa: bool
    rondas_por_turno: int
    descanso_entre_rondas_min: int
    tiempo_maximo_ronda_min: int
    created_at: datetime
    model_config = {"from_attributes": True}


class RondaConPuntosOut(RondaOut):
    puntos: List[PuntoControlOut] = []


# ── Ejecución de Ronda ────────────────────────────────────────────────────────

class RondaEjecucionOut(BaseModel):
    id: int
    turno_id: int
    ronda_id: int
    guardia_id: int
    numero_ronda: int
    estado: str
    iniciada_en: Optional[datetime] = None
    completada_en: Optional[datetime] = None
    proxima_ronda_disponible: Optional[datetime] = None
    minutos_duracion: Optional[int] = None
    puntos_completados: int
    puntos_total: int
    notas_sistema: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Verificación ──────────────────────────────────────────────────────────────

class VerificacionCreate(BaseModel):
    punto_control_id: int
    turno_id: int
    guardia_id: int
    ejecucion_id: Optional[int] = None
    metodo: str  # gps | qr
    latitud_verificada: Optional[float] = None
    longitud_verificada: Optional[float] = None
    qr_escaneado: Optional[str] = None
    notas: Optional[str] = None


class VerificacionOut(BaseModel):
    id: int
    punto_control_id: int
    turno_id: int
    guardia_id: int
    ejecucion_id: Optional[int] = None
    metodo: str
    distancia_metros: Optional[float] = None
    verificado_en: datetime
    model_config = {"from_attributes": True}


# ── Vista del guardia: turno activo con ronda ─────────────────────────────────

class PuntoConEstadoOut(PuntoControlOut):
    """Punto con estado de verificación en la ejecución actual."""
    verificado: bool = False
    verificado_en: Optional[datetime] = None
    distancia_metros: Optional[float] = None


class EjecucionActivaOut(BaseModel):
    """Estado completo de la ronda activa para el guardia."""
    ejecucion_id: Optional[int] = None
    numero_ronda: int
    estado: str  # pendiente | en_progreso | completada | incompleta
    iniciada_en: Optional[datetime] = None
    proxima_ronda_disponible: Optional[datetime] = None
    puntos_completados: int
    puntos_total: int
    puntos: List[PuntoConEstadoOut] = []
    # Info de progreso total del turno
    rondas_completadas_turno: int
    rondas_por_turno: int
    descanso_entre_rondas_min: int
    # Próxima ronda en segundos (positivo = tiempo restante, negativo = ya disponible)
    segundos_para_proxima: Optional[int] = None
    model_config = {"from_attributes": True}


class TurnoActivoOut(BaseModel):
    """Turno activo completo para la página de ronda del guardia."""
    id: int
    guardia_id: int
    instalacion_id: int
    instalacion_nombre: str
    instalacion_direccion: Optional[str] = None
    instalacion_latitud: Optional[float] = None
    instalacion_longitud: Optional[float] = None
    radio_gps_metros: int
    ronda_id: Optional[int] = None
    ronda_nombre: Optional[str] = None
    ronda_descripcion: Optional[str] = None
    fecha_inicio: datetime
    fecha_fin: datetime
    estado: str
    ejecucion_activa: Optional[EjecucionActivaOut] = None
    model_config = {"from_attributes": True}


# ── Resumen de rondas para el supervisor ──────────────────────────────────────

class ResumenRondasTurnoOut(BaseModel):
    turno_id: int
    guardia_nombre: str
    instalacion_nombre: str
    ronda_nombre: Optional[str] = None
    rondas_completadas: int
    rondas_por_turno: int
    ultima_completada_en: Optional[datetime] = None
    ejecuciones: List[RondaEjecucionOut] = []
    model_config = {"from_attributes": True}
