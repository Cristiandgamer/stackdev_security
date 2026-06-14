import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  MapPin, QrCode, CheckCircle2, AlertCircle, Navigation,
  RefreshCw, ChevronDown, ChevronUp, Clock, Target,
  Loader2, WifiOff, ShieldCheck,
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
          1: 'Permiso de ubicación bloqueado. Haga clic en el icono de candado/información junto a la URL y permita "Ubicación". Si el permiso está permanentemente rechazado, haga clic en "Restablecer permisos".',
          2: 'No se pudo obtener la ubicación. Intente nuevamente al aire libre.',
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
    ? <span className="badge-green"><CheckCircle2 className="w-4 h-4 mr-1" />Verificado</span>
    : <span className="badge-gray">Pendiente</span>
}

// ── Escáner QR ────────────────────────────────────────────────────────────────
function QRScanner({ onResult, onClose }) {
  const scannerRef = useRef(null);
  const [error, setError] = useState(null);
  const [activo, setActivo] = useState(false);

  useEffect(() => {
    const scanner = new Html5Qrcode('qr-reader');
    scannerRef.current = scanner;

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (text) => {
        // 1. Pausamos el escaneo de inmediato (síncrono y seguro)
        if (scanner.isScanning) {
          scanner.pause(true); 
        }

        // 2. Ejecutamos el resultado hacia el componente padre
        onResult(text);

        // 3. Intentamos apagar el hardware de forma asíncrona y segura
        setTimeout(() => {
          if (scannerRef.current && scannerRef.current.isScanning) {
            scannerRef.current.stop()
              .then(() => setActivo(false))
              .catch((err) => console.warn("Aviso: El escáner ya se había detenido:", err));
          }
        }, 100);
      },
      () => {} // Ignorar errores de muestreo continuo
    )
    .then(() => setActivo(true))
    .catch(e => setError('No se puede acceder a la cámara. Permita el acceso en su navegador.'));

    // Limpieza estricta al desmontar el componente (Salvavidas)
    return () => {
      if (scannerRef.current) {
        const instance = scannerRef.current;
        scannerRef.current = null; 

        if (instance.isScanning) {
          instance.stop()
            .then(() => setActivo(false))
            .catch((err) => console.log("Limpio: Escáner cerrado en desmontaje."));
        }
      }
    };
  }, [onResult]);

  // NUEVA FUNCIÓN: Apaga la cámara PRIMERO, luego cierra la pantalla
  const manejarCancelacionSegura = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        setActivo(false);
        await scannerRef.current.stop(); // Apagado limpio mientras el DOM existe
      } catch (err) {
        console.warn("El escáner ya estaba cerrado o deteniéndose:", err);
      }
    }
    // Una vez apagado el hardware, es seguro avisarle al padre que desmonte el componente
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-[#1e3a5f]">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-brand" />
          <span className="text-white font-semibold text-lg">Escanear QR</span>
        </div>
        {/* CAMBIO AQUÍ: Ahora llama a manejarCancelacionSegura */}
        <button onClick={manejarCancelacionSegura} className="btn-secondary !py-2 !px-4 text-base">
          Cancelar
        </button>
      </div>

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
          <AlertCircle className="w-16 h-16 text-red-400" />
          <p className="text-white text-center text-lg">{error}</p>
          {/* CAMBIO AQUÍ TAMBIÉN por seguridad */}
          <button onClick={manejarCancelacionSegura} className="btn-primary">Volver</button>
        </div>
      ) : (
        <>
          <div className="relative flex-1 flex items-center justify-center bg-black">
            <div id="qr-reader" className="w-full max-w-sm" />
            {/* Marco visual */}
            {activo && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-60 h-60 border-2 border-brand rounded-2xl" />
              </div>
            )}
          </div>
          <div className="px-4 py-4 bg-[#0f2440] text-center">
            <p className="text-[#94a3b8] text-base">Apunte la cámara al código QR del punto de control</p>
          </div>
        </>
      )}
    </div>
  );
}
// ── Card de punto de control ──────────────────────────────────────────────────
function PuntoCard({ punto, turnoId, gps, onVerificado }) {
  const [expandido, setExpandido] = useState(false)
  const [modoVerif, setModoVerif] = useState(null) // 'gps' | 'qr'
  const [mostrarQR, setMostrarQR] = useState(false)

  const { mutate: verificar, isPending } = useMutation({
    mutationFn: (payload) => seguridadService.verificarPunto(payload),
    onSuccess: () => {
      toast.success(`${punto.nombre} — verificado`)
      setModoVerif(null)
      onVerificado()
    },
    onError: (err) => toast.error(err.message),
  })

  const verificarGPS = () => {
    if (!gps.pos) {
      toast.error('No hay señal GPS. Active la ubicación y espere.')
      return
    }
    verificar({
      punto_control_id: punto.id,
      turno_id: turnoId,
      metodo: 'gps',
      latitud: gps.pos.lat,
      longitud: gps.pos.lng,
    })
  }

  const verificarQR = (codigo) => {
    setMostrarQR(false)
    verificar({
      punto_control_id: punto.id,
      turno_id: turnoId,
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

      <div className={`card overflow-hidden transition-all ${punto.verificado ? 'border-green-500/40' : ''}`}>
        <button
          className="w-full flex items-center gap-4 p-5 text-left"
          onClick={() => setExpandido(v => !v)}
          aria-expanded={expandido}
        >
          {/* Número de orden */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-lg
            ${punto.verificado ? 'bg-green-500/20 text-green-400' : 'bg-[#2d5490]/40 text-[#94a3b8]'}`}>
            {punto.verificado ? <CheckCircle2 className="w-5 h-5" /> : punto.orden + 1}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-lg truncate">{punto.nombre}</p>
            <StatusBadge verificado={punto.verificado} />
          </div>

          {expandido
            ? <ChevronUp className="w-5 h-5 text-[#94a3b8] flex-shrink-0" />
            : <ChevronDown className="w-5 h-5 text-[#94a3b8] flex-shrink-0" />
          }
        </button>

        {/* Acciones de verificación */}
        {expandido && !punto.verificado && (
          <div className="px-5 pb-5 pt-1 border-t border-white/5 space-y-3 animate-slide-up">
            <p className="text-[#94a3b8] text-base mb-3">Seleccione el método de verificación:</p>

            <button
              onClick={verificarGPS}
              disabled={isPending || gps.loading}
              className="btn-primary w-full text-lg py-4"
            >
              {isPending && modoVerif === 'gps'
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Verificando...</>
                : <><Navigation className="w-5 h-5" /> Verificar con GPS</>
              }
            </button>

            {gps.pos && (
              <p className="text-[#94a3b8] text-sm text-center">
                Precisión GPS: ±{Math.round(gps.pos.accuracy)}m
              </p>
            )}
            {gps.error && (
              <p className="text-red-400 text-sm text-center flex items-center justify-center gap-1">
                <WifiOff className="w-4 h-4" /> {gps.error}
              </p>
            )}

            <button
              onClick={() => { setModoVerif('qr'); setMostrarQR(true) }}
              disabled={isPending}
              className="btn-secondary w-full text-lg py-4"
            >
              {isPending && modoVerif === 'qr'
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Procesando...</>
                : <><QrCode className="w-5 h-5" /> Escanear Código QR</>
              }
            </button>
          </div>
        )}

        {expandido && punto.verificado && (
          <div className="px-5 pb-5 pt-1 border-t border-white/5">
            <div className="flex items-center gap-2 text-green-400">
              <ShieldCheck className="w-5 h-5" />
              <span className="font-medium">Punto verificado en esta ronda</span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Mapa y verificación automática ───────────────────────────────────────
function MapOverlay({ turno, puntos, onClose, onPuntoVerificado }) {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const markerRefs = useRef({})
  const userMarkerRef = useRef(null)
  const [geoError, setGeoError] = useState(null)
  const [pos, setPos] = useState(null)
  const [verificando, setVerificando] = useState(false)
  const [autoMessage, setAutoMessage] = useState('')

  const { mutateAsync: verificarPunto } = useMutation({
    mutationFn: (payload) => seguridadService.verificarPunto(payload),
    onError: () => setAutoMessage('No se pudo verificar automáticamente'),
  })

  const circleCoordinates = (lng, lat, meters, points = 36) => {
    const coords = []
    const R = 6378137
    for (let i = 0; i <= points; i += 1) {
      const bearing = (i * 360 / points) * (Math.PI / 180)
      const lat2 = Math.asin(Math.sin(lat * Math.PI / 180) * Math.cos(meters / R) + Math.cos(lat * Math.PI / 180) * Math.sin(meters / R) * Math.cos(bearing))
      const lng2 = lng * Math.PI / 180 + Math.atan2(Math.sin(bearing) * Math.sin(meters / R) * Math.cos(lat * Math.PI / 180), Math.cos(meters / R) - Math.sin(lat * Math.PI / 180) * Math.sin(lat2))
      coords.push([lng2 * 180 / Math.PI, lat2 * 180 / Math.PI])
    }
    return coords
  }

  const calcularDistancia = (lat1, lon1, lat2, lon2) => {
    const R = 6371000
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  const drawPoints = useCallback((map, puntosList) => {
    Object.values(markerRefs.current).forEach((marker) => marker.remove())
    markerRefs.current = {}

    puntosList.forEach((punto) => {
      const markerEl = document.createElement('div')
      markerEl.className = `rounded-full w-10 h-10 flex items-center justify-center text-white font-semibold border-2 ${punto.verificado ? 'bg-green-500 border-green-300' : 'bg-red-500 border-red-300'}`
      markerEl.innerText = String(punto.orden + 1)
      const marker = new mapboxgl.Marker(markerEl).setLngLat([punto.longitud, punto.latitud]).addTo(map)
      markerRefs.current[punto.id] = marker

      const circleId = `punto-circle-${punto.id}`
      const coords = circleCoordinates(punto.longitud, punto.latitud, punto.radio_metros)
      if (map.getLayer(circleId)) {
        map.getSource(circleId).setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } })
      } else {
        map.addSource(circleId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } } })
        map.addLayer({
          id: circleId,
          type: 'fill',
          source: circleId,
          paint: { 'fill-color': punto.verificado ? '#22c55e' : '#f97316', 'fill-opacity': 0.15 }
        })
      }
    })
  }, [])

  const updateUserMarker = useCallback((position) => {
    if (!mapRef.current) return
    if (!userMarkerRef.current) {
      const el = document.createElement('div')
      el.className = 'w-5 h-5 rounded-full bg-brand border-2 border-white'
      userMarkerRef.current = new mapboxgl.Marker(el).setLngLat([position.lng, position.lat]).addTo(mapRef.current)
    } else {
      userMarkerRef.current.setLngLat([position.lng, position.lat])
    }
  }, [])

  const checkAutoVerify = useCallback(async () => {
    if (!pos || verificando || !turno) return
    const pendiente = puntos.find(p => !p.verificado)
    if (!pendiente) return
    const dist = calcularDistancia(pos.lat, pos.lng, pendiente.latitud, pendiente.longitud)
    if (dist <= (pendiente.radio_metros || 50) + 10) {
      setVerificando(true)
      setAutoMessage(`Verificando punto ${pendiente.orden + 1} automáticamente...`)
      try {
        await verificarPunto({
          punto_control_id: pendiente.id,
          turno_id: turno.id,
          guardia_id: turno.guardia_id,
          metodo: 'gps',
          latitud: pos.lat,
          longitud: pos.lng,
        })
        onPuntoVerificado(pendiente.id)
        setAutoMessage(`Punto ${pendiente.orden + 1} completado`)
      } catch (error) {
        setAutoMessage('Error en verificación automática')
      } finally {
        setVerificando(false)
      }
    }
  }, [pos, verificando, turno, puntos, verificarPunto, onPuntoVerificado])

  useEffect(() => {
    if (!mapRef.current || !pos) return
    updateUserMarker(pos)
    mapRef.current.flyTo({ center: [pos.lng, pos.lat], speed: 0.7, zoom: 16 })
  }, [pos, updateUserMarker])

  useEffect(() => {
    if (!mapRef.current) return
    drawPoints(mapRef.current, puntos)
  }, [drawPoints, puntos])

  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN
    if (!token) {
      setGeoError('VITE_MAPBOX_TOKEN no configurado. Añade tu token en .env')
      return
    }
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [turno.instalacion?.longitud || -71.54, turno.instalacion?.latitud || -29.90],
      zoom: 15,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('load', () => drawPoints(map, puntos))
    return () => map.remove()
  }, [turno, puntos, drawPoints])

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError('Este dispositivo no soporta GPS')
      return
    }

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        setGeoError(null)
        setPos({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy })
      },
      (error) => {
        const msgs = {
          1: 'Permiso de ubicación denegado. Active el GPS en su teléfono.',
          2: 'No se pudo obtener la ubicación. Intente nuevamente.',
          3: 'Tiempo de espera agotado. Intente al aire libre.',
        }
        setGeoError(msgs[error.code] || 'Error de GPS desconocido')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )

    return () => navigator.geolocation.clearWatch(watch)
  }, [])

  useEffect(() => { checkAutoVerify() }, [checkAutoVerify])

  return (
    <div className="fixed inset-0 z-50 bg-black/80 p-4 overflow-auto">
      <div className="relative mx-auto max-w-6xl rounded-3xl bg-[#081026] border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 p-4 bg-[#0f2440] border-b border-white/10">
          <div>
            <h2 className="text-xl font-semibold text-white">Mapa de ronda</h2>
            <p className="text-[#94a3b8] text-sm">Puntos y verificación automática por GPS</p>
          </div>
          <button onClick={onClose} className="btn-secondary">Cerrar</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_0.9fr] gap-4 p-4">
          <div className="h-[520px] rounded-3xl overflow-hidden border border-white/10">
            <div ref={mapContainer} className="w-full h-full" />
          </div>

          <div className="space-y-4">
            <div className="card p-4 space-y-3 bg-[#0f2440] border border-white/5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[#94a3b8] text-sm">Instalación</p>
                  <p className="text-white font-semibold">{turno.instalacion?.nombre}</p>
                </div>
                <span className="badge-blue">{turno.ronda?.nombre || 'Sin ronda'}</span>
              </div>
              <p className="text-[#94a3b8] text-sm">{turno.instalacion?.direccion}</p>
              <div className="text-sm text-[#94a3b8]">
                <p>Inicio: {new Date(turno.fecha_inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</p>
                <p>Fin: {new Date(turno.fecha_fin).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>

            <div className="card p-4 bg-[#0f2440] border border-white/5">
              <p className="text-[#94a3b8] text-sm mb-2">Estado de ronda</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white">Puntos completos</span>
                  <span className="text-green-300 font-semibold">{puntos.filter(p => p.verificado).length}/{puntos.length}</span>
                </div>
                <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand transition-all"
                    style={{ width: `${Math.round((puntos.filter(p => p.verificado).length / Math.max(puntos.length, 1)) * 100)}%` }}
                  />
                </div>
                {autoMessage && <p className="text-sm text-[#c7d2fe]">{autoMessage}</p>}
                {geoError && <p className="text-sm text-red-400">{geoError}</p>}
              </div>
            </div>

            <div className="card p-4 bg-[#0f2440] border border-white/5 max-h-[360px] overflow-y-auto">
              <h3 className="text-white font-semibold mb-3">Puntos de control</h3>
              <div className="space-y-3">
                {puntos.map((punto) => (
                  <div key={punto.id} className={`rounded-3xl p-3 border ${punto.verificado ? 'border-green-500/30 bg-green-500/10' : 'border-white/10 bg-white/5'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-white font-semibold">{punto.nombre || `Punto ${punto.orden + 1}`}</p>
                        <p className="text-[#94a3b8] text-sm">Radio {punto.radio_metros} m</p>
                      </div>
                      <StatusBadge verificado={punto.verificado} />
                    </div>
                    <p className="text-[#94a3b8] text-sm mt-2">{punto.latitud.toFixed(5)}, {punto.longitud.toFixed(5)}</p>
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

export default function RondaPage() {
  const qc = useQueryClient()
  const gps = useGPS()
  const [puntos, setPuntos] = useState([])
  const [mapOpen, setMapOpen] = useState(false)

  const { data: turno, isLoading, refetch } = useQuery({
    queryKey: ['mi-turno'],
    queryFn: () => seguridadService.miTurnoActivo()
      .then((r) => r.data)
      .catch((err) => err.response?.status === 404 ? null : Promise.reject(err)),
    retry: false,
  })

useEffect(() => {
  if (turno?.puntos) {
    // Solo actualiza si no tienes puntos cargados o si cambió la estructura
    setPuntos((prev) => (prev.length === 0 ? turno.puntos : prev))
  }
}, [turno])

 // Modifica la función onVerificado en tu componente RondaPage (Líneas ~335)
const onVerificado = useCallback((puntoId) => {
  // 1. Actualizamos el estado local inmediatamente para mantener la UI intacta
  setPuntos((prev) => prev.map(p => p.id === puntoId ? { ...p, verificado: true } : p))
  
  // 2. Invalidamos los datos en React Query para que se actualicen en segundo plano sin romper nada
  qc.invalidateQueries({ queryKey: ['mi-turno'] })
  qc.invalidateQueries({ queryKey: ['notificaciones-badge'] })
}, [qc])

  const abrirMapa = () => setMapOpen(true)

  if (isLoading) {
    return <Spinner label="Cargando ronda..." />
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

  const completados = puntos.filter(p => p.verificado).length
  const porcentaje = puntos.length ? Math.round((completados / puntos.length) * 100) : 0

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-slide-up">
      <div className="card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-[#94a3b8] uppercase tracking-wide text-sm">Ronda asignada</p>
            <h1 className="text-3xl font-bold text-white mt-2">{turno.ronda?.nombre || 'Ronda de instalación'}</h1>
            <p className="text-[#94a3b8] mt-2">{turno.instalacion?.nombre}</p>
            <p className="text-[#94a3b8] text-sm mt-1">{turno.instalacion?.direccion}</p>
          </div>
          <button onClick={abrirMapa} className="btn-primary">Empezar ronda</button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl bg-[#0f2440] p-4 border border-white/10">
            <p className="text-[#94a3b8] text-sm">Duración</p>
            <p className="text-white font-semibold mt-2">
              {new Date(turno.fecha_inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
              {' — '}
              {new Date(turno.fecha_fin).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <div className="rounded-3xl bg-[#0f2440] p-4 border border-white/10">
            <p className="text-[#94a3b8] text-sm">Progreso</p>
            <div className="flex items-center justify-between mt-2 text-white font-semibold">
              <span>{completados}/{puntos.length} puntos</span>
              <span>{porcentaje}%</span>
            </div>
            <div className="h-3 bg-white/10 rounded-full overflow-hidden mt-3">
              <div className="h-full bg-brand" style={{ width: `${porcentaje}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Puntos de control</h2>
            <p className="text-[#94a3b8] text-sm">Recorre los puntos en el mapa para completar la ronda automáticamente con GPS.</p>
          </div>
          <span className="badge-blue">{turno.ronda?.nombre || 'Ronda de instalación'}</span>
        </div>

        {puntos.length === 0 ? (
          <EmptyState icon={MapPin} title="Sin puntos" description="El administrador aún no ha configurado los puntos para esta instalación." />
        ) : (
          <div className="space-y-3">
            {puntos.map((punto) => (
              <PuntoCard key={punto.id} punto={punto} turnoId={turno.id} gps={gps} onVerificado={() => onVerificado(punto.id)} />
            ))}
          </div>
        )}
      </div>

      {mapOpen && (
        <MapOverlay turno={turno} puntos={puntos} onClose={() => setMapOpen(false)} onPuntoVerificado={onVerificado} />
      )}
    </div>
  )
}
