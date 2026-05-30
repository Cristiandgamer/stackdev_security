import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Plus, Filter, Upload, X,
  FileText, Image, ExternalLink, ChevronDown, ChevronUp,
  Calendar, MapPin, User, Building2
} from 'lucide-react'
import toast from 'react-hot-toast'
import { seguridadService } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { Modal, Spinner, PageHeader, EmptyState } from '../components/index.jsx'

// ── Constantes ────────────────────────────────────────────────────────────────

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
  abierto:      'badge-yellow',
  en_proceso:   'badge-blue',
}

const TIPOS = ['seguridad', 'accidente', 'emergencia', 'otro']
const SEVERIDADES = ['baja', 'media', 'alta', 'critica']

// ── Helper: formatear fecha segura ────────────────────────────────────────────
function formatFecha(valor, opts = {}) {
  if (!valor) return '—'
  const d = new Date(valor)
  if (isNaN(d.getTime())) return '—'
  const defOpts = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  return d.toLocaleString('es-CL', { ...defOpts, ...opts })
}

// ── Helper: ícono por tipo MIME ───────────────────────────────────────────────
function FileIcon({ mime = '' }) {
  if (mime.startsWith('image/')) return <Image className="w-4 h-4 flex-shrink-0" />
  return <FileText className="w-4 h-4 flex-shrink-0" />
}

// ── Visor de archivos (imágenes inline, PDF en nueva pestaña) ─────────────────
function VisorArchivos({ archivos = [] }) {
  const [activo, setActivo] = useState(null)

  if (!archivos.length) return null

  const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace('/api', '') || ''

  const urlCompleta = (ruta) =>
    ruta.startsWith('http') ? ruta : `${baseUrl}${ruta}`

  return (
    <div className="space-y-2">
      <p className="label">Archivos adjuntos ({archivos.length})</p>

      <div className="flex flex-wrap gap-2">
        {archivos.map((a) => {
          const url = urlCompleta(a.ruta)
          const esImagen = (a.tipo_mime || '').startsWith('image/')
          const esPDF    = (a.tipo_mime || '') === 'application/pdf'

          return (
            <button
              key={a.id}
              onClick={() => esImagen ? setActivo(url) : window.open(url, '_blank')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#263548] border border-white/10
                         hover:border-brand/50 transition-colors text-sm text-[#94a3b8] hover:text-white"
            >
              <FileIcon mime={a.tipo_mime} />
              <span className="truncate max-w-[160px]">
                {a.nombre_archivo || `Archivo ${a.id}`}
              </span>
              <ExternalLink className="w-3 h-3 opacity-50" />
            </button>
          )
        })}
      </div>

      {/* Lightbox para imágenes */}
      {activo && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setActivo(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setActivo(null)}
          >
            <X className="w-8 h-8" />
          </button>
          <img
            src={activo}
            alt="Vista previa"
            className="max-w-full max-h-[90vh] object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

// ── Card de incidente ─────────────────────────────────────────────────────────
function IncidenteCard({ inc, isAdmin, onUpdate }) {
  const [abrirDetalle, setAbrirDetalle] = useState(false)
  const [estado, setEstado] = useState(inc.estado)
  const [expandido, setExpandido] = useState(false)

  const { mutate: actualizar, isPending } = useMutation({
    mutationFn: (data) => seguridadService.actualizarIncidente(inc.id, data),
    onSuccess: () => {
      toast.success('Incidente actualizado')
      setAbrirDetalle(false)
      onUpdate()
    },
    onError: (e) => toast.error(e.response?.data?.detail || e.message),
  })

  const severidadEsAlta = inc.severidad === 'critica' || inc.severidad === 'alta'

  return (
    <>
      {/* Modal de detalle */}
      <Modal open={abrirDetalle} onClose={() => setAbrirDetalle(false)} title="Detalle del incidente" size="lg">
        <div className="space-y-5">

          {/* Badges de estado */}
          <div className="flex flex-wrap gap-2">
            <span className={SEVERIDAD_BADGE[inc.severidad] || 'badge-gray'}>
              Severidad: {inc.severidad}
            </span>
            <span className={ESTADO_BADGE[inc.estado] || 'badge-gray'}>
              Estado: {inc.estado}
            </span>
            {inc.tipo && (
              <span className="badge-gray">{inc.tipo}</span>
            )}
          </div>

          {/* Descripción */}
          <div>
            <p className="label">Descripción</p>
            <p className="text-white text-base bg-[#263548] p-4 rounded-xl leading-relaxed">
              {inc.descripcion || 'Sin descripción.'}
            </p>
          </div>

          {/* Metadatos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-2">
              <Calendar className="w-4 h-4 text-[#94a3b8] mt-0.5 flex-shrink-0" />
              <div>
                <p className="label text-xs">Fecha de reporte</p>
                <p className="text-white text-sm">{formatFecha(inc.reportado_en)}</p>
              </div>
            </div>

            {inc.resuelto_en && (
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="label text-xs">Resuelto en</p>
                  <p className="text-white text-sm">{formatFecha(inc.resuelto_en)}</p>
                </div>
              </div>
            )}

            {inc.instalacion && (
              <div className="flex items-start gap-2">
                <Building2 className="w-4 h-4 text-[#94a3b8] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="label text-xs">Instalación</p>
                  <p className="text-white text-sm">{inc.instalacion?.nombre || `ID ${inc.instalacion_id}`}</p>
                </div>
              </div>
            )}

            {inc.latitud && inc.longitud && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-[#94a3b8] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="label text-xs">Coordenadas GPS</p>
                  <p className="text-white text-sm">
                    {Number(inc.latitud).toFixed(5)}, {Number(inc.longitud).toFixed(5)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Archivos adjuntos */}
          <VisorArchivos archivos={inc.archivos || []} />

          {/* Cambiar estado (admin/supervisor) */}
          {isAdmin && (
            <div className="pt-4 border-t border-white/10 space-y-3">
              <p className="label">Cambiar estado</p>
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="input-field"
              >
                {['reportado', 'investigando', 'resuelto', 'cerrado'].map((e) => (
                  <option key={e} value={e}>
                    {e.charAt(0).toUpperCase() + e.slice(1)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => actualizar({ estado })}
                disabled={isPending || estado === inc.estado}
                className="btn-primary w-full"
              >
                {isPending ? 'Guardando...' : 'Guardar cambio de estado'}
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Tarjeta compacta */}
      <div className={`card overflow-hidden transition-all ${
        severidadEsAlta ? 'border-l-4 border-l-red-500' : ''
      }`}>
        <button
          className="w-full flex items-start gap-4 p-5 text-left"
          onClick={() => setAbrirDetalle(true)}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5
            ${severidadEsAlta ? 'bg-red-500/20' : 'bg-yellow-500/20'}`}>
            <AlertTriangle className={`w-5 h-5 ${severidadEsAlta ? 'text-red-400' : 'text-yellow-400'}`} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-lg truncate">{inc.titulo}</p>
            {inc.descripcion && (
              <p className="text-[#94a3b8] text-sm line-clamp-2 mt-0.5">{inc.descripcion}</p>
            )}

            <div className="flex flex-wrap gap-2 mt-2">
              <span className={SEVERIDAD_BADGE[inc.severidad] || 'badge-gray'}>
                {inc.severidad}
              </span>
              <span className={ESTADO_BADGE[inc.estado] || 'badge-gray'}>
                {inc.estado}
              </span>
              {inc.archivos?.length > 0 && (
                <span className="badge-gray">
                  📎 {inc.archivos.length} archivo{inc.archivos.length > 1 ? 's' : ''}
                </span>
              )}
              <span className="text-[#94a3b8] text-sm ml-auto">
                {formatFecha(inc.reportado_en, { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
          </div>
        </button>
      </div>
    </>
  )
}

// ── Formulario de nuevo incidente ─────────────────────────────────────────────
function NuevoIncidenteForm({ onClose, instalaciones }) {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  const [form, setForm] = useState({
    titulo: '',
    descripcion: '',
    tipo: 'seguridad',
    severidad: 'media',
    instalacion_id: '',
    latitud: null,
    longitud: null,
  })
  const [archivos, setArchivos] = useState([])     // File[]
  const [previews, setPreviews]  = useState([])     // { name, url, mime }[]
  const [obtenGPS, setObtenGPS]  = useState(false)

  // ── Gestión de archivos ──────────────────────────────────────────────────────
  const agregarArchivos = (nuevos) => {
    const lista = Array.from(nuevos)
    setArchivos((prev) => [...prev, ...lista])

    const prevsNuevos = lista.map((f) => ({
      name: f.name,
      mime: f.type,
      url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
    }))
    setPreviews((prev) => [...prev, ...prevsNuevos])
  }

  const quitarArchivo = (idx) => {
    if (previews[idx]?.url) URL.revokeObjectURL(previews[idx].url)
    setArchivos((prev) => prev.filter((_, i) => i !== idx))
    setPreviews((prev) => prev.filter((_, i) => i !== idx))
  }

  // ── GPS ──────────────────────────────────────────────────────────────────────
  const obtenerGPS = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalización no disponible en este dispositivo')
      return
    }
    setObtenGPS(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({ ...f, latitud: p.coords.latitude, longitud: p.coords.longitude }))
        setObtenGPS(false)
        toast.success('Ubicación GPS capturada')
      },
      (err) => {
        setObtenGPS(false)
        toast.error(`GPS: ${err.message || 'No se pudo obtener la ubicación'}`)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // ── Envío ────────────────────────────────────────────────────────────────────
  const { mutate, isPending } = useMutation({
    mutationFn: async (data) => {
      // 1. Crear el incidente
      const res = await seguridadService.crearIncidente(data)
      const id = res.data.id

      // 2. Subir todos los archivos (uno por uno para compatibilidad con el endpoint)
      for (const archivo of archivos) {
        const fd = new FormData()
        fd.append('archivo', archivo)
        await seguridadService.subirArchivoIncidente(id, fd)
      }

      return res
    },
    onSuccess: () => {
      toast.success('Incidente reportado correctamente')
      qc.invalidateQueries({ queryKey: ['incidentes'] })
      onClose()
    },
    onError: (e) => toast.error(e.response?.data?.detail || e.message),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.titulo.trim())        return toast.error('Ingrese un título')
    if (!form.descripcion.trim())   return toast.error('Ingrese la descripción')
    if (!form.instalacion_id)       return toast.error('Seleccione la instalación')

    mutate({
      ...form,
      instalacion_id: Number(form.instalacion_id),
      guardia_id: user?.guardia_id ?? undefined,
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>

      {/* Título */}
      <div>
        <label className="label">Título del incidente *</label>
        <input
          className="input-field"
          placeholder="Ej: Persona sospechosa en entrada norte"
          value={form.titulo}
          maxLength={200}
          onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
        />
      </div>

      {/* Tipo + Severidad */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Tipo *</label>
          <select className="input-field" value={form.tipo}
            onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}>
            {TIPOS.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Severidad *</label>
          <select className="input-field" value={form.severidad}
            onChange={(e) => setForm((f) => ({ ...f, severidad: e.target.value }))}>
            {SEVERIDADES.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Instalación */}
      <div>
        <label className="label">Instalación *</label>
        <select className="input-field" value={form.instalacion_id}
          onChange={(e) => setForm((f) => ({ ...f, instalacion_id: e.target.value }))}>
          <option value="">Seleccionar instalación</option>
          {instalaciones?.map((i) => (
            <option key={i.id} value={i.id}>{i.nombre}</option>
          ))}
        </select>
      </div>

      {/* Descripción */}
      <div>
        <label className="label">Descripción detallada *</label>
        <textarea
          className="input-field resize-none"
          rows={4}
          placeholder="Describa lo ocurrido con el mayor detalle posible…"
          value={form.descripcion}
          onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
        />
      </div>

      {/* GPS */}
      <button
        type="button"
        onClick={obtenerGPS}
        disabled={obtenGPS}
        className="btn-secondary w-full"
      >
        {obtenGPS ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Obteniendo ubicación…
          </>
        ) : form.latitud ? (
          `📍 GPS capturado (${Number(form.latitud).toFixed(4)}, ${Number(form.longitud).toFixed(4)})`
        ) : (
          '📍 Capturar ubicación GPS (opcional)'
        )}
      </button>

      {/* Zona de archivos */}
      <div>
        <label className="label">
          Fotos / documentos (opcional) — puede seleccionar múltiples
        </label>

        {/* Drop zone */}
        <label
          className="flex flex-col items-center justify-center gap-2 w-full py-5 px-4
                     bg-[#0f1929] border-2 border-dashed border-[#2d5490]/60
                     rounded-xl hover:border-brand/60 transition-colors cursor-pointer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (e.dataTransfer.files.length) agregarArchivos(e.dataTransfer.files)
          }}
        >
          <Upload className="w-7 h-7 text-[#94a3b8]" />
          <span className="text-[#94a3b8] text-sm text-center leading-snug">
            Arrastra archivos aquí o haz clic para seleccionar<br />
            <span className="text-xs opacity-70">Imágenes (JPG, PNG, WEBP) y PDF — sin límite de cantidad</span>
          </span>
          <input
            type="file"
            className="hidden"
            multiple
            accept="image/*,.pdf,.doc,.docx"
            onChange={(e) => {
              if (e.target.files?.length) agregarArchivos(e.target.files)
              e.target.value = ''   // permite re-seleccionar el mismo archivo
            }}
          />
        </label>

        {/* Previews */}
        {previews.length > 0 && (
          <div className="mt-3 space-y-2">
            {previews.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2 bg-[#263548] rounded-xl border border-white/10"
              >
                {/* Miniatura o ícono */}
                {p.url ? (
                  <img
                    src={p.url}
                    alt={p.name}
                    className="w-10 h-10 object-cover rounded-lg flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 bg-[#1e3a5f] rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-brand" />
                  </div>
                )}
                <span className="flex-1 text-white text-sm truncate">{p.name}</span>
                <button
                  type="button"
                  onClick={() => quitarArchivo(i)}
                  className="text-[#94a3b8] hover:text-red-400 transition-colors !min-h-0 p-1"
                  aria-label={`Quitar ${p.name}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Botones */}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">
          Cancelar
        </button>
        <button type="submit" disabled={isPending} className="btn-danger flex-1">
          {isPending
            ? `Reportando${archivos.length > 1 ? ` (${archivos.length} archivos)` : ''}…`
            : '⚠️ Reportar incidente'}
        </button>
      </div>
    </form>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function IncidentesPage() {
  const [abrirForm, setAbrirForm]             = useState(false)
  const [filtroEstado, setFiltroEstado]       = useState('')
  const [filtroSeveridad, setFiltroSeveridad] = useState('')
  const qc   = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = ['admin', 'supervisor'].includes(user?.rol)

  const { data: incidentes, isLoading } = useQuery({
    queryKey: ['incidentes', filtroEstado, filtroSeveridad],
    queryFn: () => seguridadService.listarIncidentes({
      estado:    filtroEstado    || undefined,
      severidad: filtroSeveridad || undefined,
    }),
    select: (r) => Array.isArray(r?.data) ? r.data : [],
  })

  const { data: instalaciones } = useQuery({
    queryKey: ['instalaciones'],
    queryFn: () => seguridadService.listarInstalaciones({ activa: true }),
    select: (r) => Array.isArray(r?.data) ? r.data : [],
  })

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-slide-up">

      <Modal open={abrirForm} onClose={() => setAbrirForm(false)} title="Reportar incidente" size="lg">
        <NuevoIncidenteForm
          onClose={() => setAbrirForm(false)}
          instalaciones={instalaciones}
        />
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
      <div className="flex gap-3 flex-wrap items-center">
        <Filter className="w-4 h-4 text-[#94a3b8]" />
        <select
          className="input-field !w-auto !min-h-0 py-2 text-sm"
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
        >
          <option value="">Todos los estados</option>
          {['reportado', 'investigando', 'resuelto', 'cerrado'].map((e) => (
            <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
          ))}
        </select>
        <select
          className="input-field !w-auto !min-h-0 py-2 text-sm"
          value={filtroSeveridad}
          onChange={(e) => setFiltroSeveridad(e.target.value)}
        >
          <option value="">Todas las severidades</option>
          {SEVERIDADES.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <Spinner />
      ) : incidentes?.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Sin incidentes"
          description="No hay incidentes registrados con los filtros actuales."
          action={
            <button onClick={() => setAbrirForm(true)} className="btn-danger">
              <Plus className="w-5 h-5" />Reportar incidente
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {incidentes.map((inc) => (
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
