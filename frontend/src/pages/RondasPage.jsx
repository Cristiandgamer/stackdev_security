/**
 * RondasPage.jsx — Gestión de plantillas de ronda (admin/supervisor)
 *
 * Funciones:
 * - Ver rondas por instalación
 * - Crear nueva ronda (abre RondaModal)
 * - Editar configuración (rondas por turno, descanso)
 * - Ver puntos de cada ronda
 * - Monitorear ejecuciones de hoy
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MapPin, Plus, Pencil, Trash2, Building2,
  Clock, CheckCircle2, AlertCircle, RefreshCw,
  ChevronDown, ChevronUp, Settings, Eye,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { seguridadService, rondasService } from '../services/api'
import { Modal, Spinner, PageHeader, EmptyState, ConfirmDialog } from '../components/index.jsx'
import RondaModal from '../components/RondaModal'

function errMsg(e) {
  const detail = e?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map(d => d.msg).join(', ')
  return e?.message || 'Error inesperado'
}

// ── Formulario de edición de ronda ────────────────────────────────────────────
function FormEditarRonda({ ronda, onClose, onSuccess }) {
  const [form, setForm] = useState({
    nombre: ronda.nombre || '',
    descripcion: ronda.descripcion || '',
    rondas_por_turno: ronda.rondas_por_turno || 1,
    descanso_entre_rondas_min: ronda.descanso_entre_rondas_min || 60,
    tiempo_maximo_ronda_min: ronda.tiempo_maximo_ronda_min || 0,
  })

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => rondasService.actualizarPlantilla(ronda.id, data).then(r => r.data),
    onSuccess: () => { toast.success('Ronda actualizada'); onSuccess() },
    onError: (e) => toast.error(errMsg(e)),
  })

  const f = (key) => ({
    value: form[key],
    onChange: (e) => setForm(p => ({
      ...p,
      [key]: e.target.type === 'number' ? Number(e.target.value) : e.target.value,
    })),
  })

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutate(form) }}
      className="space-y-4"
    >
      <div>
        <label className="label">Nombre *</label>
        <input className="input-field" required {...f('nombre')} />
      </div>

      <div>
        <label className="label">Descripción</label>
        <textarea className="input-field resize-none" rows={2} {...f('descripcion')} />
      </div>

      <div className="bg-[#0f1929] border border-[#1e3a5f] rounded-2xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-brand" />
          <span className="text-white font-medium text-sm">Ciclo de rondas</span>
        </div>

        <div>
          <label className="label">Rondas por turno</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, rondas_por_turno: Math.max(1, p.rondas_por_turno - 1) }))}
              className="w-10 h-10 rounded-xl bg-[#1e3a5f] text-white font-bold text-xl flex items-center justify-center"
            >−</button>
            <span className="text-white text-2xl font-bold w-12 text-center">{form.rondas_por_turno}</span>
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, rondas_por_turno: Math.min(20, p.rondas_por_turno + 1) }))}
              className="w-10 h-10 rounded-xl bg-[#1e3a5f] text-white font-bold text-xl flex items-center justify-center"
            >+</button>
          </div>
        </div>

        <div>
          <label className="label">
            Descanso entre rondas (minutos)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="0"
              max="480"
              className="input-field !w-32 text-center font-bold"
              {...f('descanso_entre_rondas_min')}
            />
            <span className="text-[#94a3b8] text-sm">minutos</span>
          </div>
        </div>

        <div className="bg-[#152032] rounded-xl p-3 text-sm text-[#94a3b8]">
          El guardia hará <span className="text-brand font-semibold">{form.rondas_por_turno}</span> ronda{form.rondas_por_turno !== 1 ? 's' : ''} con
          <span className="text-brand font-semibold"> {form.descanso_entre_rondas_min}min</span> de descanso entre cada una.
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button type="submit" disabled={isPending} className="btn-primary flex-1">
          {isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  )
}

// ── Card de ronda ─────────────────────────────────────────────────────────────
function RondaCard({ ronda, onEditar, onEliminar }) {
  const [expandida, setExpandida] = useState(false)

  const { data: puntos, isLoading: loadPuntos } = useQuery({
    queryKey: ['ronda-puntos', ronda.id],
    queryFn: () => rondasService.listarPuntos(ronda.instalacion_id, ronda.id).then(r => r.data),
    enabled: expandida,
  })

  return (
    <div className="card overflow-hidden">
      {/* Cabecera */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-white font-semibold truncate">{ronda.nombre}</p>
            {ronda.descripcion && (
              <p className="text-[#94a3b8] text-sm mt-0.5 truncate">{ronda.descripcion}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => onEditar(ronda)}
              className="btn-ghost !p-2 !min-h-0"
              title="Editar ronda"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => onEliminar(ronda)}
              className="btn-ghost !p-2 !min-h-0 hover:text-red-400"
              title="Eliminar ronda"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Configuración en badges */}
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="bg-brand/15 text-brand px-2.5 py-1 rounded-lg font-medium">
            {ronda.rondas_por_turno} ronda{ronda.rondas_por_turno !== 1 ? 's' : ''}/turno
          </span>
          <span className="bg-[#1e3a5f] text-[#94a3b8] px-2.5 py-1 rounded-lg">
            {ronda.descanso_entre_rondas_min}min descanso
          </span>
          <span className={`px-2.5 py-1 rounded-lg ${ronda.activa ? 'badge-green' : 'badge-gray'}`}>
            {ronda.activa ? 'Activa' : 'Inactiva'}
          </span>
        </div>

        {/* Toggle puntos */}
        <button
          onClick={() => setExpandida(v => !v)}
          className="mt-3 flex items-center gap-2 text-sm text-[#94a3b8] hover:text-white transition-colors"
        >
          <Eye className="w-4 h-4" />
          Ver puntos de control
          {expandida ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Lista de puntos */}
      {expandida && (
        <div className="border-t border-[#1e3a5f] p-4 space-y-2 bg-[#0a1628]">
          {loadPuntos ? (
            <Spinner />
          ) : !puntos?.length ? (
            <p className="text-[#94a3b8] text-sm text-center py-2">Sin puntos configurados</p>
          ) : (
            <>
              <p className="text-[#94a3b8] text-xs mb-2">{puntos.length} punto{puntos.length !== 1 ? 's' : ''} en esta ronda:</p>
              {puntos.map((p, idx) => (
                <div key={p.id} className="flex items-center gap-3 bg-[#152032] rounded-xl px-3 py-2.5">
                  <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center text-brand font-bold text-xs flex-shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{p.nombre}</p>
                    <p className="text-[#475569] text-xs font-mono truncate">
                      {p.latitud?.toFixed(5)}, {p.longitud?.toFixed(5)}
                    </p>
                  </div>
                  <MapPin className="w-3.5 h-3.5 text-[#475569] flex-shrink-0" />
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Monitor de ejecuciones ────────────────────────────────────────────────────
function MonitorEjecuciones({ instalaciones }) {
  const [instalacionId, setInstalacionId] = useState('')
  const hoy = new Date().toISOString().slice(0, 10)

  const { data: turnos, isLoading, refetch } = useQuery({
    queryKey: ['turnos-hoy', instalacionId],
    queryFn: () => seguridadService
      .listarTurnos(instalacionId ? { instalacion_id: instalacionId } : {})
      .then(r => r.data),
    refetchInterval: 30_000,
  })

  // Filtra turnos de hoy
  const turnosHoy = (turnos || []).filter(t => {
    const fechaT = new Date(t.fecha_inicio).toISOString().slice(0, 10)
    return fechaT === hoy
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          className="input-field !w-auto !min-h-0 py-2 text-sm"
          value={instalacionId}
          onChange={e => setInstalacionId(e.target.value)}
        >
          <option value="">Todas las instalaciones</option>
          {(instalaciones || []).map(i => (
            <option key={i.id} value={i.id}>{i.nombre}</option>
          ))}
        </select>
        <button
          onClick={() => refetch()}
          className="btn-ghost !p-2 !min-h-0"
          title="Actualizar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        <span className="text-[#475569] text-xs ml-auto">Hoy · Actualización automática 30s</span>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !turnosHoy.length ? (
        <EmptyState
          icon={Clock}
          title="Sin turnos hoy"
          description="No hay turnos programados para hoy con los filtros seleccionados."
        />
      ) : (
        <div className="space-y-2">
          {turnosHoy.map(t => (
            <ResumenTurnoRow key={t.id} turno={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function ResumenTurnoRow({ turno }) {
  const [expandido, setExpandido] = useState(false)

  const { data: resumen } = useQuery({
    queryKey: ['resumen-rondas', turno.id],
    queryFn: () => rondasService.resumenTurno(turno.id).then(r => r.data),
    enabled: expandido,
    refetchInterval: expandido ? 30_000 : false,
  })

  const estadoColor = {
    programado: 'badge-gray',
    asignado: 'badge-blue',
    en_curso: 'badge-green',
    finalizado: 'badge-gray',
  }

  return (
    <div className="card overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-4 text-left"
        onClick={() => setExpandido(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-white font-medium text-sm">
              Turno #{turno.id}
            </p>
            <span className={estadoColor[turno.estado] || 'badge-gray'}>
              {turno.estado}
            </span>
          </div>
          <p className="text-[#94a3b8] text-xs mt-0.5">
            {new Date(turno.fecha_inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
            {' — '}
            {new Date(turno.fecha_fin).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        {expandido ? <ChevronUp className="w-4 h-4 text-[#94a3b8]" /> : <ChevronDown className="w-4 h-4 text-[#94a3b8]" />}
      </button>

      {expandido && (
        <div className="border-t border-[#1e3a5f] p-4 bg-[#0a1628]">
          {!resumen ? (
            <Spinner />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-white text-sm font-medium">{resumen.guardia_nombre}</p>
                <span className="text-[#94a3b8] text-xs">
                  {resumen.rondas_completadas}/{resumen.rondas_por_turno} rondas
                </span>
              </div>

              {/* Barra de progreso */}
              <div className="h-2 bg-[#1e3a5f] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    resumen.rondas_completadas >= resumen.rondas_por_turno
                      ? 'bg-green-500'
                      : 'bg-brand'
                  }`}
                  style={{
                    width: `${resumen.rondas_por_turno > 0
                      ? Math.round(resumen.rondas_completadas / resumen.rondas_por_turno * 100)
                      : 0}%`
                  }}
                />
              </div>

              {/* Ejecuciones */}
              {resumen.ejecuciones?.length > 0 && (
                <div className="space-y-1.5">
                  {resumen.ejecuciones.map(ej => {
                    const styleMap = {
                      completada: 'text-green-400 bg-green-500/10',
                      en_progreso: 'text-brand bg-brand/10',
                      incompleta: 'text-red-400 bg-red-500/10',
                      pendiente: 'text-[#94a3b8] bg-[#1e3a5f]',
                    }
                    const iconMap = {
                      completada: <CheckCircle2 className="w-3 h-3" />,
                      en_progreso: <Clock className="w-3 h-3 animate-pulse" />,
                      incompleta: <AlertCircle className="w-3 h-3" />,
                      pendiente: <Clock className="w-3 h-3" />,
                    }
                    return (
                      <div
                        key={ej.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${styleMap[ej.estado] || 'text-[#94a3b8] bg-[#1e3a5f]'}`}
                      >
                        {iconMap[ej.estado]}
                        <span>Ronda {ej.numero_ronda}</span>
                        <span className="text-[#475569] ml-auto capitalize">{ej.estado}</span>
                        {ej.puntos_completados > 0 && (
                          <span className="text-[#475569]">
                            {ej.puntos_completados}/{ej.puntos_total}pts
                          </span>
                        )}
                        {ej.minutos_duracion && (
                          <span className="text-[#475569]">{ej.minutos_duracion}min</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {resumen.ultima_completada_en && (
                <p className="text-[#475569] text-xs">
                  Última completada: {new Date(resumen.ultima_completada_en).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function RondasPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('plantillas') // 'plantillas' | 'monitor'
  const [instSeleccionada, setInstSeleccionada] = useState(null)
  const [crearModal, setCrearModal] = useState(null) // instalacion | null
  const [editarRonda, setEditarRonda] = useState(null)
  const [eliminarRonda, setEliminarRonda] = useState(null)

  const { data: instalaciones, isLoading: loadInst } = useQuery({
    queryKey: ['instalaciones'],
    queryFn: () => seguridadService.listarInstalaciones().then(r => r.data),
    select: data => (Array.isArray(data) ? data : []),
  })

  const { data: rondas, isLoading: loadRondas, refetch: refetchRondas } = useQuery({
    queryKey: ['rondas-plantillas', instSeleccionada?.id],
    queryFn: () => rondasService.listarPlantillas(instSeleccionada.id).then(r => r.data),
    enabled: !!instSeleccionada,
  })

  const { mutate: eliminar, isPending: eliminando } = useMutation({
    mutationFn: (id) => rondasService.eliminarPlantilla(id),
    onSuccess: () => {
      toast.success('Ronda eliminada')
      setEliminarRonda(null)
      refetchRondas()
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-slide-up">

      {/* Confirm eliminar */}
      <ConfirmDialog
        open={!!eliminarRonda}
        title="Eliminar ronda"
        message={`¿Eliminar la ronda "${eliminarRonda?.nombre}"? Los guardias ya no podrán ejecutarla.`}
        confirmLabel="Eliminar"
        onConfirm={() => eliminar(eliminarRonda.id)}
        onCancel={() => setEliminarRonda(null)}
      />

      {/* Modal crear */}
      {crearModal && (
        <RondaModal
          instalacion={crearModal}
          onClose={() => setCrearModal(null)}
          onCreated={() => {
            setCrearModal(null)
            if (instSeleccionada?.id === crearModal.id) refetchRondas()
            qc.invalidateQueries({ queryKey: ['instalaciones'] })
          }}
        />
      )}

      {/* Modal editar */}
      {editarRonda && (
        <Modal
          open
          onClose={() => setEditarRonda(null)}
          title="Editar ronda"
          size="md"
        >
          <FormEditarRonda
            ronda={editarRonda}
            onClose={() => setEditarRonda(null)}
            onSuccess={() => { setEditarRonda(null); refetchRondas() }}
          />
        </Modal>
      )}

      <PageHeader
        title="Rondas"
        subtitle="Gestiona plantillas de ronda y monitorea ejecuciones"
      />

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { id: 'plantillas', label: 'Plantillas' },
          { id: 'monitor', label: 'Monitor de hoy' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tab === t.id ? 'bg-brand text-white' : 'bg-white/5 text-[#94a3b8] hover:bg-white/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Plantillas ─────────────────────────────────────────── */}
      {tab === 'plantillas' && (
        <div className="space-y-4">
          {/* Selector de instalación */}
          <div className="card p-4">
            <label className="label">Selecciona una instalación</label>
            {loadInst ? (
              <Spinner />
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {(instalaciones || []).map(inst => (
                  <button
                    key={inst.id}
                    onClick={() => setInstSeleccionada(inst)}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                      instSeleccionada?.id === inst.id
                        ? 'border-brand bg-brand/10'
                        : 'border-[#1e3a5f] bg-[#0f1929] hover:border-[#2d5490]'
                    }`}
                  >
                    <Building2 className={`w-5 h-5 flex-shrink-0 ${instSeleccionada?.id === inst.id ? 'text-brand' : 'text-[#94a3b8]'}`} />
                    <span className={`font-medium text-sm truncate ${instSeleccionada?.id === inst.id ? 'text-white' : 'text-[#94a3b8]'}`}>
                      {inst.nombre}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Rondas de la instalación seleccionada */}
          {instSeleccionada && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-white font-semibold">
                  Rondas — {instSeleccionada.nombre}
                </h2>
                <button
                  onClick={() => setCrearModal(instSeleccionada)}
                  className="btn-primary !py-2 !px-4 text-sm"
                >
                  <Plus className="w-4 h-4" />Nueva ronda
                </button>
              </div>

              {loadRondas ? (
                <Spinner />
              ) : !rondas?.length ? (
                <EmptyState
                  icon={MapPin}
                  title="Sin rondas"
                  description="Esta instalación no tiene rondas configuradas."
                  action={
                    <button
                      onClick={() => setCrearModal(instSeleccionada)}
                      className="btn-primary"
                    >
                      <Plus className="w-4 h-4" />Crear primera ronda
                    </button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {rondas.map(r => (
                    <RondaCard
                      key={r.id}
                      ronda={r}
                      onEditar={setEditarRonda}
                      onEliminar={setEliminarRonda}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {!instSeleccionada && !loadInst && (
            <div className="card p-8 text-center">
              <Building2 className="w-10 h-10 text-[#94a3b8] mx-auto mb-3" />
              <p className="text-[#94a3b8]">Selecciona una instalación para ver sus rondas</p>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Monitor ─────────────────────────────────────────────── */}
      {tab === 'monitor' && (
        <MonitorEjecuciones instalaciones={instalaciones} />
      )}
    </div>
  )
}
