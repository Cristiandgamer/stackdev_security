from sqlalchemy import Column, Integer, Boolean, DateTime
from sqlalchemy.sql import func
from app.core.database import Base


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
