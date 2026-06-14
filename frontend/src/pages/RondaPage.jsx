/**
 * RondaPage.jsx — CORREGIDO v2
 *
 * BUGS RESUELTOS:
 * 1. Error 422: PuntoCard enviaba latitud/longitud en lugar de
 *    latitud_verificada/longitud_verificada. Además faltaba guardia_id.
 * 2. Pantalla negra: MapOverlay hacía setPuntos dentro del onClick del mapa
 *    creando una closure stale + el estado se perdía al montar/desmontar.
 * 3. Estado no actualiza en tiempo real: useEffect en RondaPage sobreescribía
 *    el estado local con datos del servidor cada vez que React Query hacía
 *    re-fetch, borrando las verificaciones recién hechas.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  MapPin, QrCode, CheckCircle2, AlertCircle, Navigation,
  ChevronDown, ChevronUp, Clock, Loader2, WifiOff, ShieldCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Html5Qrcode } from 'html5-qrcode'
import { seguridadService } from '../services/api'
import { Spinner, EmptyState } from '../components/index.jsx'

// ── Hook GPS ──────────────────────────────────────────────────────────────────
function useGPS() {
  const [pos, setPos] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const obtener = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Este dispositivo no soporta GPS')
      return
    }
    setLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy })
        setLoading(false)
      },
      (e) => {
        const msgs = {
          1: 'Permiso de ubicación bloqueado. Haga clic en el ícono junto a la URL y permita "Ubicación".',
          2: 'No se pudo obtener la ubicación. Intente al aire libre.',
          3: 'Tiempo de espera agotado. Intente al aire libre con buena cobertura.',
        }
        setError(msgs[e.code] || 'Error de GPS desconocido')
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [])

  useEffect(() => { obtener() }, [obtener])
  return { pos, error, loading, obtener }
}

// ── Badge de estado ───────────────────────────────────────────────────────────
function StatusBadge({ verificado }) {
  return verificado
    ? <span className="badge-green flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Verificado</span>
    : <span className="badge-gray">Pendiente</span>
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
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (text) => {
        if (scanner.isScanning) {
          scanner.pause(true)
        }
        onResult(text)
        setTimeout(() => {
          if (scannerRef.current?.isScanning) {
            scannerRef.current.stop()
              .then(() => setActivo(false))
              .catch(() => {})
          }
        }, 100)
      },
      () => {}
    )
      .then(() => setActivo(true))
      .catch(() => setError('No se puede acceder a la cámara. Permita el acceso en su navegador.'))

    return () => {
      const instance = scannerRef.current
      scannerRef.current = null
      if (instance?.isScanning) {
        instance.stop().catch(() => {})
      }
    }
  }, [onResult])

  const cerrarSeguro = async () => {
    if (scannerRef.current?.isScanning) {
      try {
        setActivo(false)
        await scannerRef.current.stop()
      } catch { }
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-[#1e3a5f] flex-shrink-0">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-brand" />
          <span className="text-white font-semibold text-lg">Escanear QR</span>
        </div>
        <button onClick={cerrarSeguro} className="btn-secondary !py-2 !px-4 text-base">
          Cancelar
        </button>
      </div>

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
          <AlertCircle className="w-16 h-16 text-red-400" />
          <p className="text-white text-center text-lg">{error}</p>
          <button onClick={cerrarSeguro} className="btn-primary">Volver</button>
        </div>
      ) : (
        <>
          <div className="relative flex-1 flex items-center justify-center bg-black">
            <div id="qr-reader-ronda" className="w-full max-w-sm" />
            {activo && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-60 h-60 border-2 border-brand rounded-2xl" />
              </div>
            )}
          </div>
          <div className="px-4 py-4 bg-[#0f2440] text-center flex-shrink-0">
            <p className="text-[#94a3b8] text-base">Apunte la cámara al código QR del punto de control</p>
          </div>
        </>
      )}
    </div>
  )
}

// ── Card de punto de control ──────────────────────────────────────────────────
/**
 * FIX #1 — Error 422:
 * El schema VerificacionCreate usa latitud_verificada / longitud_verificada
 * (no latitud / longitud). Además se requiere guardia_id que antes no se enviaba.
 * Lo obtenemos de turno.guardia_id pasado como prop.
 */
function PuntoCard({ punto, turnoId, guardiaId, gps, onVerificado }) {
  const [expandido, setExpandido] = useState(false)
  const [mostrarQR, setMostrarQR] = useState(false)

  const { mutate: verificar, isPending } = useMutation({
    mutationFn: (payload) => seguridadService.verificarPunto(payload),
    onSuccess: () => {
      toast.success(`✓ ${punto.nombre} verificado`)
      setExpandido(false)
      onVerificado()
    },
    onError: (err) => {
      // Mostrar detalle del error 422 si lo hay
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') {
        toast.error(detail)
      } else if (Array.isArray(detail)) {
        // Pydantic validation errors
        const msg = detail.map(d => `${d.loc?.join('.')}: ${d.msg}`).join('\n')
        toast.error(`Error de validación: ${msg}`)
      } else {
        toast.error(err.message || 'Error al verificar')
      }
    },
  })

  const verificarGPS = () => {
    if (!gps.pos) {
      toast.error('No hay señal GPS. Active la ubicación y espere.')
      return
    }
    // FIX: campos correctos para el schema del backend
    verificar({
      punto_control_id: punto.id,
      turno_id: turnoId,
      guardia_id: guardiaId,          // ← FIX: faltaba este campo
      metodo: 'gps',
      latitud_verificada: gps.pos.lat,  // ← FIX: nombre correcto
      longitud_verificada: gps.pos.lng, // ← FIX: nombre correcto
    })
  }

  const verificarQR = (codigo) => {
    setMostrarQR(false)
    verificar({
      punto_control_id: punto.id,
      turno_id: turnoId,
      guardia_id: guardiaId,          // ← FIX: faltaba este campo
      metodo: 'qr',
      qr_escaneado: codigo,
    })
  }

  return (
    <>
      {mostrarQR && (
        <QRScanner
          onResult={verificarQR}
          onClose={() => setMostrarQR(false)}
        />
      )}

      <div className={`card overflow-hidden transition-all ${punto.verificado ? 'border-green-500/40 bg-green-500/5' : ''}`}>
        <button
          className="w-full flex items-center gap-4 p-5 text-left"
          onClick={() => !punto.verificado && setExpandido(v => !v)}
          aria-expanded={expandido}
          disabled={punto.verificado}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-lg
            ${punto.verificado ? 'bg-green-500/20 text-green-400' : 'bg-[#2d5490]/40 text-[#94a3b8]'}`}>
            {punto.verificado ? <CheckCircle2 className="w-5 h-5" /> : (punto.orden ?? 0) + 1}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-lg truncate">{punto.nombre}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge verificado={punto.verificado} />
              <span className="text-[#94a3b8] text-xs">Radio {punto.radio_metros ?? 50}m</span>
            </div>
            {punto.descripcion && (
              <p className="text-[#94a3b8] text-sm mt-1 truncate">{punto.descripcion}</p>
            )}
          </div>

          {!punto.verificado && (
            expandido
              ? <ChevronUp className="w-5 h-5 text-[#94a3b8] flex-shrink-0" />
              : <ChevronDown className="w-5 h-5 text-[#94a3b8] flex-shrink-0" />
          )}
        </button>

        {/* Acciones de verificación */}
        {expandido && !punto.verificado && (
          <div className="px-5 pb-5 pt-1 border-t border-white/5 space-y-3 animate-slide-up">
            <p className="text-[#94a3b8] text-base mb-3">Seleccione el método de verificación:</p>

            {/* Estado GPS */}
            {gps.error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 rounded-xl px-3 py-2">
                <WifiOff className="w-4 h-4 flex-shrink-0" />
                <span>{gps.error}</span>
              </div>
            )}
            {gps.loading && (
              <div className="flex items-center gap-2 text-yellow-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Obteniendo señal GPS...</span>
              </div>
            )}
            {gps.pos && (
              <p className="text-[#94a3b8] text-sm text-center">
                Precisión GPS: ±{Math.round(gps.pos.accuracy)}m
              </p>
            )}

            <button
              onClick={verificarGPS}
              disabled={isPending || gps.loading || !gps.pos}
              className="btn-primary w-full text-lg py-4 disabled:opacity-50"
            >
              {isPending
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Verificando...</>
                : <><Navigation className="w-5 h-5" /> Verificar con GPS</>
              }
            </button>

            {!gps.pos && !gps.loading && (
              <button
                onClick={gps.obtener}
                className="btn-secondary w-full text-sm py-2"
              >
                Reintentar GPS
              </button>
            )}

            <button
              onClick={() => setMostrarQR(true)}
              disabled={isPending}
              className="btn-secondary w-full text-lg py-4"
            >
              {isPending
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Procesando...</>
                : <><QrCode className="w-5 h-5" /> Escanear Código QR</>
              }
            </button>
          </div>
        )}

        {punto.verificado && (
          <div className="px-5 pb-4 pt-1 border-t border-green-500/10">
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <ShieldCheck className="w-4 h-4" />
              <span className="font-medium">Punto verificado en esta ronda</span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Mapa de ronda ─────────────────────────────────────────────────────────────
/**
 * FIX #2 — Pantalla negra:
 * El problema era que setPuntos dentro del onClick del mapa creaba una closure
 * stale. Ahora usamos una ref para los puntos en el mapa y el estado se pasa
 * como prop desde el padre, evitando el setState asincrónico dentro de callbacks.
 *
 * FIX: también se agregó guardiaId a las verificaciones automáticas.
 */
function MapOverlay({ turno, puntos, guardiaId, onClose, onPuntoVerificado }) {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const markerRefs = useRef({})
  const userMarkerRef = useRef(null)
  const watchRef = useRef(null)
  // Ref para puntos — evita closure stale en callbacks del mapa
  const puntosRef = useRef(puntos)

  const [geoError, setGeoError] = useState(null)
  const [pos, setPosLocal] = useState(null)
  const [verificando, setVerificando] = useState(null) // id del punto verificándose
  const [autoMessage, setAutoMessage] = useState('')

  // Sincronizar ref cuando cambian los puntos (desde el padre)
  useEffect(() => {
    puntosRef.current = puntos
  }, [puntos])

  const { mutateAsync: verificarPunto } = useMutation({
    mutationFn: (payload) => seguridadService.verificarPunto(payload),
  })

  // ── Helpers geométricos ─────────────────────────────────────────────────
  const circleCoords = useCallback((lng, lat, meters, n = 36) => {
    const R = 6378137
    return Array.from({ length: n + 1 }, (_, i) => {
      const bearing = (i * 360 / n) * (Math.PI / 180)
      const lat2 = Math.asin(
        Math.sin(lat * Math.PI / 180) * Math.cos(meters / R) +
        Math.cos(lat * Math.PI / 180) * Math.sin(meters / R) * Math.cos(bearing)
      )
      const lng2 = lng * Math.PI / 180 + Math.atan2(
        Math.sin(bearing) * Math.sin(meters / R) * Math.cos(lat * Math.PI / 180),
        Math.cos(meters / R) - Math.sin(lat * Math.PI / 180) * Math.sin(lat2)
      )
      return [lng2 * 180 / Math.PI, lat2 * 180 / Math.PI]
    })
  }, [])

  const haversine = useCallback((lat1, lon1, lat2, lon2) => {
    const R = 6371000
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }, [])

  // ── Dibujar marcadores en el mapa ─────────────────────────────────────────
  const drawPoints = useCallback((map, puntosList) => {
    if (!map) return
    // Limpiar marcadores anteriores
    Object.values(markerRefs.current).forEach(m => m.remove())
    markerRefs.current = {}

    puntosList.forEach((punto) => {
      const el = document.createElement('div')
      el.style.cssText = `
        width:36px;height:36px;border-radius:50%;
        background:${punto.verificado ? '#22c55e' : '#f97316'};
        color:white;font-weight:700;font-size:14px;
        display:flex;align-items:center;justify-content:center;
        border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);
        cursor:default;transition:background 0.3s;
      `
      el.innerText = String((punto.orden ?? 0) + 1)

      const marker = new mapboxgl.Marker(el)
        .setLngLat([punto.longitud, punto.latitud])
        .setPopup(
          new mapboxgl.Popup({ offset: 20 }).setHTML(
            `<b>${punto.nombre}</b><br/>Radio: ${punto.radio_metros ?? 50}m<br/>${punto.verificado ? '✓ Verificado' : 'Pendiente'}`
          )
        )
        .addTo(map)

      markerRefs.current[punto.id] = marker

      // Dibujar círculo de radio
      const circleId = `circle-${punto.id}`
      const coords = circleCoords(punto.longitud, punto.latitud, punto.radio_metros ?? 50)
      const geojson = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } }

      if (map.getSource(circleId)) {
        map.getSource(circleId).setData(geojson)
        if (map.getLayer(circleId)) {
          map.setPaintProperty(circleId, 'fill-color', punto.verificado ? '#22c55e' : '#f97316')
        }
      } else if (map.isStyleLoaded()) {
        map.addSource(circleId, { type: 'geojson', data: geojson })
        map.addLayer({
          id: circleId,
          type: 'fill',
          source: circleId,
          paint: {
            'fill-color': punto.verificado ? '#22c55e' : '#f97316',
            'fill-opacity': 0.18,
          }
        })
      }
    })
  }, [circleCoords])

  // ── Re-dibujar cuando cambian los puntos ──────────────────────────────────
  useEffect(() => {
    if (mapRef.current && mapRef.current.isStyleLoaded()) {
      drawPoints(mapRef.current, puntos)
    }
  }, [puntos, drawPoints])

  // ── Verificación automática por GPS ───────────────────────────────────────
  const checkAutoVerify = useCallback(async (position) => {
    const { lat, lng } = position
    const puntosActuales = puntosRef.current
    const pendiente = puntosActuales.find(p => !p.verificado)
    if (!pendiente || verificando === pendiente.id) return

    const dist = haversine(lat, lng, pendiente.latitud, pendiente.longitud)
    const radio = (pendiente.radio_metros ?? 50) + 10 // margen de 10m

    if (dist <= radio) {
      setVerificando(pendiente.id)
      setAutoMessage(`Verificando punto ${(pendiente.orden ?? 0) + 1} automáticamente...`)
      try {
        await verificarPunto({
          punto_control_id: pendiente.id,
          turno_id: turno.id,
          guardia_id: guardiaId,             // ← FIX: guardia_id requerido
          metodo: 'gps',
          latitud_verificada: lat,           // ← FIX: nombre correcto
          longitud_verificada: lng,          // ← FIX: nombre correcto
        })
        onPuntoVerificado(pendiente.id)
        setAutoMessage(`✓ Punto ${(pendiente.orden ?? 0) + 1} verificado`)
        toast.success(`✓ ${pendiente.nombre} verificado automáticamente`)
      } catch (err) {
        const detail = err.response?.data?.detail
        const msg = typeof detail === 'string' ? detail : 'Error en verificación automática'
        setAutoMessage(msg)
        toast.error(msg)
      } finally {
        setVerificando(null)
      }
    }
  }, [haversine, turno, guardiaId, onPuntoVerificado, verificando, verificarPunto])

  // ── Inicializar mapa ──────────────────────────────────────────────────────
  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN
    if (!token) {
      setGeoError('VITE_MAPBOX_TOKEN no configurado')
      return
    }

    mapboxgl.accessToken = token

    // Centro inicial: instalación o La Serena por defecto
    const centerLng = turno.instalacion?.longitud ?? -71.2519
    const centerLat = turno.instalacion?.latitud ?? -29.9027

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [centerLng, centerLat],
      zoom: 15,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right')

    // Dibujar puntos cuando el estilo esté cargado
    map.on('load', () => {
      drawPoints(map, puntosRef.current)
    })

    // Manejo de error de estilo
    map.on('error', (e) => {
      console.error('Mapbox error:', e)
    })

    // ── GPS watchPosition ────────────────────────────────────────────────
    if (!navigator.geolocation) {
      setGeoError('Este dispositivo no soporta GPS')
    } else {
      watchRef.current = navigator.geolocation.watchPosition(
        (position) => {
          setGeoError(null)
          const newPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          }
          setPosLocal(newPos)

          // Actualizar marcador de usuario
          if (!userMarkerRef.current) {
            const el = document.createElement('div')
            el.style.cssText = `
              width:14px;height:14px;border-radius:50%;
              background:rgba(59,130,246,0.6);
              border:3px solid #3b82f6;
              box-shadow:0 0 0 6px rgba(59,130,246,0.15);
            `
            userMarkerRef.current = new mapboxgl.Marker(el)
              .setLngLat([newPos.lng, newPos.lat])
              .addTo(map)
          } else {
            userMarkerRef.current.setLngLat([newPos.lng, newPos.lat])
          }

          // Centrar mapa en primera posición
          map.easeTo({ center: [newPos.lng, newPos.lat], zoom: 16, speed: 0.5 })

          // Intentar verificación automática
          checkAutoVerify(newPos)
        },
        (err) => {
          const msgs = {
            1: 'Permiso de ubicación denegado. Active el GPS.',
            2: 'No se pudo obtener la ubicación.',
            3: 'Tiempo de espera agotado.',
          }
          setGeoError(msgs[err.code] || 'Error de GPS')
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      )
    }

    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current)
      userMarkerRef.current?.remove()
      Object.values(markerRefs.current).forEach(m => m.remove())
      map.remove()
      mapRef.current = null
    }
  }, [turno, drawPoints]) // checkAutoVerify NO va aquí para evitar re-montar el mapa

  // Verificación automática reactiva al cambiar posición
  useEffect(() => {
    if (pos) checkAutoVerify(pos)
  }, [pos, checkAutoVerify])

  const completados = puntos.filter(p => p.verificado).length
  const porcentaje = puntos.length ? Math.round((completados / puntos.length) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 bg-black/80 p-2 sm:p-4 overflow-auto flex items-start justify-center">
      <div className="relative w-full max-w-6xl rounded-3xl bg-[#081026] border border-white/10 shadow-2xl overflow-hidden my-2">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 bg-[#0f2440] border-b border-white/10">
          <div>
            <h2 className="text-xl font-semibold text-white">Mapa de ronda</h2>
            <p className="text-[#94a3b8] text-sm">
              {verificando ? 'Verificando punto...' : 'Verificación automática por GPS activa'}
            </p>
          </div>
          <button onClick={onClose} className="btn-secondary">Cerrar</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_0.9fr] gap-4 p-4">
          {/* Mapa */}
          <div className="h-[380px] sm:h-[520px] rounded-3xl overflow-hidden border border-white/10 relative">
            <div ref={mapContainer} className="w-full h-full" />
            {verificando && (
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-brand text-white px-3 py-2 rounded-xl text-sm font-medium shadow-lg">
                <Loader2 className="w-4 h-4 animate-spin" />
                Verificando...
              </div>
            )}
          </div>

          {/* Panel lateral */}
          <div className="space-y-4">
            {/* Info instalación */}
            <div className="card p-4 space-y-2 bg-[#0f2440] border border-white/5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[#94a3b8] text-xs">Instalación</p>
                  <p className="text-white font-semibold">{turno.instalacion?.nombre || '—'}</p>
                </div>
                {turno.ronda?.nombre && (
                  <span className="badge-blue text-xs">{turno.ronda.nombre}</span>
                )}
              </div>
              {turno.instalacion?.direccion && (
                <p className="text-[#94a3b8] text-sm">{turno.instalacion.direccion}</p>
              )}
              <div className="text-xs text-[#94a3b8] flex gap-4">
                <span>Inicio: {new Date(turno.fecha_inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
                <span>Fin: {new Date(turno.fecha_fin).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>

            {/* Progreso */}
            <div className="card p-4 bg-[#0f2440] border border-white/5">
              <p className="text-[#94a3b8] text-sm mb-2">Estado de ronda</p>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-white font-medium">Puntos completos</span>
                <span className={`font-semibold ${completados === puntos.length ? 'text-green-400' : 'text-white'}`}>
                  {completados}/{puntos.length}
                </span>
              </div>
              <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${completados === puntos.length ? 'bg-green-500' : 'bg-brand'}`}
                  style={{ width: `${porcentaje}%` }}
                />
              </div>
              {autoMessage && (
                <p className={`text-sm mt-2 ${autoMessage.includes('✓') ? 'text-green-400' : 'text-[#94a3b8]'}`}>
                  {autoMessage}
                </p>
              )}
              {geoError && (
                <p className="text-red-400 text-sm mt-2 flex items-center gap-1">
                  <WifiOff className="w-4 h-4" /> {geoError}
                </p>
              )}
              {pos && (
                <p className="text-[#94a3b8] text-xs mt-2">
                  GPS activo · ±{Math.round(pos.accuracy)}m precisión
                </p>
              )}
            </div>

            {/* Lista de puntos en el mapa */}
            <div className="card p-4 bg-[#0f2440] border border-white/5 max-h-72 overflow-y-auto">
              <h3 className="text-white font-semibold mb-3">Puntos de control</h3>
              <div className="space-y-2">
                {puntos.map((punto) => (
                  <div
                    key={punto.id}
                    className={`rounded-2xl p-3 border transition-all ${
                      punto.id === verificando
                        ? 'border-brand/60 bg-brand/10'
                        : punto.verificado
                          ? 'border-green-500/30 bg-green-500/10'
                          : 'border-white/10 bg-white/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-white font-medium text-sm truncate">
                          {punto.nombre || `Punto ${(punto.orden ?? 0) + 1}`}
                        </p>
                        <p className="text-[#94a3b8] text-xs">Radio {punto.radio_metros ?? 50}m</p>
                      </div>
                      {punto.id === verificando
                        ? <Loader2 className="w-4 h-4 text-brand animate-spin flex-shrink-0" />
                        : <StatusBadge verificado={punto.verificado} />
                      }
                    </div>
                    <p className="text-[#94a3b8] text-xs font-mono mt-1">
                      {punto.latitud?.toFixed(5)}, {punto.longitud?.toFixed(5)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function RondaPage() {
  const qc = useQueryClient()
  const gps = useGPS()
  /**
   * FIX #3 — Estado de puntos no se actualiza correctamente:
   * Antes: puntos vivía en el estado de React Query y se sincronizaba con
   *        useEffect → cada re-fetch borraba las verificaciones locales.
   * Ahora: puntos vive en estado local inicializado UNA SOLA VEZ desde la
   *        respuesta del servidor. Las verificaciones solo se actualizan
   *        localmente (optimistic) y se invalida la query sin refetch inmediato.
   */
  const [puntos, setPuntos] = useState([])
  const [inicializado, setInicializado] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)

  const { data: turno, isLoading } = useQuery({
    queryKey: ['mi-turno'],
    queryFn: () => seguridadService.miTurnoActivo()
      .then((r) => r.data)
      .catch((err) => err.response?.status === 404 ? null : Promise.reject(err)),
    retry: false,
    // No refetch automático para no sobreescribir el estado local
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000, // 5 minutos
  })

  /**
   * FIX: Inicializar puntos UNA SOLA VEZ cuando llegan del servidor.
   * Después de eso, el estado es 100% local y no se sobreescribe.
   */
  useEffect(() => {
    if (turno?.puntos && !inicializado) {
      setPuntos(turno.puntos)
      setInicializado(true)
    }
  }, [turno, inicializado])

  /**
   * FIX: onVerificado actualiza el estado LOCAL y NO invalida la query
   * inmediatamente (para no sobreescribir el estado local).
   * La query se invalida SOLO al cerrar el mapa o salir de la página.
   */
  const onVerificado = useCallback((puntoId) => {
    setPuntos(prev => prev.map(p => p.id === puntoId ? { ...p, verificado: true } : p))
  }, [])

  // Al cerrar el mapa, sincronizar con el servidor
  const cerrarMapa = useCallback(() => {
    setMapOpen(false)
    // Invalidar para que la próxima visita tenga datos frescos del servidor
    qc.invalidateQueries({ queryKey: ['mi-turno'] })
  }, [qc])

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto animate-slide-up flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }

  if (!turno) {
    return (
      <div className="max-w-2xl mx-auto animate-slide-up">
        <EmptyState
          icon={Clock}
          title="Sin turno activo"
          description="No tienes un turno activo. Espera a que el administrador o supervisor te asigne uno."
        />
      </div>
    )
  }

  // Guardia ID para las verificaciones
  const guardiaId = turno.guardia_id

  const completados = puntos.filter(p => p.verificado).length
  const porcentaje = puntos.length ? Math.round((completados / puntos.length) * 100) : 0
  const rondaCompleta = puntos.length > 0 && completados === puntos.length

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-slide-up">

      {/* Encabezado del turno */}
      <div className="card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-[#94a3b8] uppercase tracking-wide text-sm font-medium">Ronda asignada</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mt-1">
              {turno.ronda?.nombre || 'Ronda de instalación'}
            </h1>
            <p className="text-[#94a3b8] mt-1">{turno.instalacion?.nombre}</p>
            {turno.instalacion?.direccion && (
              <p className="text-[#94a3b8] text-sm">{turno.instalacion.direccion}</p>
            )}
          </div>
          <button
            onClick={() => setMapOpen(true)}
            className="btn-primary flex-shrink-0"
            disabled={rondaCompleta}
          >
            {rondaCompleta ? '✓ Ronda completada' : 'Empezar ronda'}
          </button>
        </div>

        {/* Resumen */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-[#0f2440] p-4 border border-white/10">
            <p className="text-[#94a3b8] text-sm mb-1">Duración del turno</p>
            <p className="text-white font-semibold">
              {new Date(turno.fecha_inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
              {' — '}
              {new Date(turno.fecha_fin).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <div className="rounded-2xl bg-[#0f2440] p-4 border border-white/10">
            <p className="text-[#94a3b8] text-sm mb-1">Progreso</p>
            <div className="flex items-center justify-between text-white font-semibold mb-2">
              <span>{completados}/{puntos.length} puntos</span>
              <span className={rondaCompleta ? 'text-green-400' : ''}>{porcentaje}%</span>
            </div>
            <div className="h-2.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${rondaCompleta ? 'bg-green-500' : 'bg-brand'}`}
                style={{ width: `${porcentaje}%` }}
              />
            </div>
          </div>
        </div>

        {rondaCompleta && (
          <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-2xl p-4">
            <ShieldCheck className="w-6 h-6 text-green-400 flex-shrink-0" />
            <div>
              <p className="text-green-400 font-semibold">¡Ronda completada!</p>
              <p className="text-[#94a3b8] text-sm">Todos los puntos han sido verificados.</p>
            </div>
          </div>
        )}
      </div>

      {/* Lista de puntos de control */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold text-white">Puntos de control</h2>
            <p className="text-[#94a3b8] text-sm mt-0.5">
              Verifica cada punto con GPS o QR. También puedes usar el mapa para verificación automática.
            </p>
          </div>
          {turno.ronda?.nombre && (
            <span className="badge-blue">{turno.ronda.nombre}</span>
          )}
        </div>

        {/* GPS status bar */}
        <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
          gps.pos ? 'bg-green-500/10 text-green-400' :
          gps.error ? 'bg-red-500/10 text-red-400' :
          'bg-yellow-500/10 text-yellow-400'
        }`}>
          {gps.loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Obteniendo señal GPS...</>
          ) : gps.pos ? (
            <><Navigation className="w-4 h-4" />GPS activo — Precisión ±{Math.round(gps.pos.accuracy)}m</>
          ) : (
            <>
              <WifiOff className="w-4 h-4" />
              {gps.error || 'Sin señal GPS'}
              <button onClick={gps.obtener} className="ml-auto text-xs underline underline-offset-2">
                Reintentar
              </button>
            </>
          )}
        </div>

        {puntos.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="Sin puntos de control"
            description="El administrador aún no ha configurado puntos para esta instalación."
          />
        ) : (
          <div className="space-y-3">
            {puntos.map((punto) => (
              <PuntoCard
                key={punto.id}
                punto={punto}
                turnoId={turno.id}
                guardiaId={guardiaId}     // ← FIX: pasar guardiaId
                gps={gps}
                onVerificado={() => onVerificado(punto.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mapa overlay */}
      {mapOpen && (
        <MapOverlay
          turno={turno}
          puntos={puntos}
          guardiaId={guardiaId}           // ← FIX: pasar guardiaId
          onClose={cerrarMapa}
          onPuntoVerificado={onVerificado}
        />
      )}
    </div>
  )
}
