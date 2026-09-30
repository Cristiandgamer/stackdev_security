/**
 * TurnosPage.jsx — Módulo de gestión de turnos
 *
 * Diseño:
 *  - Inputs nativos HTML5 type="date" / type="time" (24 h estricto, sin AM/PM)
 *  - Cruce de medianoche automático: si hora_fin ≤ hora_inicio → fecha_fin = fecha_inicio + 1 día
 *  - Auto-clasificación tipo (diurno / nocturno / mixto) en tiempo real
 *  - Conversión segura a ISO 8601: new Date(año, mes, día, h, min) → .toISOString()
 *  - Selectores de jornada y días por botones (sin dropdowns anidados)
 */
import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Calendar, Plus, Clock, Pencil, Filter,
  Sun, Moon, Shuffle, AlertCircle, CheckCircle2,
  Briefcase, Users, Building2, ChevronDown, ChevronUp,
  ArrowRight, MoonStar,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { seguridadService } from '../services/api'
import { Modal, Spinner, PageHeader, EmptyState } from '../components/index.jsx'

// ── Constantes ────────────────────────────────────────────────────────────────

const JORNADAS = [
  { value: 'full-time',   label: 'Full-time',   desc: 'Hasta 12h' },
  { value: 'part-time',   label: 'Part-time',   desc: 'Hasta 5h' },
  { value: 'hora-extra',  label: 'Hora Extra',  desc: 'Sin límite' },
  { value: 'reemplazo',   label: 'Reemplazo',   desc: 'Sin límite' },
]

const ESTADOS_TURNO = ['asignado', 'activo', 'completado', 'cancelado', 'inasistencia']

const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const ESTADO_BADGE = {
  asignado:    'badge-blue',
  activo:      'badge-green',
  completado:  'badge-gray',
  cancelado:   'badge-red',
  inasistencia:'badge-red',
}

const TIPO_CONFIG = {
  diurno:   { icon: Sun,   color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Diurno'   },
  nocturno: { icon: MoonStar, color: 'text-blue-400',   bg: 'bg-blue-400/10',   label: 'Nocturno' },
  mixto:    { icon: Shuffle, color: 'text-purple-400', bg: 'bg-purple-400/10', label: 'Mixto'    },
}

// ── Utilidades de fecha/hora ──────────────────────────────────────────────────

const TURNO_TIME_ZONE = 'America/Santiago'
const TURNO_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: TURNO_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const TURNO_OFFSET_FORMATTER = new Intl.DateTimeFormat('en', {
  timeZone: TURNO_TIME_ZONE,
  timeZoneName: 'longOffset',
})

/**
 * Agrega días a una string de fecha "YYYY-MM-DD" y retorna "YYYY-MM-DD".
 * Usa el constructor local para evitar desfases de zona horaria.
 */
function addDays(fechaStr, days) {
  if (!fechaStr) return ''
  const [y, m, d] = fechaStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * Convierte fecha "YYYY-MM-DD" + hora "HH:MM" a ISO 8601 UTC.
 * Usa new Date(año, mes, día, hora, min) — constructor LOCAL — para que
 * la hora que el operador escribió sea la hora LOCAL del servidor/navegador.
 */
function toISO(fechaStr, horaStr) {
  if (!fechaStr || !horaStr) return null
  const [y, m, d] = fechaStr.split('-').map(Number)
  const [h, min]  = horaStr.split(':').map(Number)
  const localTimestamp = Date.UTC(y, m - 1, d, h, min)
  let utcTimestamp = localTimestamp

  for (let attempt = 0; attempt < 2; attempt++) {
    const offset = TURNO_OFFSET_FORMATTER
      .formatToParts(new Date(utcTimestamp))
      .find(part => part.type === 'timeZoneName')?.value
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offset || '')
    const offsetMinutes = match
      ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
      : 0
    utcTimestamp = localTimestamp - offsetMinutes * 60000
  }

  return new Date(utcTimestamp).toISOString()
}

/** Interpreta como UTC los timestamps sin zona que devuelve la base de datos. */
function parseServerDateTime(value) {
  if (!value) return null
  const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  return new Date(timestamp)
}

/**
 * Extrae "YYYY-MM-DD" de un DateTime del servidor (ISO 8601).
 * Usa el tiempo LOCAL del cliente para mostrar la fecha correcta.
 */
function isoToDate(iso) {
  if (!iso) return ''
  const d = parseServerDateTime(iso)
  const parts = Object.fromEntries(TURNO_DATE_TIME_FORMATTER.formatToParts(d).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Extrae "HH:MM" (24h) de un DateTime del servidor. */
function isoToTime(iso) {
  if (!iso) return ''
  const d = parseServerDateTime(iso)
  const parts = Object.fromEntries(TURNO_DATE_TIME_FORMATTER.formatToParts(d).map(part => [part.type, part.value]))
  return `${parts.hour}:${parts.minute}`
}

/**
 * Auto-clasifica el tipo de turno en base a la hora de inicio.
 *  - Diurno:   inicio entre 06:00 y 19:59 Y no cruza medianoche Y fin ≤ 21:00
 *  - Nocturno: inicio entre 20:00 y 05:59
 *  - Mixto:    cualquier otra combinación (cruza boundary día/noche)
 */
function calcularTipo(horaInicio, horaFin, cruzaMedianoche) {
  if (!horaInicio || !horaFin) return 'diurno'
  const hI = parseInt(horaInicio.split(':')[0], 10)
  const hF = parseInt(horaFin.split(':')[0], 10)

  // Nocturno: inicio en horario nocturno (20:00-05:59)
  if (hI >= 20 || hI < 6) return 'nocturno'

  // Diurno puro: inicio diurno + no cruza medianoche + fin dentro de horario diurno
  if (!cruzaMedianoche && hF >= 6 && hF <= 21) return 'diurno'

  // Todo lo demás es mixto
  return 'mixto'
}

/** Calcula la duración en horas entre dos datetime strings ISO. */
function calcularDuracionHoras(inicio, fin) {
  if (!inicio || !fin) return null
  const diff = (parseServerDateTime(fin) - parseServerDateTime(inicio)) / 3600000
  return diff > 0 ? diff : null
}

/** Formatea un datetime ISO para mostrar en la lista de turnos. */
function formatFecha(iso) {
  if (!iso) return '—'
  return parseServerDateTime(iso).toLocaleString('es-CL', {
    timeZone: TURNO_TIME_ZONE,
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Formulario de turno ───────────────────────────────────────────────────────

function FormTurno({ inicial, guardias, instalaciones, onClose, onSuccess }) {
  // Inicializar estado del formulario
  const [form, setForm] = useState(() => {
    if (inicial?.id) {
      return {
        guardia_id:    String(inicial.guardia_id || ''),
        instalacion_id: String(inicial.instalacion_id || ''),
        ronda_id:      String(inicial.ronda_id || ''),
        fecha_inicio:  isoToDate(inicial.fecha_inicio),
        hora_inicio:   isoToTime(inicial.fecha_inicio),
        hora_fin:      isoToTime(inicial.fecha_fin),
        jornada:       inicial.jornada || 'full-time',
        dias_semana:   inicial.dias_semana || [],
        notas:         inicial.notas || '',
        estado:        inicial.estado || 'asignado',
      }
    }
    return {
      guardia_id:    '',
      instalacion_id: '',
      ronda_id:      '',
      fecha_inicio:  '',
      hora_inicio:   '08:00',
      hora_fin:      '20:00',
      jornada:       'full-time',
      dias_semana:   [],
      notas:         '',
      estado:        'asignado',
    }
  })

  // ── Valores derivados ────────────────────────────────────────────────────

  // ¿El turno cruza medianoche? (salida ≤ entrada)
  const cruzaMedianoche = useMemo(() => {
    if (!form.hora_inicio || !form.hora_fin) return false
    return form.hora_fin <= form.hora_inicio
  }, [form.hora_inicio, form.hora_fin])

  // fecha_fin: si cruza medianoche → fecha_inicio + 1 día
  const fecha_fin_calculada = useMemo(() => {
    if (!form.fecha_inicio) return ''
    return cruzaMedianoche ? addDays(form.fecha_inicio, 1) : form.fecha_inicio
  }, [form.fecha_inicio, cruzaMedianoche])

  // tipo: calculado automáticamente
  const tipo = useMemo(
    () => calcularTipo(form.hora_inicio, form.hora_fin, cruzaMedianoche),
    [form.hora_inicio, form.hora_fin, cruzaMedianoche]
  )

  // ISO strings para enviar a la API
  const isoInicio = useMemo(() => toISO(form.fecha_inicio, form.hora_inicio), [form.fecha_inicio, form.hora_inicio])
  const isoFin    = useMemo(() => toISO(fecha_fin_calculada, form.hora_fin), [fecha_fin_calculada, form.hora_fin])

  // Duración del turno en horas
  const duracionH = useMemo(() => calcularDuracionHoras(isoInicio, isoFin), [isoInicio, isoFin])

  // Advertencia de jornada
  const advertenciaJornada = useMemo(() => {
    if (!duracionH) return null
    if (form.jornada === 'part-time' && duracionH > 5)
      return `Part-time excede 5h (actual: ${duracionH.toFixed(1)}h). El servidor lo rechazará.`
    if (form.jornada === 'full-time' && duracionH > 12)
      return `Full-time excede 12h (actual: ${duracionH.toFixed(1)}h). El servidor lo rechazará.`
    return null
  }, [duracionH, form.jornada])

  // Rondas disponibles para la instalación seleccionada
  const { data: rondasDisponibles } = useQuery({
    queryKey: ['rondas-instalacion', form.instalacion_id],
    queryFn: () => seguridadService.listarRondas(Number(form.instalacion_id)),
    select: r => Array.isArray(r?.data) ? r.data : [],
    enabled: !!form.instalacion_id,
  })

  // ── Helpers ──────────────────────────────────────────────────────────────

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const toggleDia = (dia) => {
    setForm(f => {
      const set = new Set(f.dias_semana)
      set.has(dia) ? set.delete(dia) : set.add(dia)
      return { ...f, dias_semana: Array.from(set) }
    })
  }

  // ── Mutación ─────────────────────────────────────────────────────────────

  const { mutate, isPending } = useMutation({
    mutationFn: (payload) => inicial?.id
      ? seguridadService.actualizarTurno(inicial.id, payload)
      : seguridadService.crearTurno(payload),
    onSuccess: () => {
      toast.success(inicial?.id ? 'Turno actualizado' : 'Turno creado')
      onSuccess()
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || e?.message || 'Error desconocido'
      toast.error(msg)
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.guardia_id)    return toast.error('Seleccione un guardia')
    if (!form.instalacion_id) return toast.error('Seleccione una instalación')
    if (!form.fecha_inicio)   return toast.error('Ingrese la fecha de inicio')
    if (!form.hora_inicio)    return toast.error('Ingrese la hora de entrada')
    if (!form.hora_fin)       return toast.error('Ingrese la hora de salida')
    if (!isoInicio || !isoFin) return toast.error('Fechas y horas inválidas')

    mutate({
      guardia_id:     Number(form.guardia_id),
      instalacion_id: Number(form.instalacion_id),
      ronda_id:       form.ronda_id ? Number(form.ronda_id) : null,
      fecha_inicio:   isoInicio,
      fecha_fin:      isoFin,
      jornada:        form.jornada,
      tipo,
      dias_semana:    form.dias_semana,
      notas:          form.notas.trim() || null,
      ...(inicial?.id && { estado: form.estado }),
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const TipoIcon = TIPO_CONFIG[tipo]?.icon || Sun

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* ── Guardia + Instalación ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Guardia *</label>
          <select
            className="input-field"
            value={form.guardia_id}
            onChange={e => set('guardia_id', e.target.value)}
            required
          >
            <option value="">— Seleccionar guardia —</option>
            {guardias?.map(g => (
              <option key={g.id} value={g.id}>
                {`${g.nombre} ${g.apellido}`.trim() || `Guardia #${g.id}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Instalación *</label>
          <select
            className="input-field"
            value={form.instalacion_id}
            onChange={e => { set('instalacion_id', e.target.value); set('ronda_id', '') }}
            required
          >
            <option value="">— Seleccionar instalación —</option>
            {instalaciones?.map(i => (
              <option key={i.id} value={i.id}>{i.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Ronda (opcional) ────────────────────────────────────────────── */}
      {form.instalacion_id && (
        <div>
          <label className="label">Ronda de patrullaje <span className="text-[#64748b] font-normal">(opcional)</span></label>
          <select
            className="input-field"
            value={form.ronda_id}
            onChange={e => set('ronda_id', e.target.value)}
          >
            <option value="">Sin ronda asignada (puesto fijo)</option>
            {rondasDisponibles?.map(r => (
              <option key={r.id} value={r.id}>{r.nombre}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Fecha y horas ────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="label">Horario del turno *</p>

        {/* Fecha de inicio */}
        <div>
          <label className="text-xs text-[#94a3b8] mb-1 block">Fecha de inicio</label>
          <input
            type="date"
            className="input-field"
            value={form.fecha_inicio}
            onChange={e => set('fecha_inicio', e.target.value)}
            required
          />
        </div>

        {/* Horas (24h — sin AM/PM) */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#94a3b8] mb-1 block">Hora entrada (24 h)</label>
            <input
              type="time"
              className="input-field font-mono"
              value={form.hora_inicio}
              onChange={e => set('hora_inicio', e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs text-[#94a3b8] mb-1 block">Hora salida (24 h)</label>
            <input
              type="time"
              className="input-field font-mono"
              value={form.hora_fin}
              onChange={e => set('hora_fin', e.target.value)}
              required
            />
          </div>
        </div>

        {/* Resumen calculado */}
        {form.fecha_inicio && form.hora_inicio && form.hora_fin && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {/* Cruce de medianoche */}
            {cruzaMedianoche && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/10 text-blue-400 text-xs font-medium">
                <MoonStar className="w-3.5 h-3.5" />
                Cruza medianoche → finaliza el {fecha_fin_calculada}
              </span>
            )}

            {/* Duración */}
            {duracionH && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 text-[#94a3b8] text-xs">
                <Clock className="w-3.5 h-3.5" />
                {duracionH.toFixed(1)} horas
              </span>
            )}

            {/* Tipo auto-calculado */}
            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium ${TIPO_CONFIG[tipo]?.bg} ${TIPO_CONFIG[tipo]?.color}`}>
              <TipoIcon className="w-3.5 h-3.5" />
              {TIPO_CONFIG[tipo]?.label} (auto)
            </span>

            {/* Advertencia de jornada */}
            {advertenciaJornada && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 text-red-400 text-xs w-full">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {advertenciaJornada}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Jornada (botones) ────────────────────────────────────────────── */}
      <div>
        <label className="label">Tipo de jornada *</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {JORNADAS.map(j => (
            <button
              key={j.value}
              type="button"
              onClick={() => set('jornada', j.value)}
              className={`flex flex-col items-center justify-center px-3 py-3 rounded-xl border text-sm font-medium transition-all ${
                form.jornada === j.value
                  ? 'bg-brand border-brand text-white'
                  : 'bg-white/5 border-white/10 text-[#cbd5e1] hover:bg-white/10'
              }`}
            >
              <span>{j.label}</span>
              <span className={`text-xs mt-0.5 ${form.jornada === j.value ? 'text-white/70' : 'text-[#64748b]'}`}>
                {j.desc}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Días de la semana (botones) ────────────────────────────────── */}
      <div>
        <label className="label">
          Días de repetición
          <span className="text-[#64748b] font-normal ml-1">(opcional — para patrones semanales)</span>
        </label>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((dia, i) => (
            <button
              key={dia}
              type="button"
              onClick={() => toggleDia(dia)}
              title={dia}
              className={`py-2.5 rounded-xl border text-xs font-medium transition-all ${
                form.dias_semana.includes(dia)
                  ? 'bg-brand border-brand text-white'
                  : 'bg-white/5 border-white/10 text-[#cbd5e1] hover:bg-white/10'
              }`}
            >
              {WEEKDAYS_SHORT[i]}
            </button>
          ))}
        </div>
        {form.dias_semana.length > 0 && (
          <p className="text-xs text-[#64748b] mt-1.5">
            Activos: {form.dias_semana.join(', ')}
          </p>
        )}
      </div>

      {/* ── Estado (solo en edición) ─────────────────────────────────────── */}
      {inicial?.id && (
        <div>
          <label className="label">Estado</label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {ESTADOS_TURNO.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => set('estado', e)}
                className={`px-2 py-2.5 rounded-xl border text-xs font-medium capitalize transition-all ${
                  form.estado === e
                    ? 'bg-brand border-brand text-white'
                    : 'bg-white/5 border-white/10 text-[#cbd5e1] hover:bg-white/10'
                }`}
              >
                {e.replace('-', ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Notas ────────────────────────────────────────────────────────── */}
      <div>
        <label className="label">Consignas / Notas</label>
        <textarea
          className="input-field resize-none"
          rows={2}
          placeholder="Instrucciones especiales para el guardia..."
          value={form.notas}
          onChange={e => set('notas', e.target.value)}
        />
      </div>

      {/* ── Botones ──────────────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-1 flex-col sm:flex-row">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending || !!advertenciaJornada}
          className="btn-primary flex-1 disabled:opacity-50"
        >
          {isPending
            ? 'Guardando…'
            : inicial?.id ? 'Actualizar turno' : 'Crear turno'
          }
        </button>
      </div>
    </form>
  )
}

// ── Card de turno en la lista ─────────────────────────────────────────────────

function TurnoCard({ turno, onEdit }) {
  const tipo = turno.tipo || 'diurno'
  const TipoIcon = TIPO_CONFIG[tipo]?.icon || Sun
  const [detalle, setDetalle] = useState(false)

  const duracionH = calcularDuracionHoras(turno.fecha_inicio, turno.fecha_fin)

  return (
    <div className="card overflow-hidden">
      <div className="p-5">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${TIPO_CONFIG[tipo]?.bg}`}>
              <TipoIcon className={`w-5 h-5 ${TIPO_CONFIG[tipo]?.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold truncate">
                {turno.guardia?.nombre
                  ? `${turno.guardia.nombre} ${turno.guardia.apellido || ''}`.trim()
                  : `Guardia #${turno.guardia_id}`
                }
              </p>
              <p className="text-[#94a3b8] text-sm truncate">
                {turno.instalacion?.nombre || `Instalación #${turno.instalacion_id}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`${ESTADO_BADGE[turno.estado] || 'badge-gray'} capitalize`}>
              {turno.estado}
            </span>
            <button
              onClick={() => onEdit(turno)}
              className="btn-ghost !min-h-0 !p-2"
              title="Editar turno"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Horario */}
        <div className="flex flex-wrap items-center gap-2 text-sm text-[#94a3b8]">
          <span className="font-mono">{formatFecha(turno.fecha_inicio)}</span>
          <ArrowRight className="w-3 h-3 flex-shrink-0" />
          <span className="font-mono">{formatFecha(turno.fecha_fin)}</span>
          {duracionH && (
            <span className="text-xs ml-auto">{duracionH.toFixed(1)}h</span>
          )}
        </div>

        {/* Badges de jornada y tipo */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="badge-gray capitalize text-xs">{turno.jornada || 'full-time'}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${TIPO_CONFIG[tipo]?.bg} ${TIPO_CONFIG[tipo]?.color}`}>
            {TIPO_CONFIG[tipo]?.label}
          </span>
          {turno.ronda_id && (
            <span className="badge-blue text-xs">Con ronda</span>
          )}
          {turno.dias_semana?.length > 0 && (
            <span className="text-xs text-[#64748b]">
              {turno.dias_semana.map(d => d.slice(0, 3)).join(' · ')}
            </span>
          )}
        </div>
      </div>

      {/* Detalle expandible */}
      {turno.notas && (
        <>
          <button
            className="w-full flex items-center justify-between px-5 py-2 border-t border-white/5 text-xs text-[#64748b] hover:text-[#94a3b8] transition"
            onClick={() => setDetalle(v => !v)}
          >
            <span>Ver consignas</span>
            {detalle ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {detalle && (
            <div className="px-5 pb-4 bg-white/[0.02]">
              <p className="text-[#94a3b8] text-sm">{turno.notas}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function TurnosPage() {
  const qc = useQueryClient()
  const [modal, setModal]             = useState(null)   // null | {} | { turno }
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroJornada, setFiltroJornada] = useState('')

  const { data: turnos, isLoading } = useQuery({
    queryKey: ['turnos', filtroEstado, filtroJornada],
    queryFn:  () => seguridadService.listarTurnos({
      estado:  filtroEstado  || undefined,
    }),
    select: r => {
      const lista = Array.isArray(r?.data) ? r.data : []
      if (!filtroJornada) return lista
      return lista.filter(t => t.jornada === filtroJornada)
    },
  })

  const { data: guardias } = useQuery({
    queryKey: ['guardias-activos'],
    queryFn:  () => seguridadService.listarGuardias({ activo: true }),
    select:   r => Array.isArray(r?.data) ? r.data : [],
  })

  const { data: instalaciones } = useQuery({
    queryKey: ['instalaciones-activas'],
    queryFn:  () => seguridadService.listarInstalaciones({ activa: true }),
    select:   r => Array.isArray(r?.data) ? r.data : [],
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['turnos'] })
    setModal(null)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-slide-up">

      {/* Modal de creación / edición */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.turno ? 'Editar turno' : 'Nuevo turno'}
        size="lg"
      >
        {modal && (
          <FormTurno
            inicial={modal.turno}
            guardias={guardias}
            instalaciones={instalaciones}
            onClose={() => setModal(null)}
            onSuccess={refresh}
          />
        )}
      </Modal>

      {/* Header */}
      <PageHeader
        icon={Calendar}
        title="Turnos"
        subtitle="Programación y asignación de guardias"
        action={
          <button onClick={() => setModal({})} className="btn-primary">
            <Plus className="w-5 h-5" />Nuevo turno
          </button>
        }
      />

      {/* Filtros */}
      <div className="space-y-2">
        {/* Estado */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-[#94a3b8] flex-shrink-0" />
          <span className="text-xs text-[#64748b] mr-1">Estado:</span>
          {['', ...ESTADOS_TURNO].map(e => (
            <button
              key={e}
              onClick={() => setFiltroEstado(e)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                filtroEstado === e
                  ? 'bg-brand text-white'
                  : 'bg-white/5 text-[#94a3b8] hover:bg-white/10'
              }`}
            >
              {e || 'Todos'}
            </button>
          ))}
        </div>

        {/* Jornada */}
        <div className="flex items-center gap-2 flex-wrap">
          <Briefcase className="w-4 h-4 text-[#94a3b8] flex-shrink-0" />
          <span className="text-xs text-[#64748b] mr-1">Jornada:</span>
          {['', ...JORNADAS.map(j => j.value)].map(j => (
            <button
              key={j}
              onClick={() => setFiltroJornada(j)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-all ${
                filtroJornada === j
                  ? 'bg-brand text-white'
                  : 'bg-white/5 text-[#94a3b8] hover:bg-white/10'
              }`}
            >
              {j || 'Todas'}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <Spinner />
      ) : !turnos?.length ? (
        <EmptyState
          icon={Calendar}
          title="Sin turnos"
          description="No hay turnos con los filtros seleccionados."
          action={
            <button onClick={() => setModal({})} className="btn-primary">
              <Plus className="w-5 h-5" />Crear turno
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {turnos.map(t => (
            <TurnoCard
              key={t.id}
              turno={t}
              onEdit={(turno) => setModal({ turno })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

