import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth.store'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import ProductionForm from './ProductionForm'
import ProductionDetail from './ProductionDetail'

const STATUS_CFG = {
  draft:     { label: 'Brouillon', cls: 'badge-gray' },
  confirmed: { label: 'Confirmé',  cls: 'badge-green' },
  cancelled: { label: 'Annulé',    cls: 'badge-red' },
} as const

const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

export default function ProductionList() {
  const [rows, setRows]           = useState<any[]>([])
  const [loading, setLoading]     = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const { user } = useAuthStore()
  const userId = user?.id ?? 1

  async function handleConfirmDirect(id: number) {
    try {
      await api.confirmProduction(id, userId)
      toast('Production confirmée — Stock mis à jour ✅')
      load()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getProductionOrders() as any[]
      setRows([...data].sort((a, b) => b.id - a.id))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const h = () => load()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [load])

  const totalCost = rows.reduce((s, r) => s + (r.total_cost ?? 0), 0)
  const confirmed = rows.filter(r => r.status === 'confirmed').length
  const drafts    = rows.filter(r => r.status === 'draft').length
  const cancelled = rows.filter(r => r.status === 'cancelled').length
  void cancelled // used in filter tabs

  const filtered = statusFilter === 'all'
    ? rows
    : rows.filter(r => r.status === statusFilter)

  return (
    <div className="h-full flex flex-col gap-3">

      {/* ── Bouton ── */}
      <div className="flex items-center gap-3 shrink-0">
        <button className="btn-primary px-5 py-2.5 text-sm font-semibold shadow-sm"
          onClick={() => setModalOpen(true)}>
          + Nouvel Ordre de Production
        </button>
        <button onClick={load} className="btn-secondary btn-sm ml-auto">↻ Actualiser</button>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {[
          { label: 'Total ordres', value: String(rows.length),     color: 'text-primary',   bg: 'bg-primary/5',                     icon: '🏭', filter: 'all' },
          { label: 'Confirmés',    value: String(confirmed),       color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/10', icon: '✅', filter: 'confirmed' },
          { label: 'Brouillons',   value: String(drafts),          color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/10', icon: '📝', filter: 'draft' },
          { label: 'Coût total',   value: fmt(totalCost) + ' MAD', color: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-50 dark:bg-gray-700/30', icon: '💰', filter: null },
        ].map(c => (
          <div key={c.label}
            onClick={() => c.filter && setStatusFilter(statusFilter === c.filter ? 'all' : c.filter)}
            className={`card p-4 ${c.bg} transition-all
              ${c.filter ? 'cursor-pointer hover:shadow-md' : ''}
              ${statusFilter === c.filter ? 'ring-2 ring-primary/40' : ''}`}>
            <div className="text-lg mb-1">{c.icon}</div>
            <div className="text-xs text-gray-400 mb-1">{c.label}</div>
            <div className={`text-xl font-bold ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
          {[
            { v: 'all', l: 'Tous' },
            { v: 'draft', l: 'Brouillons' },
            { v: 'confirmed', l: 'Confirmés' },
            { v: 'cancelled', l: 'Annulés' },
          ].map(s => (
            <button key={s.v} onClick={() => setStatusFilter(s.v)}
              className={`px-3 py-1.5 transition-all ${statusFilter === s.v
                ? 'bg-primary text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}>
              {s.l}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-gray-500">{filtered.length} ordre(s)</span>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '80px' }} />
            <col style={{ width: '180px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '120px' }} />
            <col style={{ width: '120px' }} />
            <col style={{ width: '120px' }} />
          </colgroup>
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10 [&_th]:border [&_th]:border-gray-200 dark:[&_th]:border-gray-600">
            <tr>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Date</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Produit fini</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Quantité</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Coût unitaire</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Coût total</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Statut / Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700 [&_td]:border [&_td]:border-gray-100 dark:[&_td]:border-gray-700">
            {loading && [...Array(4)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                {[...Array(6)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16">
                <div className="text-4xl mb-3">🏭</div>
                <div className="text-gray-500 font-medium">
                  {statusFilter !== 'all' ? 'Aucun ordre avec ce statut' : 'Aucun ordre de production'}
                </div>
                {statusFilter === 'all' && (
                  <button onClick={() => setModalOpen(true)} className="btn-primary mt-3">+ Créer le premier</button>
                )}
              </td></tr>
            )}
            {!loading && filtered.map(r => (
              <tr key={r.id}
                onMouseDown={e => { (e.currentTarget as any)._mdX = e.clientX; (e.currentTarget as any)._mdY = e.clientY }}
                  onClick={e => {
                    const el = e.currentTarget as any
                    if (Math.abs(e.clientX-(el._mdX??e.clientX))>5||Math.abs(e.clientY-(el._mdY??e.clientY))>5) return
                    if ((e.target as HTMLElement).closest('button')) return
                    setSelectedId(r.id)
                  }}
                className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors
                  ${r.status === 'draft' ? 'border-l-2 border-l-amber-400' : ''}
                  ${r.status === 'cancelled' ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 text-center align-middle text-gray-500 text-xs whitespace-nowrap">
                  {new Date(r.date).toLocaleDateString('fr-FR')}
                </td>
                <td className="px-4 py-3 text-center align-middle">
                  <div className="font-semibold text-gray-800 dark:text-gray-100">{r.product_name}</div>
                  <div className="text-xs text-gray-400 font-mono">{r.product_code}</div>
                </td>
                <td className="px-4 py-3 text-center align-middle font-semibold">{fmt(r.quantity)} {r.unit}</td>
                <td className="px-4 py-3 text-center align-middle text-gray-600 dark:text-gray-300">{fmt(r.unit_cost)} MAD</td>
                <td className="px-4 py-3 text-center align-middle font-bold text-primary">{fmt(r.total_cost)} MAD</td>
                <td className="px-4 py-3 text-center align-middle" onClick={e => e.stopPropagation()}>
                  {r.status === 'draft' ? (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleConfirmDirect(r.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-colors shadow-sm">
                        ✅ Confirmer
                      </button>
                    </div>
                  ) : (
                    <span className={(STATUS_CFG as any)[r.status]?.cls ?? 'badge-gray'}>
                      {(STATUS_CFG as any)[r.status]?.label ?? r.status}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {!loading && filtered.length > 0 && (
            <tfoot className="sticky bottom-0 z-10 [&_tr]:bg-gray-50 dark:[&_tr]:bg-[#2a2a2a]">
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-t-2 border-gray-200 dark:border-gray-600 font-semibold text-sm">
                <td colSpan={4} className="px-4 py-3 text-gray-500">Total ({filtered.length})</td>
                <td className="px-4 py-3 text-right text-primary font-bold">
                  {fmt(filtered.reduce((s, r) => s + r.total_cost, 0))} MAD
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Modals ── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvel Ordre de Production" size="lg">
        <ProductionForm onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />
      </Modal>

      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} title="Détails — Ordre de Production">
        {selectedId !== null && (
          <ProductionDetail
            orderId={selectedId}
            onUpdated={() => { load(); setSelectedId(null) }}
          />
        )}
      </Drawer>
    </div>
  )
}
