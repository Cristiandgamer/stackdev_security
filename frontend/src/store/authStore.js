import { create } from "zustand";
import { persist } from "zustand/middleware";

const storage = {
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
};

const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => {
        try { sessionStorage.removeItem("stackdev-auth"); } catch { }
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
