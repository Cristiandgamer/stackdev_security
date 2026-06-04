-- Índices recomendados para optimizar consultas frecuentes de asistencia en MySQL

ALTER TABLE puntos_control ADD INDEX ix_puntos_instalacion_id (instalacion_id);
ALTER TABLE puntos_control ADD INDEX ix_puntos_ronda_id (ronda_id);

ALTER TABLE verificaciones_punto ADD INDEX ix_verificaciones_punto_control_id (punto_control_id);
ALTER TABLE verificaciones_punto ADD INDEX ix_verificaciones_turno_id (turno_id);
ALTER TABLE verificaciones_punto ADD INDEX ix_verificaciones_guardia_id (guardia_id);
ALTER TABLE verificaciones_punto ADD INDEX ix_verificaciones_turno_guardia (turno_id, guardia_id);

ALTER TABLE guardias ADD INDEX ix_guardias_usuario_id (usuario_id);
ALTER TABLE guardias ADD INDEX ix_guardias_instalacion_id (instalacion_id);

ALTER TABLE turnos ADD INDEX ix_turnos_guardia_id (guardia_id);
ALTER TABLE turnos ADD INDEX ix_turnos_instalacion_id (instalacion_id);
ALTER TABLE turnos ADD INDEX ix_turnos_fecha_inicio (fecha_inicio);
ALTER TABLE turnos ADD INDEX ix_turnos_fecha_fin (fecha_fin);
ALTER TABLE turnos ADD INDEX ix_turnos_guardia_fecha_inicio (guardia_id, fecha_inicio);
ALTER TABLE turnos ADD INDEX ix_turnos_instalacion_fecha_inicio (instalacion_id, fecha_inicio);

ALTER TABLE asistencias ADD INDEX ix_asistencias_turno_id (turno_id);
ALTER TABLE asistencias ADD INDEX ix_asistencias_guardia_id (guardia_id);
ALTER TABLE asistencias ADD INDEX ix_asistencias_guardia_created_at (guardia_id, created_at);

ALTER TABLE incidentes ADD INDEX ix_incidentes_instalacion_id (instalacion_id);
ALTER TABLE incidentes ADD INDEX ix_incidentes_guardia_id (guardia_id);
ALTER TABLE incidentes ADD INDEX ix_incidentes_turno_id (turno_id);

ALTER TABLE notificaciones ADD INDEX ix_notificaciones_usuario_id (usuario_id);
ALTER TABLE notificaciones ADD INDEX ix_notificaciones_created_at (created_at);
ALTER TABLE notificaciones ADD INDEX ix_notificaciones_usuario_fecha (usuario_id, created_at);
