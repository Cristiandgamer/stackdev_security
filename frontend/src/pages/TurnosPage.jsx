import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Calendar, Plus, Clock, Pencil, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import { seguridadService } from '../services/api'
import { Modal, Spinner, PageHeader, EmptyState } from '../components/index.jsx'

const TIPOS = ['diurno','nocturno','mixto']
const ESTADOS = ['asignado','activo','completado','cancelado']

const ESTADO_BADGE = {
  asignado:   'badge-blue',
  activo:     'badge-green',
  completado: 'badge-gray',
  cancelado:  'badge-red',
}

const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = ['00', '15', '30', '45']

function dateToIsoDate(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : ''
}

function timeToString({ hour, minute, ampm }) {
  if (!hour || !minute || !ampm) return ''
  const h = Number(hour) % 12 + (ampm === 'PM' ? 12 : 0)
  return `${String(h).padStart(2, '0')}:${minute}:00`
}

function dateWithTime(date, time) {
  if (!date || !time) return null
  return new Date(`${date}T${time}`)
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'long' }).format(date)
}

function buildCalendarDays(baseDate) {
  const year = baseDate.getFullYear()
  const month = baseDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startWeekday = firstDay.getDay() // 0 domingo
  const offset = startWeekday === 0 ? 6 : startWeekday - 1

  return Array.from({ length: offset + daysInMonth }, (_, idx) => {
    const day = idx - offset + 1
    return day > 0
      ? new Date(year, month, day)
      : null
  })
}

function getRangeInfo(start, end) {
  if (!start || !end) return null
  const diffMs = end.getTime() - start.getTime()
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1
  return {
    label: `Del ${formatDateLabel(start)} al ${formatDateLabel(end)} (${days} día${days === 1 ? '' : 's'} en total)`,
    count: days,
  }
}

function FormTurno({ inicial, guardias, instalaciones, onClose, onSuccess }) {
  const initialFechaInicio = inicial?.fecha_inicio ? new Date(inicial.fecha_inicio) : null
  const initialFechaFin = inicial?.fecha_fin ? new Date(inicial.fecha_fin) : null
  const initialStartTime = initialFechaInicio
    ? { hour: ((initialFechaInicio.getHours() + 11) % 12) + 1, minute: String(initialFechaInicio.getMinutes()).padStart(2, '0'), ampm: initialFechaInicio.getHours() >= 12 ? 'PM' : 'AM' }
    : { hour: 8, minute: '00', ampm: 'AM' }
  const initialEndTime = initialFechaFin
    ? { hour: ((initialFechaFin.getHours() + 11) % 12) + 1, minute: String(initialFechaFin.getMinutes()).padStart(2, '0'), ampm: initialFechaFin.getHours() >= 12 ? 'PM' : 'AM' }
    : { hour: 5, minute: '00', ampm: 'PM' }

  const [form, setForm] = useState(inicial ? {
    guardia_id: inicial.guardia_id,
    instalacion_id: inicial.instalacion_id,
    range_start: initialFechaInicio,
    range_end: initialFechaFin,
    start_time: initialStartTime,
    end_time: initialEndTime,
    dias_semana: inicial.dias_semana || [],
    tipo: inicial.tipo,
    estado: inicial.estado,
    notas: inicial.notas || '',
  } : {
    guardia_id: '', instalacion_id: '', range_start: null, range_end: null,
    start_time: { hour: 8, minute: '00', ampm: 'AM' }, end_time: { hour: 5, minute: '00', ampm: 'PM' },
    dias_semana: [], tipo: 'diurno', estado: 'asignado', notas: ''
  })

  const calendarBase = form.range_start || new Date()
  const calendarDays = useMemo(() => buildCalendarDays(calendarBase), [calendarBase])
  const rangeInfo = useMemo(() => getRangeInfo(form.range_start, form.range_end), [form.range_start, form.range_end])

  const selectDate = (date) => {
    if (!form.range_start || (form.range_start && form.range_end)) {
      setForm(f => ({ ...f, range_start: date, range_end: null }))
      return
    }

    if (date < form.range_start) {
      setForm(f => ({ ...f, range_start: date, range_end: f.range_start }))
      return
    }

    setForm(f => ({ ...f, range_end: date }))
  }

  const toggleWeekday = (day) => {
    setForm(f => {
      const selected = new Set(f.dias_semana)
      if (selected.has(day)) selected.delete(day)
      else selected.add(day)
      return { ...f, dias_semana: Array.from(selected) }
    })
  }

  const startTimeString = timeToString(form.start_time)
  const endTimeString = timeToString(form.end_time)
  const startDateTime = dateWithTime(dateToIsoDate(form.range_start), startTimeString)
  const endDateTime = dateWithTime(dateToIsoDate(form.range_end), endTimeString)

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => inicial
      ? seguridadService.actualizarTurno(inicial.id, data)
      : seguridadService.crearTurno(data),
    onSuccess: () => { toast.success(inicial ? 'Turno actualizado' : 'Turno creado'); onSuccess() },
    onError: e => toast.error(e.response?.data?.detail || e.message),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.guardia_id) return toast.error('Seleccione un guardia')
    if (!form.instalacion_id) return toast.error('Seleccione una instalación')
    if (!form.range_start || !form.range_end) return toast.error('Seleccione fecha de inicio y fin')
    if (!startDateTime || !endDateTime || startDateTime >= endDateTime) return toast.error('Seleccione un rango de tiempo válido')

    mutate({
      guardia_id: Number(form.guardia_id),
      instalacion_id: Number(form.instalacion_id),
      fecha_inicio: startDateTime.toISOString(),
      fecha_fin: endDateTime.toISOString(),
      tipo: form.tipo,
      estado: form.estado,
      notas: form.notas,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Guardia *</label>
        <select className="input-field" value={form.guardia_id}
          onChange={e => setForm(f => ({ ...f, guardia_id: e.target.value }))}>
          <option value="">Seleccionar guardia</option>
          {guardias?.map(g => (
            <option key={g.id} value={g.id}>
              {g.usuario?.username || `${g.usuario?.nombre || ''} ${g.usuario?.apellido || ''}`.trim() || `Guardia ${g.id}`}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Instalación *</label>
        <select className="input-field" value={form.instalacion_id}
          onChange={e => setForm(f => ({ ...f, instalacion_id: e.target.value }))}>
          <option value="">Seleccionar instalación</option>
          {instalaciones?.map(i => <option key={i.id} value={i.id}>{i.nombre} — {i.ciudad}</option>)}
        </select>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <label className="label">Rango de fechas *</label>
            <p className="text-sm text-[#94a3b8]">Haz clic en el día de inicio y luego en el día de fin.</p>
          </div>
          <div className="text-right text-sm text-[#94a3b8]">
            {rangeInfo ? rangeInfo.label : 'Selecciona el primer día y luego el último día.'}
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((label) => (
            <div key={label} className="text-center text-xs text-[#94a3b8]">{label}</div>
          ))}
          {calendarDays.map((date, index) => {
            if (!date) return <div key={index} />
            const isSelectedStart = form.range_start && date.toDateString() === form.range_start.toDateString()
            const isSelectedEnd = form.range_end && date.toDateString() === form.range_end.toDateString()
            const inRange = form.range_start && form.range_end && date >= form.range_start && date <= form.range_end
            return (
              <button
                key={index}
                type="button"
                onClick={() => selectDate(date)}
                className={`h-10 rounded-lg text-sm transition-all ${isSelectedStart || isSelectedEnd ? 'bg-brand text-white' : inRange ? 'bg-blue-500/20 text-white' : 'bg-white/5 text-white hover:bg-white/10'}`}
                aria-pressed={isSelectedStart || isSelectedEnd}
                aria-label={`Día ${date.getDate()}`}
              >
                {date.getDate()}
              </button>
            )
          })}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {WEEKDAYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleWeekday(day)}
              className={`rounded-2xl border px-2 py-2 text-xs font-medium transition ${form.dias_semana.includes(day) ? 'bg-brand border-brand text-white' : 'bg-white/5 border-white/10 text-[#cbd5e1]'}`}
            >
              {day.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Hora de Entrada *</label>
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
            <select className="input-field" value={form.start_time.hour}
              onChange={e => setForm(f => ({ ...f, start_time: { ...f.start_time, hour: e.target.value } }))}>
              {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <select className="input-field" value={form.start_time.minute}
              onChange={e => setForm(f => ({ ...f, start_time: { ...f.start_time, minute: e.target.value } }))}>
              {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="input-field" value={form.start_time.ampm}
              onChange={e => setForm(f => ({ ...f, start_time: { ...f.start_time, ampm: e.target.value } }))}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Hora de Salida *</label>
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
            <select className="input-field" value={form.end_time.hour}
              onChange={e => setForm(f => ({ ...f, end_time: { ...f.end_time, hour: e.target.value } }))}>
              {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <select className="input-field" value={form.end_time.minute}
              onChange={e => setForm(f => ({ ...f, end_time: { ...f.end_time, minute: e.target.value } }))}>
              {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="input-field" value={form.end_time.ampm}
              onChange={e => setForm(f => ({ ...f, end_time: { ...f.end_time, ampm: e.target.value } }))}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Tipo</label>
          <select className="input-field" value={form.tipo}
            onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
            {TIPOS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
          </select>
        </div>
        {inicial && (
          <div>
            <label className="label">Estado</label>
            <select className="input-field" value={form.estado}
              onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
              {ESTADOS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="label">Notas</label>
        <textarea className="input-field resize-none" rows={2} placeholder="Instrucciones especiales..." value={form.notas}
          onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
      </div>

      <div className="flex gap-3 pt-2 flex-col sm:flex-row">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button type="submit" disabled={isPending} className="btn-primary flex-1">
          {isPending ? 'Guardando...' : inicial ? 'Actualizar' : 'Crear turno'}
        </button>
      </div>
    </form>
}

export default function TurnosPage() {
  const qc = useQueryClient()
  const [modal, setModal] = useState(null)
  const [filtroEstado, setFiltroEstado] = useState('')

  const { data: turnos, isLoading } = useQuery({
    queryKey: ['turnos', filtroEstado],
    queryFn: () => seguridadService.listarTurnos({ estado: filtroEstado || undefined }),
    select: r => Array.isArray(r?.data) ? r.data : [],
  })

  const { data: guardias } = useQuery({
    queryKey: ['guardias-activos'],
    queryFn: () => seguridadService.listarGuardias({ activo: true }),
    select: r => Array.isArray(r?.data) ? r.data : [],
  })

  const { data: instalaciones } = useQuery({
    queryKey: ['instalaciones-activas'],
    queryFn: () => seguridadService.listarInstalaciones({ activa: true }),
    select: r => Array.isArray(r?.data) ? r.data : [],
  })

  const refresh = () => { qc.invalidateQueries({ queryKey: ['turnos'] }); setModal(null) }

  const formatFecha = (f) => new Date(f).toLocaleString('es-CL', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  })

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-slide-up">
      <Modal open={!!modal} onClose={() => setModal(null)}
        title={modal?.turno ? 'Editar turno' : 'Nuevo turno'} size="lg">
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

      <PageHeader
        icon={Calendar}
        title="Turnos"
        subtitle="Programación y asignación de guardias"
        action={<button onClick={() => setModal({})} className="btn-primary"><Plus className="w-5 h-5" />Nuevo</button>}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-[#94a3b8]" />
        {['', ...ESTADOS].map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all min-h-[40px]
              ${filtroEstado === e ? 'bg-brand text-white' : 'bg-white/5 text-[#94a3b8] hover:bg-white/10'}`}>
            {e || 'Todos'}
          </button>
        ))}
      </div>

      {isLoading ? <Spinner /> : turnos?.length === 0 ? (
        <EmptyState icon={Calendar} title="Sin turnos" description="No hay turnos con el filtro seleccionado."
          action={<button onClick={() => setModal({})} className="btn-primary"><Plus className="w-5 h-5" />Crear turno</button>} />
      ) : (
        <div className="space-y-3">
          {turnos?.map(t => (
            <div key={t.id} className="card p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-brand/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-brand" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold truncate">
                      {t.guardia?.usuario?.nombre} {t.guardia?.usuario?.apellido}
                    </p>
                    <p className="text-[#94a3b8] text-sm truncate">{t.instalacion?.nombre}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={ESTADO_BADGE[t.estado] || 'badge-gray'}>{t.estado}</span>
                  <button onClick={() => setModal({ turno: t })} className="btn-ghost !min-h-0 !p-2">
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-4 text-sm text-[#94a3b8]">
                <span>📅 {formatFecha(t.fecha_inicio)}</span>
                <span>→</span>
                <span>{formatFecha(t.fecha_fin)}</span>
                <span className="badge-gray capitalize ml-auto">{t.tipo}</span>
              </div>

              {t.notas && (
                <p className="text-[#94a3b8] text-sm mt-2 bg-white/5 px-3 py-2 rounded-lg">{t.notas}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
