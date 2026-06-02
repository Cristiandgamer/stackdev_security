from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime,
    Float, Text, ForeignKey, Enum
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class Instalacion(Base):
    __tablename__ = "instalaciones"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(150), nullable=False)
    direccion = Column(String(255))
    latitud = Column(Float)
    longitud = Column(Float)
    activa = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    puntos_control = relationship("PuntoControl", back_populates="instalacion")
    turnos = relationship("Turno", back_populates="instalacion")
    rondas = relationship("Ronda", back_populates="instalacion")


class PuntoControl(Base):
    __tablename__ = "puntos_control"

    id = Column(Integer, primary_key=True, index=True)
    instalacion_id = Column(Integer, ForeignKey("instalaciones.id"), nullable=False)
    ronda_id = Column(Integer, ForeignKey("rondas.id"), nullable=True)
    nombre = Column(String(150), nullable=False)
    descripcion = Column(Text)
    latitud = Column(Float, nullable=False)
    longitud = Column(Float, nullable=False)
    radio_metros = Column(Integer, default=50)
    qr_token = Column(String(64), unique=True, index=True)
    activo = Column(Boolean, default=True)
    orden = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    instalacion = relationship("Instalacion", back_populates="puntos_control")
    ronda = relationship("Ronda", back_populates="puntos")
    verificaciones = relationship("VerificacionPunto", back_populates="punto_control")


class VerificacionPunto(Base):
    __tablename__ = "verificaciones_punto"

    id = Column(Integer, primary_key=True, index=True)
    punto_control_id = Column(Integer, ForeignKey("puntos_control.id"), nullable=False)
    turno_id = Column(Integer, ForeignKey("turnos.id"), nullable=False)
    guardia_id = Column(Integer, ForeignKey("guardias.id"), nullable=False)
    metodo = Column(String(10))
    latitud_verificada = Column(Float)
    longitud_verificada = Column(Float)
    distancia_metros = Column(Float)
    qr_escaneado = Column(String(64))
    notas = Column(Text)
    verificado_en = Column(DateTime(timezone=True), server_default=func.now())

    punto_control = relationship("PuntoControl", back_populates="verificaciones")
    turno = relationship("Turno")
    guardia = relationship("Guardia")


class Guardia(Base):
    __tablename__ = "guardias"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    instalacion_id = Column(Integer, ForeignKey("instalaciones.id"), nullable=True)
    rut = Column(String(15), unique=True, index=True, nullable=False)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False)
    telefono = Column(String(20))
    email = Column(String(150))
    certificaciones = Column(Text)
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    usuario = relationship("Usuario")
    instalacion = relationship("Instalacion")
    turnos = relationship("Turno", back_populates="guardia")
    asistencias = relationship("Asistencia", back_populates="guardia")


class Turno(Base):
    __tablename__ = "turnos"

    id = Column(Integer, primary_key=True, index=True)
    guardia_id = Column(Integer, ForeignKey("guardias.id"), nullable=False)
    instalacion_id = Column(Integer, ForeignKey("instalaciones.id"), nullable=False)
    fecha_inicio = Column(DateTime(timezone=True), nullable=False)
    fecha_fin = Column(DateTime(timezone=True), nullable=False)
    estado = Column(String(20), default="programado")
    notas = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    guardia = relationship("Guardia", back_populates="turnos")
    instalacion = relationship("Instalacion", back_populates="turnos")
    asistencia = relationship("Asistencia", back_populates="turno", uselist=False)


class Asistencia(Base):
    """
    Registro completo de asistencia de un guardia en un turno.
    Incluye geolocalización, selfie de entrada/salida, estado calculado
    y métricas para nómina.
    """
    __tablename__ = "asistencias"

    id = Column(Integer, primary_key=True, index=True)
    turno_id = Column(Integer, ForeignKey("turnos.id"), nullable=False)
    guardia_id = Column(Integer, ForeignKey("guardias.id"), nullable=False)

    # ── Entrada ────────────────────────────────────────────────────────────
    entrada = Column(DateTime(timezone=True), nullable=True)
    latitud_entrada = Column(Float, nullable=True)
    longitud_entrada = Column(Float, nullable=True)
    distancia_entrada = Column(Float, nullable=True)   # metros desde la instalación
    foto_entrada = Column(String(500), nullable=True)  # ruta /uploads/...

    # ── Salida ─────────────────────────────────────────────────────────────
    salida = Column(DateTime(timezone=True), nullable=True)
    latitud_salida = Column(Float, nullable=True)
    longitud_salida = Column(Float, nullable=True)
    distancia_salida = Column(Float, nullable=True)
    foto_salida = Column(String(500), nullable=True)

    # ── Estado y métricas ──────────────────────────────────────────────────
    # a_tiempo | tardanza | falta | sin_marcar
    estado = Column(String(20), default="sin_marcar", nullable=False)
    minutos_retraso = Column(Integer, default=0, nullable=False)
    minutos_trabajados = Column(Integer, nullable=True)   # calculado al marcar salida
    horas_extra = Column(Float, default=0.0, nullable=False)

    # ── Observaciones ──────────────────────────────────────────────────────
    observacion = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    turno = relationship("Turno", back_populates="asistencia")
    guardia = relationship("Guardia", back_populates="asistencias")


class Incidente(Base):
    __tablename__ = "incidentes"

    id = Column(Integer, primary_key=True, index=True)
    instalacion_id = Column(Integer, ForeignKey("instalaciones.id"), nullable=False)
    guardia_id = Column(Integer, ForeignKey("guardias.id"), nullable=True)
    turno_id = Column(Integer, ForeignKey("turnos.id"), nullable=True)
    titulo = Column(String(200), nullable=False)
    descripcion = Column(Text)
    severidad = Column(String(10), default="media")
    estado = Column(String(20), default="abierto")
    latitud = Column(Float)
    longitud = Column(Float)
    reportado_en = Column(DateTime(timezone=True), server_default=func.now())
    resuelto_en = Column(DateTime(timezone=True))

    instalacion = relationship("Instalacion")
    guardia = relationship("Guardia")
    archivos = relationship("ArchivoIncidente", back_populates="incidente")


class ArchivoIncidente(Base):
    __tablename__ = "archivos_incidente"

    id = Column(Integer, primary_key=True, index=True)
    incidente_id = Column(Integer, ForeignKey("incidentes.id"), nullable=False)
    nombre_archivo = Column(String(255))
    ruta = Column(String(500))
    tipo_mime = Column(String(100))
    subido_en = Column(DateTime(timezone=True), server_default=func.now())

    incidente = relationship("Incidente", back_populates="archivos")


class Notificacion(Base):
    __tablename__ = "notificaciones"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    titulo = Column(String(200), nullable=False)
    mensaje = Column(Text)
    leida = Column(Boolean, default=False)
    tipo = Column(String(30), default="info")
    referencia_id = Column(Integer)
    referencia_tipo = Column(String(30))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    usuario = relationship("Usuario")


class Ronda(Base):
    __tablename__ = "rondas"

    id = Column(Integer, primary_key=True, index=True)
    instalacion_id = Column(Integer, ForeignKey("instalaciones.id"), nullable=False)
    nombre = Column(String(150), nullable=False)
    descripcion = Column(Text)
    activa = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    instalacion = relationship("Instalacion", back_populates="rondas")
    puntos = relationship("PuntoControl", back_populates="ronda")


# ── Configuración del sistema de asistencia ───────────────────────────────────
class ConfigAsistencia(Base):
    """
    Tabla de configuración global del sistema de asistencia.
    Solo debe existir un registro (id=1). El admin lo edita desde el panel.
    """
    __tablename__ = "config_asistencia"

    id = Column(Integer, primary_key=True, default=1)
    tolerancia_tardanza_min = Column(Integer, default=10, nullable=False)
    tolerancia_falta_min = Column(Integer, default=120, nullable=False)
    radio_geofence_metros = Column(Integer, default=50, nullable=False)
    requiere_foto = Column(Boolean, default=True, nullable=False)
    reconocimiento_facial = Column(Boolean, default=False, nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
