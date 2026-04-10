import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import PurchaseOrderForm from './PurchaseOrderForm'
import DocumentDetail from '../../components/DocumentDetail'
import SkeletonRows from '../../components/ui/SkeletonRows'
import type { Document, PaginatedResponse } from '../../types'

const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Brouillon', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  confirmed: { label: 'Confirmé',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  received:  { label: 'Reçu',      cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  partial:   { label: 'Partiel',    cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  cancelled: { label: 'Annulé',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
}

const FILTER_TABS = [
  { key: 'all',       label: 'Tous' },
  { key: 'draft',     label: 'Brouillons' },
  { key: 'confirmed', label: 'Confirmés' },
  { key: 'partial',   label: 'Partiels' },
  { key: 'received',  label: 'Reçus' },
  { key: 'cancelled', label: 'Annulés' },
]

export default function PurchaseOrdersList() {
  const [data, setData]           = useState<PaginatedResponse<Document> | null>(null)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('all')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout>>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const filters: any = { type: 'purchase_order', page, limit: 50 }
      if (search) filters.search = search
      if (statusFilter !== 'all') filters.status = statusFilter
      const r = await api.getDocuments(filters) as PaginatedResponse<Document>
      setData(r)
    } finally { setLoading(false) }
  }, [search, statusFilter, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, statusFilter])
  useEffect(() => {
    const h = () => load()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [load])

  function handleSearch(v: string) {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => setSearch(v), 300)
  }

  const rows = data?.rows ?? []
  const active      = rows.filter(d => d.status !== 'cancelled')
  const totalAmount = active.reduce((s, d) => s + d.total_ttc, 0)
  const received    = active.filter(d => (d.status as string) === 'received').length
  const pending     = active.filter(d => ['draft', 'confirmed', 'partial'].includes(d.status)).length

  const filtered = rows.filter(d => {
    if (d.status === 'cancelled' && statusFilter !== 'cancelled') return false
    if (dateFrom && d.date < dateFrom) return false
    if (dateTo   && d.date > dateTo)   return false
    return true
  })

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center justify-between shrink-0">
        <button className="btn-primary px-5 py-2.5 text-sm font-semibold shadow-sm" onClick={() => setModalOpen(true)}>
          + Nouveau Bon de Commande
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {[
          { label: 'Total BC',      value: String(active.length),     sub: 'Bons de commande actifs',    color: 'text-primary',    bg: 'bg-primary/5' },
          { label: 'Montant total', value: fmt(totalAmount) + ' MAD', sub: 'Hors annulés',               color: 'text-gray-700 dark:text-gray-200',  bg: 'bg-gray-50 dark:bg-gray-700/30' },
          { label: 'En attente',    value: String(pending),           sub: 'Draft + Confirmés',       color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/10', alert: pending > 0 },
          { label: 'Reçus',         value: String(received),          sub: 'Réceptions effectuées',   color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/10' },
        ].map(c => (
          <div key={c.label} className={`card p-4 ${c.bg} ${(c as any).alert ? 'border-amber-200 dark:border-amber-800' : ''}`}>
            <div className="text-xs text-gray-500 mb-1">{c.label}</div>
            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <input onChange={e => handleSearch(e.target.value)} className="input max-w-xs text-sm" placeholder="Rechercher..." />
        <select value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1) }} className="input w-36 text-sm">
          {FILTER_TABS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <input value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input w-36 text-sm" type="date" title="Date début" />
        <span className="text-gray-400 text-xs">→</span>
        <input value={dateTo} onChange={e => setDateTo(e.target.value)} className="input w-36 text-sm" type="date" title="Date fin" />
        {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-xs text-gray-400 hover:text-red-500">✕</button>}
      </div>

      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '80px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '180px' }} />
            <col style={{ width: '147px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '147px' }} />
            <col style={{ width: '80px' }} />
          </colgroup>
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10 [&_th]:border [&_th]:border-gray-200 dark:[&_th]:border-gray-600">
            <tr>
              <th className="px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Numéro</th>
              <th className="px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Date</th>
              <th className="px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Fournisseur</th>
              <th className="px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Total HT</th>
              <th className="px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">TVA</th>
              <th className="px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Total TTC</th>
              <th className="px-3 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700 [&_td]:border [&_td]:border-gray-100 dark:[&_td]:border-gray-700">
            {loading && <SkeletonRows cols={5} />}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-16">
                <div className="text-4xl mb-3">🛒</div>
                <div className="text-gray-500 font-medium">Aucun bon de commande</div>
                <div className="text-gray-400 text-xs mt-1">{statusFilter !== 'all' ? 'Essayez un autre filtre' : 'Créez votre premier BC'}</div>
              </td></tr>
            )}
            {filtered.map(doc => {
              const cfg = STATUS_CFG[doc.status] ?? STATUS_CFG.draft
              return (
                <tr key={doc.id} onMouseDown={e => { (e.currentTarget as any)._mdX = e.clientX; (e.currentTarget as any)._mdY = e.clientY }}
                  onClick={e => {
                    const el = e.currentTarget as any
                    if (Math.abs(e.clientX-(el._mdX??e.clientX))>5||Math.abs(e.clientY-(el._mdY??e.clientY))>5) return
                    if ((e.target as HTMLElement).closest('button')) return
                    setSelectedId(doc.id)
                  }}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <td className="px-3 py-3 text-center align-middle"><span className="font-mono text-xs font-semibold text-primary">{doc.number}</span></td>
                  <td className="px-3 py-3 text-center align-middle text-gray-500 text-xs">{new Date(doc.date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-3 text-center align-middle font-medium truncate">{doc.party_name ?? '—'}</td>
                  <td className="px-3 py-3 text-center align-middle text-gray-600">{fmt(doc.total_ht)} MAD</td>
                  <td className="px-3 py-3 text-center align-middle text-gray-500 text-xs">{fmt(doc.total_tva)} MAD</td>
                  <td className="px-3 py-3 text-center align-middle font-semibold">{fmt(doc.total_ttc)} MAD</td>
                  <td className="px-3 py-3 text-center align-middle">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {!loading && filtered.length > 0 && (
            <tfoot className="sticky bottom-0 z-10 [&_tr]:bg-gray-50 dark:[&_tr]:bg-[#2a2a2a]">
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-t-2 border-gray-200 dark:border-gray-600 font-semibold text-sm">
                <td colSpan={3} className="px-3 py-3 text-gray-500">Total ({filtered.length})</td>
                <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-200">{fmt(filtered.reduce((s, d) => s + d.total_ht, 0))} MAD</td>
                <td className="px-3 py-3 text-right text-gray-500">{fmt(filtered.reduce((s, d) => s + d.total_tva, 0))} MAD</td>
                <td className="px-3 py-3 text-right text-primary font-bold">{fmt(filtered.reduce((s, d) => s + d.total_ttc, 0))} MAD</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {(data?.total ?? 0) > 50 && (
        <div className="flex items-center justify-between shrink-0 text-xs text-gray-500">
          <span>{data?.total} BC</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn-secondary btn-sm disabled:opacity-40">←</button>
            <span className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">{page} / {Math.ceil((data?.total ?? 0) / 50)}</span>
            <button disabled={page >= Math.ceil((data?.total ?? 0) / 50)} onClick={() => setPage(p => p + 1)} className="btn-secondary btn-sm disabled:opacity-40">→</button>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau Bon de Commande" size="xl">
        <PurchaseOrderForm onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />
      </Modal>
      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} title="Détails Bon de Commande">
        {selectedId !== null && <DocumentDetail docId={selectedId} onClose={() => setSelectedId(null)} onUpdated={load} />}
      </Drawer>
    </div>
  )
}
