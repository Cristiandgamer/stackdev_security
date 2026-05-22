import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserCog, Plus, Pencil, ToggleLeft, ToggleRight, Search, Shield, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { usuariosService } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { Modal, Spinner, PageHeader, EmptyState } from '../components/index.jsx'

const ROL_BADGE = {
  admin:      'badge-red',
  supervisor: 'badge-yellow',
  usuario:    'badge-blue',
}

function FormUsuario({ inicial, onClose, onSuccess }) {
  const [form, setForm] = useState(inicial ? {
    username: inicial.username, email: inicial.email,
    nombre: inicial.nombre, apellido: inicial.apellido || '',
    rol: inicial.rol, password: '',
  } : { username: '', email: '', nombre: '', apellido: '', rol: 'usuario', password: '' })
  const [showPass, setShowPass] = useState(false)

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => inicial
      ? usuariosService.actualizar(inicial.id, data)
      : usuariosService.crear(data),
    onSuccess: () => { toast.success(inicial ? 'Usuario actualizado' : 'Usuario creado'); onSuccess() },
    onError: e => toast.error(e.response?.data?.detail || e.message),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.nombre.trim()) return toast.error('Ingrese el nombre')
    if (!inicial && (!form.username.trim() || !form.email.trim() || !form.password))
      return toast.error('Complete todos los campos requeridos')
    const payload = { ...form }
    if (!payload.password) delete payload.password
    mutate(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Nombre *</label>
          <input className="input-field" autoComplete="given-name" placeholder="Juan" value={form.nombre}
            onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
        </div>
        <div>
          <label className="label">Apellido</label>
          <input className="input-field" autoComplete="family-name" placeholder="Pérez" value={form.apellido}
            onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))} />
        </div>
      </div>

      <div>
        <label className="label">Correo electrónico *</label>
        <input className="input-field" type="email" autoComplete="email" placeholder="juan@empresa.cl" value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Usuario *</label>
          <input className="input-field" autoComplete="username" placeholder="juanperez" value={form.username}
            disabled={!!inicial}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
        </div>
        <div>
          <label className="label">Rol *</label>
          <select className="input-field" value={form.rol}
            onChange={e => setForm(f => ({ ...f, rol: e.target.value }))}>
            {['usuario','supervisor','admin'].map(r => (
              <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label">{inicial ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</label>
        <div className="relative">
          <input
            className="input-field pr-12"
            type={showPass ? 'text' : 'password'}
            autoComplete={inicial ? 'new-password' : 'current-password'}
            placeholder={inicial ? 'Dejar vacío para no cambiar' : 'Mínimo 8 caracteres'}
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          />
          <button type="button" onClick={() => setShowPass(v => !v)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#94a3b8] !min-h-0 p-1">
            {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button type="submit" disabled={isPending} className="btn-primary flex-1">
          {isPending ? 'Guardando...' : inicial ? 'Actualizar' : 'Crear usuario'}
        </button>
      </div>
    </form>
  )
}

export default function UsuariosPage() {
  const qc = useQueryClient()
  const { user: me } = useAuthStore()
  const [modal, setModal] = useState(null)
  const [busqueda, setBusqueda] = useState('')

  const { data: usuarios, isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => usuariosService.listar(),
    select: r => Array.isArray(r?.data) ? r.data : [],
  })

  const { mutate: toggleActivo } = useMutation({
    mutationFn: ({ id, activo }) => usuariosService.actualizar(id, { activo }),
    onSuccess: (_, v) => {
      toast.success(v.activo ? 'Usuario activado' : 'Usuario desactivado')
      qc.invalidateQueries({ queryKey: ['usuarios'] })
    },
    onError: e => toast.error(e.response?.data?.detail || e.message),
  })

  const refresh = () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); setModal(null) }

  const filtrados = usuarios?.filter(u =>
    !busqueda || [u.nombre, u.apellido, u.username, u.email]
      .filter(Boolean).some(v => v.toLowerCase().includes(busqueda.toLowerCase()))
  )

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-slide-up">
      <Modal open={!!modal} onClose={() => setModal(null)}
        title={modal?.usuario ? 'Editar usuario' : 'Nuevo usuario'} size="lg">
        {modal && <FormUsuario inicial={modal.usuario} onClose={() => setModal(null)} onSuccess={refresh} />}
      </Modal>

      <PageHeader
        icon={UserCog}
        title="Usuarios del sistema"
        subtitle="Administración de accesos y roles"
        action={<button onClick={() => setModal({})} className="btn-primary"><Plus className="w-5 h-5" />Nuevo</button>}
      />

      <div className="card p-4 flex items-center gap-3 border-l-4 border-l-brand">
        <Shield className="w-5 h-5 text-brand flex-shrink-0" />
        <p className="text-[#94a3b8] text-sm">
          <strong className="text-white">Admin:</strong> acceso total.
          <strong className="text-white"> Supervisor:</strong> gestión de turnos/guardias.
          <strong className="text-white"> Usuario:</strong> guardia (ronda e incidentes).
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94a3b8]" />
        <input className="input-field pl-12" placeholder="Buscar por nombre, usuario o correo..."
          value={busqueda} onChange={e => setBusqueda(e.target.value)} />
      </div>

      {isLoading ? <Spinner /> : filtrados?.length === 0 ? (
        <EmptyState icon={UserCog} title="Sin usuarios" description="Cree el primer usuario."
          action={<button onClick={() => setModal({})} className="btn-primary"><Plus className="w-5 h-5" />Crear usuario</button>} />
      ) : (
        <div className="space-y-2">
          {filtrados?.map(u => (
            <div key={u.id} className="card px-5 py-4 flex items-center gap-4">
              <div className="w-11 h-11 bg-brand/20 rounded-full flex items-center justify-center text-brand font-bold text-xl flex-shrink-0">
                {u.nombre?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold">
                  {u.nombre} {u.apellido}
                  {u.id === me?.id && <span className="text-[#94a3b8] text-sm ml-2">(tú)</span>}
                </p>
                <p className="text-[#94a3b8] text-sm">{u.username} · {u.email}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                <span className={ROL_BADGE[u.rol] || 'badge-gray'}>{u.rol}</span>
                <span className={u.activo ? 'badge-green' : 'badge-gray'}>
                  {u.activo ? 'Activo' : 'Inactivo'}
                </span>
                <button onClick={() => setModal({ usuario: u })} className="btn-ghost !min-h-0 !p-2">
                  <Pencil className="w-4 h-4" />
                </button>
                {u.id !== me?.id && (
                  <button onClick={() => toggleActivo({ id: u.id, activo: !u.activo })}
                    className="btn-ghost !min-h-0 !p-2"
                    title={u.activo ? 'Desactivar' : 'Activar'}>
                    {u.activo
                      ? <ToggleRight className="w-5 h-5 text-green-400" />
                      : <ToggleLeft className="w-5 h-5 text-[#94a3b8]" />
                    }
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
