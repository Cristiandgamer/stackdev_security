import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Usar localStorage para que la sesión sobreviva recargas de página
// sessionStorage se borra al cerrar la pestaña o recargar en algunos navegadores móviles
const storage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // En modo privado algunos navegadores bloquean localStorage
      sessionStorage.setItem(name, value);
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
      sessionStorage.removeItem(name);
    } catch {
      // ignorar
    }
  },
};

const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    {
      name: "stackdev-auth",
      storage,
    }
  )
);

// Named export para compatibilidad con páginas
export { useAuthStore };
export default useAuthStore;
