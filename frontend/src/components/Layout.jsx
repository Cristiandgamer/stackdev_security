import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, MapPin, Users, Calendar,
  Building2, ClipboardList, AlertTriangle,
  UserCog, LogOut, Menu, X, Bell, Shield,
  Trash2, CheckCheck
} from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "../store/authStore";
import { seguridadService } from "../services/api";
import { formatChileDateTime } from "../utils/time.js";

// Destinos alineados con las rutas declaradas en App.jsx.
const navItems = [
  { to: "/",               label: "Dashboard",     icon: LayoutDashboard, roles: ["admin","supervisor","usuario"] },
  { to: "/ronda",          label: "Ronda GPS+QR",  icon: MapPin,          roles: ["admin","supervisor","usuario"] },
  { to: "/incidentes",     label: "Incidentes",    icon: AlertTriangle,   roles: ["admin","supervisor","usuario"] },
  { to: "/guardias",       label: "Guardias",      icon: Users,           roles: ["admin","supervisor"] },
  { to: "/turnos",         label: "Turnos",        icon: Calendar,        roles: ["admin","supervisor"] },
  { to: "/rondas",         label: "Rondas",        icon: MapPin,          roles: ["admin","supervisor"] },
  { to: "/instalaciones",  label: "Instalaciones", icon: Building2,       roles: ["admin","supervisor"] },
  { to: "/asistencias",    label: "Asistencias",   icon: ClipboardList,   roles: ["admin","supervisor","usuario"] },
  { to: "/usuarios",       label: "Usuarios",      icon: UserCog,         roles: ["admin"] },
];

// ── Dropdown de notificaciones ─────────────────────────────────────────────────
function NotificationDropdown({ show, onClose, notifications, notifCount, loadingNotifs, onEliminar, onEliminarLeidas, onMarcarTodas }) {
  if (!show) return null;

  const hayLeidas = notifications.some(n => n.leida);

  return (
    <div className="absolute right-0 top-full z-50 mt-3 w-80 rounded-3xl border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div>
          <p className="text-sm font-semibold text-white">Notificaciones</p>
          <p className="text-xs text-slate-400">
            {notifCount > 0 ? `${notifCount} sin leer` : "Todo al día ✓"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {/* Marcar todas leídas */}
          {notifCount > 0 && (
            <button
              type="button"
              onClick={onMarcarTodas}
              title="Marcar todas como leídas"
              className="flex items-center justify-center w-7 h-7 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition"
            >
              <CheckCheck size={14} />
            </button>
          )}
          {/* Papelera global — elimina sólo las ya leídas */}
          {hayLeidas && (
            <button
              type="button"
              onClick={onEliminarLeidas}
              title="Eliminar notificaciones leídas"
              className="flex items-center justify-center w-7 h-7 text-slate-400 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition"
            >
              <Trash2 size={14} />
            </button>
          )}
          {/* Cerrar */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="max-h-80 overflow-y-auto px-3 py-2 space-y-1.5">
        {loadingNotifs ? (
          <p className="text-sm text-slate-400 py-4 text-center">Cargando...</p>
        ) : !notifications?.length ? (
          <div className="py-8 text-center">
            <Bell size={28} className="text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No hay notificaciones</p>
          </div>
        ) : (
          notifications.map((notif) => (
            <div
              key={notif.id}
              className={`rounded-2xl border p-3 group ${
                notif.leida
                  ? "border-white/5 bg-white/[0.02]"
                  : "border-brand/30 bg-brand/5"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {/* Punto azul para no leídas */}
                    {!notif.leida && (
                      <span className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
                    )}
                    <p className="text-sm font-semibold text-white truncate">{notif.titulo}</p>
                  </div>
                  <p className="text-xs text-slate-500">
                    {formatChileDateTime(notif.created_at, {
                      day: "2-digit", month: "2-digit", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                </div>
                {/* Papelera individual — visible al hacer hover */}
                <button
                  type="button"
                  onClick={() => onEliminar(notif.id)}
                  title="Eliminar"
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 flex items-center justify-center w-6 h-6 text-slate-500 hover:text-red-400 rounded-lg hover:bg-red-500/10"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {notif.mensaje && (
                <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">{notif.mensaje}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Layout principal ──────────────────────────────────────────────────────────
export default function Layout() {
  const [open, setOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifCount, setNotifCount] = useState(0);
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  // ── Carga de notificaciones ─────────────────────────────────────────────────
  const loadNotifications = () => {
    setLoadingNotifs(true);
    seguridadService.listarNotificaciones()
      .then(r => {
        const list = r.data || [];
        setNotifications(list);
        setNotifCount(list.filter(n => !n.leida).length);
      })
      .catch(err => {
        console.error("Error cargando notificaciones", err);
      })
      .finally(() => setLoadingNotifs(false));
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  // ── Abrir dropdown: auto-marcar todas como leídas ───────────────────────────
  const toggleNotifications = () => {
    const next = !showNotifications;
    setShowNotifications(next);

    // Al abrir, si hay no-leídas → marcarlas todas como leídas en el backend
    // y actualizar el contador local inmediatamente (UX sin espera)
    if (next && notifCount > 0) {
      // Optimistic update: badge desaparece al instante
      setNotifCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, leida: true })));

      seguridadService.marcarTodasLeidas().catch(err => {
        console.error("Error marcando notificaciones como leídas", err);
        // Revertir si falla
        loadNotifications();
      });
    }
  };

  // ── Eliminar una notificación individual ────────────────────────────────────
  const eliminarNotificacion = (id) => {
    // Optimistic update
    setNotifications(prev => {
      const nueva = prev.filter(n => n.id !== id);
      setNotifCount(nueva.filter(n => !n.leida).length);
      return nueva;
    });

    seguridadService.eliminarNotificacion(id).catch(err => {
      console.error("Error eliminando notificación", err);
      toast.error("No se pudo eliminar la notificación");
      loadNotifications(); // revertir
    });
  };

  // ── Eliminar todas las leídas (papelera global) ──────────────────────────────
  const eliminarLeidas = () => {
    // Optimistic update
    setNotifications(prev => prev.filter(n => !n.leida));

    seguridadService.eliminarLeidas()
      .then(() => toast.success("Notificaciones leídas eliminadas"))
      .catch(err => {
        console.error("Error vaciando papelera", err);
        toast.error("No se pudo vaciar las notificaciones");
        loadNotifications(); // revertir
      });
  };

  // ── Marcar todas leídas manualmente (botón CheckCheck) ──────────────────────
  const marcarTodasLeidas = () => {
    setNotifCount(0);
    setNotifications(prev => prev.map(n => ({ ...n, leida: true })));

    seguridadService.marcarTodasLeidas().catch(err => {
      console.error("Error marcando todas leídas", err);
      loadNotifications();
    });
  };

  const handleLogout = () => { logout(); navigate("/login"); };
  const filtered = navItems.filter(n => n.roles.includes(user?.rol));

  // El dashboard corresponde a la ruta raíz.
  const NavItem = ({ to, label, icon: Icon, onClick }) => (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-5 py-3 text-sm transition-colors rounded-xl mx-2 mb-0.5 ${
          isActive
            ? "bg-brand text-white font-medium"
            : "text-[#94a3b8] hover:bg-white/5 hover:text-white"
        }`
      }
    >
      <Icon size={17} />
      {label}
    </NavLink>
  );

  // Props compartidos para el dropdown
  const dropdownProps = {
    show: showNotifications,
    onClose: () => setShowNotifications(false),
    notifications,
    notifCount,
    loadingNotifs,
    onEliminar: eliminarNotificacion,
    onEliminarLeidas: eliminarLeidas,
    onMarcarTodas: marcarTodasLeidas,
  };

  return (
    <div className="flex h-screen" style={{ backgroundColor: "#0f1929" }}>

      {/* ── Sidebar desktop ─────────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-64 border-r" style={{ backgroundColor: "#0d1a2d", borderColor: "#1e3a5f" }}>
        <div className="flex items-center gap-3 px-5 py-5 border-b" style={{ borderColor: "#1e3a5f" }}>
          <div className="w-9 h-9 bg-brand rounded-xl flex items-center justify-center">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-sm leading-tight">Stack Security</p>
            <p className="text-xs" style={{ color: "#475569" }}>Sistema de Guardias</p>
          </div>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {filtered.map(item => <NavItem key={item.to} {...item} />)}
        </nav>
        <div className="px-5 py-4 border-t" style={{ borderColor: "#1e3a5f" }}>
          <p className="text-sm text-white font-medium truncate">{user?.nombre}</p>
          <p className="text-xs capitalize" style={{ color: "#475569" }}>{user?.rol}</p>
          <button
            onClick={handleLogout}
            className="mt-3 flex items-center gap-2 text-xs transition-colors"
            style={{ color: "#475569" }}
            onMouseOver={e => e.currentTarget.style.color = "#e2e8f0"}
            onMouseOut={e => e.currentTarget.style.color = "#475569"}
          >
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── Sidebar mobile overlay ───────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 flex flex-col z-50 border-r"
            style={{ backgroundColor: "#0d1a2d", borderColor: "#1e3a5f" }}>
            <div className="flex items-center justify-between px-5 py-5 border-b" style={{ borderColor: "#1e3a5f" }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-brand rounded-xl flex items-center justify-center">
                  <Shield size={17} className="text-white" />
                </div>
                <span className="font-bold text-white text-sm">Stack Security</span>
              </div>
              <button onClick={() => setOpen(false)} style={{ color: "#94a3b8" }}><X size={20} /></button>
            </div>
            <nav className="flex-1 py-3 overflow-y-auto">
              {filtered.map(item => <NavItem key={item.to} {...item} onClick={() => setOpen(false)} />)}
            </nav>
            <div className="px-5 py-4 border-t" style={{ borderColor: "#1e3a5f" }}>
              <button onClick={handleLogout} className="flex items-center gap-2 text-sm" style={{ color: "#94a3b8" }}>
                <LogOut size={15} /> Cerrar sesión
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar desktop */}
        <header className="hidden md:flex items-center justify-end px-6 py-4 border-b"
          style={{ backgroundColor: "#0d1a2d", borderColor: "#1e3a5f" }}>
          <div className="relative">
            <button
              type="button"
              onClick={toggleNotifications}
              className="flex items-center justify-center p-2 rounded-xl transition-colors"
              style={{ color: "#94a3b8" }}>
              <Bell size={20} />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-brand text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {notifCount > 9 ? "9+" : notifCount}
                </span>
              )}
            </button>
            <NotificationDropdown {...dropdownProps} />
          </div>
        </header>

        {/* Topbar mobile */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b"
          style={{ backgroundColor: "#0d1a2d", borderColor: "#1e3a5f" }}>
          <button onClick={() => setOpen(true)} style={{ color: "#94a3b8" }}><Menu size={22} /></button>
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-brand" />
            <span className="font-bold text-white text-sm">Stack Security</span>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={toggleNotifications}
              className="flex items-center justify-center p-2 rounded-xl"
              style={{ color: "#94a3b8" }}>
              <Bell size={20} />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-brand text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {notifCount > 9 ? "9+" : notifCount}
                </span>
              )}
            </button>
            <NotificationDropdown {...dropdownProps} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
