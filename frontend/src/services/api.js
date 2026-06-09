import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || "/api" });

const readAuthToken = () => {
  try {
    const raw = sessionStorage.getItem("stackdev-auth");
    if (!raw) return null;
    const auth = JSON.parse(raw);
    return auth?.state?.token ?? null;
  } catch {
    return null;
  }
};

// Flag que evita múltiples redirects simultáneos
let redirectingToLogin = false;

// Contador de reintentos para evitar loops infinitos
const retryCount = new Map();

api.interceptors.request.use((config) => {
  const token = readAuthToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => {
    // Reset del flag en cualquier respuesta exitosa
    redirectingToLogin = false;
    // Limpiar contador de reintentos
    const key = `${r.config.method}:${r.config.url}`;
    retryCount.delete(key);
    return r;
  },
  async (err) => {
    const config = err.config;
    const key = `${config.method}:${config.url}`;
    const attempts = retryCount.get(key) || 0;

    // ═══════════════════════════════════════════════════════════════════════
    // CASO 1: Error 401 en primer request (race condition de auth)
    // ═══════════════════════════════════════════════════════════════════════
    if (
      err.response?.status === 401 &&
      attempts < 2 &&
      !config.url.includes("/auth/login") &&
      !config.url.includes("/auth/me")
    ) {
      // Incrementar contador de reintentos
      retryCount.set(key, attempts + 1);

      // Esperar 50ms a que Zustand persista el token en sessionStorage
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Releer el token (ahora debería estar disponible)
      const token = readAuthToken();
      if (token) {
        // Token está disponible → reintentar request
        config.headers.Authorization = `Bearer ${token}`;
        return api.request(config);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CASO 2: Error 401 real (sesión expirada, token inválido, etc.)
    // ═══════════════════════════════════════════════════════════════════════
    if (err.response?.status === 401) {
      const token = readAuthToken();
      const enPaginaLogin = window.location.pathname === "/login";

      // Solo hacer logout si:
      // 1. No hay token (sesión realmente expirada, no race condition)
      // 2. No estamos ya en /login
      // 3. No hay ya un redirect en progreso
      if (!token && !enPaginaLogin && !redirectingToLogin) {
        redirectingToLogin = true;
        try {
          sessionStorage.removeItem("stackdev-auth");
        } catch { }
        // Usar replace para no agregar /login al historial del navegador
        window.location.replace("/login");
      }
    }

    return Promise.reject(err);
  }
);

export const authService = {
  login: (data) => api.post("/auth/login", data),
  me: () => api.get("/auth/me"),
};

export const seguridadService = {
  listarInstalaciones: (params) => api.get("/instalaciones", { params }),
  crearInstalacion: (d) => api.post("/instalaciones", d),
  actualizarInstalacion: (id, d) => api.put(`/instalaciones/${id}`, d),
  eliminarInstalacion: (id) => api.delete(`/instalaciones/${id}`),

  listarPuntos: (instId) => api.get(`/instalaciones/${instId}/puntos`),
  crearPunto: (instId, d) =>
    api.post("/puntos-control", { ...d, instalacion_id: instId }),
  actualizarPunto: (id, d) => api.put(`/puntos-control/${id}`, d),
  regenerarQR: (id) => api.post(`/puntos-control/${id}/regenerar-qr`),
  obtenerQRImagen: (id) =>
    api.get(`/puntos-control/${id}/qr-imagen`, { responseType: "blob" }),

  verificarPunto: (d) => api.post("/verificaciones", d),
  progresoRonda: (turnoId) => api.get(`/turnos/${turnoId}/progreso-ronda`),
  verificacionesTurno: (turnoId) =>
    api.get(`/turnos/${turnoId}/verificaciones`),

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

export const asistenciaService = {
  obtenerConfig: () => api.get("/asistencia/config"),
  actualizarConfig: (d) => api.put("/asistencia/config", d),

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
    let url = `/asistencia/salida?turno_id=${turnoId}&lat=${lat}&lon=${lon}`;
    if (observacion) url += `&observacion=${encodeURIComponent(observacion)}`;
    return api.post(url, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  miAsistencia: () => api.get("/asistencia/mi-asistencia"),
  miHistorial: (params) => api.get("/asistencia/mi-historial", { params }),
  dashboardLive: (params) =>
    api.get("/asistencia/dashboard-live", { params }),
  estadisticas: (params) =>
    api.get("/asistencia/estadisticas", { params }),
  listar: (params) => api.get("/asistencia/listar", { params }),
  ajusteManual: (id, d) => api.put(`/asistencia/${id}/ajuste`, d),
  exportar: (params) =>
    api.get("/asistencia/exportar", { params, responseType: "blob" }),
};

export const usuariosService = {
  listar: () => api.get("/usuarios/"),
  crear: (d) => api.post("/usuarios/", d),
  actualizar: (id, d) => api.put(`/usuarios/${id}`, d),
  eliminar: (id) => api.delete(`/usuarios/${id}`),
};