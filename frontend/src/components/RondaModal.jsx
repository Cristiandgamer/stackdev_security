import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import toast from 'react-hot-toast'
import { seguridadService } from '../services/api'

import 'mapbox-gl/dist/mapbox-gl.css'

export default function RondaModal({ instalacion, onClose, onCreated }) {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const [puntos, setPuntos] = useState([])
  const [area, setArea] = useState(null)
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')

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
      center: [instalacion.longitud || -71.54, instalacion.latitud || -29.90],
      zoom: 15,
    })
    mapRef.current = map

    const nav = new mapboxgl.NavigationControl({ visualizePitch: true })
    map.addControl(nav, 'top-right')

    // geolocate on load
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => {
        const lng = p.coords.longitude
        const lat = p.coords.latitude
        map.setCenter([lng, lat])
      })
    }

    // click to add marker
    map.on('click', (e) => {
      const { lng, lat } = e.lngLat
      const id = Date.now()
      const nuevo = { id, lat, lng }
      setPuntos(prev => [...prev, nuevo])
      addMarker(map, nuevo)
    })

    return () => map.remove()
  }, [])

  const addMarker = (map, punto) => {
    const el = document.createElement('div')
    el.className = 'rounded-full bg-brand w-8 h-8 flex items-center justify-center text-white font-bold border-2 border-white'
    el.style.display = 'flex'
    el.innerText = (puntos.length + 1).toString()
    new mapboxgl.Marker(el).setLngLat([punto.lng, punto.lat]).addTo(map)
  }

  const crearArea = () => {
    if (!mapRef.current) return
    const center = mapRef.current.getCenter()
    const r = 20
    setArea({ lat: center.lat, lng: center.lng, radio: r })
    // draw simple circle layer
    const id = 'ronda-area'
    const coords = circleCoordinates(center.lng, center.lat, r)
    if (mapRef.current.getSource(id)) {
      mapRef.current.getSource(id).setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } })
    } else {
      mapRef.current.addSource(id, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } } })
      mapRef.current.addLayer({ id, type: 'fill', source: id, paint: { 'fill-color': '#1e90ff', 'fill-opacity': 0.2 } })
    }
  }

  const circleCoordinates = (lng, lat, meters, points = 32) => {
    const coords = []
    const R = 6378137
    for (let i = 0; i < points; i++) {
      const brng = (i * 360) / points * (Math.PI / 180)
      const d = meters
      const latRadians = lat * Math.PI / 180
      const lngRadians = lng * Math.PI / 180
      const lat2 = Math.asin(Math.sin(latRadians) * Math.cos(d / R) + Math.cos(latRadians) * Math.sin(d / R) * Math.cos(brng))
      const lng2 = lngRadians + Math.atan2(Math.sin(brng) * Math.sin(d / R) * Math.cos(latRadians), Math.cos(d / R) - Math.sin(latRadians) * Math.sin(lat2))
      coords.push([lng2 * 180 / Math.PI, lat2 * 180 / Math.PI])
    }
    coords.push(coords[0])
    return coords
  }

  const removePunto = (id) => setPuntos(prev => prev.filter(p => p.id !== id))

  const handleCrear = async () => {
    if (!nombre.trim()) return toast.error('Nombre de la ronda es requerido')
    try {
      const res = await seguridadService.crearRonda({ instalacion_id: instalacion.id, nombre, descripcion })
      const ronda = res.data
      // crear puntos asociados
      for (let i = 0; i < puntos.length; i++) {
        const p = puntos[i]
        await seguridadService.crearPunto(instalacion.id, {
          nombre: `${i+1} - Punto`, descripcion: '', latitud: p.lat, longitud: p.lng, orden: i, ronda_id: ronda.id
        })
      }
      toast.success('Ronda creada')
      onCreated && onCreated()
      onClose()
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#071129] rounded-2xl w-full max-w-5xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-[#0f2440]">
          <h3 className="text-white font-semibold">Crear ronda — {instalacion.nombre}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => { crearArea() }} className="btn-ghost">Crear área desde centro</button>
            <button onClick={onClose} className="btn-secondary">Cerrar</button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 p-4">
          <div className="col-span-2 h-[420px] rounded-lg overflow-hidden">
            <div ref={mapContainer} className="w-full h-full" />
          </div>
          <div className="col-span-1 space-y-3">
            <div>
              <label className="label">Nombre</label>
              <input className="input-field" value={nombre} onChange={e => setNombre(e.target.value)} />
            </div>
            <div>
              <label className="label">Descripción</label>
              <textarea className="input-field resize-none" rows={3} value={descripcion} onChange={e => setDescripcion(e.target.value)} />
            </div>

            <div className="border-t border-white/10 pt-3">
              <h4 className="text-white font-semibold mb-2">Puntos ({puntos.length})</h4>
              <div className="max-h-56 overflow-y-auto space-y-2">
                {puntos.map((p, idx) => (
                  <div key={p.id} className="flex items-center justify-between bg-[#10243a] p-2 rounded-lg">
                    <div>
                      <div className="text-white font-medium">Punto {idx+1}</div>
                      <div className="text-[#94a3b8] text-sm">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => removePunto(p.id)} className="btn-ghost">Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <p className="text-[#94a3b8] text-sm">Haz clic en el mapa para agregar puntos. Puedes mover el mapa y usar "Crear área desde centro" para definir la geocerca.</p>
              </div>
            </div>

            <div className="pt-3">
              <button onClick={handleCrear} className="btn-primary w-full">Crear ronda</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
