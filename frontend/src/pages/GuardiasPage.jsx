import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Pencil, ToggleLeft, ToggleRight, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { seguridadService, usuariosService } from '../services/api'
import { Modal, Spinner, PageHeader, EmptyState } from '../components/index.jsx'

function FormGuardia({ inicial, users, instalaciones, onClose, onSuccess }) {
  const [form, setForm] = useState(inicial || {
    usuario_id: '', instalacion_id: '', rut: '', telefono: '', email: '', certificaciones: ''
  })

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => inicial
      ? seguridadService.actualizarGuardia(inicial.id, data)
      : seguridadService.crearGuardia(data),
    onSuccess: () => {
      toast.success(inicial ? 'Guardia actualizado' : 'Guardia creado')
      onSuccess()
    },
    onError: (e) => {
      const msg = e.response?.data?.detail || e.message
      toast.error(typeof msg === 'string' ? msg : 'Error al guardar')
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.usuario_id) return toast.error('Seleccione el usuario creado')
    if (!form.instalacion_id) return toast.error('Seleccione la instalación')
    if (!form.rut.trim()) return toast.error('Ingrese el RUT')
    mutate(form)
  }

  const campo = (label, key, opts = {}) => (
    <div>
      <label className="label">{label}</label>
      <input
        className="input-field"
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        {...opts}
      />
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Usuario creado *</label>
          <select className="input-field" value={form.usuario_id || ''}
            onChange={e => setForm(f => ({ ...f, usuario_id: e.target.value }))}>
            <option value="">Seleccione usuario</option>
            {users?.map(u => (
              <option key={u.id} value={u.id}>{u.nombre} {u.apellido || ''} — {u.email}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Instalación *</label>
          <select className="input-field" value={form.instalacion_id || ''}
            onChange={e => setForm(f => ({ ...f, instalacion_id: e.target.value }))}>
            <option value="">Seleccione instalación</option>
            {instalaciones?.map(i => (
              <option key={i.id} value={i.id}>{i.nombre}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-sm text-[#94a3b8]">El nombre y apellido se completan según el usuario seleccionado.</p>
      <div className="grid grid-cols-2 gap-4">
        {campo('RUT chileno *', 'rut', { placeholder: '12.345.678-9' })}
        {campo('Teléfono', 'telefono', { placeholder: '+56 9 1234 5678' })}
      </div>
      {campo('Email', 'email', { placeholder: 'guardia@empresa.cl', type: 'email' })}
      <div>
        <label className="label">Certificaciones (separadas por coma)</label>
        <input className="input-field" placeholder="OS-10, Primeros Auxilios, ..."
          value={form.certificaciones}
          onChange={e => setForm(f => ({ ...f, certificaciones: e.target.value }))} />
      </div>
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button type="submit" disabled={isPending} className="btn-primary flex-1">
          {isPending ? 'Guardando...' : inicial ? 'Actualizar' : 'Crear guardia'}
        </button>
      </div>
    </form>
  )
}

export default function GuardiasPage() {
  const qc = useQueryClient()
  const [modal, setModal] = useState(null)
  const [busqueda, setBusqueda] = useState('')

  const { data: guardias, isLoading } = useQuery({
    queryKey: ['guardias'],
    queryFn: () => seguridadService.listarGuardias(),
    select: r => r.data,
  })

  const { data: usuarios, isLoading: isUsersLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => usuariosService.listar(),
    select: r => r.data,
  })

  const { data: instalaciones, isLoading: isInstalacionesLoading } = useQuery({
    queryKey: ['instalaciones'],
    queryFn: () => seguridadService.listarInstalaciones(),
    select: r => r.data,
  })

  const { mutate: toggleActivo } = useMutation({
    mutationFn: ({ id, activo }) => seguridadService.actualizarGuardia(id, { activo }),
    onSuccess: (_, vars) => {
      toast.success(vars.activo ? 'Guardia activado' : 'Guardia desactivado')
      qc.invalidateQueries({ queryKey: ['guardias'] })
    },
    onError: e => toast.error(e.response?.data?.detail || e.message),
  })

  const refresh = () => { qc.invalidateQueries({ queryKey: ['guardias'] }); setModal(null) }

  const filtrados = guardias?.filter(g =>
    !busqueda || [g.nombre, g.apellido, g.rut, g.email]
      .filter(Boolean).some(v => v.toLowerCase().includes(busqueda.toLowerCase()))
  )

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-slide-up">
      <Modal open={!!modal} onClose={() => setModal(null)}
        title={modal?.guardia ? 'Editar guardia' : 'Nuevo guardia'} size="lg">
        {modal && <FormGuardia
          inicial={modal.guardia}
          users={usuarios}
          instalaciones={instalaciones}
          onClose={() => setModal(null)}
          onSuccess={refresh}
        />}
      </Modal>

      <PageHeader
        icon={Users}
        title="Guardias"
        subtitle="Personal de seguridad registrado"
        action={<button onClick={() => setModal({})} className="btn-primary"><Plus className="w-5 h-5" />Nuevo</button>}
      />

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94a3b8]" />
        <input className="input-field pl-12" placeholder="Buscar por nombre, RUT..."
          value={busqueda} onChange={e => setBusqueda(e.target.value)} />
      </div>

      {isLoading || isUsersLoading || isInstalacionesLoading ? <Spinner /> : filtrados?.length === 0 ? (
        <EmptyState icon={Users} title="Sin guardias" description="Registre el primer guardia."
          action={<button onClick={() => setModal({})} className="btn-primary"><Plus className="w-5 h-5" />Agregar</button>} />
      ) : (
        <div className="space-y-3">
          {filtrados?.map(g => (
            <div key={g.id} className="card p-5 flex items-center gap-4">
              <div className="w-12 h-12 bg-brand/20 rounded-full flex items-center justify-center text-brand font-bold text-xl flex-shrink-0">
                {g.nombre?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-lg">{g.nombre} {g.apellido}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[#94a3b8] text-sm">
                  {g.rut && <span>RUT: {g.rut}</span>}
                  {g.telefono && <span>{g.telefono}</span>}
                  {g.email && <span>{g.email}</span>}
                </div>
                {g.certificaciones && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {g.certificaciones.split(',').map((c, i) => (
                      <span key={i} className="badge-blue text-xs">{c.trim()}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={g.activo ? 'badge-green' : 'badge-gray'}>
                  {g.activo ? 'Activo' : 'Inactivo'}
                </span>
                <button onClick={() => setModal({ guardia: g })} className="btn-ghost !min-h-0 !p-2">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => toggleActivo({ id: g.id, activo: !g.activo })}
                  className="btn-ghost !min-h-0 !p-2">
                  {g.activo
                    ? <ToggleRight className="w-5 h-5 text-green-400" />
                    : <ToggleLeft className="w-5 h-5 text-[#94a3b8]" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
