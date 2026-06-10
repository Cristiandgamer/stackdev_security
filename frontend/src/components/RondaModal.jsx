import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import toast from 'react-hot-toast'
import { seguridadService } from '../services/api'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MapPin, X, Plus, Trash2, CheckCircle2 } from 'lucide-react'

export default function RondaModal({ instalacion, onClose, onCreated }) {
  const mapContainer = useRef(null)
  const mapRef       = useRef(null)
  const markerRefs   = useRef([])
  const userMarkerRef = useRef(null)

  const [puntos,      setPuntos]      = useState([])
  const [nombre,      setNombre]      = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [guardando,   setGuardando]   = useState(false)
  // Vista móvil: 'map' o 'list'
  const [vistaMovil,  setVistaMovil]  = useState('map')

  const redibujarMarcadores = useCallback((lista, map) => {
    markerRefs.current.forEach((m) => m.remove())
    markerRefs.current = []
    lista.forEach((punto, idx) => {
      const el = document.createElement('div')
      el.style.cssText = `
        width:36px;height:36px;border-radius:50%;
        background:#f97316;color:white;font-weight:700;font-size:14px;
        display:flex;align-items:center;justify-content:center;
        border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);
        cursor:pointer;
      `
      el.innerText = String(idx + 1)
      const marker = new mapboxgl.Marker(el)
        .setLngLat([punto.lng, punto.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 20 }).setHTML(
            `<b>Punto ${idx + 1}</b><br/>${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}`
          )
        )
        .addTo(map)
      markerRefs.current.push(marker)
    })
  }, [])

  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN
    if (!token) { toast.error('VITE_MAPBOX_TOKEN no configurado'); return }
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [instalacion.longitud ?? -71.54, instalacion.latitud ?? -29.90],
      zoom: 15,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right')

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => {
        const { latitude, longitude } = p.coords
        map.setCenter([longitude, latitude])
        map.zoomTo(16)
        const el = document.createElement('div')
        el.style.cssText = `
          width:14px;height:14px;border-radius:50%;
          background:rgba(59,130,246,0.5);
          border:3px solid #3b82f6;box-shadow:0 0 0 6px rgba(59,130,246,0.15);
        `
        userMarkerRef.current = new mapboxgl.Marker(el)
          .setLngLat([longitude, latitude])
          .addTo(map)
      })
    }

    map.on('click', (e) => {
      const { lng, lat } = e.lngLat
      const nuevo = { id: Date.now(), lat, lng }
      setPuntos((prev) => {
        const siguiente = [...prev, nuevo]
        redibujarMarcadores(siguiente, map)
        // Al agregar punto en móvil, mostrar lista
        setVistaMovil('list')
        return siguiente
      })
    })

    return () => {
      markerRefs.current.forEach((m) => m.remove())
      userMarkerRef.current?.remove()
      map.remove()
    }
  }, [])

  const removePunto = (id) => {
    setPuntos((prev) => {
      const siguiente = prev.filter((p) => p.id !== id)
      if (mapRef.current) redibujarMarcadores(siguiente, mapRef.current)
      return siguiente
    })
  }

  const handleCrear = async () => {
    if (!nombre.trim()) return toast.error('El nombre de la ronda es requerido')
    if (puntos.length === 0) return toast.error('Agrega al menos un punto en el mapa')
    setGuardando(true)
    try {
      const res = await seguridadService.crearRonda({
        instalacion_id: instalacion.id,
        nombre,
        descripcion,
      })
      const ronda = res.data
      for (let i = 0; i < puntos.length; i++) {
        const p = puntos[i]
        await seguridadService.crearPunto(instalacion.id, {
          nombre: `Punto ${i + 1}`,
          descripcion: '',
          latitud: p.lat,
          longitud: p.lng,
          orden: i,
          ronda_id: ronda.id,
        })
      }
      toast.success(`Ronda "${nombre}" creada con ${puntos.length} punto${puntos.length > 1 ? 's' : ''}`)
      onCreated?.()
      onClose()
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0f1929]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0d1a2d] border-b border-[#1e3a5f] flex-shrink-0">
        <div className="min-w-0">
          <p className="text-white font-bold text-base leading-tight">Crear ronda</p>
          <p className="text-[#94a3b8] text-xs truncate">{instalacion.nombre}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-3 w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 text-[#94a3b8] hover:text-white flex-shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Nombre + descripción ── */}
      <div className="px-4 pt-3 pb-2 bg-[#0d1a2d] border-b border-[#1e3a5f] flex-shrink-0 space-y-2">
        <input
          className="input-field text-sm"
          placeholder="Nombre de la ronda *"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
        <input
          className="input-field text-sm"
          placeholder="Descripción (opcional)"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </div>

      {/* ── Tab switcher móvil ── */}
      <div className="flex bg-[#0d1a2d] border-b border-[#1e3a5f] flex-shrink-0">
        <button
          onClick={() => setVistaMovil('map')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            vistaMovil === 'map'
              ? 'text-brand border-b-2 border-brand'
              : 'text-[#94a3b8]'
          }`}
        >
          🗺 Mapa
        </button>
        <button
          onClick={() => setVistaMovil('list')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            vistaMovil === 'list'
              ? 'text-brand border-b-2 border-brand'
              : 'text-[#94a3b8]'
          }`}
        >
          <MapPin size={14} />
          Puntos
          {puntos.length > 0 && (
            <span className="bg-brand text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
              {puntos.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Contenido principal ── */}
      <div className="flex-1 overflow-hidden relative">

        {/* Mapa */}
        <div className={`absolute inset-0 ${vistaMovil === 'map' ? 'block' : 'hidden'}`}>
          <div ref={mapContainer} className="w-full h-full" />
          {/* Instrucción flotante */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm text-white text-xs px-4 py-2 rounded-full pointer-events-none whitespace-nowrap">
            Toca el mapa para agregar puntos
          </div>
        </div>

        {/* Lista de puntos */}
        {vistaMovil === 'list' && (
          <div className="h-full overflow-y-auto p-4 space-y-3">

            {puntos.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <div className="w-16 h-16 bg-[#1e3a5f]/40 rounded-2xl flex items-center justify-center">
                  <MapPin size={28} className="text-[#94a3b8]" />
                </div>
                <p className="text-[#94a3b8] text-sm text-center leading-relaxed">
                  Aún no hay puntos.<br />
                  Ve al <span className="text-brand font-medium">mapa</span> y toca para agregar.
                </p>
                <button
                  onClick={() => setVistaMovil('map')}
                  className="btn-secondary text-sm px-5 py-2"
                >
                  Ir al mapa
                </button>
              </div>
            ) : (
              <>
                <p className="text-[#94a3b8] text-xs">
                  {puntos.length} punto{puntos.length > 1 ? 's' : ''} agregado{puntos.length > 1 ? 's' : ''} — toca <span className="text-brand">Mapa</span> para agregar más
                </p>
                {puntos.map((p, idx) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 bg-[#152032] border border-[#1e3a5f] rounded-2xl px-4 py-3"
                  >
                    <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium text-sm">Punto {idx + 1}</p>
                      <p className="text-[#94a3b8] text-xs font-mono">
                        {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                      </p>
                    </div>
                    <button
                      onClick={() => removePunto(p.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 flex-shrink-0"
                      aria-label={`Eliminar punto ${idx + 1}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Footer con botón crear ── */}
      <div className="px-4 py-3 bg-[#0d1a2d] border-t border-[#1e3a5f] flex-shrink-0 space-y-2">
        {puntos.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-[#94a3b8] bg-[#152032] rounded-xl px-3 py-2">
            <CheckCircle2 size={14} className="text-brand flex-shrink-0" />
            <span>{puntos.length} punto{puntos.length > 1 ? 's' : ''} listos para guardar</span>
          </div>
        )}
        <button
          onClick={handleCrear}
          disabled={guardando || puntos.length === 0 || !nombre.trim()}
          className="btn-primary w-full disabled:opacity-40 py-4 text-base"
        >
          {guardando
            ? `Creando ronda…`
            : `Crear ronda${puntos.length > 0 ? ` (${puntos.length} pt)` : ''}`
          }
        </button>
      </div>
    </div>
  )
}
