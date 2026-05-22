import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus, Filter, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { seguridadService } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { Modal, Spinner, PageHeader, EmptyState } from '../components/index.jsx'

const SEVERIDAD_BADGE = {
  baja:    'badge-blue',
  media:   'badge-yellow',
  alta:    'badge-red',
  critica: 'badge-red',
}

const ESTADO_BADGE = {
  reportado:    'badge-yellow',
  investigando: 'badge-blue',
  resuelto:     'badge-green',
  cerrado:      'badge-gray',
}

const TIPOS = ['seguridad', 'accidente', 'emergencia', 'otro']
const SEVERIDADES = ['baja', 'media', 'alta', 'critica']

function IncidenteCard({ inc, isAdmin, onUpdate }) {
  const [abrirDetalle, setAbrirDetalle] = useState(false)
  const [estado, setEstado] = useState(inc.estado)

  const { mutate: actualizar, isPending } = useMutation({
    mutationFn: (data) => seguridadService.actualizarIncidente(inc.id, data),
    onSuccess: () => {
      toast.success('Incidente actualizado')
      setAbrirDetalle(false)
      onUpdate()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <>
      <Modal open={abrirDetalle} onClose={() => setAbrirDetalle(false)} title="Detalle del incidente" size="lg">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className={SEVERIDAD_BADGE[inc.severidad] || 'badge-gray'}>
              Severidad: {inc.severidad}
            </span>
            <span className={ESTADO_BADGE[inc.estado] || 'badge-gray'}>
              {inc.estado}
            </span>
            <span className="badge-gray">{inc.tipo}</span>
          </div>

          <div>
            <p className="label">Descripción</p>
            <p className="text-white text-base bg-[#263548] p-4 rounded-xl">{inc.descripcion}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="label">Guardia</p>
              <p className="text-white">{inc.guardia?.usuario?.nombre} {inc.guardia?.usuario?.apellido}</p>
            </div>
            <div>
              <p className="label">Instalación</p>
              <p className="text-white">{inc.instalacion?.nombre}</p>
            </div>
            <div>
              <p className="label">Fecha</p>
              <p className="text-white">{new Date(inc.created_at).toLocaleString('es-CL')}</p>
            </div>
            {inc.latitud && (
              <div>
                <p className="label">Coordenadas</p>
                <p className="text-white text-sm">{inc.latitud.toFixed(5)}, {inc.longitud.toFixed(5)}</p>
              </div>
            )}
          </div>

          {Array.isArray(inc.archivos) && inc.archivos.length > 0 && (
            <div>
              <p className="label">Archivos adjuntos</p>
              <div className="flex flex-wrap gap-2">
                {inc.archivos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="badge-blue hover:underline">
                    Archivo {i + 1}
                  </a>
                ))}
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="pt-4 border-t border-white/10 space-y-3">
              <p className="label">Cambiar estado</p>
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="input-field"
              >
                {['reportado','investigando','resuelto','cerrado'].map(e => (
                  <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
                ))}
              </select>
              <button
                onClick={() => actualizar({ estado })}
                disabled={isPending || estado === inc.estado}
                className="btn-primary w-full"
              >
                {isPending ? 'Guardando...' : 'Guardar cambio'}
              </button>
            </div>
          )}
        </div>
      </Modal>

      <button
        onClick={() => setAbrirDetalle(true)}
        className="card p-5 text-left w-full hover:border-[#2d5490]/60 transition-colors"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
            ${inc.severidad === 'critica' || inc.severidad === 'alta' ? 'bg-red-500/20' : 'bg-yellow-500/20'}`}>
            <AlertTriangle className={`w-5 h-5 ${inc.severidad === 'critica' || inc.severidad === 'alta' ? 'text-red-400' : 'text-yellow-400'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-lg truncate">{inc.titulo}</p>
            <p className="text-[#94a3b8] text-sm line-clamp-2">{inc.descripcion}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={SEVERIDAD_BADGE[inc.severidad] || 'badge-gray'}>
            {inc.severidad}
          </span>
          <span className={ESTADO_BADGE[inc.estado] || 'badge-gray'}>
            {inc.estado}
          </span>
          <span className="text-[#94a3b8] text-sm ml-auto">
            {new Date(inc.created_at).toLocaleDateString('es-CL')}
          </span>
        </div>
      </button>
    </>
  )
}

function NuevoIncidenteForm({ onClose, instalaciones }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    titulo: '', descripcion: '', tipo: 'seguridad',
    severidad: 'media', instalacion_id: '',
    latitud: null, longitud: null,
  })
  const [archivos, setArchivos] = useState([])
  const [obtenGPS, setObtenGPS] = useState(false)

  const { mutate, isPending } = useMutation({
    mutationFn: async (data) => {
      const res = await seguridadService.crearIncidente(data)
      const id = res.data.id
      for (const f of archivos) {
        const fd = new FormData()
        fd.append('archivo', f)
        await seguridadService.subirArchivoIncidente(id, fd)
      }
      return res
    },
    onSuccess: () => {
      toast.success('Incidente reportado correctamente')
      qc.invalidateQueries({ queryKey: ['incidentes'] })
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })

  const obtenerGPS = () => {
    setObtenGPS(true)
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setForm(f => ({ ...f, latitud: p.coords.latitude, longitud: p.coords.longitude }))
        setObtenGPS(false)
        toast.success('Ubicación capturada')
      },
      () => { setObtenGPS(false); toast.error('No se pudo obtener GPS') },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.titulo.trim()) return toast.error('Ingrese un título')
    if (!form.descripcion.trim()) return toast.error('Ingrese la descripción')
    if (!form.instalacion_id) return toast.error('Seleccione la instalación')
    mutate({
      ...form,
      instalacion_id: Number(form.instalacion_id),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Título del incidente *</label>
        <input
          className="input-field"
          placeholder="Ej: Persona sospechosa en entrada norte"
          value={form.titulo}
          onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
          maxLength={200}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Tipo *</label>
          <select className="input-field" value={form.tipo}
            onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
            {TIPOS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Severidad *</label>
          <select className="input-field" value={form.severidad}
            onChange={e => setForm(f => ({ ...f, severidad: e.target.value }))}>
            {SEVERIDADES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Instalación *</label>
        <select className="input-field" value={form.instalacion_id}
          onChange={e => setForm(f => ({ ...f, instalacion_id: e.target.value }))}>
          <option value="">Seleccionar instalación</option>
          {instalaciones?.map(i => <option key={i.id} value={i.id}>{i.nombre}</option>)}
        </select>
      </div>

      <div>
        <label className="label">Descripción detallada *</label>
        <textarea
          className="input-field resize-none"
          rows={4}
          placeholder="Describa lo ocurrido con el mayor detalle posible..."
          value={form.descripcion}
          onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
        />
      </div>

      <div>
        <button type="button" onClick={obtenerGPS} disabled={obtenGPS}
          className="btn-secondary w-full">
          {obtenGPS
            ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Obteniendo...</>
            : form.latitud
              ? `📍 GPS capturado (${form.latitud.toFixed(4)}, ${form.longitud.toFixed(4)})`
              : '📍 Capturar ubicación GPS (opcional)'
          }
        </button>
      </div>

      <div>
        <label className="label">Fotos / archivos (opcional)</label>
        <label className="flex items-center gap-2 cursor-pointer w-full px-4 py-3 bg-[#263548] border border-dashed border-[#2d5490]/50 rounded-xl hover:border-brand/50 transition-colors min-h-[48px]">
          <Upload className="w-5 h-5 text-[#94a3b8]" />
          <span className="text-[#94a3b8]">
            {archivos.length > 0 ? `${archivos.length} archivo(s) seleccionado(s)` : 'Seleccionar fotos o PDF'}
          </span>
          <input type="file" className="hidden" multiple accept="image/*,.pdf"
            onChange={e => setArchivos(Array.from(e.target.files))} />
        </label>
        {archivos.map((f, i) => (
          <div key={i} className="flex items-center justify-between mt-2 px-3 py-2 bg-[#263548] rounded-lg">
            <span className="text-white text-sm truncate">{f.name}</span>
            <button type="button" onClick={() => setArchivos(a => a.filter((_, j) => j !== i))}
              className="!min-h-0 p-1 text-[#94a3b8] hover:text-red-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button type="submit" disabled={isPending} className="btn-danger flex-1">
          {isPending ? 'Reportando...' : '⚠️ Reportar incidente'}
        </button>
      </div>
    </form>
  )
}

export default function IncidentesPage() {
  const [abrirForm, setAbrirForm] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroSeveridad, setFiltroSeveridad] = useState('')
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = ['admin', 'supervisor'].includes(user?.rol)

  const { data: incidentes, isLoading } = useQuery({
    queryKey: ['incidentes', filtroEstado, filtroSeveridad],
    queryFn: () => seguridadService.listarIncidentes({
      estado: filtroEstado || undefined,
      severidad: filtroSeveridad || undefined,
    }),
    select: r => Array.isArray(r?.data) ? r.data : [],
  })

  const { data: instalaciones } = useQuery({
    queryKey: ['instalaciones'],
    queryFn: () => seguridadService.listarInstalaciones({ activa: true }),
    select: r => Array.isArray(r?.data) ? r.data : [],
  })

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-slide-up">
      <Modal open={abrirForm} onClose={() => setAbrirForm(false)} title="Reportar incidente" size="lg">
        <NuevoIncidenteForm onClose={() => setAbrirForm(false)} instalaciones={instalaciones} />
      </Modal>

      <PageHeader
        icon={AlertTriangle}
        title="Incidentes"
        subtitle="Reportar y gestionar incidentes de seguridad"
        action={
          <button onClick={() => setAbrirForm(true)} className="btn-danger">
            <Plus className="w-5 h-5" />
            Reportar
          </button>
        }
      />

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[#94a3b8]" />
        </div>
        <select className="input-field !w-auto !min-h-0 py-2 text-sm" value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {['reportado','investigando','resuelto','cerrado'].map(e =>
            <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
          )}
        </select>
        <select className="input-field !w-auto !min-h-0 py-2 text-sm" value={filtroSeveridad}
          onChange={e => setFiltroSeveridad(e.target.value)}>
          <option value="">Todas las severidades</option>
          {SEVERIDADES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>

      {isLoading ? <Spinner /> : incidentes?.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Sin incidentes"
          description="No hay incidentes registrados con los filtros actuales."
          action={<button onClick={() => setAbrirForm(true)} className="btn-danger"><Plus className="w-5 h-5" />Reportar incidente</button>}
        />
      ) : (
        <div className="space-y-3">
          {incidentes?.map(inc => (
            <IncidenteCard
              key={inc.id}
              inc={inc}
              isAdmin={isAdmin}
              onUpdate={() => qc.invalidateQueries({ queryKey: ['incidentes'] })}
            />
          ))}
        </div>
      )}
    </div>
  )
}
