import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || "/api" });

api.interceptors.request.use((config) => {
  const raw = localStorage.getItem("stackdev-auth");
  let token;
  try {
    const auth = JSON.parse(raw || "{}");
    // Support different persist shapes: { state: { token } }, { token }, { access_token }
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
  // Instalaciones
  listarInstalaciones: (params) => api.get("/instalaciones", { params }),
  crearInstalacion: (d) => api.post("/instalaciones", d),
  actualizarInstalacion: (id, d) => api.put(`/instalaciones/${id}`, d),
  eliminarInstalacion: (id) => api.delete(`/instalaciones/${id}`),

  // Puntos de control
  listarPuntos: (instId) => api.get(`/instalaciones/${instId}/puntos`),
  crearPunto: (instId, d) => api.post("/puntos-control", { ...d, instalacion_id: instId }),
  actualizarPunto: (id, d) => api.put(`/puntos-control/${id}`, d),
  regenerarQR: (id) => api.post(`/puntos-control/${id}/regenerar-qr`),
  obtenerQRImagen: (id) => api.get(`/puntos-control/${id}/qr-imagen`, { responseType: "blob" }),

  // Verificaciones / Rondas
  verificarPunto: (d) => api.post("/verificaciones", d),
  progresoRonda: (turnoId) => api.get(`/turnos/${turnoId}/progreso-ronda`),
  verificacionesTurno: (turnoId) => api.get(`/turnos/${turnoId}/verificaciones`),
  // Rondas
  listarRondas: (instId) => api.get(`/instalaciones/${instId}/rondas`),
  crearRonda: (d) => api.post(`/rondas`, d),
  actualizarRonda: (id, d) => api.put(`/rondas/${id}`, d),
  eliminarRonda: (id) => api.delete(`/rondas/${id}`),

  // Guardias
  listarGuardias: (params) => api.get("/guardias", { params }),
  crearGuardia: (d) => api.post("/guardias", d),
  actualizarGuardia: (id, d) => api.put(`/guardias/${id}`, d),
  eliminarGuardia: (id) => api.delete(`/guardias/${id}`),

  // Turnos
  listarTurnos: (params) => api.get("/turnos", { params }),
  crearTurno: (d) => api.post("/turnos", d),
  actualizarTurno: (id, d) => api.put(`/turnos/${id}`, d),
  miTurnoActivo: () => api.get("/turnos/mi-activo"),

  // Asistencias
  listarAsistencia: (params) => api.get("/asistencias", { params }),
  registrarEntrada: (turnoId, lat, lon) =>
    api.post(`/asistencias/entrada?turno_id=${turnoId}${lat ? `&lat=${lat}&lon=${lon}` : ""}`),
  registrarSalida: (turnoId) => api.post(`/asistencias/salida?turno_id=${turnoId}`),

  // Incidentes
  listarIncidentes: (params) => api.get("/incidentes", { params }),
  crearIncidente: (d) => api.post("/incidentes", d),
  actualizarIncidente: (id, d) => api.put(`/incidentes/${id}`, d),
  subirArchivoIncidente: (incidenteId, file) => api.post(`/incidentes/${incidenteId}/archivos`, file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream' }
  }),
  // Notificaciones
  listarNotificaciones: (params) => api.get("/notificaciones", { params }),
  marcarLeida: (id) => api.post(`/notificaciones/${id}/leer`),

  // Dashboard
  estadisticas: () => api.get("/estadisticas/dashboard"),
};

// ── usuariosService ───────────────────────────────────────────────────────────
export const usuariosService = {
  listar: () => api.get("/usuarios/"),
  crear: (d) => api.post("/usuarios/", d),
  actualizar: (id, d) => api.put(`/usuarios/${id}`, d),
  eliminar: (id) => api.delete(`/usuarios/${id}`),
};

export default api;

