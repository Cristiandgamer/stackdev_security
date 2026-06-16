/**
 * RondaModal.jsx — Crear ronda y puntos desde el mapa
 *
 * CLAVE: Las coordenadas de cada punto son donde el admin hace clic
 * en el mapa, NO donde está el dispositivo. El guardia luego tiene
 * que ir físicamente a ese punto para verificarlo con GPS.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import toast from 'react-hot-toast'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  MapPin, X, Plus, Trash2, CheckCircle2,
  ChevronRight, Info, Settings,
} from 'lucide-react'
import { rondasService } from '../services/api'

function errMsg(e) {
  const detail = e?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map(d => d.msg).join(', ')
  return e?.message || 'Error inesperado'
}

// ── Paso 1: Configuración de la ronda ────────────────────────────────────────
function PasoConfiguracion({ instalacion, config, onConfig, onNext }) {
  const [form, setForm] = useState(config || {
    nombre: '',
    descripcion: '',
    rondas_por_turno: 1,
    descanso_entre_rondas_min: 60,
    tiempo_maximo_ronda_min: 0,
  })

  const handleNext = () => {
    if (!form.nombre.trim()) return toast.error('El nombre de la ronda es requerido')
    if (form.rondas_por_turno < 1) return toast.error('Mínimo 1 ronda por turno')
    if (form.descanso_entre_rondas_min < 0) return toast.error('El descanso no puede ser negativo')
    onConfig(form)
    onNext()
  }

  const f = (key) => ({
    value: form[key],
    onChange: (e) => setForm(p => ({
      ...p,
      [key]: e.target.type === 'number' ? Number(e.target.value) : e.target.value,
    })),
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-[#1e3a5f] flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center text-white text-xs font-bold">1</div>
          <span className="text-white font-semibold">Configurar ronda</span>
        </div>
        <p className="text-[#94a3b8] text-sm ml-8">Instalación: {instalacion.nombre}</p>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <label className="label">Nombre de la ronda *</label>
          <input
            className="input-field"
            placeholder="Ej: Ronda nocturna perimetral"
            {...f('nombre')}
          />
        </div>

        <div>
          <label className="label">Descripción (opcional)</label>
          <textarea
            className="input-field resize-none"
            rows={2}
            placeholder="Instrucciones generales para el guardia..."
            {...f('descripcion')}
          />
        </div>

        <div className="bg-[#0f1929] border border-[#1e3a5f] rounded-2xl p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Settings className="w-4 h-4 text-brand" />
            <span className="text-white font-medium text-sm">Ciclo de rondas por turno</span>
          </div>

          <div>
            <label className="label">¿Cuántas rondas debe hacer el guardia por turno?</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, rondas_por_turno: Math.max(1, p.rondas_por_turno - 1) }))}
                className="w-10 h-10 rounded-xl bg-[#1e3a5f] text-white font-bold text-xl flex items-center justify-center"
              >−</button>
              <span className="text-white text-2xl font-bold w-12 text-center">{form.rondas_por_turno}</span>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, rondas_por_turno: Math.min(20, p.rondas_por_turno + 1) }))}
                className="w-10 h-10 rounded-xl bg-[#1e3a5f] text-white font-bold text-xl flex items-center justify-center"
              >+</button>
              <span className="text-[#94a3b8] text-sm">ronda{form.rondas_por_turno !== 1 ? 's' : ''} completa{form.rondas_por_turno !== 1 ? 's' : ''}</span>
            </div>
          </div>

          <div>
            <label className="label">
              Minutos de descanso entre rondas
              <span className="ml-2 text-xs text-[#475569]">(después de completar una, antes de la siguiente)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                max="480"
                className="input-field !w-32 text-center text-lg font-bold"
                {...f('descanso_entre_rondas_min')}
              />
              <span className="text-[#94a3b8] text-sm">minutos</span>
            </div>
            {form.descanso_entre_rondas_min === 0 && (
              <p className="text-yellow-400 text-xs mt-1">⚠️ Sin descanso: el guardia debe iniciar la siguiente ronda inmediatamente</p>
            )}
          </div>

          {/* Resumen visual */}
          <div className="bg-[#152032] rounded-xl p-3 text-sm text-[#94a3b8]">
            <p className="text-white font-medium mb-1">Resumen del ciclo:</p>
            <p>
              El guardia hará <span className="text-brand font-semibold">{form.rondas_por_turno}</span> ronda{form.rondas_por_turno !== 1 ? 's' : ''} completa{form.rondas_por_turno !== 1 ? 's' : ''} por turno,
              con <span className="text-brand font-semibold">{form.descanso_entre_rondas_min}</span> minuto{form.descanso_entre_rondas_min !== 1 ? 's' : ''} de descanso entre cada una.
            </p>
          </div>
        </div>

        <div className="bg-[#0f1929] border border-[#1e3a5f]/50 rounded-2xl p-4">
          <div className="flex items-start gap-2 text-sm text-[#94a3b8]">
            <Info className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" />
            <p>
              En el siguiente paso podrás agregar los puntos en el mapa.
              Cada punto que coloques representa una ubicación física donde
              el guardia deberá ir para verificar.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#1e3a5f] flex-shrink-0">
        <button onClick={handleNext} className="btn-primary w-full py-4 text-base">
          Continuar: agregar puntos en el mapa
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}

// ── Paso 2: Mapa para colocar puntos ─────────────────────────────────────────
function PasoMapa({ instalacion, puntos, onPuntosChange, onBack, onCrear, guardando }) {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const markerRefs = useRef([])
  const puntosRef = useRef(puntos) // ref para evitar closures stale

  // Sincronizar ref con estado
  useEffect(() => {
    puntosRef.current = puntos
  }, [puntos])

  // Redibujar marcadores cuando cambian los puntos
  const redibujar = useCallback((lista, map) => {
    markerRefs.current.forEach(m => m.remove())
    markerRefs.current = []
    lista.forEach((p, idx) => {
      const el = document.createElement('div')
      el.style.cssText = `
        width: 36px; height: 36px; border-radius: 50%;
        background: #f97316; color: white; font-weight: 700; font-size: 14px;
        display: flex; align-items: center; justify-content: center;
        border: 3px solid white; box-shadow: 0 2px 12px rgba(249,115,22,0.5);
        cursor: default;
      `
      el.innerText = String(idx + 1)
      const marker = new mapboxgl.Marker(el)
        .setLngLat([p.lng, p.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 20 }).setHTML(
            `<div style="font-family:system-ui;padding:4px">
              <b style="color:#0f1929">Punto ${idx + 1}</b><br/>
              <span style="color:#475569;font-size:12px">${p.nombre}</span><br/>
              <span style="color:#94a3b8;font-size:11px;font-family:monospace">
                ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}
              </span>
            </div>`
          )
        )
        .addTo(map)
      markerRefs.current.push(marker)
    })
  }, [])

  // Inicializar mapa
  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN
    if (!token) { toast.error('VITE_MAPBOX_TOKEN no configurado'); return }

    mapboxgl.accessToken = token

    // Centro: instalación o La Serena por defecto
    const centerLng = instalacion.longitud ?? -71.2519
    const centerLat = instalacion.latitud ?? -29.9027

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [centerLng, centerLat],
      zoom: instalacion.latitud ? 16 : 14,
    })
    mapRef.current = map

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right')

    // Marcador de la instalación (azul)
    if (instalacion.latitud && instalacion.longitud) {
      const elInst = document.createElement('div')
      elInst.style.cssText = `
        width: 14px; height: 14px; border-radius: 50%;
        background: #3b82f6; border: 3px solid white;
        box-shadow: 0 0 0 6px rgba(59,130,246,0.2);
      `
      new mapboxgl.Marker(elInst)
        .setLngLat([instalacion.longitud, instalacion.latitud])
        .setPopup(new mapboxgl.Popup({ offset: 15 }).setHTML(
          `<b>${instalacion.nombre}</b><br/><span style="color:#94a3b8;font-size:11px">Instalación</span>`
        ))
        .addTo(map)
    }

    // CLAVE: Click en el mapa → usar coordenadas del mapa, NO del dispositivo
    map.on('click', (e) => {
      const { lng, lat } = e.lngLat
      const actuales = puntosRef.current
      const nuevoPunto = {
        id: Date.now(),
        lat,
        lng,
        nombre: `Punto ${actuales.length + 1}`,
        orden: actuales.length,
      }
      const nuevaLista = [...actuales, nuevoPunto]
      puntosRef.current = nuevaLista
      onPuntosChange(nuevaLista)
      redibujar(nuevaLista, map)
    })

    map.on('load', () => {
      redibujar(puntosRef.current, map)
    })

    return () => {
      markerRefs.current.forEach(m => m.remove())
      map.remove()
      mapRef.current = null
    }
  }, []) // Solo al montar

  // Cuando puntos cambia desde fuera (ej: eliminar), redibujar
  useEffect(() => {
    if (mapRef.current && mapRef.current.isStyleLoaded()) {
      redibujar(puntos, mapRef.current)
    }
  }, [puntos, redibujar])

  const eliminarPunto = (id) => {
    const nuevaLista = puntos
      .filter(p => p.id !== id)
      .map((p, idx) => ({ ...p, nombre: `Punto ${idx + 1}`, orden: idx }))
    onPuntosChange(nuevaLista)
  }

  const editarNombre = (id, nombre) => {
    onPuntosChange(puntos.map(p => p.id === id ? { ...p, nombre } : p))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-[#1e3a5f] flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center text-white text-xs font-bold">2</div>
          <span className="text-white font-semibold">Colocar puntos en el mapa</span>
        </div>
        <p className="text-[#94a3b8] text-xs mt-1 ml-8">
          Toca el mapa donde esté físicamente cada punto de control
        </p>
      </div>

      {/* Instrucción */}
      <div className="px-4 py-2.5 bg-brand/10 border-b border-brand/20 flex-shrink-0">
        <div className="flex items-center gap-2 text-sm text-brand">
          <MapPin className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">Toca el mapa para agregar puntos — {puntos.length} punto{puntos.length !== 1 ? 's' : ''} agregado{puntos.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Layout: mapa + lista */}
      <div className="flex-1 overflow-hidden grid grid-rows-[55%_45%] lg:grid-rows-none lg:grid-cols-[1fr_320px]">
        {/* Mapa */}
        <div ref={mapContainer} className="w-full h-full" />

        {/* Lista de puntos */}
        <div className="overflow-y-auto bg-[#0d1a2d] border-t lg:border-t-0 lg:border-l border-[#1e3a5f]">
          {puntos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <div className="w-14 h-14 bg-[#1e3a5f]/40 rounded-2xl flex items-center justify-center mb-3">
                <MapPin className="w-7 h-7 text-[#94a3b8]" />
              </div>
              <p className="text-white font-medium">Sin puntos aún</p>
              <p className="text-[#94a3b8] text-sm mt-1 leading-relaxed">
                Toca cualquier lugar del mapa para colocar el primer punto de control
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              <p className="text-[#94a3b8] text-xs px-1 py-1">
                Puedes editar el nombre de cada punto:
              </p>
              {puntos.map((p, idx) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 bg-[#152032] border border-[#1e3a5f] rounded-xl px-3 py-2.5"
                >
                  <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <input
                      className="w-full bg-transparent text-white text-sm font-medium border-b border-transparent focus:border-brand/50 focus:outline-none pb-0.5 truncate"
                      value={p.nombre}
                      onChange={e => editarNombre(p.id, e.target.value)}
                    />
                    <p className="text-[#475569] text-xs font-mono mt-0.5 truncate">
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                    </p>
                  </div>
                  <button
                    onClick={() => eliminarPunto(p.id)}
                    className="w-7 h-7 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 flex items-center justify-center flex-shrink-0"
                    aria-label="Eliminar punto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#1e3a5f] bg-[#0d1a2d] flex-shrink-0 space-y-2">
        {puntos.length > 0 && (
          <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2 text-sm text-green-400">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{puntos.length} punto{puntos.length !== 1 ? 's' : ''} listos — puedes seguir agregando o crear la ronda</span>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onBack} className="btn-secondary flex-shrink-0 !py-3">
            ← Atrás
          </button>
          <button
            onClick={onCrear}
            disabled={guardando || puntos.length === 0}
            className="btn-primary flex-1 !py-3 disabled:opacity-40"
          >
            {guardando
              ? `Creando ronda…`
              : `Crear ronda con ${puntos.length} punto${puntos.length !== 1 ? 's' : ''}`
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal principal ───────────────────────────────────────────────────────────
export default function RondaModal({ instalacion, onClose, onCreated }) {
  const [paso, setPaso] = useState(1) // 1 = config, 2 = mapa
  const [config, setConfig] = useState(null)
  const [puntos, setPuntos] = useState([])
  const [guardando, setGuardando] = useState(false)

  const handleCrear = async () => {
    if (!config || puntos.length === 0) return
    setGuardando(true)
    try {
      // 1. Crear la plantilla de ronda
      const { data: ronda } = await rondasService.crearPlantilla({
        instalacion_id: instalacion.id,
        nombre: config.nombre,
        descripcion: config.descripcion || null,
        rondas_por_turno: config.rondas_por_turno,
        descanso_entre_rondas_min: config.descanso_entre_rondas_min,
        tiempo_maximo_ronda_min: config.tiempo_maximo_ronda_min || 0,
      })

      // 2. Crear cada punto con las coordenadas del mapa
      for (let i = 0; i < puntos.length; i++) {
        const p = puntos[i]
        await rondasService.crearPunto({
          instalacion_id: instalacion.id,
          ronda_id: ronda.id,
          nombre: p.nombre || `Punto ${i + 1}`,
          latitud: p.lat,   // coordenadas donde el admin hizo clic en el mapa
          longitud: p.lng,  // NO la posición del dispositivo
          orden: i,
        })
      }

      toast.success(`Ronda "${config.nombre}" creada con ${puntos.length} puntos`)
      onCreated?.()
      onClose()
    } catch (e) {
      toast.error(errMsg(e) || 'Error al crear la ronda')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0f1929]">
      {/* Topbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0d1a2d] border-b border-[#1e3a5f] flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex gap-1.5">
            {[1, 2].map(n => (
              <div
                key={n}
                className={`h-1.5 rounded-full transition-all ${
                  n === paso ? 'w-8 bg-brand' : n < paso ? 'w-4 bg-brand/60' : 'w-4 bg-[#1e3a5f]'
                }`}
              />
            ))}
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">
              {paso === 1 ? 'Nueva ronda' : config?.nombre || 'Agregar puntos'}
            </p>
            <p className="text-[#94a3b8] text-xs truncate">{instalacion.nombre}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 text-[#94a3b8] hover:text-white ml-3 flex-shrink-0"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-hidden">
        {paso === 1 && (
          <PasoConfiguracion
            instalacion={instalacion}
            config={config}
            onConfig={setConfig}
            onNext={() => setPaso(2)}
          />
        )}
        {paso === 2 && (
          <PasoMapa
            instalacion={instalacion}
            puntos={puntos}
            onPuntosChange={setPuntos}
            onBack={() => setPaso(1)}
            onCrear={handleCrear}
            guardando={guardando}
          />
        )}
      </div>
    </div>
  )
}
