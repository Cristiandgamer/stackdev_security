import { create } from "zustand";
import { persist } from "zustand/middleware";

const storage = {
  getItem: (name) => sessionStorage.getItem(name),
  setItem: (name, value) => sessionStorage.setItem(name, value),
  removeItem: (name) => sessionStorage.removeItem(name),
};

const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: "stackdev-auth", storage }
  )
);

// Named export para compatibilidad con páginas
export { useAuthStore };
export default useAuthStore;
