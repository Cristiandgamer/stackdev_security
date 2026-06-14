import json
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime,
    Float, Text, ForeignKey, Enum, Index
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
    instalacion_id = Column(Integer, ForeignKey("instalaciones.id"), nullable=False, index=True)
    ronda_id = Column(Integer, ForeignKey("rondas.id"), nullable=True, index=True)
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
    __table_args__ = (
        Index("ix_verificaciones_turno_guardia", "turno_id", "guardia_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    punto_control_id = Column(Integer, ForeignKey("puntos_control.id"), nullable=False, index=True)
    turno_id = Column(Integer, ForeignKey("turnos.id"), nullable=False, index=True)
    guardia_id = Column(Integer, ForeignKey("guardias.id"), nullable=False, index=True)
    metodo = Column(String(10))  # gps | qr | ambos
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
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    instalacion_id = Column(Integer, ForeignKey("instalaciones.id"), nullable=True, index=True)
    rut = Column(String(15), unique=True, index=True, nullable=False)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False)
    telefono = Column(String(20))
    email = Column(String(150))
    certificaciones = Column(Text)  # JSON string
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    usuario = relationship("Usuario")
    instalacion = relationship("Instalacion")
    turnos = relationship("Turno", back_populates="guardia")
    asistencias = relationship("Asistencia", back_populates="guardia")


class Turno(Base):
    __tablename__ = "turnos"
    __table_args__ = (
        Index("ix_turnos_guardia_fecha_inicio", "guardia_id", "fecha_inicio"),
        Index("ix_turnos_instalacion_fecha_inicio", "instalacion_id", "fecha_inicio"),
    )

    id = Column(Integer, primary_key=True, index=True)
    guardia_id = Column(Integer, ForeignKey("guardias.id"), nullable=False, index=True)
    instalacion_id = Column(Integer, ForeignKey("instalaciones.id"), nullable=False, index=True)
    fecha_inicio = Column(DateTime(timezone=True), nullable=False, index=True)
    fecha_fin = Column(DateTime(timezone=True), nullable=False, index=True)
    _dias_semana = Column("dias_semana", Text, nullable=True)

    @property
    def dias_semana(self):
        if not self._dias_semana:
            return []
        try:
            return json.loads(self._dias_semana)
        except Exception:
            return []

    @dias_semana.setter
    def dias_semana(self, value):
        if value is None:
            self._dias_semana = None
        elif isinstance(value, str):
            self._dias_semana = value
        else:
            self._dias_semana = json.dumps(value)

    estado = Column(String(20), default="programado")  # programado|en_curso|finalizado|ausente
    notas = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    guardia = relationship("Guardia", back_populates="turnos")
    instalacion = relationship("Instalacion", back_populates="turnos")
    asistencia = relationship("Asistencia", back_populates="turno", uselist=False)


class Asistencia(Base):
    __tablename__ = "asistencias"
    __table_args__ = (
        Index("ix_asistencias_guardia_created_at", "guardia_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    turno_id = Column(Integer, ForeignKey("turnos.id"), nullable=False, index=True)
    guardia_id = Column(Integer, ForeignKey("guardias.id"), nullable=False, index=True)
    
    # Entrada
    entrada = Column(DateTime(timezone=True))
    latitud_entrada = Column(Float)
    longitud_entrada = Column(Float)
    distancia_entrada = Column(Float)
    foto_entrada = Column(String(500))
    
    # Salida
    salida = Column(DateTime(timezone=True))
    latitud_salida = Column(Float)
    longitud_salida = Column(Float)
    distancia_salida = Column(Float)
    foto_salida = Column(String(500))
    
    # Estado y cálculos
    estado = Column(String(20), default="sin_marcar")  # ← IMPORTANTE
    minutos_retraso = Column(Integer, default=0)      # ← IMPORTANTE
    minutos_trabajados = Column(Integer)              # ← IMPORTANTE
    horas_extra = Column(Float, default=0.0)          # ← IMPORTANTE
    
    # Observaciones
    observacion = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    turno = relationship("Turno", back_populates="asistencia")
    guardia = relationship("Guardia", back_populates="asistencias")


class Incidente(Base):
    __tablename__ = "incidentes"

    id = Column(Integer, primary_key=True, index=True)
    instalacion_id = Column(Integer, ForeignKey("instalaciones.id"), nullable=False, index=True)
    guardia_id = Column(Integer, ForeignKey("guardias.id"), nullable=True, index=True)
    turno_id = Column(Integer, ForeignKey("turnos.id"), nullable=True, index=True)
    titulo = Column(String(200), nullable=False)
    descripcion = Column(Text)
    severidad = Column(String(10), default="media")  # baja|media|alta|critica
    estado = Column(String(20), default="abierto")   # abierto|en_proceso|resuelto|cerrado
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
    __table_args__ = (
        Index("ix_notificaciones_usuario_fecha", "usuario_id", "created_at"),
        Index("ix_notificaciones_created_at", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    titulo = Column(String(200), nullable=False)
    mensaje = Column(Text)
    leida = Column(Boolean, default=False)
    tipo = Column(String(30), default="info")  # info|alerta|incidente
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
    intervalo_minutos = Column(Integer, default=60, nullable=False)
    rondas_por_turno = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    instalacion = relationship("Instalacion", back_populates="rondas")
    puntos = relationship("PuntoControl", back_populates="ronda")
