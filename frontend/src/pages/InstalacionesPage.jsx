import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, MapPin, QrCode, Pencil, Trash2, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import { seguridadService } from '../services/api'
import { Modal, Spinner, PageHeader, EmptyState, ConfirmDialog } from '../components/index.jsx'
import RondaModal from '../components/RondaModal'

const TIPOS = ['oficina','residencial','comercial','industrial','educacional','salud','otro']

function FormInstalacion({ inicial, onClose, onSuccess }) {
  const [form, setForm] = useState(inicial || {
    nombre:'', descripcion:'', direccion:'', ciudad:'',
    telefono:'', tipo:'', latitud:'', longitud:''
  })
  const [errors, setErrors] = useState({})

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => inicial
      ? seguridadService.actualizarInstalacion(inicial.id, data)
      : seguridadService.crearInstalacion(data),
    onSuccess: () => { toast.success(inicial ? 'Instalación actualizada' : 'Instalación creada'); onSuccess() },
    onError: e => toast.error(e.response?.data?.detail || e.message),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.nombre.trim()) errs.nombre = 'Requerido'
    if (!form.direccion.trim()) errs.direccion = 'Requerido'
    if (Object.keys(errs).length) return setErrors(errs)
    mutate({
      ...form,
      latitud:  form.latitud  ? parseFloat(form.latitud)  : null,
      longitud: form.longitud ? parseFloat(form.longitud) : null,
    })
  }

  const f = (k) => ({ value: form[k], onChange: e => { setForm(p => ({ ...p, [k]: e.target.value })); setErrors(p => ({ ...p, [k]: '' })) } })

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nombre *</label>
        <input className={`input-field ${errors.nombre?'border-red-500':''}`} placeholder="Ej: Centro Comercial Norte" {...f('nombre')} />
        {errors.nombre && <p className="text-red-400 text-sm mt-1">{errors.nombre}</p>}
      </div>

      <div>
        <label className="label">Dirección *</label>
        <input className={`input-field ${errors.direccion?'border-red-500':''}`} placeholder="Ej: Av. Balmaceda 1234" {...f('direccion')} />
        {errors.direccion && <p className="text-red-400 text-sm mt-1">{errors.direccion}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Ciudad</label>
          <input className="input-field" placeholder="La Serena" {...f('ciudad')} />
        </div>
        <div>
          <label className="label">Tipo</label>
          <select className="input-field" {...f('tipo')}>
            <option value="">Seleccionar</option>
            {TIPOS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Teléfono</label>
        <input className="input-field" placeholder="+56 9 1234 5678" {...f('telefono')} />
      </div>

      <div>
        <label className="label">Descripción</label>
        <textarea className="input-field resize-none" rows={2} {...f('descripcion')} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Latitud GPS</label>
          <input className="input-field" type="number" step="any" placeholder="-29.9027" {...f('latitud')} />
        </div>
        <div>
          <label className="label">Longitud GPS</label>
          <input className="input-field" type="number" step="any" placeholder="-71.2519" {...f('longitud')} />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
        <button type="submit" disabled={isPending} className="btn-primary flex-1">
          {isPending ? 'Guardando...' : inicial ? 'Actualizar' : 'Crear instalación'}
        </button>
      </div>
    </form>
  )
}

function PuntosModal({ instalacion, onClose }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ nombre:'', descripcion:'', latitud:'', longitud:'', orden:'0' })
  const [qrImg, setQrImg] = useState(null)

  const { data: puntos, isLoading } = useQuery({
    queryKey: ['puntos', instalacion.id],
    queryFn: () => seguridadService.listarPuntos(instalacion.id),
    select: r => Array.isArray(r?.data) ? r.data : [],
  })

  const { mutate: crear, isPending } = useMutation({
    mutationFn: (data) => seguridadService.crearPunto(instalacion.id, data),
    onSuccess: () => { toast.success('Punto creado'); qc.invalidateQueries({ queryKey: ['puntos', instalacion.id] }); setForm({ nombre:'', descripcion:'', latitud:'', longitud:'', orden:'0' }) },
    onError: e => toast.error(e.response?.data?.detail || e.message),
  })

  const { mutate: regenQR } = useMutation({
    mutationFn: (id) => seguridadService.regenerarQR(id),
    onSuccess: () => { toast.success('QR regenerado'); qc.invalidateQueries({ queryKey: ['puntos', instalacion.id] }) },
    onError: e => toast.error(e.response?.data?.detail || e.message),
  })

  const mostrarQR = async (id) => {
    try {
      const res = await seguridadService.obtenerQRImagen(id)
      setQrImg(res.data)
    } catch (e) { toast.error(e.message) }
  }

  const handleCrear = (e) => {
    e.preventDefault()
    if (!form.nombre.trim() || !form.latitud || !form.longitud) return toast.error('Complete nombre y coordenadas')
    crear({ ...form, latitud: parseFloat(form.latitud), longitud: parseFloat(form.longitud), orden: parseInt(form.orden) })
  }

  return (
    <>
      {qrImg && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setQrImg(null)}>
          <div className="bg-white rounded-2xl p-6 text-center max-w-xs w-full">
            <h3 className="text-[#0f2440] font-bold text-xl mb-3">{qrImg.nombre}</h3>
            <img src={qrImg.qr_image} alt="Código QR" className="w-48 h-48 mx-auto" />
            <p className="text-gray-500 text-sm mt-3">Imprima y pegue en el punto de control</p>
            <button onClick={() => setQrImg(null)} className="mt-4 bg-[#1e3a5f] text-white px-6 py-2 rounded-xl">Cerrar</button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <p className="text-[#94a3b8]">Instalación: <span className="text-white font-semibold">{instalacion.nombre}</span></p>

        {isLoading ? <Spinner size="sm" /> : puntos?.length === 0 ? (
          <p className="text-[#94a3b8] text-center py-4">Sin puntos de control configurados.</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {puntos?.map(p => (
              <div key={p.id} className="flex items-center gap-3 bg-[#263548] rounded-xl px-4 py-3">
                <div className="flex-1">
                  <p className="text-white font-medium">{p.nombre}</p>
                  <p className="text-[#94a3b8] text-sm">{p.latitud.toFixed(5)}, {p.longitud.toFixed(5)}</p>
                </div>
                <button onClick={() => mostrarQR(p.id)} className="btn-ghost !min-h-0 !p-2" title="Ver QR">
                  <QrCode className="w-4 h-4 text-brand" />
                </button>
                <button onClick={() => regenQR(p.id)} className="btn-ghost !min-h-0 !p-2" title="Regenerar QR">
                  <span className="text-[#94a3b8] text-xs">↻ QR</span>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-white/10 pt-4">
          <p className="text-white font-semibold mb-3">Agregar punto de control</p>
          <form onSubmit={handleCrear} className="space-y-3">
            <input className="input-field" placeholder="Nombre del punto *" value={form.nombre}
              onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
            <input className="input-field" placeholder="Descripción (opcional)" value={form.descripcion}
              onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} />
            <div className="grid grid-cols-3 gap-2">
              <input className="input-field" type="number" step="any" placeholder="Latitud *" value={form.latitud}
                onChange={e => setForm(p => ({ ...p, latitud: e.target.value }))} />
              <input className="input-field" type="number" step="any" placeholder="Longitud *" value={form.longitud}
                onChange={e => setForm(p => ({ ...p, longitud: e.target.value }))} />
              <input className="input-field" type="number" placeholder="Orden" value={form.orden}
                onChange={e => setForm(p => ({ ...p, orden: e.target.value }))} />
            </div>
            <button type="submit" disabled={isPending} className="btn-primary w-full">
              {isPending ? 'Creando...' : <><Plus className="w-4 h-4" />Agregar punto</>}
            </button>
          </form>
        </div>
        <button onClick={onClose} className="btn-secondary w-full">Cerrar</button>
      </div>
    </>
  )
}

export default function InstalacionesPage() {
  const qc = useQueryClient()
  const [modal, setModal] = useState(null) // null | 'crear' | { instalacion }
  const [puntosInst, setPuntosInst] = useState(null)
  const [rondaInst, setRondaInst] = useState(null)
  const [confirmarEliminar, setConfirmarEliminar] = useState(null)

  const { data: instalaciones, isLoading } = useQuery({
    queryKey: ['instalaciones'],
    queryFn: () => seguridadService.listarInstalaciones(),
    select: r => Array.isArray(r?.data) ? r.data : [],
  })

  const { mutate: eliminar } = useMutation({
    mutationFn: (id) => seguridadService.eliminarInstalacion(id),
    onSuccess: () => { toast.success('Instalación desactivada'); qc.invalidateQueries({ queryKey: ['instalaciones'] }) },
    onError: e => toast.error(e.response?.data?.detail || e.message),
  })

  const refresh = () => { qc.invalidateQueries({ queryKey: ['instalaciones'] }); setModal(null) }

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-slide-up">
      <ConfirmDialog
        open={!!confirmarEliminar}
        title="Desactivar instalación"
        message={`¿Desactivar "${confirmarEliminar?.nombre}"? Los guardias asignados perderán acceso.`}
        confirmLabel="Desactivar"
        onConfirm={() => { eliminar(confirmarEliminar.id); setConfirmarEliminar(null) }}
        onCancel={() => setConfirmarEliminar(null)}
      />

      <Modal open={modal === 'crear'} onClose={() => setModal(null)} title="Nueva instalación" size="lg">
        <FormInstalacion onClose={() => setModal(null)} onSuccess={refresh} />
      </Modal>

      {modal?.instalacion && (
        <Modal open onClose={() => setModal(null)} title="Editar instalación" size="lg">
          <FormInstalacion inicial={modal.instalacion} onClose={() => setModal(null)} onSuccess={refresh} />
        </Modal>
      )}

      {puntosInst && (
        <Modal open onClose={() => setPuntosInst(null)} title="Puntos de control" size="lg">
          <PuntosModal instalacion={puntosInst} onClose={() => setPuntosInst(null)} />
        </Modal>
      )}

      {rondaInst && (
        <RondaModal instalacion={rondaInst} onClose={() => setRondaInst(null)} onCreated={() => { qc.invalidateQueries({ queryKey: ['instalaciones'] }); setRondaInst(null) }} />
      )}

      <PageHeader
        icon={Building2}
        title="Instalaciones"
        subtitle="Gestión de sedes y puntos de control"
        action={<button onClick={() => setModal('crear')} className="btn-primary"><Plus className="w-5 h-5" />Nueva</button>}
      />

      {isLoading ? <Spinner /> : instalaciones?.length === 0 ? (
        <EmptyState icon={Building2} title="Sin instalaciones" description="Cree la primera instalación."
          action={<button onClick={() => setModal('crear')} className="btn-primary"><Plus className="w-5 h-5" />Crear instalación</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {instalaciones?.map(inst => (
            <div key={inst.id} className="card p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-brand/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-brand" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold truncate">{inst.nombre}</p>
                    {inst.ciudad && <p className="text-[#94a3b8] text-sm">{inst.ciudad}</p>}
                  </div>
                </div>
                <span className={inst.activa ? 'badge-green' : 'badge-gray'}>
                  {inst.activa ? 'Activa' : 'Inactiva'}
                </span>
              </div>

              <div className="flex items-center gap-1 text-[#94a3b8] text-sm">
                <MapPin className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{inst.direccion}</span>
              </div>

              {inst.tipo && (
                <span className="badge-blue capitalize">{inst.tipo}</span>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setPuntosInst(inst)} className="btn-secondary flex-1 !py-2 text-sm">
                  <MapPin className="w-4 h-4" />Puntos QR
                </button>
                <button onClick={() => setRondaInst(inst)} className="btn-primary flex-1 !py-2 text-sm">
                  <MapPin className="w-4 h-4" />Crear ronda
                </button>
                <button onClick={() => setModal({ instalacion: inst })} className="btn-ghost !py-2 !px-3">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => setConfirmarEliminar(inst)} className="btn-ghost !py-2 !px-3 hover:text-red-400">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
