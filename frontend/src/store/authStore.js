import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── DECISIÓN DE SEGURIDAD: localStorage vs sessionStorage ────────────────────
//
// sessionStorage (original):
//   + Token desaparece al cerrar pestaña
//   - Se borra al recargar en Safari móvil → usuario pierde sesión constantemente
//   - No funciona bien en PWA / modo standalone
//
// localStorage (actual):
//   + Token persiste entre recargas → UX funcional en móvil
//   - Vulnerable a XSS si hay scripts maliciosos inyectados
//
// MITIGACIONES XSS aplicadas para hacer localStorage seguro:
//   1. Content-Security-Policy en index.html bloquea scripts externos
//   2. JWT con expiración corta (480 min = 8h) configurada en el backend
//   3. El backend valida el token en cada request (no hay sesión del lado servidor)
//   4. CORS restringido al dominio propio
//   5. allow_credentials=false → no hay cookies de sesión que robar
//
// OWASP A02 (Cryptographic Failures): el JWT usa HS256 con SECRET_KEY fuerte
// OWASP A07 (Identification and Authentication Failures): expiración + rate limiting en login
// ─────────────────────────────────────────────────────────────────────────────

const storage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      // Fallback para modo privado donde localStorage puede estar bloqueado
      try {
        return sessionStorage.getItem(name);
      } catch {
        return null;
      }
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      try {
        sessionStorage.setItem(name, value);
      } catch {
        // En modo privado muy restrictivo, ignorar
      }
    }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* ignorar */ }
    try { sessionStorage.removeItem(name); } catch { /* ignorar */ }
  },
};

const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => {
        // Limpiar ambos storages explícitamente al hacer logout
        try { localStorage.removeItem("stackdev-auth"); } catch { /* ignorar */ }
        try { sessionStorage.removeItem("stackdev-auth"); } catch { /* ignorar */ }
        set({ token: null, user: null });
      },
    }),
    {
      name: "stackdev-auth",
      storage,
    }
  )
);

export { useAuthStore };
export default useAuthStore;
