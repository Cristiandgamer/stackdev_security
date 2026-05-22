import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import useAuthStore from "./store/authStore";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import RondaPage from "./pages/RondaPage";
import RondasPage from "./pages/RondasPage";
import GuardiasPage from "./pages/GuardiasPage";
import TurnosPage from "./pages/TurnosPage";
import InstalacionesPage from "./pages/InstalacionesPage";
import AsistenciasPage from "./pages/AsistenciasPage";
import IncidentesPage from "./pages/IncidentesPage";
import UsuariosPage from "./pages/UsuariosPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function PrivateRoute({ children, roles }) {
  const { token, user } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user?.rol)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="ronda" element={<RondaPage />} />
            <Route path="incidentes" element={<IncidentesPage />} />
            <Route path="rondas" element={
              <PrivateRoute roles={["admin","supervisor"]}><RondasPage /></PrivateRoute>
            } />
            <Route path="guardias" element={
              <PrivateRoute roles={["admin","supervisor"]}><GuardiasPage /></PrivateRoute>
            } />
            <Route path="turnos" element={
              <PrivateRoute roles={["admin","supervisor"]}><TurnosPage /></PrivateRoute>
            } />
            <Route path="instalaciones" element={
              <PrivateRoute roles={["admin","supervisor"]}><InstalacionesPage /></PrivateRoute>
            } />
            <Route path="asistencias" element={
              <PrivateRoute roles={["admin","supervisor"]}><AsistenciasPage /></PrivateRoute>
            } />
            <Route path="usuarios" element={
              <PrivateRoute roles={["admin"]}><UsuariosPage /></PrivateRoute>
            } />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
