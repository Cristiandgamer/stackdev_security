import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Users, Building2, Calendar, AlertTriangle,
  CheckCircle2, Route, Clock, TrendingUp, Bell,
  ChevronRight, Shield,
} from 'lucide-react'
import { seguridadService } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { Spinner } from '../components/index.jsx'

function StatCard({ icon: Icon, label, value, color, sub }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-[#94a3b8] text-sm">{label}</p>
        <p className="text-white text-2xl font-bold leading-tight">{value ?? '—'}</p>
        {sub && <p className="text-[#94a3b8] text-sm">{sub}</p>}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const isAdmin = ['admin', 'supervisor'].includes(user?.rol)

  const { data: stats, isLoading: loadStats } = useQuery({
    queryKey: ['estadisticas'],
    queryFn: () => seguridadService.estadisticas(),
    enabled: isAdmin,
    select: r => r.data,
  })

  const { data: turnoData } = useQuery({
    queryKey: ['mi-turno'],
    queryFn: () => seguridadService.miTurnoActivo()
      .then((r) => r.data)
      .catch((err) => err.response?.status === 404 ? null : Promise.reject(err)),
  })

  const { data: notifData } = useQuery({
    queryKey: ['notificaciones'],
    queryFn: () => seguridadService.listarNotificaciones({ solo_no_leidas: true }),
    select: r => r.data,
    refetchInterval: 30_000,
  })

  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">

      {/* ── Bienvenida ─────────────────────────────────────────────────── */}
      <div className="card p-6 flex items-center gap-4">
        <div className="w-14 h-14 bg-brand/20 rounded-2xl flex items-center justify-center flex-shrink-0">
          <Shield className="w-8 h-8 text-brand" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">
            {saludo}, {user?.nombre} 👋
          </h1>
          <p className="text-[#94a3b8]">
            {new Date().toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      {/* ── Turno activo del guardia ────────────────────────────────────── */}
      {turnoData ? (
        <div className="card p-5 border-l-4 border-l-green-500">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center">
                <Clock className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-green-400 font-semibold text-sm uppercase tracking-wide">Turno activo</p>
                <p className="text-white font-bold">{turnoData.instalacion?.nombre}</p>
                <p className="text-[#94a3b8] text-sm">
                  {new Date(turnoData.fecha_inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                  {' — '}
                  {new Date(turnoData.fecha_fin).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate('/ronda')}
              className="btn-primary flex-shrink-0"
            >
              Ir a Ronda
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-5 border-l-4 border-l-[#2d5490]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center">
              <Clock className="w-5 h-5 text-[#94a3b8]" />
            </div>
            <p className="text-[#94a3b8]">No tienes un turno asignado activo en este momento.</p>
          </div>
        </div>
      )}

      {/* ── Notificaciones sin leer ─────────────────────────────────────── */}
      {notifData?.no_leidas > 0 && (
        <div className="card p-5 border-l-4 border-l-brand">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand/20 rounded-xl flex items-center justify-center">
                <Bell className="w-5 h-5 text-brand" />
              </div>
              <div>
                <p className="text-white font-semibold">
                  {notifData.no_leidas} notificación{notifData.no_leidas > 1 ? 'es' : ''} sin leer
                </p>
                <p className="text-[#94a3b8] text-sm">
                  {notifData.items?.[0]?.titulo}
                </p>
              </div>
            </div>
            <button onClick={() => navigate('/incidentes')} className="btn-ghost text-brand">
              Ver <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Estadísticas globales (solo admin/supervisor) ───────────────── */}
      {isAdmin && (
        <>
          <h2 className="text-xl font-bold text-white">Resumen general</h2>
          {loadStats ? <Spinner /> : stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={Users}
                label="Guardias activos"
                value={stats.guardias_activos}
                sub={`de ${stats.total_guardias} total`}
                color="bg-blue-500/20 text-blue-400"
              />
              <StatCard
                icon={Building2}
                label="Instalaciones"
                value={stats.instalaciones_activas}
                sub="activas"
                color="bg-purple-500/20 text-purple-400"
              />
              <StatCard
                icon={Calendar}
                label="Turnos hoy"
                value={stats.turnos_hoy}
                color="bg-green-500/20 text-green-400"
              />
              <StatCard
                icon={AlertTriangle}
                label="Incidentes abiertos"
                value={stats.incidentes_abiertos}
                color={stats.incidentes_abiertos > 0 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}
              />
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-2 gap-4">
            <StatCard
              icon={CheckCircle2}
              label="Verificaciones hoy"
              value={stats?.verificaciones_hoy ?? '—'}
              color="bg-brand/20 text-brand"
            />
            <StatCard
              icon={TrendingUp}
              label="Total instalaciones"
              value={stats?.total_instalaciones ?? '—'}
              color="bg-indigo-500/20 text-indigo-400"
            />
          </div>
        </>
      )}

      {/* ── Accesos rápidos ─────────────────────────────────────────────── */}
      <h2 className="text-xl font-bold text-white">Accesos rápidos</h2>
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Iniciar Ronda', icon: Route,         path: '/ronda',      color: 'bg-brand', desc: 'GPS + QR' },
          { label: 'Reportar Incidente', icon: AlertTriangle, path: '/incidentes', color: 'bg-red-600', desc: 'Nuevo reporte' },
          ...(isAdmin ? [
            { label: 'Gestionar Turnos', icon: Calendar, path: '/turnos', color: 'bg-blue-600', desc: 'Asignaciones' },
            { label: 'Ver Guardias', icon: Users, path: '/guardias', color: 'bg-purple-600', desc: 'Personal activo' },
          ] : []),
        ].map(({ label, icon: Icon, path, color, desc }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="card p-5 flex flex-col items-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-transform text-center"
          >
            <div className={`w-12 h-12 ${color} rounded-2xl flex items-center justify-center`}>
              <Icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-white font-semibold">{label}</p>
              <p className="text-[#94a3b8] text-sm">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
