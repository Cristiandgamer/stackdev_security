import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, MapPin, Pencil, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { seguridadService } from '../services/api'
import { Modal, Spinner, PageHeader, EmptyState } from '../components/index.jsx'
import RondaModal from '../components/RondaModal'

function RondaEditForm({ ronda, onSave, onCancel, saving }) {
  const [nombre, setNombre] = useState(ronda.nombre || '')
  const [descripcion, setDescripcion] = useState(ronda.descripcion || '')
  const [activa, setActiva] = useState(ronda.activa)

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(ronda.id, { nombre, descripcion, activa })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nombre</label>
        <input className="input-field" value={nombre} onChange={e => setNombre(e.target.value)} />
      </div>
      <div>
        <label className="label">Descripción</label>
        <textarea className="input-field resize-none" rows={3} value={descripcion} onChange={e => setDescripcion(e.target.value)} />
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-[#94a3b8]">
          <input type="checkbox" checked={activa} onChange={e => setActiva(e.target.checked)} className="form-checkbox" />
          Activa
        </label>
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  )
}

export default function RondasPage() {
  const qc = useQueryClient()
  const [selectedInst, setSelectedInst] = useState(null)
  const [openCreate, setOpenCreate] = useState(false)
  const [openList, setOpenList] = useState(false)
  const [editingRonda, setEditingRonda] = useState(null)

  const { data: instalaciones, isLoading } = useQuery({
    queryKey: ['instalaciones'],
    queryFn: () => seguridadService.listarInstalaciones(),
    select: (r) => Array.isArray(r?.data) ? r.data : [],
  })

  const { data: rondas, refetch: refetchRondas, isFetching: loadingRondas } = useQuery({
    queryKey: ['rondas', selectedInst?.id],
    queryFn: () => seguridadService.listarRondas(selectedInst.id),
    select: (r) => Array.isArray(r?.data) ? r.data : [],
    enabled: !!selectedInst,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => seguridadService.actualizarRonda(id, data),
    onSuccess: () => {
      toast.success('Ronda actualizada')
      refetchRondas()
      setEditingRonda(null)
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => seguridadService.eliminarRonda(id),
    onSuccess: () => {
      toast.success('Ronda inactivada')
      refetchRondas()
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message),
  })

  const openRoundsForInst = (instalacion) => {
    setSelectedInst(instalacion)
    setOpenList(true)
  }

  const handleCreate = (instalacion) => {
    setSelectedInst(instalacion)
    setOpenCreate(true)
  }

  const handleSaveRound = (id, data) => {
    updateMutation.mutate({ id, data })
  }

  const handleDeleteRound = (id) => {
    deleteMutation.mutate(id)
  }

  const closeList = () => {
    setOpenList(false)
    setSelectedInst(null)
    setEditingRonda(null)
  }

  const closeCreate = () => {
    setOpenCreate(false)
    setSelectedInst(null)
    qc.invalidateQueries({ queryKey: ['instalaciones'] })
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
      <PageHeader
        title="Rondas"
        subtitle="Gestiona las rondas creadas por instalación y edita sus datos"
        action={
          <button onClick={() => handleCreate(instalaciones?.[0])} className="btn-primary" disabled={!instalaciones?.length}>
            <Plus className="w-4 h-4 mr-2" />Nueva ronda
          </button>
        }
      />

      {isLoading ? (
        <Spinner />
      ) : instalaciones?.length === 0 ? (
        <EmptyState icon={Building2} title="No hay instalaciones" description="Crea una instalación antes de crear una ronda." />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {instalaciones?.map((inst) => (
            <div key={inst.id} className="card p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[#94a3b8] uppercase tracking-wide text-xs">Instalación</p>
                  <h2 className="text-xl font-semibold text-white">{inst.nombre}</h2>
                  <p className="text-[#94a3b8] text-sm mt-1">{inst.direccion}</p>
                </div>
                <MapPin className="w-6 h-6 text-brand" />
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => openRoundsForInst(inst)} className="btn-secondary flex-1">Ver rondas</button>
                <button onClick={() => handleCreate(inst)} className="btn-primary flex-1">Crear ronda</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {openList && selectedInst && (
        <Modal open onClose={closeList} title={`Rondas en ${selectedInst.nombre}`} size="xl">
          {loadingRondas ? (
            <Spinner />
          ) : (
            <div className="space-y-4">
              <button onClick={() => handleCreate(selectedInst)} className="btn-primary w-full">Crear nueva ronda en esta instalación</button>
              {rondas?.length === 0 ? (
                <EmptyState icon={MapPin} title="Sin rondas" description="No hay rondas activas para esta instalación." />
              ) : (
                <div className="space-y-3">
                  {rondas?.map((ronda) => (
                    <div key={ronda.id} className="rounded-3xl border border-white/10 bg-[#0f2440] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold text-white">{ronda.nombre}</p>
                          <p className="text-[#94a3b8] text-sm mt-1">{ronda.descripcion || 'Sin descripción'}</p>
                        </div>
                        <div className="space-x-2">
                          <button onClick={() => setEditingRonda(ronda)} className="btn-ghost !py-2 !px-3" title="Editar ronda"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => handleDeleteRound(ronda.id)} className="btn-ghost !py-2 !px-3 text-red-400" title="Inactivar ronda"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-3 text-sm text-[#94a3b8]">
                        <span className={ronda.activa ? 'badge-green' : 'badge-gray'}>{ronda.activa ? 'Activa' : 'Inactiva'}</span>
                        <span>Creada: {new Date(ronda.created_at).toLocaleDateString('es-CL')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {openCreate && selectedInst && (
        <RondaModal instalacion={selectedInst} onClose={closeCreate} onCreated={() => { refetchRondas(); qc.invalidateQueries({ queryKey: ['instalaciones'] }) }} />
      )}

      {editingRonda && (
        <Modal open onClose={() => setEditingRonda(null)} title="Editar ronda" size="md">
          <RondaEditForm
            ronda={editingRonda}
            saving={updateMutation.isLoading}
            onSave={handleSaveRound}
            onCancel={() => setEditingRonda(null)}
          />
        </Modal>
      )}
    </div>
  )
}
