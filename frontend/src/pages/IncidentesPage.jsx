import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Plus, Filter, Upload, X,
  FileText, Image as ImageIcon, Video, File,
  ExternalLink, Download, MapPin, Building2, Calendar,
  ChevronDown, ChevronUp, ShieldAlert, UserX,
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

const TIPOS      = ['seguridad', 'accidente', 'emergencia', 'otro']
const SEVERIDADES = ['baja', 'media', 'alta', 'critica']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// Tipos MIME agrupados
const ES_IMAGEN = (m = '') => /^image\//.test(m)
const ES_VIDEO  = (m = '') => /^video\//.test(m)
const ES_PDF    = (m = '') => m === 'application/pdf'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFecha(valor, opts = {}) {
  if (!valor) return '—'
  const d = new Date(valor)
  if (isNaN(d.getTime())) return '—'
  const def = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  return d.toLocaleString('es-CL', { ...def, ...opts })
}

/** Construye la URL absoluta de un archivo guardado en /uploads */
function urlArchivo(ruta = '') {
  if (ruta.startsWith('http')) return ruta
  const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/api\/?$/, '')
  return `${base}${ruta}`
}

// ── Ícono según MIME ──────────────────────────────────────────────────────────
function MimeIcon({ mime = '', className = 'w-5 h-5' }) {
  if (ES_IMAGEN(mime)) return <ImageIcon className={className} />
  if (ES_VIDEO(mime))  return <Video     className={className} />
  if (ES_PDF(mime))    return <FileText  className={className} />
  return <File className={className} />
}

// ── Visor de archivos ─────────────────────────────────────────────────────────
function VisorArchivos({ archivos = [] }) {
  const [lightbox, setLightbox] = useState(null) // { url, mime, nombre }

  if (!archivos.length) return null

  return (
    <div className="space-y-3">
      <p className="label">
        Archivos adjuntos
        <span className="ml-2 text-xs text-[#64748b]">({archivos.length})</span>
      </p>

      {/* Grid de previews */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {archivos.map((a) => {
          const url    = urlArchivo(a.ruta)
          const mime   = a.tipo_mime || ''
          const nombre = a.nombre_archivo || `Archivo ${a.id}`

          /* ── Imagen → thumbnail clicable ── */
          if (ES_IMAGEN(mime)) {
            return (
              <button
                key={a.id}
                onClick={() => setLightbox({ url, mime, nombre })}
                className="relative group rounded-xl overflow-hidden border border-white/10 aspect-square bg-[#263548] hover:border-brand/60 transition-colors"
                title={nombre}
              >
                <img
                  src={url}
                  alt={nombre}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <ExternalLink className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="absolute bottom-0 left-0 right-0 px-2 py-1 text-[10px] text-white bg-black/50 truncate">
                  {nombre}
                </p>
              </button>
            )
          }

          /* ── Vídeo → thumbnail con play ── */
          if (ES_VIDEO(mime)) {
            return (
              <button
                key={a.id}
                onClick={() => setLightbox({ url, mime, nombre })}
                className="relative group rounded-xl overflow-hidden border border-white/10 aspect-square bg-[#263548] hover:border-brand/60 transition-colors flex flex-col items-center justify-center gap-2"
                title={nombre}
              >
                <Video className="w-8 h-8 text-brand" />
                <p className="text-[10px] text-[#94a3b8] px-2 truncate w-full text-center">{nombre}</p>
              </button>
            )
          }

          /* ── PDF / DOC → botón con descarga y nueva pestaña ── */
          return (
            <a
              key={a.id}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl border border-white/10 bg-[#263548] hover:border-brand/60 transition-colors aspect-square text-center"
              title={`Abrir ${nombre}`}
            >
              <MimeIcon mime={mime} className="w-8 h-8 text-brand" />
              <p className="text-[10px] text-[#94a3b8] line-clamp-2 w-full">{nombre}</p>
              <span className="text-[9px] text-brand uppercase tracking-wide">
                {ES_PDF(mime) ? 'PDF' : mime.split('/')[1]?.toUpperCase() || 'DOC'}
              </span>
            </a>
          )
        })}
      </div>

      {/* Lightbox imagen */}
      {lightbox && ES_IMAGEN(lightbox.mime) && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white bg-black/40 rounded-xl"
            onClick={() => setLightbox(null)}
            aria-label="Cerrar"
          >
            <X className="w-6 h-6" />
          </button>
          <a
            href={lightbox.url}
            download
            className="absolute top-4 left-4 p-2 text-white/70 hover:text-white bg-black/40 rounded-xl"
            onClick={(e) => e.stopPropagation()}
            aria-label="Descargar"
          >
            <Download className="w-6 h-6" />
          </a>
          <img
            src={lightbox.url}
            alt={lightbox.nombre}
            className="max-w-full max-h-[88vh] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-4 text-white/60 text-sm">{lightbox.nombre}</p>
        </div>
      )}

      {/* Lightbox vídeo */}
      {lightbox && ES_VIDEO(lightbox.mime) && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white bg-black/40 rounded-xl"
            onClick={() => setLightbox(null)}
            aria-label="Cerrar"
          >
            <X className="w-6 h-6" />
          </button>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={lightbox.url}
            controls
            autoPlay
            className="max-w-full max-h-[88vh] rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-4 text-white/60 text-sm">{lightbox.nombre}</p>
        </div>
      )}
    </div>
  )
}

// ── Modal de detalle de incidente ─────────────────────────────────────────────
function ModalDetalle({ inc, isAdmin, onClose, onUpdate }) {
  const [estado, setEstado] = useState(inc.estado)

  const { mutate: actualizar, isPending } = useMutation({
    mutationFn: (data) => seguridadService.actualizarIncidente(inc.id, data),
    onSuccess: () => {
      toast.success('Estado actualizado')
      onUpdate()
      onClose()
    },
    onError: (e) => toast.error(e.response?.data?.detail || e.message),
  })

  const severidadEsAlta = inc.severidad === 'critica' || inc.severidad === 'alta'

  return (
    <div className="space-y-5">

      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        <span className={`${SEVERIDAD_BADGE[inc.severidad] || 'badge-gray'} text-sm`}>
          Severidad: {inc.severidad}
        </span>
        <span className={`${ESTADO_BADGE[inc.estado] || 'badge-gray'} text-sm`}>
          Estado: {inc.estado}
        </span>
        {inc.tipo && <span className="badge-gray text-sm capitalize">{inc.tipo}</span>}
      </div>

      {/* Descripción */}
      <div>
        <p className="label">Descripción</p>
        <p className="text-white text-base bg-[#0f1929] p-4 rounded-xl leading-relaxed border border-white/5">
          {inc.descripcion || 'Sin descripción registrada.'}
        </p>
      </div>

      {/* Metadatos: 2 columnas en desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* Fecha reporte */}
        <div className="flex items-start gap-3 bg-[#0f1929] rounded-xl p-3 border border-white/5">
          <Calendar className="w-4 h-4 text-[#94a3b8] mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-[#94a3b8] text-xs mb-0.5">Fecha de reporte</p>
            <p className="text-white text-sm font-medium">{formatFecha(inc.reportado_en)}</p>
          </div>
        </div>

        {/* Fecha resolución */}
        {inc.resuelto_en && (
          <div className="flex items-start gap-3 bg-[#0f1929] rounded-xl p-3 border border-green-500/20">
            <Calendar className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[#94a3b8] text-xs mb-0.5">Resuelto en</p>
              <p className="text-white text-sm font-medium">{formatFecha(inc.resuelto_en)}</p>
            </div>
          </div>
        )}

        {/* Instalación */}
        {(inc.instalacion || inc.instalacion_id) && (
          <div className="flex items-start gap-3 bg-[#0f1929] rounded-xl p-3 border border-white/5">
            <Building2 className="w-4 h-4 text-brand mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[#94a3b8] text-xs mb-0.5">Instalación</p>
              <p className="text-white text-sm font-medium">
                {inc.instalacion?.nombre ?? `ID ${inc.instalacion_id}`}
              </p>
              {inc.instalacion?.direccion && (
                <p className="text-[#94a3b8] text-xs mt-0.5">{inc.instalacion.direccion}</p>
              )}
            </div>
          </div>
        )}

        {/* GPS — solo si existe */}
        {inc.latitud != null && inc.longitud != null && (
          <div className="flex items-start gap-3 bg-[#0f1929] rounded-xl p-3 border border-white/5">
            <MapPin className="w-4 h-4 text-[#94a3b8] mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[#94a3b8] text-xs mb-0.5">Ubicación GPS</p>
              <p className="text-white text-sm font-medium font-mono">
                {Number(inc.latitud).toFixed(5)}, {Number(inc.longitud).toFixed(5)}
              </p>
              <a
                href={`https://www.google.com/maps?q=${inc.latitud},${inc.longitud}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand text-xs flex items-center gap-1 mt-1 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                Ver en Google Maps
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Archivos adjuntos */}
      <VisorArchivos archivos={inc.archivos || []} />

      {/* Cambiar estado (solo admin/supervisor) */}
      {isAdmin && (
        <div className="pt-4 border-t border-white/10 space-y-3">
          <p className="label">Cambiar estado del incidente</p>
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            className="input-field"
          >
            {['reportado', 'investigando', 'resuelto', 'cerrado'].map((e) => (
              <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
            ))}
          </select>
          <button
            onClick={() => actualizar({ estado })}
            disabled={isPending || estado === inc.estado}
            className="btn-primary w-full"
          >
            {isPending ? 'Guardando…' : 'Guardar cambio de estado'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Tarjeta de incidente (lista) ──────────────────────────────────────────────
function IncidenteCard({ inc, isAdmin, onUpdate }) {
  const [abierto, setAbierto] = useState(false)
  const severidadEsAlta = inc.severidad === 'critica' || inc.severidad === 'alta'

  return (
    <>
      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={inc.titulo}
        size="lg"
      >
        <ModalDetalle
          inc={inc}
          isAdmin={isAdmin}
          onClose={() => setAbierto(false)}
          onUpdate={onUpdate}
        />
      </Modal>

      <button
        className={`card w-full text-left p-5 hover:border-[#2d5490]/80 transition-colors
          ${severidadEsAlta ? 'border-l-4 border-l-red-500' : ''}`}
        onClick={() => setAbierto(true)}
      >
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5
            ${severidadEsAlta ? 'bg-red-500/20' : 'bg-yellow-500/20'}`}>
            <AlertTriangle className={`w-5 h-5 ${severidadEsAlta ? 'text-red-400' : 'text-yellow-400'}`} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-base truncate">{inc.titulo}</p>
            {inc.descripcion && (
              <p className="text-[#94a3b8] text-sm line-clamp-2 mt-0.5">{inc.descripcion}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={SEVERIDAD_BADGE[inc.severidad] || 'badge-gray'}>{inc.severidad}</span>
              <span className={ESTADO_BADGE[inc.estado] || 'badge-gray'}>{inc.estado}</span>

              {/* Instalación */}
              {(inc.instalacion?.nombre) && (
                <span className="badge-gray flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  {inc.instalacion.nombre}
                </span>
              )}

              {/* Archivos */}
              {inc.archivos?.length > 0 && (
                <span className="badge-gray">
                  📎 {inc.archivos.length}
                </span>
              )}

              {/* GPS */}
              {inc.latitud != null && (
                <span className="badge-gray flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  GPS
                </span>
              )}

              <span className="text-[#94a3b8] text-xs ml-auto whitespace-nowrap">
                {formatFecha(inc.reportado_en, { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
          </div>
        </div>
      </button>
    </>
  )
}

// ── Formulario nuevo incidente ────────────────────────────────────────────────
function NuevoIncidenteForm({ onClose, instalaciones }) {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  const [form, setForm] = useState({
    titulo: '', descripcion: '', tipo: 'seguridad',
    severidad: 'media', instalacion_id: '',
    latitud: null, longitud: null,
  })
  const [archivos, setArchivos]   = useState([])   // File[]
  const [previews, setPreviews]   = useState([])   // {name, mime, previewUrl|null}[]
  const [obtenGPS, setObtenGPS]   = useState(false)

  // ── Archivos ──────────────────────────────────────────────────────────────
  const agregarArchivos = (nuevos) => {
    const lista = Array.from(nuevos)
    setArchivos((p) => [...p, ...lista])
    setPreviews((p) => [
      ...p,
      ...lista.map((f) => ({
        name: f.name,
        mime: f.type,
        previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      })),
    ])
  }

  const quitarArchivo = (i) => {
    if (previews[i]?.previewUrl) URL.revokeObjectURL(previews[i].previewUrl)
    setArchivos((p) => p.filter((_, j) => j !== i))
    setPreviews((p) => p.filter((_, j) => j !== i))
  }

  // ── GPS ───────────────────────────────────────────────────────────────────
  const obtenerGPS = () => {
    if (!navigator.geolocation) return toast.error('Geolocalización no disponible')
    setObtenGPS(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({ ...f, latitud: p.coords.latitude, longitud: p.coords.longitude }))
        setObtenGPS(false)
        toast.success('Ubicación GPS capturada')
      },
      (e) => { setObtenGPS(false); toast.error(`GPS: ${e.message}`) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // ── Envío ─────────────────────────────────────────────────────────────────
  const { mutate, isPending } = useMutation({
    mutationFn: async (data) => {
      const res = await seguridadService.crearIncidente(data)
      const id  = res.data.id
      if (archivos.length > 0) {
        const fd = new FormData()
        archivos.forEach((f) => fd.append('archivos', f))
        await seguridadService.subirArchivoIncidente(id, fd)
      }
      return res
    },
    onSuccess: () => {
      toast.success('Incidente reportado')
      qc.invalidateQueries({ queryKey: ['incidentes'] })
      onClose()
    },
    onError: (e) => toast.error(e.response?.data?.detail || e.message),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.titulo.trim())      return toast.error('Ingrese un título')
    if (!form.descripcion.trim()) return toast.error('Ingrese la descripción')
    if (!form.instalacion_id)     return toast.error('Seleccione la instalación')
    mutate({ ...form, instalacion_id: Number(form.instalacion_id) })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>

      <div>
        <label className="label">Título *</label>
        <input className="input-field" placeholder="Ej: Persona sospechosa en entrada norte"
          value={form.titulo} maxLength={200}
          onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Tipo *</label>
          <select className="input-field" value={form.tipo}
            onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}>
            {TIPOS.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Severidad *</label>
          <select className="input-field" value={form.severidad}
            onChange={(e) => setForm((f) => ({ ...f, severidad: e.target.value }))}>
            {SEVERIDADES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Instalación *</label>
        <select className="input-field" value={form.instalacion_id}
          onChange={(e) => setForm((f) => ({ ...f, instalacion_id: e.target.value }))}>
          <option value="">Seleccionar instalación</option>
          {instalaciones?.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
        </select>
      </div>

      <div>
        <label className="label">Descripción *</label>
        <textarea className="input-field resize-none" rows={4}
          placeholder="Describa lo ocurrido con el mayor detalle posible…"
          value={form.descripcion}
          onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} />
      </div>

      {/* GPS */}
      <button type="button" onClick={obtenerGPS} disabled={obtenGPS} className="btn-secondary w-full">
        {obtenGPS
          ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Obteniendo…</>
          : form.latitud
            ? `GPS: ${Number(form.latitud).toFixed(4)}, ${Number(form.longitud).toFixed(4)}`
            : 'Capturar ubicación GPS (opcional)'}
      </button>

      {/* Zona de archivos */}
      <div>
        <label className="label">
          Fotos, vídeos o documentos
          <span className="text-xs text-[#64748b] ml-2">(opcional, múltiples)</span>
        </label>

        <label
          className="flex flex-col items-center justify-center gap-2 w-full py-5 px-4
                     bg-[#0f1929] border-2 border-dashed border-[#2d5490]/60
                     rounded-xl hover:border-brand/60 transition-colors cursor-pointer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) agregarArchivos(e.dataTransfer.files) }}
        >
          <Upload className="w-7 h-7 text-[#94a3b8]" />
          <span className="text-[#94a3b8] text-sm text-center leading-snug">
            Arrastra archivos aquí o haz clic para seleccionar<br />
            <span className="text-xs opacity-60">JPG · PNG · WEBP · MP4 · MOV · PDF · DOC — sin límite de cantidad</span>
          </span>
          <input type="file" className="hidden" multiple
            accept="image/*,video/*,.pdf,.doc,.docx,.txt"
            onChange={(e) => { if (e.target.files?.length) agregarArchivos(e.target.files); e.target.value = '' }} />
        </label>

        {previews.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2">
            {previews.map((p, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 bg-[#263548] rounded-xl border border-white/10">
                {p.previewUrl
                  ? <img src={p.previewUrl} alt={p.name} className="w-10 h-10 object-cover rounded-lg flex-shrink-0" />
                  : <div className="w-10 h-10 bg-[#1e3a5f] rounded-lg flex items-center justify-center flex-shrink-0">
                      <MimeIcon mime={p.mime} className="w-5 h-5 text-brand" />
                    </div>
                }
                <span className="flex-1 text-white text-sm truncate">{p.name}</span>
                <button type="button" onClick={() => quitarArchivo(i)}
                  className="text-[#94a3b8] hover:text-red-400 transition-colors !min-h-0 p-1"
                  aria-label={`Quitar ${p.name}`}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button type="submit" disabled={isPending} className="btn-danger flex-1">
          {isPending
            ? `Reportando${archivos.length > 0 ? ` (${archivos.length} archivo${archivos.length > 1 ? 's' : ''})` : ''}…`
            : '⚠️ Reportar incidente'}
        </button>
      </div>
    </form>
  )
}

// ── Aviso de cuenta no vinculada a Guardia ────────────────────────────────────
function AvisoSinGuardia() {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-4">
      <div className="w-14 h-14 bg-red-500/15 rounded-2xl flex items-center justify-center">
        <UserX className="w-7 h-7 text-red-400" />
      </div>
      <div>
        <p className="text-white font-semibold text-lg">Cuenta no vinculada</p>
        <p className="text-[#94a3b8] text-sm mt-2 leading-relaxed max-w-sm">
          Tu cuenta de usuario aún no está vinculada a una ficha de guardia.
          Para poder reportar incidentes, contacta al administrador para
          que vincule tu cuenta en la sección de Guardias.
        </p>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function IncidentesPage() {
  const [abrirForm, setAbrirForm]             = useState(false)
  const [filtroEstado, setFiltroEstado]       = useState('')
  const [filtroSeveridad, setFiltroSeveridad] = useState('')
  const [filtroFecha, setFiltroFecha]         = useState('')
  const [filtroMes, setFiltroMes]             = useState('')
  const [filtroAnio, setFiltroAnio]           = useState('')
  const qc      = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin  = ['admin', 'supervisor'].includes(user?.rol)

  // El backend ya filtra: admin/supervisor ven todos, usuario ve solo
  // los suyos. No es necesario (ni seguro) replicar ese filtro en el
  // cliente — el servidor es la única fuente de verdad sobre qué
  // incidentes puede ver cada quien.
  const { data: incidentes, isLoading } = useQuery({
    queryKey: ['incidentes', filtroEstado, filtroSeveridad, filtroFecha, filtroMes, filtroAnio],
    queryFn: () => seguridadService.listarIncidentes({
      estado:    filtroEstado    || undefined,
      severidad: filtroSeveridad || undefined,
      fecha:     filtroFecha     || undefined,
      mes:       filtroMes       || undefined,
      anio:      filtroAnio      || undefined,
    }),
    select: (r) => Array.isArray(r?.data) ? r.data : [],
  })

  const { data: instalaciones } = useQuery({
    queryKey: ['instalaciones'],
    queryFn: () => seguridadService.listarInstalaciones({ activa: true }),
    select: (r) => Array.isArray(r?.data) ? r.data : [],
  })

  // Verifica si el usuario actual tiene ficha de Guardia vinculada.
  // Solo aplica a usuarios no-admin/supervisor, que son los que tienen
  // la obligación de estar vinculados para poder reportar.
  const { data: miFicha, isLoading: cargandoFicha } = useQuery({
    queryKey: ['mi-ficha-guardia'],
    queryFn: () => seguridadService.miFichaGuardia().then((r) => r.data),
    enabled: !isAdmin,
    retry: false,
  })

  const tieneGuardia = isAdmin || !!miFicha

  const handleAbrirForm = () => {
    if (!isAdmin && !cargandoFicha && !tieneGuardia) {
      toast.error('Tu cuenta no está vinculada a una ficha de guardia. Contacta al administrador.')
      return
    }
    setAbrirForm(true)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-slide-up">

      <Modal
        open={abrirForm}
        onClose={() => setAbrirForm(false)}
        title={tieneGuardia ? 'Reportar incidente' : 'Cuenta no vinculada'}
        size="lg"
      >
        {tieneGuardia
          ? <NuevoIncidenteForm onClose={() => setAbrirForm(false)} instalaciones={instalaciones} />
          : <AvisoSinGuardia />}
      </Modal>

      <PageHeader
        icon={AlertTriangle}
        title="Incidentes"
        subtitle={isAdmin
          ? 'Reportar y gestionar todos los incidentes de seguridad'
          : 'Reportar y ver tus incidentes reportados'}
        action={
          <button
            onClick={handleAbrirForm}
            disabled={!isAdmin && cargandoFicha}
            className="btn-danger disabled:opacity-50"
          >
            <Plus className="w-5 h-5" /> Reportar
          </button>
        }
      />

      {/* Aviso persistente si el usuario no tiene ficha de guardia */}
      {!isAdmin && !cargandoFicha && !tieneGuardia && (
        <div className="card p-4 flex items-start gap-3 border-l-4 border-l-red-500">
          <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-white font-medium text-sm">Cuenta no vinculada a guardia</p>
            <p className="text-[#94a3b8] text-xs mt-1">
              No podrás reportar incidentes hasta que el administrador vincule tu cuenta
              a una ficha de guardia en la sección Guardias.
            </p>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap items-center">
        <Filter className="w-4 h-4 text-[#94a3b8]" />
        <select className="input-field !w-auto !min-h-0 py-2 text-sm"
          value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {['reportado','investigando','resuelto','cerrado'].map((e) =>
            <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
          )}
        </select>
        <select className="input-field !w-auto !min-h-0 py-2 text-sm"
          value={filtroSeveridad} onChange={(e) => setFiltroSeveridad(e.target.value)}>
          <option value="">Todas las severidades</option>
          {SEVERIDADES.map((s) =>
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          )}
        </select>
        <input
          type="date"
          aria-label="Filtrar incidentes por fecha"
          className="input-field !w-auto !min-h-0 py-2 text-sm"
          value={filtroFecha}
          onChange={(e) => {
            setFiltroFecha(e.target.value)
            if (e.target.value) { setFiltroMes(''); setFiltroAnio('') }
          }}
        />
        <select
          aria-label="Filtrar incidentes por mes"
          className="input-field !w-auto !min-h-0 py-2 text-sm"
          value={filtroMes}
          onChange={(e) => { setFiltroMes(e.target.value); setFiltroFecha('') }}
        >
          <option value="">Todos los meses</option>
          {MESES.map((mes, index) => <option key={mes} value={index + 1}>{mes}</option>)}
        </select>
        <input
          type="number"
          aria-label="Filtrar incidentes por año"
          placeholder="Año"
          min="1900"
          max="9999"
          className="input-field !w-28 !min-h-0 py-2 text-sm"
          value={filtroAnio}
          onChange={(e) => { setFiltroAnio(e.target.value); setFiltroFecha('') }}
        />
        {(filtroFecha || filtroMes || filtroAnio) && (
          <button
            type="button"
            className="btn-ghost !py-2 !px-3 text-sm"
            onClick={() => { setFiltroFecha(''); setFiltroMes(''); setFiltroAnio('') }}
          >
            Limpiar fecha
          </button>
        )}
      </div>

      {/* Lista */}
      {isLoading ? (
        <Spinner />
      ) : incidentes?.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Sin incidentes"
          description={isAdmin
            ? 'No hay incidentes registrados con los filtros actuales.'
            : 'Aún no has reportado ningún incidente.'}
          action={
            <button onClick={handleAbrirForm} className="btn-danger">
              <Plus className="w-5 h-5" /> Reportar incidente
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
