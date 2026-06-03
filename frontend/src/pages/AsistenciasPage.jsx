/**
 * AsistenciasPage.jsx
 * Sistema completo de asistencia:
 *  - Vista Guardia: marcaje entrada/salida con GPS + selfie + face-api.js opcional
 *  - Vista Admin: dashboard en vivo (polling 30s), filtros, ajuste manual, exportación Excel/CSV
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardList, Camera, MapPin, CheckCircle2, XCircle,
  Clock, AlertTriangle, Users, Building2, Download,
  RefreshCw, Filter, Pencil, ChevronRight, Shield,
  TrendingUp, UserCheck, UserX, Timer, Settings,
  Eye, EyeOff, Save, X, Image as ImageIcon,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { asistenciaService, seguridadService } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { Modal, Spinner, EmptyState } from '../components/index.jsx'
import { ErrorBoundary } from '../components/ErrorBoundary.jsx'

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function fmt(dt, opts = {}) {
  if (!dt) return '—'
  const d = new Date(dt)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', ...opts,
  })
}

function fmtHora(dt) {
  if (!dt) return '—'
  const d = new Date(dt)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

function fmtMin(mins) {
  if (mins == null) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function urlFoto(ruta) {
  if (!ruta) return null
  if (ruta.startsWith('http')) return ruta
  const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/api\/?$/, '')
  return `${base}${ruta}`
}

const ESTADO_STYLE = {
  a_tiempo:   { badge: 'badge-green',  label: 'A tiempo',   icon: CheckCircle2 },
  tardanza:   { badge: 'badge-yellow', label: 'Tardanza',   icon: Timer },
  falta:      { badge: 'badge-red',    label: 'Falta',      icon: XCircle },
  sin_marcar: { badge: 'badge-gray',   label: 'Sin marcar', icon: Clock },
}

function EstadoBadge({ estado }) {
  const s = ESTADO_STYLE[estado] || ESTADO_STYLE.sin_marcar
  return <span className={s.badge}>{s.label}</span>
}

// ══════════════════════════════════════════════════════════════════════════════
// HOOK GPS
// ══════════════════════════════════════════════════════════════════════════════

function useGPS() {
  const [pos, setPos]     = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const obtener = useCallback(() => {
    if (!navigator.geolocation) { setError('GPS no disponible'); return }
    setLoading(true); setError(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy })
        setLoading(false)
      },
      (e) => {
        const msgs = {
          1: 'Permiso de ubicación denegado. Actívelo en su navegador.',
          2: 'No se pudo obtener la ubicación.',
          3: 'Tiempo de espera agotado.',
        }
        setError(msgs[e.code] || 'Error GPS')
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [])

  useEffect(() => { obtener() }, [obtener])
  return { pos, error, loading, obtener }
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE: CÁMARA + SELFIE (con face-api.js opcional)
// ══════════════════════════════════════════════════════════════════════════════

function CamaraSelfi({ onFoto, onCancelar, reconocimientoFacial = false }) {
  const videoRef      = useRef(null)
  const canvasRef     = useRef(null)
  const streamRef     = useRef(null)
  const [listo, setListo]           = useState(false)
  const [capturada, setCapturada]   = useState(null) // base64
  const [faceApi, setFaceApi]       = useState(null) // módulo cargado dinámicamente
  const [detectando, setDetectando] = useState(false)
  const [faceOk, setFaceOk]         = useState(null) // true | false | null
  const [errorCam, setErrorCam]     = useState(null)

  // Cargar face-api.js solo si el admin lo activó
  useEffect(() => {
    if (!reconocimientoFacial) return
    import('@vladmandic/face-api').then(async (fa) => {
      try {
        const modelBase = (import.meta.env.VITE_FACE_API_MODEL_PATH || '/models/face-api').replace(/\/$/, '')
        await Promise.all([
          fa.nets.tinyFaceDetector.loadFromUri(modelBase),
        ])
        setFaceApi(fa)
      } catch {
        // Los modelos no están disponibles — seguir sin reconocimiento
        setFaceApi(null)
      }
    }).catch(() => setFaceApi(null))
  }, [reconocimientoFacial])

  // Iniciar cámara frontal
  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    }).then((stream) => {
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        setListo(true)
      }
    }).catch((e) => {
      setErrorCam('No se pudo acceder a la cámara. Verifique los permisos.')
    })
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()) }
  }, [])

  const capturar = async () => {
    if (!videoRef.current || !canvasRef.current) return
    const v = videoRef.current
    const c = canvasRef.current
    c.width  = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    const dataUrl = c.toDataURL('image/jpeg', 0.85)
    setCapturada(dataUrl)

    // Detección facial si está disponible
    if (faceApi && reconocimientoFacial) {
      setDetectando(true)
      try {
        const detections = await faceApi.detectAllFaces(
          c, new faceApi.TinyFaceDetectorOptions()
        )
        setFaceOk(detections.length > 0)
        if (detections.length === 0) {
          toast.error('No se detectó ningún rostro. Intente de nuevo.')
        }
      } catch {
        setFaceOk(null)
      } finally {
        setDetectando(false)
      }
    }
  }

  const confirmar = () => {
    if (!capturada) return
    if (reconocimientoFacial && faceApi && faceOk === false) {
      toast.error('Se requiere un rostro visible para confirmar.')
      return
    }
    // Convertir base64 → File
    fetch(capturada)
      .then((r) => r.blob())
      .then((blob) => {
        const file = new File([blob], `selfie_${Date.now()}.jpg`, { type: 'image/jpeg' })
        onFoto(file, capturada)
      })
  }

  if (errorCam) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <Camera className="w-12 h-12 text-red-400" />
        <p className="text-red-400">{errorCam}</p>
        <p className="text-[#94a3b8] text-sm">
          También puede continuar sin foto si el administrador no la requiere.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancelar} className="btn-secondary">Cancelar</button>
          <button onClick={() => onFoto(null, null)} className="btn-primary">
            Continuar sin foto
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!capturada ? (
        <>
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            {/* Marco guía */}
            {listo && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-4 border-brand/70 rounded-full" />
              </div>
            )}
            {!listo && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner className="text-brand w-10 h-10" />
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <p className="text-[#94a3b8] text-sm text-center">
            Centre su rostro en el círculo y presione capturar
          </p>
          {reconocimientoFacial && !faceApi && (
            <p className="text-yellow-400 text-xs text-center">
              ⚠️ Reconocimiento facial no disponible (modelos no cargados). La foto se tomará sin verificación.
            </p>
          )}
          <div className="flex gap-3">
            <button onClick={onCancelar} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={capturar} disabled={!listo} className="btn-primary flex-1">
              <Camera className="w-5 h-5" /> Capturar
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="relative rounded-2xl overflow-hidden aspect-video bg-black">
            <img src={capturada} alt="Selfie capturada" className="w-full h-full object-cover" />
            {detectando && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="text-white text-center space-y-2">
                  <Spinner className="w-8 h-8 mx-auto" />
                  <p className="text-sm">Detectando rostro…</p>
                </div>
              </div>
            )}
            {/* Indicador de detección */}
            {faceOk === true && (
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-green-500/90 text-white px-3 py-1.5 rounded-xl text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" /> Rostro detectado
              </div>
            )}
            {faceOk === false && (
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-500/90 text-white px-3 py-1.5 rounded-xl text-sm font-medium">
                <XCircle className="w-4 h-4" /> Sin rostro detectado
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setCapturada(null); setFaceOk(null) }} className="btn-secondary flex-1">
              Repetir
            </button>
            <button
              onClick={confirmar}
              disabled={detectando || (reconocimientoFacial && faceApi && faceOk === false)}
              className="btn-primary flex-1"
            >
              <CheckCircle2 className="w-5 h-5" /> Usar esta foto
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE: PANEL DE MARCAJE (GUARDIA)
// ══════════════════════════════════════════════════════════════════════════════

function PanelMarcaje({ turno, asistencia, onMarcado }) {
  const [paso, setPaso]           = useState('inicio')  // inicio | camara_entrada | camara_salida | obs
  const [fotoFile, setFotoFile]   = useState(null)
  const [fotoPreview, setFotoPreview] = useState(null)
  const [observacion, setObservacion] = useState('')
  const gps = useGPS()

  const { data: config } = useQuery({
    queryKey: ['asistencia-config'],
    queryFn: () => asistenciaService.obtenerConfig().then((r) => r.data),
    staleTime: 60_000,
  })

  const { mutate: entrada, isPending: cargandoEntrada } = useMutation({
    mutationFn: () => asistenciaService.marcarEntrada(turno.id, gps.pos.lat, gps.pos.lng, fotoFile),
    onSuccess: () => {
      toast.success('✅ Entrada registrada')
      setPaso('inicio')
      setFotoFile(null); setFotoPreview(null)
      onMarcado()
    },
    onError: (e) => toast.error(e.response?.data?.detail || e.message),
  })

  const { mutate: salida, isPending: cargandoSalida } = useMutation({
    mutationFn: () => asistenciaService.marcarSalida(turno.id, gps.pos.lat, gps.pos.lng, fotoFile, observacion),
    onSuccess: () => {
      toast.success('✅ Salida registrada')
      setPaso('inicio')
      setFotoFile(null); setFotoPreview(null)
      onMarcado()
    },
    onError: (e) => toast.error(e.response?.data?.detail || e.message),
  })

  const hayEntrada = !!asistencia?.entrada
  const haySalida  = !!asistencia?.salida
  const requiereFoto = config?.requiere_foto ?? true
  const reconFacial  = config?.reconocimiento_facial ?? false

  const iniciarMarcaje = (tipo) => {
    if (!gps.pos) { toast.error('Esperando señal GPS…'); return }
    if (requiereFoto) {
      setPaso(tipo === 'entrada' ? 'camara_entrada' : 'camara_salida')
    } else {
      if (tipo === 'entrada') entrada()
      else setPaso('obs')
    }
  }

  const onFotoCapturada = (file, preview) => {
    setFotoFile(file)
    setFotoPreview(preview)
    if (paso === 'camara_entrada') {
      setPaso('confirmar_entrada')
    } else {
      setPaso('obs')
    }
  }

  if (paso === 'camara_entrada' || paso === 'camara_salida') {
    return (
      <div className="card p-5">
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Camera className="w-5 h-5 text-brand" />
          Selfie de {paso === 'camara_entrada' ? 'entrada' : 'salida'}
        </h3>
        <CamaraSelfi
          onFoto={onFotoCapturada}
          onCancelar={() => setPaso('inicio')}
          reconocimientoFacial={reconFacial}
        />
      </div>
    )
  }

  if (paso === 'obs') {
    return (
      <div className="card p-5 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          Confirmar salida
        </h3>
        {fotoPreview && (
          <img src={fotoPreview} alt="Selfie" className="w-24 h-24 object-cover rounded-xl mx-auto" />
        )}
        <div>
          <label className="label">Observación (opcional)</label>
          <textarea
            className="input-field resize-none"
            rows={3}
            placeholder="Novedades del turno, incidencias, estado del lugar…"
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
          />
        </div>
        {gps.pos && (
          <p className="text-[#94a3b8] text-xs flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            GPS: {gps.pos.lat.toFixed(5)}, {gps.pos.lng.toFixed(5)} (±{Math.round(gps.pos.acc)}m)
          </p>
        )}
        <div className="flex gap-3">
          <button onClick={() => setPaso('inicio')} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => salida()}
            disabled={cargandoSalida || !gps.pos}
            className="btn-primary flex-1"
          >
            {cargandoSalida ? 'Registrando…' : 'Confirmar salida'}
          </button>
        </div>
      </div>
    )
  }

  if (paso === 'confirmar_entrada') {
    return (
      <div className="card p-5 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          Confirmar entrada
        </h3>
        {fotoPreview && (
          <img src={fotoPreview} alt="Selfie" className="w-32 h-32 object-cover rounded-xl mx-auto border-2 border-brand/40" />
        )}
        {gps.pos && (
          <p className="text-[#94a3b8] text-sm flex items-center gap-1 justify-center">
            <MapPin className="w-4 h-4 text-brand" />
            {gps.pos.lat.toFixed(5)}, {gps.pos.lng.toFixed(5)} (±{Math.round(gps.pos.acc)}m)
          </p>
        )}
        <div className="flex gap-3">
          <button onClick={() => setPaso('inicio')} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => entrada()}
            disabled={cargandoEntrada || !gps.pos}
            className="btn-primary flex-1"
          >
            {cargandoEntrada ? 'Registrando…' : '✅ Marcar entrada'}
          </button>
        </div>
      </div>
    )
  }

  // ── Vista principal de marcaje ─────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Estado GPS */}
      <div className={`card p-4 flex items-center gap-3 border-l-4 ${
        gps.pos ? 'border-l-green-500' : gps.error ? 'border-l-red-500' : 'border-l-yellow-500'
      }`}>
        <MapPin className={`w-5 h-5 flex-shrink-0 ${
          gps.pos ? 'text-green-400' : gps.error ? 'text-red-400' : 'text-yellow-400'
        }`} />
        <div className="flex-1 min-w-0">
          {gps.loading && <p className="text-[#94a3b8] text-sm">Obteniendo ubicación GPS…</p>}
          {gps.pos && (
            <p className="text-green-400 text-sm font-medium">
              GPS activo — precisión ±{Math.round(gps.pos.acc)}m
            </p>
          )}
          {gps.error && <p className="text-red-400 text-sm">{gps.error}</p>}
        </div>
        {(gps.error || (!gps.loading && !gps.pos)) && (
          <button onClick={gps.obtener} className="btn-secondary !py-1 !px-3 text-xs">
            Reintentar
          </button>
        )}
      </div>

      {/* Turno info */}
      <div className="card p-5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[#94a3b8] text-sm uppercase tracking-wide">Turno asignado</p>
          <span className={`text-xs px-2 py-1 rounded-full ${
            turno.estado === 'en_curso' ? 'bg-green-500/20 text-green-400' :
            turno.estado === 'programado' ? 'bg-blue-500/20 text-blue-400' :
            'bg-white/10 text-[#94a3b8]'
          }`}>{turno.estado}</span>
        </div>
        <p className="text-white font-bold text-lg">{turno.instalacion?.nombre || '—'}</p>
        <p className="text-[#94a3b8] text-sm">{turno.instalacion?.direccion || ''}</p>
        <div className="flex items-center gap-4 text-sm text-[#94a3b8] pt-1">
          <span>🕐 {fmtHora(turno.fecha_inicio)}</span>
          <span>→</span>
          <span>{fmtHora(turno.fecha_fin)}</span>
        </div>
      </div>

      {/* Estado asistencia actual */}
      {asistencia && (
        <div className="card p-4 space-y-2 border-l-4 border-l-brand">
          <p className="text-[#94a3b8] text-sm uppercase tracking-wide text-xs">Estado asistencia</p>
          <div className="flex items-center gap-3">
            <EstadoBadge estado={asistencia.estado} />
            {asistencia.minutos_retraso > 0 && (
              <span className="text-yellow-400 text-sm">
                {asistencia.minutos_retraso} min de retraso
              </span>
            )}
          </div>
          {asistencia.entrada && (
            <p className="text-white text-sm">
              Entrada: <span className="font-medium text-green-400">{fmtHora(asistencia.entrada)}</span>
            </p>
          )}
          {asistencia.salida && (
            <p className="text-white text-sm">
              Salida: <span className="font-medium text-brand">{fmtHora(asistencia.salida)}</span>
            </p>
          )}
          {asistencia.minutos_trabajados != null && (
            <p className="text-[#94a3b8] text-sm">
              Tiempo trabajado: <span className="text-white font-medium">{fmtMin(asistencia.minutos_trabajados)}</span>
            </p>
          )}
        </div>
      )}

      {/* Botones de marcaje */}
      {!haySalida && (
        <div className="grid grid-cols-1 gap-3">
          {!hayEntrada ? (
            <button
              onClick={() => iniciarMarcaje('entrada')}
              disabled={!gps.pos || gps.loading}
              className="btn-primary w-full text-lg py-5 disabled:opacity-50"
            >
              <CheckCircle2 className="w-6 h-6" />
              Marcar Entrada
              {requiereFoto && <Camera className="w-4 h-4 opacity-70" />}
            </button>
          ) : (
            <button
              onClick={() => iniciarMarcaje('salida')}
              disabled={!gps.pos || gps.loading}
              className="w-full text-lg py-5 inline-flex items-center justify-center gap-2
                         font-medium rounded-xl transition-all min-h-[44px]
                         bg-[#1e3a5f] border border-[#2d5490] text-white
                         hover:bg-[#2d5490] disabled:opacity-50"
            >
              <XCircle className="w-6 h-6 text-brand" />
              Marcar Salida
              {requiereFoto && <Camera className="w-4 h-4 opacity-70" />}
            </button>
          )}
        </div>
      )}

      {haySalida && (
        <div className="card p-5 text-center border-l-4 border-l-green-500">
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-2" />
          <p className="text-white font-semibold">Turno completado</p>
          <p className="text-[#94a3b8] text-sm mt-1">
            Has completado tu jornada de {fmtMin(asistencia?.minutos_trabajados)}
          </p>
        </div>
      )}

      {!requiereFoto && (
        <p className="text-[#94a3b8] text-xs text-center">
          Modo sin foto activado por el administrador
        </p>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE: TARJETA GUARDIA EN DASHBOARD LIVE
// ══════════════════════════════════════════════════════════════════════════════

function TarjetaGuardiaLive({ item, onAjuste }) {
  const [verFoto, setVerFoto] = useState(false)
  const s = ESTADO_STYLE[item.estado_asistencia] || ESTADO_STYLE.sin_marcar
  const IconEstado = s.icon

  return (
    <div className={`card p-4 space-y-3 ${
      item.estado_asistencia === 'falta'    ? 'border-l-4 border-l-red-500' :
      item.estado_asistencia === 'tardanza' ? 'border-l-4 border-l-yellow-500' :
      item.estado_asistencia === 'a_tiempo' ? 'border-l-4 border-l-green-500' :
      'border-l-4 border-l-[#2d5490]'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            item.estado_asistencia === 'a_tiempo'   ? 'bg-green-500/20' :
            item.estado_asistencia === 'tardanza'   ? 'bg-yellow-500/20' :
            item.estado_asistencia === 'falta'      ? 'bg-red-500/20' :
            'bg-white/5'
          }`}>
            <IconEstado className={`w-5 h-5 ${
              item.estado_asistencia === 'a_tiempo'   ? 'text-green-400' :
              item.estado_asistencia === 'tardanza'   ? 'text-yellow-400' :
              item.estado_asistencia === 'falta'      ? 'text-red-400' :
              'text-[#94a3b8]'
            }`} />
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold truncate">
              {item.guardia_nombre} {item.guardia_apellido}
            </p>
            <p className="text-[#94a3b8] text-sm truncate">{item.instalacion_nombre}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <EstadoBadge estado={item.estado_asistencia} />
          {item.foto_entrada && (
            <button
              onClick={() => setVerFoto(true)}
              className="btn-ghost !p-2 !min-h-0"
              title="Ver selfie de entrada"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
          )}
          {item.asistencia_id && (
            <button
              onClick={() => onAjuste(item)}
              className="btn-ghost !p-2 !min-h-0"
              title="Ajuste manual"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-[#0f1929] rounded-xl p-2">
          <p className="text-[#94a3b8] text-xs">Turno</p>
          <p className="text-white text-xs font-medium">
            {fmtHora(item.fecha_inicio)} – {fmtHora(item.fecha_fin)}
          </p>
        </div>
        <div className="bg-[#0f1929] rounded-xl p-2">
          <p className="text-[#94a3b8] text-xs">Entrada</p>
          <p className={`text-xs font-medium ${item.entrada ? 'text-green-400' : 'text-[#94a3b8]'}`}>
            {fmtHora(item.entrada)}
          </p>
        </div>
        <div className="bg-[#0f1929] rounded-xl p-2">
          <p className="text-[#94a3b8] text-xs">Retraso</p>
          <p className={`text-xs font-medium ${item.minutos_retraso > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
            {item.minutos_retraso > 0 ? `${item.minutos_retraso}m` : '—'}
          </p>
        </div>
      </div>

      {/* Lightbox selfie */}
      {verFoto && item.foto_entrada && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setVerFoto(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 bg-black/40 rounded-xl text-white"
            onClick={() => setVerFoto(false)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={urlFoto(item.foto_entrada)}
            alt="Selfie entrada"
            className="max-w-sm w-full rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-4 text-white/60 text-sm">
            {item.guardia_nombre} {item.guardia_apellido} — selfie de entrada
          </p>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE: MODAL AJUSTE MANUAL
// ══════════════════════════════════════════════════════════════════════════════

function ModalAjuste({ item, onClose, onGuardado }) {
  const [form, setForm] = useState({
    estado: item.estado_asistencia || 'sin_marcar',
    observacion: '',
    entrada: item.entrada ? new Date(item.entrada).toISOString().slice(0, 16) : '',
    salida: '',
  })

  const { mutate, isPending } = useMutation({
    mutationFn: () => asistenciaService.ajusteManual(item.asistencia_id, {
      estado: form.estado,
      observacion: form.observacion || undefined,
      entrada: form.entrada ? new Date(form.entrada).toISOString() : undefined,
      salida: form.salida ? new Date(form.salida).toISOString() : undefined,
    }),
    onSuccess: () => {
      toast.success('Asistencia ajustada correctamente')
      onGuardado()
      onClose()
    },
    onError: (e) => toast.error(e.response?.data?.detail || e.message),
  })

  return (
    <div className="space-y-4">
      <div className="bg-[#0f1929] rounded-xl p-3 border border-white/5">
        <p className="text-white font-semibold">{item.guardia_nombre} {item.guardia_apellido}</p>
        <p className="text-[#94a3b8] text-sm">{item.instalacion_nombre}</p>
      </div>

      <div>
        <label className="label">Estado</label>
        <select className="input-field" value={form.estado}
          onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value }))}>
          <option value="a_tiempo">A tiempo</option>
          <option value="tardanza">Tardanza</option>
          <option value="falta">Falta</option>
          <option value="sin_marcar">Sin marcar</option>
        </select>
      </div>

      <div>
        <label className="label">Entrada (ajuste)</label>
        <input type="datetime-local" className="input-field" value={form.entrada}
          onChange={(e) => setForm((f) => ({ ...f, entrada: e.target.value }))} />
      </div>

      <div>
        <label className="label">Salida (ajuste)</label>
        <input type="datetime-local" className="input-field" value={form.salida}
          onChange={(e) => setForm((f) => ({ ...f, salida: e.target.value }))} />
      </div>

      <div>
        <label className="label">Motivo del ajuste</label>
        <textarea className="input-field resize-none" rows={3}
          placeholder="Explique el motivo del ajuste manual…"
          value={form.observacion}
          onChange={(e) => setForm((f) => ({ ...f, observacion: e.target.value }))} />
      </div>

      <div className="flex gap-3">
        <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button onClick={() => mutate()} disabled={isPending} className="btn-primary flex-1">
          {isPending ? 'Guardando…' : <><Save className="w-4 h-4" /> Guardar ajuste</>}
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE: CONFIGURACIÓN DEL SISTEMA
// ══════════════════════════════════════════════════════════════════════════════

function PanelConfig({ config, onActualizado }) {
  const [form, setForm] = useState({
    tolerancia_tardanza_min: config?.tolerancia_tardanza_min ?? 10,
    tolerancia_falta_min:    config?.tolerancia_falta_min    ?? 120,
    radio_geofence_metros:   config?.radio_geofence_metros   ?? 50,
    requiere_foto:           config?.requiere_foto           ?? true,
    reconocimiento_facial:   config?.reconocimiento_facial   ?? false,
  })

  const { mutate, isPending } = useMutation({
    mutationFn: () => asistenciaService.actualizarConfig(form),
    onSuccess: () => { toast.success('Configuración actualizada'); onActualizado() },
    onError: (e) => toast.error(e.response?.data?.detail || e.message),
  })

  return (
    <div className="space-y-5">
      <p className="text-[#94a3b8] text-sm">
        Estos parámetros aplican globalmente a todo el sistema de asistencia.
      </p>

      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="label">Tolerancia tardanza (min)</label>
          <input type="number" min={0} max={60} className="input-field"
            value={form.tolerancia_tardanza_min}
            onChange={(e) => setForm((f) => ({ ...f, tolerancia_tardanza_min: Number(e.target.value) }))} />
          <p className="text-[#94a3b8] text-xs mt-1">Minutos de gracia antes de marcar tardanza</p>
        </div>
        <div>
          <label className="label">Tolerancia falta (min)</label>
          <input type="number" min={30} max={480} className="input-field"
            value={form.tolerancia_falta_min}
            onChange={(e) => setForm((f) => ({ ...f, tolerancia_falta_min: Number(e.target.value) }))} />
          <p className="text-[#94a3b8] text-xs mt-1">Minutos sin marcar para considerar falta</p>
        </div>
        <div>
          <label className="label">Radio geofence (metros)</label>
          <input type="number" min={10} max={500} className="input-field"
            value={form.radio_geofence_metros}
            onChange={(e) => setForm((f) => ({ ...f, radio_geofence_metros: Number(e.target.value) }))} />
          <p className="text-[#94a3b8] text-xs mt-1">Radio máximo desde la instalación</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="card p-4 flex items-center gap-4 cursor-pointer hover:border-brand/50 transition-colors">
          <input type="checkbox" className="w-5 h-5 rounded accent-brand"
            checked={form.requiere_foto}
            onChange={(e) => setForm((f) => ({ ...f, requiere_foto: e.target.checked }))} />
          <div>
            <p className="text-white font-medium">Requerir selfie al marcar</p>
            <p className="text-[#94a3b8] text-xs">El guardia debe tomarse una foto al marcar entrada y salida</p>
          </div>
        </label>

        <label className="card p-4 flex items-center gap-4 cursor-pointer hover:border-brand/50 transition-colors">
          <input type="checkbox" className="w-5 h-5 rounded accent-brand"
            checked={form.reconocimiento_facial}
            onChange={(e) => setForm((f) => ({ ...f, reconocimiento_facial: e.target.checked }))} />
          <div>
            <p className="text-white font-medium">Reconocimiento facial (opcional)</p>
            <p className="text-[#94a3b8] text-xs">
              Detecta que hay un rostro humano en la selfie. Requiere conexión y modelos cargados.
            </p>
          </div>
        </label>
      </div>

      <button onClick={() => mutate()} disabled={isPending} className="btn-primary">
        {isPending ? 'Guardando…' : <><Save className="w-4 h-4" /> Guardar configuración</>}
      </button>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE: EXPORTACIÓN
// ══════════════════════════════════════════════════════════════════════════════

function PanelExportar({ instalaciones, guardias }) {
  const hoy = new Date().toISOString().slice(0, 10)
  const primerDiaMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString().slice(0, 10)

  const [form, setForm] = useState({
    fecha_inicio:   primerDiaMes,
    fecha_fin:      hoy,
    guardia_id:     '',
    instalacion_id: '',
    formato:        'excel',
  })
  const [descargando, setDescargando] = useState(false)

  const exportar = async () => {
    if (!form.fecha_inicio || !form.fecha_fin) {
      return toast.error('Seleccione rango de fechas')
    }
    setDescargando(true)
    try {
      const params = {
        fecha_inicio:   form.fecha_inicio,
        fecha_fin:      form.fecha_fin,
        formato:        form.formato,
        ...(form.guardia_id     && { guardia_id:     Number(form.guardia_id) }),
        ...(form.instalacion_id && { instalacion_id: Number(form.instalacion_id) }),
      }
      const res = await asistenciaService.exportar(params)
      const ext  = form.formato === 'excel' ? 'xlsx' : 'csv'
      const url  = URL.createObjectURL(res.data)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `asistencias_${form.fecha_inicio}_${form.fecha_fin}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Reporte descargado')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Error al exportar')
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-[#94a3b8] text-sm">
        Genera el reporte de asistencia en Excel (con colores por estado) o CSV (compatible con cualquier software de nómina).
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Fecha inicio *</label>
          <input type="date" className="input-field" value={form.fecha_inicio}
            onChange={(e) => setForm((f) => ({ ...f, fecha_inicio: e.target.value }))} />
        </div>
        <div>
          <label className="label">Fecha fin *</label>
          <input type="date" className="input-field" value={form.fecha_fin}
            onChange={(e) => setForm((f) => ({ ...f, fecha_fin: e.target.value }))} />
        </div>
        <div>
          <label className="label">Guardia (opcional)</label>
          <select className="input-field" value={form.guardia_id}
            onChange={(e) => setForm((f) => ({ ...f, guardia_id: e.target.value }))}>
            <option value="">Todos los guardias</option>
            {guardias?.map((g) => (
              <option key={g.id} value={g.id}>{g.nombre} {g.apellido}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Instalación (opcional)</label>
          <select className="input-field" value={form.instalacion_id}
            onChange={(e) => setForm((f) => ({ ...f, instalacion_id: e.target.value }))}>
            <option value="">Todas las instalaciones</option>
            {instalaciones?.map((i) => (
              <option key={i.id} value={i.id}>{i.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Formato de exportación</label>
        <div className="grid grid-cols-2 gap-3">
          {[
            { val: 'excel', label: '📊 Excel (.xlsx)', desc: 'Con colores y hoja de resumen' },
            { val: 'csv',   label: '📄 CSV (.csv)',    desc: 'Compatible con cualquier software' },
          ].map((op) => (
            <label key={op.val} className={`card p-4 cursor-pointer transition-colors hover:border-brand/50 ${
              form.formato === op.val ? 'border-brand bg-brand/5' : ''
            }`}>
              <input type="radio" name="formato" value={op.val} className="hidden"
                checked={form.formato === op.val}
                onChange={() => setForm((f) => ({ ...f, formato: op.val }))} />
              <p className="text-white font-medium">{op.label}</p>
              <p className="text-[#94a3b8] text-xs mt-1">{op.desc}</p>
            </label>
          ))}
        </div>
      </div>

      <button onClick={exportar} disabled={descargando} className="btn-primary w-full sm:w-auto">
        {descargando
          ? <><Spinner className="w-4 h-4" /> Generando…</>
          : <><Download className="w-5 h-5" /> Descargar reporte</>
        }
      </button>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

export default function AsistenciasPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const isAdmin = ['admin', 'supervisor'].includes(user?.rol)

  // tabs admin: live | historial | exportar | config
  const [tabAdmin, setTabAdmin] = useState('live')
  const [ajusteItem, setAjusteItem] = useState(null)

  // Filtros dashboard live
  const [fechaLive, setFechaLive]           = useState(new Date().toISOString().slice(0, 10))
  const [instalacionLive, setInstalacionLive] = useState('')

  // ── Datos base ─────────────────────────────────────────────────────────────
  const { data: instalaciones } = useQuery({
    queryKey: ['instalaciones'],
    queryFn: () => seguridadService.listarInstalaciones().then((r) => r.data),
    staleTime: 60_000,
    retry: false,
  })

  const { data: guardias } = useQuery({
    queryKey: ['guardias-activos'],
    queryFn: () => seguridadService.listarGuardias({ activo: true }).then((r) => r.data),
    staleTime: 60_000,
    enabled: isAdmin,
    retry: false,
  })

  // ── Turno activo del guardia ───────────────────────────────────────────────
  const { data: turnoActivo, isLoading: loadTurno, isError: turnoError, error: turnoErrorObj } = useQuery({
    queryKey: ['mi-turno'],
    queryFn: () => seguridadService.miTurnoActivo()
      .then((r) => r.data)
      .catch((err) => err.response?.status === 404 ? null : Promise.reject(err)),
    enabled: !isAdmin,
    refetchInterval: 60_000,
    retry: false,
  })

  const { data: miAsistencia, refetch: refetchAsistencia, isError: asistenciaError } = useQuery({
    queryKey: ['mi-asistencia'],
    queryFn: () => asistenciaService.miAsistencia().then((r) => r.data),
    enabled: !isAdmin,
    refetchInterval: 30_000,
    retry: false,
  })

  // ── Dashboard live (polling 30s) ───────────────────────────────────────────
  const { data: liveData, isLoading: loadLive, dataUpdatedAt, isError: liveError } = useQuery({
    queryKey: ['asistencia-live', fechaLive, instalacionLive],
    queryFn: () => asistenciaService.dashboardLive({
      fecha: fechaLive,
      ...(instalacionLive && { instalacion_id: Number(instalacionLive) }),
    }).then((r) => r.data),
    enabled: isAdmin && tabAdmin === 'live',
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  })

  // ── Estadísticas para live ─────────────────────────────────────────────────
  const { data: statsLive } = useQuery({
    queryKey: ['asistencia-stats-live', fechaLive],
    queryFn: () => asistenciaService.estadisticas({
      fecha_inicio: fechaLive,
      fecha_fin: fechaLive,
    }).then((r) => r.data),
    enabled: isAdmin && tabAdmin === 'live',
    refetchInterval: 30_000,
    retry: false,
  })

  // ── Config ─────────────────────────────────────────────────────────────────
  const { data: config, refetch: refetchConfig, isError: configError } = useQuery({
    queryKey: ['asistencia-config'],
    queryFn: () => asistenciaService.obtenerConfig().then((r) => r.data),
    staleTime: 60_000,
    retry: false,
  })

  // ══════════════════════════════════════════════════════════════════════════
  // VISTA GUARDIA
  // ══════════════════════════════════════════════════════════════════════════
  if (!isAdmin) {
    return (
      <ErrorBoundary>
        <div className="max-w-lg mx-auto space-y-5 animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand/20 rounded-xl flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Asistencia</h1>
              <p className="text-[#94a3b8] text-sm">Marque su entrada y salida del turno</p>
            </div>
          </div>

          {turnoError ? (
            <EmptyState icon={Clock} title="Error al obtener turno" description={turnoErrorObj?.message || 'Intenta recargar la página.'} />
          ) : loadTurno ? (
            <Spinner />
          ) : !turnoActivo ? (
            <EmptyState
              icon={Clock}
              title="Sin turno activo"
              description="No tienes un turno asignado para marcar asistencia en este momento."
            />
          ) : (
            <PanelMarcaje
              turno={turnoActivo}
              asistencia={miAsistencia}
              onMarcado={() => {
                refetchAsistencia()
                qc.invalidateQueries({ queryKey: ['mi-turno'] })
              }}
            />
          )}

          {/* Historial reciente */}
          <HistorialGuardia />
        </div>
      </ErrorBoundary>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VISTA ADMIN / SUPERVISOR
  // ══════════════════════════════════════════════════════════════════════════
  const tabs = [
    { id: 'live',     label: 'En vivo',      icon: RefreshCw },
    { id: 'historial',label: 'Historial',    icon: ClipboardList },
    { id: 'exportar', label: 'Exportar',     icon: Download },
    { id: 'config',   label: 'Configuración',icon: Settings },
  ]

  return (
    <ErrorBoundary>
      <div className="max-w-5xl mx-auto space-y-5 animate-slide-up">

      {/* Modal ajuste manual */}
      <Modal
        open={!!ajusteItem}
        onClose={() => setAjusteItem(null)}
        title="Ajuste manual de asistencia"
        size="md"
      >
        {ajusteItem && (
          <ModalAjuste
            item={ajusteItem}
            onClose={() => setAjusteItem(null)}
            onGuardado={() => {
              qc.invalidateQueries({ queryKey: ['asistencia-live'] })
              qc.invalidateQueries({ queryKey: ['asistencia-historial'] })
            }}
          />
        )}
      </Modal>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand/20 rounded-xl flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Asistencias</h1>
            <p className="text-[#94a3b8] text-sm">Control de entrada/salida y reportes de nómina</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTabAdmin(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                tabAdmin === t.id
                  ? 'bg-brand text-white'
                  : 'bg-white/5 text-[#94a3b8] hover:bg-white/10'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── TAB: EN VIVO ───────────────────────────────────────────────────── */}
      {tabAdmin === 'live' && (
        <div className="space-y-5">

          {/* Filtros */}
          <div className="flex flex-wrap gap-3 items-center">
            <input type="date" className="input-field !w-auto !min-h-0 py-2 text-sm"
              value={fechaLive}
              onChange={(e) => setFechaLive(e.target.value)} />
            <select className="input-field !w-auto !min-h-0 py-2 text-sm"
              value={instalacionLive}
              onChange={(e) => setInstalacionLive(e.target.value)}>
              <option value="">Todas las instalaciones</option>
              {instalaciones?.map((i) => (
                <option key={i.id} value={i.id}>{i.nombre}</option>
              ))}
            </select>
            {dataUpdatedAt > 0 && (
              <span className="text-[#94a3b8] text-xs ml-auto">
                Actualizado: {new Date(dataUpdatedAt).toLocaleTimeString('es-CL')}
                <span className="ml-1 text-[#475569]">(auto 30s)</span>
              </span>
            )}
          </div>

          {/* Tarjetas estadísticas */}
          {statsLive && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'A tiempo',   val: statsLive.a_tiempo,   color: 'bg-green-500/20 text-green-400',  icon: UserCheck },
                { label: 'Tardanzas',  val: statsLive.tardanzas,  color: 'bg-yellow-500/20 text-yellow-400',icon: Timer },
                { label: 'Faltas',     val: statsLive.faltas,     color: 'bg-red-500/20 text-red-400',      icon: UserX },
                { label: 'Sin marcar', val: statsLive.sin_marcar, color: 'bg-white/5 text-[#94a3b8]',       icon: Clock },
              ].map((s) => {
                const Icon = s.icon
                return (
                  <div key={s.label} className="card p-4 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[#94a3b8] text-xs">{s.label}</p>
                      <p className="text-white text-xl font-bold">{s.val ?? '—'}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Lista en vivo */}
          {loadLive ? (
            <Spinner />
          ) : !liveData?.length ? (
            <EmptyState
              icon={Users}
              title="Sin turnos para esta fecha"
              description="No hay turnos programados para el día seleccionado."
            />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {liveData.map((item) => (
                <TarjetaGuardiaLive
                  key={item.turno_id}
                  item={item}
                  onAjuste={setAjusteItem}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: HISTORIAL ─────────────────────────────────────────────────── */}
      {tabAdmin === 'historial' && (
        <HistorialAdmin
          instalaciones={instalaciones}
          guardias={guardias}
          onAjuste={setAjusteItem}
        />
      )}

      {/* ── TAB: EXPORTAR ──────────────────────────────────────────────────── */}
      {tabAdmin === 'exportar' && (
        <div className="card p-6">
          <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
            <Download className="w-5 h-5 text-brand" /> Exportar reporte de nómina
          </h2>
          <PanelExportar instalaciones={instalaciones} guardias={guardias} />
        </div>
      )}

      {/* ── TAB: CONFIGURACIÓN ─────────────────────────────────────────────── */}
      {tabAdmin === 'config' && (
        <div className="card p-6">
          <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5 text-brand" /> Configuración del sistema
          </h2>
          <PanelConfig config={config} onActualizado={refetchConfig} />
        </div>
      )}
    </div>
    </ErrorBoundary>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTE: Historial del guardia (vista guardia)
// ══════════════════════════════════════════════════════════════════════════════

function HistorialGuardia() {
  const { data, isLoading } = useQuery({
    queryKey: ['mi-historial-asistencia'],
    queryFn: () => asistenciaService.miHistorial({ limit: 10 }).then((r) => r.data),
    staleTime: 30_000,
  })

  if (isLoading) return <Spinner />
  if (!data?.length) return null

  return (
    <div className="card p-5 space-y-3">
      <h3 className="text-white font-semibold flex items-center gap-2">
        <Clock className="w-4 h-4 text-brand" /> Historial reciente
      </h3>
      <div className="space-y-2">
        {data.map((a) => (
          <div key={a.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
            <EstadoBadge estado={a.estado} />
            <div className="flex-1 min-w-0 text-sm">
              <p className="text-white">{fmtHora(a.entrada)} → {fmtHora(a.salida)}</p>
              <p className="text-[#94a3b8] text-xs">{fmt(a.entrada, { day:'2-digit', month:'short', year:'numeric' })}</p>
            </div>
            {a.minutos_trabajados != null && (
              <span className="text-[#94a3b8] text-xs flex-shrink-0">{fmtMin(a.minutos_trabajados)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTE: Historial admin con filtros
// ══════════════════════════════════════════════════════════════════════════════

function HistorialAdmin({ instalaciones, guardias, onAjuste }) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [filtros, setFiltros] = useState({
    fecha_inicio: hoy, fecha_fin: hoy,
    guardia_id: '', instalacion_id: '', estado: '',
    skip: 0, limit: 50,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['asistencia-historial', filtros],
    queryFn: () => asistenciaService.listar({
      ...filtros,
      guardia_id:     filtros.guardia_id     || undefined,
      instalacion_id: filtros.instalacion_id || undefined,
      estado:         filtros.estado         || undefined,
    }).then((r) => r.data),
    staleTime: 20_000,
  })

  const set = (k, v) => setFiltros((f) => ({ ...f, [k]: v, skip: 0 }))

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="card p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div>
          <label className="label text-xs">Desde</label>
          <input type="date" className="input-field !min-h-0 py-2 text-sm"
            value={filtros.fecha_inicio} onChange={(e) => set('fecha_inicio', e.target.value)} />
        </div>
        <div>
          <label className="label text-xs">Hasta</label>
          <input type="date" className="input-field !min-h-0 py-2 text-sm"
            value={filtros.fecha_fin} onChange={(e) => set('fecha_fin', e.target.value)} />
        </div>
        <div>
          <label className="label text-xs">Guardia</label>
          <select className="input-field !min-h-0 py-2 text-sm"
            value={filtros.guardia_id} onChange={(e) => set('guardia_id', e.target.value)}>
            <option value="">Todos</option>
            {guardias?.map((g) => (
              <option key={g.id} value={g.id}>{g.nombre} {g.apellido}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">Instalación</label>
          <select className="input-field !min-h-0 py-2 text-sm"
            value={filtros.instalacion_id} onChange={(e) => set('instalacion_id', e.target.value)}>
            <option value="">Todas</option>
            {instalaciones?.map((i) => (
              <option key={i.id} value={i.id}>{i.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">Estado</label>
          <select className="input-field !min-h-0 py-2 text-sm"
            value={filtros.estado} onChange={(e) => set('estado', e.target.value)}>
            <option value="">Todos</option>
            <option value="a_tiempo">A tiempo</option>
            <option value="tardanza">Tardanza</option>
            <option value="falta">Falta</option>
            <option value="sin_marcar">Sin marcar</option>
          </select>
        </div>
      </div>

      {/* Tabla */}
      {isLoading ? <Spinner /> : !data?.length ? (
        <EmptyState icon={ClipboardList} title="Sin registros" description="No hay asistencias con los filtros seleccionados." />
      ) : (
        <div className="space-y-2">
          {data.map((a) => (
            <div key={a.id} className="card px-4 py-3 flex items-center gap-4">
              <EstadoBadge estado={a.estado} />
              <div className="flex-1 min-w-0 text-sm">
                <p className="text-white font-medium">
                  {fmt(a.entrada, { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
                <p className="text-[#94a3b8] text-xs">
                  Entrada: {fmtHora(a.entrada)} · Salida: {fmtHora(a.salida)} · {fmtMin(a.minutos_trabajados)}
                </p>
              </div>
              {a.minutos_retraso > 0 && (
                <span className="text-yellow-400 text-xs flex-shrink-0">+{a.minutos_retraso}m</span>
              )}
              <button
                onClick={() => onAjuste({ asistencia_id: a.id, estado_asistencia: a.estado, entrada: a.entrada })}
                className="btn-ghost !p-2 !min-h-0"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          ))}
          <div className="flex gap-3 justify-center pt-2">
            <button
              onClick={() => setFiltros((f) => ({ ...f, skip: Math.max(0, f.skip - f.limit) }))}
              disabled={filtros.skip === 0}
              className="btn-secondary disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              onClick={() => setFiltros((f) => ({ ...f, skip: f.skip + f.limit }))}
              disabled={data.length < filtros.limit}
              className="btn-secondary disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
