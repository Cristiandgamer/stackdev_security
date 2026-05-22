import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Filter, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { seguridadService } from '../services/api'
import { Spinner, PageHeader, EmptyState } from '../components/index.jsx'

export default function AsistenciasPage() {
  const [filtroGuardia, setFiltroGuardia] = useState('')
  const [pagina, setPagina] = useState(0)
  const LIMIT = 30

  const { data: asistencias, isLoading } = useQuery({
    queryKey: ['asistencias', filtroGuardia, pagina],
    queryFn: () => seguridadService.listarAsistencia({
      guardia_id: filtroGuardia || undefined,
      skip: pagina * LIMIT,
      limit: LIMIT,
    }),
    select: r => r.data,
  })

  const { data: guardias } = useQuery({
    queryKey: ['guardias-activos'],
    queryFn: () => seguridadService.listarGuardias({ activo: true }),
    select: r => r.data,
  })

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-slide-up">
      <PageHeader
        icon={ClipboardList}
        title="Asistencias"
        subtitle="Registro de entradas y salidas"
      />

      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-[#94a3b8]" />
        <select className="input-field !w-auto !min-h-0 py-2 text-sm" value={filtroGuardia}
          onChange={e => { setFiltroGuardia(e.target.value); setPagina(0) }}>
          <option value="">Todos los guardias</option>
          {guardias?.map(g => (
            <option key={g.id} value={g.id}>
              {g.usuario?.nombre} {g.usuario?.apellido}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? <Spinner /> : asistencias?.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Sin asistencias" description="No se encontraron registros." />
      ) : (
        <>
          <div className="space-y-2">
            {asistencias?.map(a => (
              <div key={a.id} className="card px-5 py-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
                  ${a.tipo === 'entrada' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                  {a.tipo === 'entrada'
                    ? <ArrowUpCircle className="w-5 h-5 text-green-400" />
                    : <ArrowDownCircle className="w-5 h-5 text-red-400" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium capitalize">{a.tipo}</p>
                  <p className="text-[#94a3b8] text-sm">
                    {new Date(a.created_at).toLocaleString('es-CL')}
                    {a.ubicacion_texto && ` · ${a.ubicacion_texto}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="badge-gray capitalize">{a.metodo}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 justify-center">
            <button onClick={() => setPagina(p => Math.max(0, p-1))} disabled={pagina === 0}
              className="btn-secondary disabled:opacity-40">Anterior</button>
            <span className="text-[#94a3b8] flex items-center text-base">Pág. {pagina + 1}</span>
            <button onClick={() => setPagina(p => p+1)} disabled={asistencias?.length < LIMIT}
              className="btn-secondary disabled:opacity-40">Siguiente</button>
          </div>
        </>
      )}
    </div>
  )
}
