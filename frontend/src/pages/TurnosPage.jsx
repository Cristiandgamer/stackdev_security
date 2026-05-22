import { useState } from 'react'
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

function FormTurno({ inicial, guardias, instalaciones, onClose, onSuccess }) {
  const [form, setForm] = useState(inicial ? {
    guardia_id: inicial.guardia_id,
    instalacion_id: inicial.instalacion_id,
    fecha_inicio: inicial.fecha_inicio?.slice(0,16),
    fecha_fin: inicial.fecha_fin?.slice(0,16),
    tipo: inicial.tipo,
    estado: inicial.estado,
    notas: inicial.notas || '',
  } : {
    guardia_id: '', instalacion_id: '', fecha_inicio: '', fecha_fin: '',
    tipo: 'diurno', estado: 'asignado', notas: ''
  })

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
    if (!form.fecha_inicio || !form.fecha_fin) return toast.error('Complete las fechas')
    mutate({
      ...form,
      guardia_id: Number(form.guardia_id),
      instalacion_id: Number(form.instalacion_id),
      fecha_inicio: new Date(form.fecha_inicio).toISOString(),
      fecha_fin: new Date(form.fecha_fin).toISOString(),
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
              {g.usuario?.nombre} {g.usuario?.apellido} {g.rut ? `— ${g.rut}` : ''}
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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Inicio *</label>
          <input className="input-field" type="datetime-local" value={form.fecha_inicio}
            onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
        </div>
        <div>
          <label className="label">Fin *</label>
          <input className="input-field" type="datetime-local" value={form.fecha_fin}
            onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value }))} />
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

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button type="submit" disabled={isPending} className="btn-primary flex-1">
          {isPending ? 'Guardando...' : inicial ? 'Actualizar' : 'Crear turno'}
        </button>
      </div>
    </form>
  )
}

export default function TurnosPage() {
  const qc = useQueryClient()
  const [modal, setModal] = useState(null)
  const [filtroEstado, setFiltroEstado] = useState('')

  const { data: turnos, isLoading } = useQuery({
    queryKey: ['turnos', filtroEstado],
    queryFn: () => seguridadService.listarTurnos({ estado: filtroEstado || undefined }),
    select: r => r.data,
  })

  const { data: guardias } = useQuery({
    queryKey: ['guardias-activos'],
    queryFn: () => seguridadService.listarGuardias({ activo: true }),
    select: r => r.data,
  })

  const { data: instalaciones } = useQuery({
    queryKey: ['instalaciones-activas'],
    queryFn: () => seguridadService.listarInstalaciones({ activa: true }),
    select: r => r.data,
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
