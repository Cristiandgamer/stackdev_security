/**
 * RondaPage.jsx — Página de ronda para el guardia
 *
 * Mapa Mapbox:
 *  - interactive: false  → los puntos nunca se mueven (mapa estático)
 *  - Colapso via max-height/overflow:hidden → el canvas SIEMPRE tiene
 *    dimensiones reales; Mapbox no pierde contexto WebGL al ocultar/mostrar
 *  - Marcadores como capas GeoJSON (circle + symbol) → renderizados en canvas
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MapPin, QrCode, CheckCircle2, Navigation, Clock,
  Loader2, WifiOff, ChevronDown, ChevronUp,
  AlertCircle, Play, Coffee, Trophy, RefreshCw, Map,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Html5Qrcode } from 'html5-qrcode'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { rondasService } from '../services/api'
import { Spinner, EmptyState } from '../components/index.jsx'

// Token a nivel de módulo — disponible antes de cualquier render
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// ── Helper: mensaje de error legible ─────────────────────────────────────────
function errMsg(e) {
  const detail = e?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map(d => d.msg).join(', ')
  return e?.message || 'Error inesperado'
}

// ── Hook GPS ──────────────────────────────────────────────────────────────────
function useGPS() {
  const [pos, setPos]         = useState(null)
  const [error, setError]     = useState(null)
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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }, [])

  useEffect(() => { obtener() }, [obtener])
  return { pos, error, loading, obtener }
}

// ── Mapa Mapbox estático ───────────────────────────────────────────────────────
//
// DECISIONES DE DISEÑO:
//
// 1. interactive: false → el usuario NO puede panear/zoomar.
//    Esto elimina el problema de "los puntos se mueven": al no poder mover el
//    mapa, los marcadores siempre están en el mismo lugar en pantalla.
//
// 2. Colapso con max-height + overflow:hidden (NO display:none):
//    El div del mapa SIEMPRE tiene height:320px real en el DOM.
//    display:none pone el div a 0×0 → Mapbox falla al renderizar tiles.
//    Con max-height:0 en el padre, el div está "clippeado" pero sigue
//    teniendo sus dimensiones reales → Mapbox renderiza correctamente.
//
// 3. Marcadores como capas GeoJSON (circle + symbol):
//    Renderizados directamente en el canvas WebGL como parte del mapa.
//    No son elementos DOM flotantes → no tienen lag visual.
//
function MapaRonda({ puntos, posGuardia }) {
  const mapContainer  = useRef(null)
  const mapRef        = useRef(null)
  const [mapLoaded, setMapLoaded]   = useState(false)
  const [expandido, setExpandido]   = useState(true)

  const sorted = [...puntos].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

  // ── Inicializar mapa (una sola vez al montar el componente) ───────────────
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style:     'mapbox://styles/mapbox/dark-v11',
      center:    sorted.length > 0
        ? [sorted[0].longitud, sorted[0].latitud]
        : [-70.6483, -33.4569], // Santiago como fallback
      zoom:      15,
      // ↓ CLAVE: deshabilita toda interacción → puntos nunca se mueven
      interactive:          false,
      attributionControl:   false,
      preserveDrawingBuffer: true, // Mejora compatibilidad en algunos móviles
    })

    map.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      'bottom-right',
    )

    map.on('load', () => setMapLoaded(true))
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      setMapLoaded(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Solo al montar — puntos ya existen porque MapaRonda solo renderiza cuando hay puntos

  // ── Actualizar capas GeoJSON cuando cambia el estado de los puntos ─────────
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || sorted.length === 0) return
    const map = mapRef.current

    const siguiente = sorted.find(p => !p.verificado)

    // Feature collection de puntos de control
    const features = sorted.map((p, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.longitud, p.latitud] },
      properties: {
        numero:      String(i + 1),
        nombre:      p.nombre,
        verificado:  p.verificado ? 1 : 0,
        esSiguiente: siguiente?.id === p.id ? 1 : 0,
        color: p.verificado
          ? '#22c55e'
          : siguiente?.id === p.id
            ? '#f59e0b'
            : '#3b82f6',
        radio: siguiente?.id === p.id ? 18 : 14,
      },
    }))

    const geoData  = { type: 'FeatureCollection', features }
    const lineData = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: sorted.map(p => [p.longitud, p.latitud]),
      },
    }

    // ── Ruta ────────────────────────────────────────────────────────────────
    if (map.getSource('ruta')) {
      map.getSource('ruta').setData(lineData)
    } else {
      map.addSource('ruta', { type: 'geojson', data: lineData })

      map.addLayer({
        id: 'ruta-sombra', type: 'line', source: 'ruta',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#000', 'line-width': 7, 'line-opacity': 0.2 },
      })
      map.addLayer({
        id: 'ruta-linea', type: 'line', source: 'ruta',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#3b82f6', 'line-width': 2.5, 'line-dasharray': [3, 2] },
      })
    }

    // ── Puntos: halo + círculo + número ─────────────────────────────────────
    if (map.getSource('puntos')) {
      // Solo actualizar datos — las expresiones ['get', 'color'] se aplican solas
      map.getSource('puntos').setData(geoData)
    } else {
      map.addSource('puntos', { type: 'geojson', data: geoData })

      // Halo (glow del siguiente punto)
      map.addLayer({
        id: 'puntos-halo', type: 'circle', source: 'puntos',
        paint: {
          'circle-radius': ['match', ['get', 'esSiguiente'], 1, 28, 20],
          'circle-color':  ['get', 'color'],
          'circle-opacity': 0.20,
          'circle-blur':    0.5,
        },
      })

      // Círculo principal
      map.addLayer({
        id: 'puntos-circulo', type: 'circle', source: 'puntos',
        paint: {
          'circle-radius':       ['get', 'radio'],
          'circle-color':        ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
        },
      })

      // Número encima del círculo
      map.addLayer({
        id: 'puntos-numero', type: 'symbol', source: 'puntos',
        layout: {
          'text-field':              ['get', 'numero'],
          'text-size':               ['match', ['get', 'esSiguiente'], 1, 15, 12],
          'text-font':               ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
          'text-anchor':             'center',
          'text-allow-overlap':      true,
          'text-ignore-placement':   true,
        },
        paint: {
          'text-color':       '#ffffff',
          'text-halo-color':  'rgba(0,0,0,0.4)',
          'text-halo-width':  0.5,
        },
      })
    }

    // ── Ajustar vista para mostrar todos los puntos ──────────────────────────
    if (sorted.length === 1) {
      map.flyTo({ center: [sorted[0].longitud, sorted[0].latitud], zoom: 18, duration: 800 })
    } else {
      const coords  = sorted.map(p => [p.longitud, p.latitud])
      const bounds  = coords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(coords[0], coords[0]),
      )
      map.fitBounds(bounds, { padding: 60, maxZoom: 18, duration: 800 })
    }
  }, [mapLoaded, puntos])

  // ── Posición del guardia ───────────────────────────────────────────────────
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !posGuardia) return
    const map = mapRef.current

    const data = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [posGuardia.lng, posGuardia.lat] },
      properties: {},
    }

    if (map.getSource('guardia')) {
      map.getSource('guardia').setData(data)
    } else {
      map.addSource('guardia', { type: 'geojson', data })
      map.addLayer({
        id: 'guardia-halo', type: 'circle', source: 'guardia',
        paint: { 'circle-radius': 14, 'circle-color': '#a855f7', 'circle-opacity': 0.25 },
      })
      map.addLayer({
        id: 'guardia-punto', type: 'circle', source: 'guardia',
        paint: {
          'circle-radius': 7, 'circle-color': '#a855f7',
          'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5,
        },
      })
    }
  }, [mapLoaded, posGuardia])

  if (sorted.length === 0) return null

  return (
    <div className="card overflow-hidden">
      {/* Cabecera con toggle ─────────────────────────────────────────────── */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpandido(v => !v)}
      >
        <div className="flex items-center gap-2">
          <Map className="w-4 h-4 text-brand" />
          <span className="text-white font-semibold text-sm">Mapa de ronda</span>
          <span className="text-[#94a3b8] text-xs">
            · {sorted.length} punto{sorted.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Leyenda desktop */}
          <div className="hidden sm:flex items-center gap-3 text-xs text-[#94a3b8]">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#f59e0b] inline-block" />Siguiente
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#22c55e] inline-block" />Verificado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#a855f7] inline-block" />Tú
            </span>
          </div>
          {expandido
            ? <ChevronUp className="w-4 h-4 text-[#94a3b8]" />
            : <ChevronDown className="w-4 h-4 text-[#94a3b8]" />
          }
        </div>
      </button>

      {/*
        ══════════════════════════════════════════════════════════════════════
        COLAPSO CON max-height (NO display:none ni conditional rendering)
        ──────────────────────────────────────────────────────────────────────
        El div del mapa (mapContainer) SIEMPRE tiene height:320px real en DOM.
        El PADRE usa max-height:0 + overflow:hidden para "clippear" visualmente.
        Así Mapbox NUNCA ve un contenedor de 0×0 → tiles cargan correctamente.
        ══════════════════════════════════════════════════════════════════════
      */}
      <div
        style={{
          maxHeight:  expandido ? '400px' : '0',
          overflow:   'hidden',
          transition: 'max-height 0.3s ease',
        }}
      >
        {/* Canvas del mapa — altura fija, SIEMPRE en DOM con dimensiones reales */}
        <div
          ref={mapContainer}
          style={{ height: '320px', width: '100%' }}
        />

        {/* Leyenda móvil */}
        <div className="flex sm:hidden items-center justify-center gap-4 px-4 py-2 border-t border-white/5 text-xs text-[#94a3b8]">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b] inline-block" />Siguiente
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e] inline-block" />Verificado
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#3b82f6] inline-block" />Pendiente
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#a855f7] inline-block" />Tú
          </span>
        </div>
      </div>
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
        <div
          className="h-full bg-brand rounded-full transition-all duration-1000"
          style={{ width: `${progreso}%` }}
        />
      </div>
      <p className="text-[#94a3b8] text-xs text-center">
        Usa este tiempo para reportar novedades o descansar
      </p>
    </div>
  )
}

// ── Escáner QR ────────────────────────────────────────────────────────────────
function QRScanner({ onResult, onClose }) {
  const scannerRef = useRef(null)
  const [error, setError]   = useState(null)
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
      () => {},
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
            <p className="text-[#94a3b8] text-sm">
              Apunte la cámara al código QR fijado en el punto de control
            </p>
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
    onSuccess: () => {
      toast.success(`✓ ${punto.nombre} verificado`)
      setExpandido(false)
      onVerificado()
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  const verificarGPS = () => {
    if (!gps.pos) { toast.error('Sin señal GPS. Espere o use QR.'); return }
    verificar({
      punto_control_id:    punto.id,
      turno_id:            turnoId,
      guardia_id:          guardiaId,
      ejecucion_id:        ejecucionId,
      metodo:              'gps',
      latitud_verificada:  gps.pos.lat,
      longitud_verificada: gps.pos.lng,
    })
  }

  const verificarQR = (codigo) => {
    setMostrarQR(false)
    verificar({
      punto_control_id: punto.id,
      turno_id:         turnoId,
      guardia_id:       guardiaId,
      ejecucion_id:     ejecucionId,
      metodo:           'qr',
      qr_escaneado:     codigo,
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
            {punto.descripcion && (
              <p className="text-[#94a3b8] text-xs truncate">{punto.descripcion}</p>
            )}
          </div>
          <span className="badge-green flex-shrink-0">Verificado</span>
        </div>
      </div>
    )
  }

  return (
    <>
      {mostrarQR && (
        <QRScanner onResult={verificarQR} onClose={() => setMostrarQR(false)} />
      )}

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
            {punto.descripcion && (
              <p className="text-[#94a3b8] text-xs mt-0.5 truncate">{punto.descripcion}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="badge-gray text-xs">Pendiente</span>
              <span className="text-[#475569] text-xs">Radio GPS: {radioGps}m</span>
            </div>
          </div>
          {expandido
            ? <ChevronUp className="w-5 h-5 text-[#94a3b8] flex-shrink-0" />
            : <ChevronDown className="w-5 h-5 text-[#94a3b8] flex-shrink-0" />
          }
        </button>

        {expandido && (
          <div className="px-4 pb-4 pt-1 border-t border-white/5 space-y-3 animate-slide-up">
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
              gps.pos   ? 'bg-green-500/10 text-green-400'  :
              gps.error ? 'bg-red-500/10 text-red-400'       :
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
          <span>Rondas completadas</span><span>{pct}%</span>
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
              <div
                key={i}
                className={`flex-1 h-2 rounded-full transition-all ${i < puntos_completados ? 'bg-brand' : 'bg-[#1e3a5f]'}`}
              />
            ))}
          </div>
        </div>
      )}

      {rondas_por_turno > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {Array.from({ length: rondas_por_turno }).map((_, i) => (
            <div
              key={i}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${
                i < rondas_completadas_turno
                  ? 'bg-green-500/20 text-green-400'
                  : i === rondas_completadas_turno
                    ? 'bg-brand/20 text-brand'
                    : 'bg-[#1e3a5f] text-[#475569]'
              }`}
            >
              {i < rondas_completadas_turno
                ? <CheckCircle2 className="w-3 h-3" />
                : <Clock className="w-3 h-3" />
              }
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
  const qc  = useQueryClient()
  const gps = useGPS()
  const [iniciandoRonda, setIniciandoRonda] = useState(false)
  const [descansando, setDescansando]       = useState(false)

  const { data: turno, isLoading, error: turnoError, refetch } = useQuery({
    queryKey: ['ronda-turno-activo'],
    queryFn:  () => rondasService.turnoActivo().then(r => r.data),
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

  // ── Estados de carga / error ──────────────────────────────────────────────

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
          description={
            noTurno
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

  // ── Render principal ──────────────────────────────────────────────────────
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
        gps.pos   ? 'border-green-500/30' :
        gps.error ? 'border-red-500/30'   :
                    'border-yellow-500/30'
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

      {/* ── Mapa: siempre visible cuando hay puntos ──────────────────────── */}
      {ejecucion?.puntos?.length > 0 && (
        <MapaRonda
          puntos={ejecucion.puntos}
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
              Has completado las {ejecucion.rondas_por_turno} ronda{ejecucion.rondas_por_turno !== 1 ? 's' : ''} del turno.
              Excelente trabajo.
            </p>
          </div>
        </>
      )}

      {/* ── En descanso entre rondas ─────────────────────────────────────── */}
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

      {/* ── Ronda pendiente (aún no iniciada) ────────────────────────────── */}
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
              <span className="text-[#94a3b8] text-sm">
                {ejecucion.puntos_completados}/{ejecucion.puntos_total}
              </span>
            </div>

            {ejecucion.puntos.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="Sin puntos configurados"
                description="El administrador aún no ha agregado puntos a esta ronda."
              />
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
          <p className="text-[#94a3b8] text-sm">
            La siguiente ronda estará disponible después del período de descanso.
          </p>
          <button onClick={() => refetch()} className="btn-secondary mx-auto flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />Actualizar
          </button>
        </div>
      )}
    </div>
  )
}

