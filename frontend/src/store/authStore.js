import { create } from "zustand";
import { persist } from "zustand/middleware";

const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => {
        // 1. Guardar en el store (Zustand)
        set({ token, user });
        
        // 2. Guardar explícitamente en sessionStorage (respaldo)
        // Esto asegura que el token esté disponible inmediatamente
        // para axios, sin depender de que Zustand persista primero
        try {
          const authData = {
            state: { token, user },
            version: 0,
          };
          sessionStorage.setItem("stackdev-auth", JSON.stringify(authData));
        } catch (err) {
          console.error("Error guardando en sessionStorage:", err);
        }
      },
      logout: () => {
        try {
          sessionStorage.removeItem("stackdev-auth");
        } catch { }
        set({ token: null, user: null });
      },
    }),
    {
      name: "stackdev-auth",
      storage: {
        getItem: (name) => {
          try {
            return sessionStorage.getItem(name);
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            sessionStorage.setItem(name, value);
          } catch {
            // ignorar en modo privado muy restrictivo
          }
        },
        removeItem: (name) => {
          try {
            sessionStorage.removeItem(name);
          } catch {
            // ignorar
          }
        },
      },
    }
  )
);

export { useAuthStore };
export default useAuthStore;