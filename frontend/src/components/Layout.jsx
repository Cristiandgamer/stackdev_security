import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, MapPin, Users, Calendar,
  Building2, ClipboardList, AlertTriangle,
  UserCog, LogOut, Menu, X, Bell, Shield
} from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { seguridadService } from "../services/api";

const navItems = [
  { to: "/",             label: "Dashboard",      icon: LayoutDashboard, roles: ["admin","supervisor","usuario"] },
  { to: "/ronda",        label: "Ronda GPS+QR",   icon: MapPin,          roles: ["admin","supervisor","usuario"] },
  { to: "/incidentes",   label: "Incidentes",     icon: AlertTriangle,   roles: ["admin","supervisor","usuario"] },
  { to: "/guardias",     label: "Guardias",       icon: Users,           roles: ["admin","supervisor"] },
  { to: "/turnos",       label: "Turnos",         icon: Calendar,        roles: ["admin","supervisor"] },
  { to: "/rondas",       label: "Rondas",         icon: MapPin,          roles: ["admin","supervisor"] },
  { to: "/instalaciones",label: "Instalaciones",  icon: Building2,       roles: ["admin","supervisor"] },
  { to: "/asistencias",  label: "Asistencias",    icon: ClipboardList,   roles: ["admin","supervisor","usuario"] },
  { to: "/usuarios",     label: "Usuarios",       icon: UserCog,         roles: ["admin"] },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    seguridadService.listarNotificaciones()
      .then(r => setNotifCount((r.data || []).filter(n => !n.leida).length))
      .catch(() => {});
  }, []);

  const handleLogout = () => { logout(); navigate("/login"); };
  const filtered = navItems.filter(n => n.roles.includes(user?.rol));

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

  return (
    <div className="flex h-screen" style={{ backgroundColor: "#0f1929" }}>
      {/* Sidebar desktop */}
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
          <button onClick={handleLogout} className="mt-3 flex items-center gap-2 text-xs transition-colors" style={{ color: "#475569" }}
            onMouseOver={e => e.currentTarget.style.color = "#e2e8f0"}
            onMouseOut={e => e.currentTarget.style.color = "#475569"}
          >
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
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

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar mobile */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b"
          style={{ backgroundColor: "#0d1a2d", borderColor: "#1e3a5f" }}>
          <button onClick={() => setOpen(true)} style={{ color: "#94a3b8" }}><Menu size={22} /></button>
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-brand" />
            <span className="font-bold text-white text-sm">Stack Security</span>
          </div>
          <div className="relative">
            <Bell size={20} style={{ color: "#94a3b8" }} />
            {notifCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-brand text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                {notifCount}
              </span>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
