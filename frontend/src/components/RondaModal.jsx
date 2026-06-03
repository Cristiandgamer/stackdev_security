import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import toast from 'react-hot-toast'
import { seguridadService } from '../services/api'

import 'mapbox-gl/dist/mapbox-gl.css'

export default function RondaModal({ instalacion, onClose, onCreated }) {
  const mapContainer = useRef(null)
  const mapRef       = useRef(null)
  const markerRefs   = useRef([])   // mapboxgl.Marker[] (puntos de control)
  const userMarkerRef = useRef(null) // marcador de ubicación del usuario

  const [puntos,      setPuntos]      = useState([])   // { id, lat, lng }[]
  const [nombre,      setNombre]      = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [guardando,   setGuardando]   = useState(false)

  // ── Redibujar TODOS los marcadores cuando cambia la lista ─────────────────
  const redibujarMarcadores = useCallback((lista, map) => {
    // Eliminar marcadores anteriores del mapa
    markerRefs.current.forEach((m) => m.remove())
    markerRefs.current = []

    lista.forEach((punto, idx) => {
      const el = document.createElement('div')
      el.className = [
        'rounded-full', 'w-9', 'h-9',
        'flex', 'items-center', 'justify-center',
        'text-white', 'font-bold', 'text-sm',
        'border-2', 'border-white', 'shadow-lg',
        'cursor-pointer',
      ].join(' ')
      el.style.backgroundColor = '#f97316'  // brand orange
      el.innerText = String(idx + 1)        // ← número correcto siempre

      // Tooltip con coordenadas
      const marker = new mapboxgl.Marker(el)
        .setLngLat([punto.lng, punto.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 20 }).setHTML(
            `<strong>Punto ${idx + 1}</strong><br/>${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}`
          )
        )
        .addTo(map)

      markerRefs.current.push(marker)
    })
  }, [])

  // ── Inicializar mapa ──────────────────────────────────────────────────────
  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN
    if (!token) {
      toast.error('VITE_MAPBOX_TOKEN no configurado. Añade tu token en .env')
      return
    }

    mapboxgl.accessToken = token

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [
        instalacion.longitud ?? -71.54,
        instalacion.latitud  ?? -29.90,
      ],
      zoom: 15,
    })
    mapRef.current = map

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')

    // Mostrar ubicación del usuario con un marcador azul
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => {
        const { latitude, longitude, accuracy } = p.coords
        
        // Centrar el mapa en la ubicación del usuario
        map.setCenter([longitude, latitude])
        map.zoomTo(16)
        
        // Crear marcador personalizado para la ubicación del usuario
        const userEl = document.createElement('div')
        userEl.className = 'rounded-full w-5 h-5 border-4 border-blue-400 shadow-lg'
        userEl.style.backgroundColor = 'rgba(59, 130, 246, 0.3)'
        userEl.style.cursor = 'default'
        
        // Crear y agregar el marcador
        const userMarker = new mapboxgl.Marker(userEl)
          .setLngLat([longitude, latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 15 }).setHTML(
              `<strong>Tu ubicación</strong><br/>${latitude.toFixed(5)}, ${longitude.toFixed(5)}<br/><small>±${Math.round(accuracy)}m</small>`
            )
          )
          .addTo(map)
        
        userMarkerRef.current = userMarker
      })
    }

    // Click en el mapa → agregar nuevo punto
    map.on('click', (e) => {
      const { lng, lat } = e.lngLat
      const nuevo = { id: Date.now(), lat, lng }

      // Usamos la función de actualización del estado para obtener
      // el valor más reciente de la lista ANTES de hacer setState
      setPuntos((prev) => {
        const siguiente = [...prev, nuevo]
        // Redibujar con la lista ya actualizada
        redibujarMarcadores(siguiente, map)
        return siguiente
      })
    })

    return () => {
      markerRefs.current.forEach((m) => m.remove())
      markerRefs.current = []
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      map.remove()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Eliminar punto ────────────────────────────────────────────────────────
  const removePunto = (id) => {
    setPuntos((prev) => {
      const siguiente = prev.filter((p) => p.id !== id)
      if (mapRef.current) redibujarMarcadores(siguiente, mapRef.current)
      return siguiente
    })
  }

  // ── Área desde centro del mapa ────────────────────────────────────────────
  const circleCoordinates = (lng, lat, meters, points = 32) => {
    const coords = []
    const R = 6_378_137
    for (let i = 0; i < points; i++) {
      const brng = (i * 360 / points) * (Math.PI / 180)
      const lat2 = Math.asin(
        Math.sin(lat * Math.PI / 180) * Math.cos(meters / R) +
        Math.cos(lat * Math.PI / 180) * Math.sin(meters / R) * Math.cos(brng)
      )
      const lng2 =
        lng * Math.PI / 180 +
        Math.atan2(
          Math.sin(brng) * Math.sin(meters / R) * Math.cos(lat * Math.PI / 180),
          Math.cos(meters / R) - Math.sin(lat * Math.PI / 180) * Math.sin(lat2)
        )
      coords.push([lng2 * 180 / Math.PI, lat2 * 180 / Math.PI])
    }
    coords.push(coords[0])
    return coords
  }

  const crearArea = () => {
    if (!mapRef.current) return

    const drawArea = () => {
      const { lng, lat } = mapRef.current.getCenter()
      const r = 20
      const id = 'ronda-area'
      const coords = circleCoordinates(lng, lat, r)
      const geojson = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
      }
      if (mapRef.current.getSource(id)) {
        mapRef.current.getSource(id).setData(geojson)
      } else {
        mapRef.current.addSource(id, { type: 'geojson', data: geojson })
        mapRef.current.addLayer({
          id,
          type: 'fill',
          source: id,
          paint: { 'fill-color': '#f97316', 'fill-opacity': 0.15 },
        })
      }
    }

    if (!mapRef.current.style || !mapRef.current.isStyleLoaded()) {
      mapRef.current.once('load', drawArea)
      return
    }

    drawArea()
  }

  // ── Crear ronda en el backend ─────────────────────────────────────────────
  const handleCrear = async () => {
    if (!nombre.trim()) return toast.error('El nombre de la ronda es requerido')
    if (puntos.length === 0) return toast.error('Agrega al menos un punto de control')

    setGuardando(true)
    try {
      const res   = await seguridadService.crearRonda({
        instalacion_id: instalacion.id,
        nombre,
        descripcion,
      })
      const ronda = res.data

      for (let i = 0; i < puntos.length; i++) {
        const p = puntos[i]
        await seguridadService.crearPunto(instalacion.id, {
          nombre:      `Punto ${i + 1}`,
          descripcion: '',
          latitud:     p.lat,
          longitud:    p.lng,
          orden:       i,
          ronda_id:    ronda.id,
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-gradient-to-br from-[#1e2d3d] to-[#263548] border border-[#2d5490]/30 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 bg-black/20 border-b border-[#2d5490]/20 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h3 className="text-white font-bold text-lg">Crear ronda</h3>
            <p className="text-[#94a3b8] text-xs sm:text-sm truncate">{instalacion.nombre} — haz clic en el mapa para agregar puntos</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={crearArea}
              className="px-2 sm:px-4 py-2 rounded-lg bg-[#2d5490]/20 text-[#94a3b8] hover:bg-[#2d5490]/40 transition-colors text-xs sm:text-sm font-medium whitespace-nowrap"
            >
              Área
            </button>
            <button
              onClick={onClose}
              className="px-2 sm:px-4 py-2 rounded-lg bg-[#2d5490]/20 text-[#94a3b8] hover:bg-[#2d5490]/40 transition-colors text-xs sm:text-sm font-medium whitespace-nowrap"
            >
              Cancelar
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col p-3 sm:p-5 gap-3 sm:gap-4 lg:gap-4 lg:grid lg:grid-cols-[1.6fr_1fr]">

          {/* Mapa */}
          <div className="h-[250px] sm:h-[300px] lg:h-full rounded-xl overflow-hidden border border-[#2d5490]/20">
            <div ref={mapContainer} className="w-full h-full" />
          </div>

          {/* Panel lateral */}
          <div className="space-y-3 sm:space-y-4 flex flex-col min-h-0 overflow-y-auto">

            {/* Nombre */}
            <div className="flex-shrink-0">
              <label className="label text-xs sm:text-sm">Nombre de la ronda *</label>
              <input
                className="input-field text-sm"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Ronda nocturna perimetral"
              />
            </div>

            {/* Descripción */}
            <div className="flex-shrink-0">
              <label className="label text-xs sm:text-sm">Descripción</label>
              <textarea
                className="input-field resize-none text-sm"
                rows={2}
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Notas adicionales…"
              />
            </div>

            {/* Lista de puntos */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <h4 className="text-white font-semibold text-xs sm:text-sm">
                  Puntos de control
                </h4>
                <span className="badge-blue text-xs">{puntos.length}</span>
              </div>

              {puntos.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-[#94a3b8] text-xs sm:text-sm text-center py-4 border border-dashed border-[#2d5490]/40 rounded-xl">
                  Haz clic en el mapa<br />para agregar puntos
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {puntos.map((p, idx) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 bg-[#0f1929] rounded-xl px-3 py-2.5 border border-[#2d5490]/20"
                    >
                      {/* Número */}
                      <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-brand flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs sm:text-sm font-medium">Punto {idx + 1}</p>
                        <p className="text-[#94a3b8] text-xs font-mono truncate">
                          {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                        </p>
                      </div>
                      <button
                        onClick={() => removePunto(p.id)}
                        className="text-[#94a3b8] hover:text-red-400 transition-colors !min-h-0 p-1 flex-shrink-0"
                        aria-label={`Eliminar punto ${idx + 1}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tip */}
            <p className="text-[#94a3b8] text-xs bg-[#0f1929] rounded-xl p-2 sm:p-3 border border-[#2d5490]/20 leading-relaxed flex-shrink-0">
              💡 Los puntos se numeran en el orden agregado. Elimina para cambiar orden.
            </p>

            {/* Botón crear */}
            <button
              onClick={handleCrear}
              disabled={guardando || puntos.length === 0 || !nombre.trim()}
              className="btn-primary w-full disabled:opacity-50 text-sm sm:text-base flex-shrink-0"
            >
              {guardando
                ? `Creando ronda…`
                : `✓ Crear ronda${puntos.length > 0 ? ` (${puntos.length}p)` : ''}`
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
