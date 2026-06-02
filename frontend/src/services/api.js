import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || "/api" });

api.interceptors.request.use((config) => {
  const raw = localStorage.getItem("stackdev-auth");
  let token;
  try {
    const auth = JSON.parse(raw || "{}");
    token = auth?.state?.token || auth?.token || auth?.access_token || auth?.state?.access_token;
  } catch (e) {
    token = null;
  }
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("stackdev-auth");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── authService ───────────────────────────────────────────────────────────────
export const authService = {
  login: (data) => api.post("/auth/login", data),
  me: () => api.get("/auth/me"),
};

// ── seguridadService ──────────────────────────────────────────────────────────
export const seguridadService = {
  listarInstalaciones: (params) => api.get("/instalaciones", { params }),
  crearInstalacion: (d) => api.post("/instalaciones", d),
  actualizarInstalacion: (id, d) => api.put(`/instalaciones/${id}`, d),
  eliminarInstalacion: (id) => api.delete(`/instalaciones/${id}`),

  listarPuntos: (instId) => api.get(`/instalaciones/${instId}/puntos`),
  crearPunto: (instId, d) => api.post("/puntos-control", { ...d, instalacion_id: instId }),
  actualizarPunto: (id, d) => api.put(`/puntos-control/${id}`, d),
  regenerarQR: (id) => api.post(`/puntos-control/${id}/regenerar-qr`),
  obtenerQRImagen: (id) => api.get(`/puntos-control/${id}/qr-imagen`, { responseType: "blob" }),

  verificarPunto: (d) => api.post("/verificaciones", d),
  progresoRonda: (turnoId) => api.get(`/turnos/${turnoId}/progreso-ronda`),
  verificacionesTurno: (turnoId) => api.get(`/turnos/${turnoId}/verificaciones`),

  listarRondas: (instId) => api.get(`/instalaciones/${instId}/rondas`),
  crearRonda: (d) => api.post(`/rondas`, d),
  actualizarRonda: (id, d) => api.put(`/rondas/${id}`, d),
  eliminarRonda: (id) => api.delete(`/rondas/${id}`),

  listarGuardias: (params) => api.get("/guardias", { params }),
  crearGuardia: (d) => api.post("/guardias", d),
  actualizarGuardia: (id, d) => api.put(`/guardias/${id}`, d),
  eliminarGuardia: (id) => api.delete(`/guardias/${id}`),

  listarTurnos: (params) => api.get("/turnos", { params }),
  crearTurno: (d) => api.post("/turnos", d),
  actualizarTurno: (id, d) => api.put(`/turnos/${id}`, d),
  miTurnoActivo: () => api.get("/turnos/mi-activo"),

  listarIncidentes: (params) => api.get("/incidentes", { params }),
  crearIncidente: (d) => api.post("/incidentes", d),
  actualizarIncidente: (id, d) => api.put(`/incidentes/${id}`, d),
  subirArchivoIncidente: (incidenteId, formData) =>
    api.post(`/incidentes/${incidenteId}/archivos`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  listarNotificaciones: (params) => api.get("/notificaciones", { params }),
  marcarLeida: (id) => api.post(`/notificaciones/${id}/leer`),

  estadisticas: () => api.get("/estadisticas/dashboard"),
};

// ── asistenciaService ─────────────────────────────────────────────────────────
export const asistenciaService = {
  // Configuración (admin)
  obtenerConfig: () => api.get("/asistencia/config"),
  actualizarConfig: (d) => api.put("/asistencia/config", d),

  // Marcaje guardia
  marcarEntrada: (turnoId, lat, lon, foto) => {
    const fd = new FormData();
    if (foto) fd.append("foto", foto);
    return api.post(
      `/asistencia/entrada?turno_id=${turnoId}&lat=${lat}&lon=${lon}`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
  },
  marcarSalida: (turnoId, lat, lon, foto, observacion) => {
    const fd = new FormData();
    if (foto) fd.append("foto", foto);
    if (observacion) fd.append("observacion", observacion);
    return api.post(
      `/asistencia/salida?turno_id=${turnoId}&lat=${lat}&lon=${lon}`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
  },

  // Guardia — consultas
  miAsistencia: () => api.get("/asistencia/mi-asistencia"),
  miHistorial: (params) => api.get("/asistencia/mi-historial", { params }),

  // Admin — dashboard en vivo (polling)
  dashboardLive: (params) => api.get("/asistencia/dashboard-live", { params }),
  estadisticas: (params) => api.get("/asistencia/estadisticas", { params }),

  // Admin — listado con filtros
  listar: (params) => api.get("/asistencia/listar", { params }),

  // Admin — ajuste manual
  ajusteManual: (id, d) => api.put(`/asistencia/${id}/ajuste`, d),

  // Exportación
  exportar: (params) => api.get("/asistencia/exportar", {
    params,
    responseType: "blob",
  }),
};

// ── usuariosService ───────────────────────────────────────────────────────────
export const usuariosService = {
  listar: () => api.get("/usuarios/"),
  crear: (d) => api.post("/usuarios/", d),
  actualizar: (id, d) => api.put(`/usuarios/${id}`, d),
  eliminar: (id) => api.delete(`/usuarios/${id}`),
};

export default api;
