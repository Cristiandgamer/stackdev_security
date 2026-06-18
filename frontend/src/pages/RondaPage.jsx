/**
 * RondaPage.jsx — Página de ronda para el guardia
 * Incluye mapa Mapbox con puntos numerados y ruta de patrullaje.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MapPin, QrCode, CheckCircle2, Navigation, Clock,
  Loader2, WifiOff, ShieldCheck, ChevronDown, ChevronUp,
  AlertCircle, Play, Coffee, Trophy, RefreshCw, Map,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Html5Qrcode } from 'html5-qrcode'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { rondasService } from '../services/api'
import { Spinner, EmptyState } from '../components/index.jsx'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// ── Helper: extrae mensaje de error legible ──────────────────────────────────
function errMsg(e) {
  const detail = e?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map(d => d.msg).join(', ')
  return e?.message || 'Error inesperado'
}

// ── Hook GPS ──────────────────────────────────────────────────────────────────
function useGPS() {
  const [pos, setPos] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const obtener = useCallback(() => {
    if (!navigator.geolocation) { setError('GPS no disponible en este dispositivo'); return }
    setLoading(true); setError(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy })
        setLoading(false)
      },
      (e) => {
        const msgs = {
          1: 'Permiso de ubicación denegado. Active el GPS en su navegador.',
          2: 'No se pudo obtener la ubicación. Intente al aire libre.',
          3: 'Tiempo de espera agotado. Intente nuevamente.',
        }
        setError(msgs[e.code] || 'Error GPS desconocido')
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [])

  useEffect(() => { obtener() }, [obtener])
  return { pos, error, loading, obtener }
}

// ── Mapa Mapbox con puntos numerados y ruta ───────────────────────────────────
function MapaRonda({ puntos, radioGps, posGuardia }) {
  const mapContainer = useRef(null)
  const mapRef       = useRef(null)
  const markersRef   = useRef([])
  const guardiaMarkerRef = useRef(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [expandido, setExpandido] = useState(true)

  const sorted = [...puntos].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

  // ── Inicializar mapa (sólo una vez) ────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || mapRef.current || sorted.length === 0) return

    mapRef.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [sorted[0].longitud, sorted[0].latitud],
      zoom: 17,
      attributionControl: false,
    })

    mapRef.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    mapRef.current.on('load', () => setMapLoaded(true))

    return () => {
      markersRef.current.forEach(m => m.remove())
      guardiaMarkerRef.current?.remove()
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted.length === 0])

  // ── Actualizar ruta y marcadores cuando cambia el estado de los puntos ─────
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || sorted.length === 0) return

    // ── Ruta (LineString) ─────────────────────────────────────────────────
    const coords = sorted.map(p => [p.longitud, p.latitud])
    // Cerrar la ruta visualmente si hay más de 2 puntos (línea de regreso)
    const routeData = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
    }

    if (mapRef.current.getSource('ruta')) {
      mapRef.current.getSource('ruta').setData(routeData)
    } else {
      mapRef.current.addSource('ruta', { type: 'geojson', data: routeData })

      // Sombra de la línea
      mapRef.current.addLayer({
        id: 'ruta-shadow',
        type: 'line',
        source: 'ruta',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#000', 'line-width': 6, 'line-opacity': 0.3 },
      })

      // Línea principal punteada
      mapRef.current.addLayer({
        id: 'ruta-line',
        type: 'line',
        source: 'ruta',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#3b7dd8',
          'line-width': 3,
          'line-dasharray': [3, 2],
        },
      })
    }

    // ── Marcadores numerados ──────────────────────────────────────────────
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    sorted.forEach((punto, i) => {
      const verificado   = punto.verificado
      const esCurrent    = !verificado && sorted.find(p => !p.verificado)?.id === punto.id

      // Color: verde=verificado, amarillo=siguiente, azul=pendiente
      const bg = verificado ? '#22c55e' : esCurrent ? '#f59e0b' : '#3b7dd8'
      const size = esCurrent ? 36 : 30

      const el = document.createElement('div')
      el.style.cssText = `
        width:${size}px; height:${size}px; border-radius:50%;
        background:${bg}; border:2.5px solid white;
        display:flex; align-items:center; justify-content:center;
        color:white; font-weight:700; font-size:${esCurrent ? 15 : 13}px;
        cursor:pointer; box-shadow:0 2px 10px rgba(0,0,0,0.5);
        transition: all 0.3s ease;
        ${esCurrent ? 'animation: pulse-marker 2s infinite;' : ''}
      `
      el.textContent = i + 1

      // Tooltip al hacer clic
      const popup = new mapboxgl.Popup({ offset: 22, closeButton: false })
        .setHTML(`
          <div style="font-family:sans-serif; padding:4px 2px; min-width:120px">
            <strong style="display:flex;align-items:center;gap:4px">
              <span style="background:${bg};color:#fff;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:11px">${i+1}</span>
              ${punto.nombre}
            </strong>
            ${punto.descripcion ? `<p style="margin:4px 0 0;font-size:12px;color:#555">${punto.descripcion}</p>` : ''}
            <p style="margin:4px 0 0;font-size:11px;color:${verificado ? '#16a34a' : esCurrent ? '#d97706' : '#3b7dd8'}">
              ${verificado ? '✓ Verificado' : esCurrent ? '← Siguiente' : 'Pendiente'}
            </p>
          </div>
        `)

      const marker = new mapboxgl.Marker(el)
        .setLngLat([punto.longitud, punto.latitud])
        .setPopup(popup)
        .addTo(mapRef.current)

      markersRef.current.push(marker)
    })

    // ── Ajustar vista para mostrar todos los puntos ───────────────────────
    if (sorted.length === 1) {
      mapRef.current.flyTo({ center: [sorted[0].longitud, sorted[0].latitud], zoom: 18, duration: 800 })
    } else {
      const bounds = sorted.reduce(
        (b, p) => b.extend([p.longitud, p.latitud]),
        new mapboxgl.LngLatBounds(
          [sorted[0].longitud, sorted[0].latitud],
          [sorted[0].longitud, sorted[0].latitud],
        ),
      )
      mapRef.current.fitBounds(bounds, { padding: 56, maxZoom: 18, duration: 800 })
    }
  }, [mapLoaded, puntos])

  // ── Marcador del guardia (posición GPS real) ──────────────────────────────
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !posGuardia) return

    const el = document.createElement('div')
    el.style.cssText = `
      width:16px; height:16px; border-radius:50%;
      background:#a855f7; border:3px solid white;
      box-shadow:0 0 0 4px rgba(168,85,247,0.3);
    `

    if (guardiaMarkerRef.current) {
      guardiaMarkerRef.current.setLngLat([posGuardia.lng, posGuardia.lat])
    } else {
      guardiaMarkerRef.current = new mapboxgl.Marker(el)
        .setLngLat([posGuardia.lng, posGuardia.lat])
        .setPopup(new mapboxgl.Popup({ closeButton: false }).setHTML(
          '<div style="font-size:12px"><strong>Tu posición</strong></div>'
        ))
        .addTo(mapRef.current)
    }
  }, [mapLoaded, posGuardia])

  if (sorted.length === 0) return null

  return (
    <div className="card overflow-hidden">
      {/* Header del mapa */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpandido(v => !v)}
      >
        <div className="flex items-center gap-2">
          <Map className="w-4 h-4 text-brand" />
          <span className="text-white font-semibold text-sm">Mapa de ronda</span>
          <span className="text-[#94a3b8] text-xs">· {sorted.length} puntos</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Leyenda compacta */}
          <div className="hidden sm:flex items-center gap-3 text-xs text-[#94a3b8]">
            <span className="flex items-center gap-1">
              <span style={{background:'#f59e0b'}} className="w-3 h-3 rounded-full inline-block" />
              Siguiente
            </span>
            <span className="flex items-center gap-1">
              <span style={{background:'#22c55e'}} className="w-3 h-3 rounded-full inline-block" />
              Verificado
            </span>
            <span className="flex items-center gap-1">
              <span style={{background:'#a855f7'}} className="w-3 h-3 rounded-full inline-block" />
              Tu posición
            </span>
          </div>
          {expandido ? <ChevronUp className="w-4 h-4 text-[#94a3b8]" /> : <ChevronDown className="w-4 h-4 text-[#94a3b8]" />}
        </div>
      </button>

      {/* Contenedor del mapa */}
      {expandido && (
        <>
          <div
            ref={mapContainer}
            style={{ height: '320px', width: '100%' }}
          />
          {/* Leyenda móvil */}
          <div className="flex sm:hidden items-center justify-center gap-4 px-4 py-2 border-t border-white/5 text-xs text-[#94a3b8]">
            <span className="flex items-center gap-1"><span style={{background:'#f59e0b'}} className="w-2.5 h-2.5 rounded-full inline-block" />Siguiente</span>
            <span className="flex items-center gap-1"><span style={{background:'#22c55e'}} className="w-2.5 h-2.5 rounded-full inline-block" />Verificado</span>
            <span className="flex items-center gap-1"><span style={{background:'#3b7dd8'}} className="w-2.5 h-2.5 rounded-full inline-block" />Pendiente</span>
            <span className="flex items-center gap-1"><span style={{background:'#a855f7'}} className="w-2.5 h-2.5 rounded-full inline-block" />Tú</span>
          </div>
        </>
      )}

      {/* CSS para animación del marcador actual */}
      <style>{`
        @keyframes pulse-marker {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.6); }
          50%       { box-shadow: 0 0 0 8px rgba(245,158,11,0); }
        }
      `}</style>
    </div>
  )
}

// ── Cuenta regresiva ──────────────────────────────────────────────────────────
function CuentaRegresiva({ segundos, onDisponible }) {
  const [restantes, setRestantes] = useState(Math.max(0, segundos))

  useEffect(() => { setRestantes(Math.max(0, segundos)) }, [segundos])

  useEffect(() => {
    if (restantes <= 0) { onDisponible?.(); return }
    const id = setInterval(() => {
      setRestantes(prev => {
        if (prev <= 1) { clearInterval(id); onDisponible?.(); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [restantes, onDisponible])

  if (restantes <= 0) return null
  const m = Math.floor(restantes / 60)
  const s = restantes % 60
  const progreso = Math.max(0, Math.min(100, (1 - restantes / segundos) * 100))

  return (
    <div className="card p-5 space-y-3 border-l-4 border-l-[#2d5490]">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-[#1e3a5f] rounded-xl flex items-center justify-center flex-shrink-0">
          <Coffee className="w-5 h-5 text-[#94a3b8]" />
        </div>
        <div>
          <p className="text-white font-semibold">Tiempo de descanso</p>
          <p className="text-[#94a3b8] text-sm">La siguiente ronda estará disponible en:</p>
        </div>
      </div>
      <div className="text-center py-2">
        <p className="text-5xl font-bold text-white font-mono tabular-nums">
          {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
        </p>
      </div>
      <div className="h-2 bg-[#1e3a5f] rounded-full overflow-hidden">
        <div className="h-full bg-brand rounded-full transition-all duration-1000" style={{ width: `${progreso}%` }} />
      </div>
      <p className="text-[#94a3b8] text-xs text-center">Usa este tiempo para reportar novedades o descansar</p>
    </div>
  )
}

// ── Escáner QR ────────────────────────────────────────────────────────────────
function QRScanner({ onResult, onClose }) {
  const scannerRef = useRef(null)
  const [error, setError] = useState(null)
  const [activo, setActivo] = useState(false)

  useEffect(() => {
    const scanner = new Html5Qrcode('qr-reader-ronda')
    scannerRef.current = scanner
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (text) => {
        if (scanner.isScanning) scanner.pause(true)
        onResult(text)
        setTimeout(() => {
          if (scannerRef.current?.isScanning) scannerRef.current.stop().catch(() => {})
        }, 100)
      },
      () => {}
    )
      .then(() => setActivo(true))
      .catch(() => setError('No se puede acceder a la cámara. Permita el acceso en su navegador.'))

    return () => {
      const inst = scannerRef.current
      scannerRef.current = null
      if (inst?.isScanning) inst.stop().catch(() => {})
    }
  }, [onResult])

  const cerrar = async () => {
    if (scannerRef.current?.isScanning) {
      try { await scannerRef.current.stop() } catch {}
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-[#1e3a5f] flex-shrink-0">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-brand" />
          <span className="text-white font-semibold">Escanear QR de respaldo</span>
        </div>
        <button onClick={cerrar} className="btn-secondary !py-2 !px-4 text-sm">Cancelar</button>
      </div>
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
          <AlertCircle className="w-16 h-16 text-red-400" />
          <p className="text-white text-center">{error}</p>
          <button onClick={cerrar} className="btn-primary">Volver</button>
        </div>
      ) : (
        <>
          <div className="relative flex-1 flex items-center justify-center bg-black">
            <div id="qr-reader-ronda" className="w-full max-w-sm" />
            {activo && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-64 h-64 border-2 border-brand rounded-2xl" />
              </div>
            )}
          </div>
          <div className="px-4 py-4 bg-[#0f2440] text-center flex-shrink-0">
            <p className="text-[#94a3b8] text-sm">Apunte la cámara al código QR fijado en el punto de control</p>
          </div>
        </>
      )}
    </div>
  )
}

// ── Card de punto de control ──────────────────────────────────────────────────
function PuntoCard({ punto, turnoId, guardiaId, ejecucionId, gps, radioGps, onVerificado }) {
  const [expandido, setExpandido] = useState(false)
  const [mostrarQR, setMostrarQR] = useState(false)

  const { mutate: verificar, isPending } = useMutation({
    mutationFn: (payload) => rondasService.verificarPunto(payload),
    onSuccess: () => { toast.success(`✓ ${punto.nombre} verificado`); setExpandido(false); onVerificado() },
    onError: (e) => toast.error(errMsg(e)),
  })

  const verificarGPS = () => {
    if (!gps.pos) { toast.error('Sin señal GPS. Espere o use QR.'); return }
    verificar({
      punto_control_id: punto.id,
      turno_id: turnoId,
      guardia_id: guardiaId,
      ejecucion_id: ejecucionId,
      metodo: 'gps',
      latitud_verificada: gps.pos.lat,
      longitud_verificada: gps.pos.lng,
    })
  }

  const verificarQR = (codigo) => {
    setMostrarQR(false)
    verificar({
      punto_control_id: punto.id,
      turno_id: turnoId,
      guardia_id: guardiaId,
      ejecucion_id: ejecucionId,
      metodo: 'qr',
      qr_escaneado: codigo,
    })
  }

  if (punto.verificado) {
    return (
      <div className="card p-4 border-green-500/30 bg-green-500/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium truncate">{punto.nombre}</p>
            {punto.descripcion && <p className="text-[#94a3b8] text-xs truncate">{punto.descripcion}</p>}
          </div>
          <span className="badge-green flex-shrink-0">Verificado</span>
        </div>
      </div>
    )
  }

  return (
    <>
      {mostrarQR && <QRScanner onResult={verificarQR} onClose={() => setMostrarQR(false)} />}
      <div className="card overflow-hidden">
        <button
          className="w-full flex items-center gap-4 p-4 text-left"
          onClick={() => setExpandido(v => !v)}
          aria-expanded={expandido}
        >
          <div className="w-9 h-9 rounded-xl bg-[#1e3a5f] flex items-center justify-center flex-shrink-0 text-[#94a3b8] font-bold text-base">
            {(punto.orden ?? 0) + 1}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold truncate">{punto.nombre}</p>
            {punto.descripcion && <p className="text-[#94a3b8] text-xs mt-0.5 truncate">{punto.descripcion}</p>}
            <div className="flex items-center gap-2 mt-1">
              <span className="badge-gray text-xs">Pendiente</span>
              <span className="text-[#475569] text-xs">Radio GPS: {radioGps}m</span>
            </div>
          </div>
          {expandido ? <ChevronUp className="w-5 h-5 text-[#94a3b8] flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-[#94a3b8] flex-shrink-0" />}
        </button>

        {expandido && (
          <div className="px-4 pb-4 pt-1 border-t border-white/5 space-y-3 animate-slide-up">
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
              gps.pos ? 'bg-green-500/10 text-green-400' :
              gps.error ? 'bg-red-500/10 text-red-400' :
              'bg-yellow-500/10 text-yellow-400'
            }`}>
              {gps.loading ? (
                <><Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />Obteniendo GPS…</>
              ) : gps.pos ? (
                <><Navigation className="w-4 h-4 flex-shrink-0" />GPS activo · ±{Math.round(gps.pos.acc)}m precisión</>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 flex-shrink-0" />
                  {gps.error || 'Sin GPS'}
                  <button onClick={gps.obtener} className="ml-auto text-xs underline">Reintentar</button>
                </>
              )}
            </div>
            <p className="text-[#94a3b8] text-sm">
              Acércate al punto y pulsa <strong className="text-white">Verificar con GPS</strong>.
              Si el GPS no funciona, usa el <strong className="text-white">Código QR</strong> del punto.
            </p>
            <button
              onClick={verificarGPS}
              disabled={isPending || !gps.pos}
              className="btn-primary w-full !py-4 text-base disabled:opacity-40"
            >
              {isPending
                ? <><Loader2 className="w-5 h-5 animate-spin" />Verificando…</>
                : <><Navigation className="w-5 h-5" />Verificar con GPS</>
              }
            </button>
            <button
              onClick={() => setMostrarQR(true)}
              disabled={isPending}
              className="btn-secondary w-full !py-3 text-sm"
            >
              <QrCode className="w-4 h-4" />
              Usar código QR (respaldo)
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Barra de progreso del turno ───────────────────────────────────────────────
function ProgresoTurno({ rondas_completadas_turno, rondas_por_turno, puntos_completados, puntos_total }) {
  const pct = rondas_por_turno > 0
    ? Math.round((rondas_completadas_turno / rondas_por_turno) * 100)
    : 0

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-white font-semibold">Progreso del turno</p>
        <span className={`font-bold ${rondas_completadas_turno >= rondas_por_turno ? 'text-green-400' : 'text-brand'}`}>
          {rondas_completadas_turno}/{rondas_por_turno} rondas
        </span>
      </div>
      <div>
        <div className="flex justify-between text-xs text-[#94a3b8] mb-1">
          <span>Rondas completadas</span>
          <span>{pct}%</span>
        </div>
        <div className="h-3 bg-[#0f1929] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-green-500' : 'bg-brand'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {puntos_total > 0 && (
        <div>
          <div className="flex justify-between text-xs text-[#94a3b8] mb-1">
            <span>Puntos en ronda actual</span>
            <span>{puntos_completados}/{puntos_total}</span>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: puntos_total }).map((_, i) => (
              <div key={i} className={`flex-1 h-2 rounded-full transition-all ${i < puntos_completados ? 'bg-brand' : 'bg-[#1e3a5f]'}`} />
            ))}
          </div>
        </div>
      )}
      {rondas_por_turno > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {Array.from({ length: rondas_por_turno }).map((_, i) => (
            <div key={i} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${
              i < rondas_completadas_turno
                ? 'bg-green-500/20 text-green-400'
                : i === rondas_completadas_turno
                  ? 'bg-brand/20 text-brand'
                  : 'bg-[#1e3a5f] text-[#475569]'
            }`}>
              {i < rondas_completadas_turno ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
              R{i + 1}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function RondaPage() {
  const qc = useQueryClient()
  const gps = useGPS()
  const [iniciandoRonda, setIniciandoRonda] = useState(false)
  const [descansando, setDescansando] = useState(false)

  const { data: turno, isLoading, error: turnoError, refetch } = useQuery({
    queryKey: ['ronda-turno-activo'],
    queryFn: () => rondasService.turnoActivo().then(r => r.data),
    refetchInterval: 30_000,
    retry: (count, err) => {
      if (err?.response?.status === 404) return false
      return count < 2
    },
  })

  const ejecucion = turno?.ejecucion_activa

  useEffect(() => {
    if (!ejecucion) return
    const seg = ejecucion.segundos_para_proxima
    setDescansando(typeof seg === 'number' && seg > 0)
  }, [ejecucion])

  const handleIniciarRonda = async () => {
    setIniciandoRonda(true)
    try {
      await rondasService.iniciarRonda()
      toast.success('¡Ronda iniciada! Dirígete al primer punto.')
      qc.invalidateQueries({ queryKey: ['ronda-turno-activo'] })
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setIniciandoRonda(false)
    }
  }

  const onPuntoVerificado = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ronda-turno-activo'] })
  }, [qc])

  // ── Estados de carga / error ─────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto flex justify-center py-20 animate-slide-up">
        <Spinner />
      </div>
    )
  }

  if (turnoError || !turno) {
    const noTurno = turnoError?.response?.status === 404 || !turno
    return (
      <div className="max-w-2xl mx-auto animate-slide-up">
        <EmptyState
          icon={Clock}
          title={noTurno ? 'Sin turno activo' : 'Error al cargar'}
          description={noTurno
            ? 'No tienes un turno asignado para este momento. Contacta a tu supervisor.'
            : errMsg(turnoError) || 'Intenta recargar la página.'
          }
        />
        <button onClick={() => refetch()} className="btn-secondary mx-auto mt-4 flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />Reintentar
        </button>
      </div>
    )
  }

  if (!turno.ronda_id) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 animate-slide-up">
        <div className="card p-6">
          <p className="text-white font-bold text-xl mb-1">Turno activo</p>
          <p className="text-[#94a3b8]">{turno.instalacion_nombre}</p>
          <p className="text-[#94a3b8] text-sm mt-1">
            {new Date(turno.fecha_inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
            {' — '}
            {new Date(turno.fecha_fin).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <EmptyState
          icon={MapPin}
          title="Sin ronda configurada"
          description="Este turno no tiene una ronda asignada. Pide a tu supervisor que configure una ronda con puntos de control."
        />
      </div>
    )
  }

  const todasCompletas = ejecucion?.rondas_completadas_turno >= ejecucion?.rondas_por_turno

  // ── Render principal ─────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-slide-up pb-6">

      {/* Header del turno */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[#94a3b8] text-xs uppercase tracking-wide">Turno activo</p>
            <h1 className="text-xl font-bold text-white mt-0.5">{turno.instalacion_nombre}</h1>
            {turno.instalacion_direccion && (
              <p className="text-[#94a3b8] text-sm">{turno.instalacion_direccion}</p>
            )}
            <p className="text-[#94a3b8] text-sm mt-1">
              {new Date(turno.fecha_inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
              {' — '}
              {new Date(turno.fecha_fin).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          {turno.ronda_nombre && (
            <span className="badge-blue flex-shrink-0">{turno.ronda_nombre}</span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-[#94a3b8]">
          <Navigation className="w-3.5 h-3.5 text-brand" />
          <span>Radio GPS: <strong className="text-white">{turno.radio_gps_metros}m</strong></span>
        </div>
      </div>

      {/* Estado GPS */}
      <div className={`card px-4 py-3 flex items-center gap-3 text-sm ${
        gps.pos ? 'border-green-500/30' : gps.error ? 'border-red-500/30' : 'border-yellow-500/30'
      }`}>
        {gps.loading ? (
          <><Loader2 className="w-4 h-4 animate-spin text-yellow-400 flex-shrink-0" /><span className="text-yellow-400">Obteniendo señal GPS…</span></>
        ) : gps.pos ? (
          <>
            <Navigation className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-green-400 font-medium">GPS activo</span>
            <span className="text-[#94a3b8]">· Precisión ±{Math.round(gps.pos.acc)}m</span>
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span className="text-red-400 flex-1 truncate">{gps.error || 'Sin GPS'}</span>
            <button onClick={gps.obtener} className="text-brand text-xs font-medium flex-shrink-0">Reintentar</button>
          </>
        )}
      </div>

      {/* ── Mapa: visible en todos los estados con ejecución activa ─────── */}
      {ejecucion && ejecucion.puntos?.length > 0 && (
        <MapaRonda
          puntos={ejecucion.puntos}
          radioGps={turno.radio_gps_metros}
          posGuardia={gps.pos}
        />
      )}

      {/* ── Todas las rondas completadas ─────────────────────────────────── */}
      {todasCompletas && (
        <>
          <ProgresoTurno
            rondas_completadas_turno={ejecucion.rondas_completadas_turno}
            rondas_por_turno={ejecucion.rondas_por_turno}
            puntos_completados={ejecucion.puntos_total}
            puntos_total={ejecucion.puntos_total}
          />
          <div className="card p-6 text-center border-green-500/30 bg-green-500/5 space-y-3">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
              <Trophy className="w-8 h-8 text-green-400" />
            </div>
            <p className="text-green-400 font-bold text-xl">¡Todas las rondas completadas!</p>
            <p className="text-[#94a3b8]">
              Has completado las {ejecucion.rondas_por_turno} ronda{ejecucion.rondas_por_turno !== 1 ? 's' : ''} del turno. Excelente trabajo.
            </p>
          </div>
        </>
      )}

      {/* ── En descanso entre rondas ──────────────────────────────────────── */}
      {!todasCompletas && ejecucion && descansando && (
        <>
          <ProgresoTurno
            rondas_completadas_turno={ejecucion.rondas_completadas_turno}
            rondas_por_turno={ejecucion.rondas_por_turno}
            puntos_completados={0}
            puntos_total={ejecucion.puntos_total}
          />
          <CuentaRegresiva
            segundos={ejecucion.segundos_para_proxima}
            onDisponible={() => {
              setDescansando(false)
              qc.invalidateQueries({ queryKey: ['ronda-turno-activo'] })
            }}
          />
        </>
      )}

      {/* ── Ronda pendiente (no iniciada) ─────────────────────────────────── */}
      {!todasCompletas && !descansando && ejecucion?.estado === 'pendiente' && (
        <>
          <ProgresoTurno
            rondas_completadas_turno={ejecucion.rondas_completadas_turno}
            rondas_por_turno={ejecucion.rondas_por_turno}
            puntos_completados={0}
            puntos_total={ejecucion.puntos_total}
          />
          <div className="card p-6 text-center space-y-4">
            <div className="w-16 h-16 bg-brand/20 rounded-full flex items-center justify-center mx-auto">
              <Play className="w-8 h-8 text-brand" />
            </div>
            <div>
              <p className="text-white font-bold text-lg">
                Ronda {ejecucion.numero_ronda} de {ejecucion.rondas_por_turno}
              </p>
              <p className="text-[#94a3b8] text-sm mt-1">
                {ejecucion.puntos_total} punto{ejecucion.puntos_total !== 1 ? 's' : ''} de control por verificar
              </p>
            </div>
            <button
              onClick={handleIniciarRonda}
              disabled={iniciandoRonda}
              className="btn-primary w-full !py-4 text-lg"
            >
              {iniciandoRonda
                ? <><Loader2 className="w-5 h-5 animate-spin" />Iniciando…</>
                : <><Play className="w-5 h-5" />Iniciar ronda {ejecucion.numero_ronda}</>
              }
            </button>
          </div>
        </>
      )}

      {/* ── Ronda en progreso: lista de puntos ───────────────────────────── */}
      {!todasCompletas && !descansando && ejecucion?.estado === 'en_progreso' && (
        <>
          <ProgresoTurno
            rondas_completadas_turno={ejecucion.rondas_completadas_turno}
            rondas_por_turno={ejecucion.rondas_por_turno}
            puntos_completados={ejecucion.puntos_completados}
            puntos_total={ejecucion.puntos_total}
          />
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-white font-semibold">
                Ronda {ejecucion.numero_ronda} — puntos de control
              </p>
              <span className="text-[#94a3b8] text-sm">{ejecucion.puntos_completados}/{ejecucion.puntos_total}</span>
            </div>
            {ejecucion.puntos.length === 0 ? (
              <EmptyState icon={MapPin} title="Sin puntos configurados" description="El administrador aún no ha agregado puntos a esta ronda." />
            ) : (
              ejecucion.puntos.map(punto => (
                <PuntoCard
                  key={punto.id}
                  punto={punto}
                  turnoId={turno.id}
                  guardiaId={turno.guardia_id}
                  ejecucionId={ejecucion.ejecucion_id}
                  gps={gps}
                  radioGps={turno.radio_gps_metros}
                  onVerificado={onPuntoVerificado}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* ── Sin ejecución disponible ──────────────────────────────────────── */}
      {!todasCompletas && !descansando && !ejecucion && (
        <div className="card p-6 text-center space-y-3">
          <Clock className="w-10 h-10 text-[#94a3b8] mx-auto" />
          <p className="text-white font-semibold">Ronda no disponible aún</p>
          <p className="text-[#94a3b8] text-sm">La siguiente ronda estará disponible después del período de descanso.</p>
          <button onClick={() => refetch()} className="btn-secondary mx-auto flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />Actualizar
          </button>
        </div>
      )}
    </div>
  )
}

