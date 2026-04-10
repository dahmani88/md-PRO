import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Pagination from '../../components/ui/Pagination'
import Drawer from '../../components/ui/Drawer'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import DocumentDetail from '../../components/DocumentDetail'
import type { StockMovement } from '../../types'

const LIMIT = 50

export default function MovementsList() {
  const [rows, setRows]     = useState<StockMovement[]>([])
  const [total, setTotal]   = useState(0)
  const [page, setPage]     = useState(1)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'applied'>('all')
  const [search, setSearch] = useState('')
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<StockMovement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const applied = filter === 'all' ? undefined : filter === 'applied'
      const result = await api.getStockMovements({ applied, page, limit: LIMIT }) as any
      // handler يرجع array أو paginated object
      if (Array.isArray(result)) {
        setRows(result)
        setTotal(result.length)
      } else {
        setRows(result.rows ?? result)
        setTotal(result.total ?? result.length)
      }
    } finally {
      setLoading(false)
    }
  }, [filter, page])

  useEffect(() => { load() }, [load])

  // reset page عند تغيير الفلتر
  useEffect(() => { setPage(1) }, [filter])

  useEffect(() => {
    const handler = () => load()
    window.addEventListener('app:refresh', handler)
    return () => window.removeEventListener('app:refresh', handler)
  }, [load])

  async function handleApply(id: number) {
    try {
      await api.applyStockMovement(id)
      toast('Mouvement appliqué ✅')
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  async function handleDelete(m: StockMovement) {
    setConfirmDelete(m)
  }

  async function doDelete(m: StockMovement) {
    try {
      if (m.document_id) {
        await api.cancelDocument(m.document_id)
        toast('Document annulé', 'warning')
      } else {
        await api.deleteStockMovement(m.id)
        toast('Mouvement supprimé', 'warning')
      }
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setConfirmDelete(null)
    }
  }

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  const DOC_TYPE_LABELS: Record<string, string> = {
    invoice: 'Facture', quote: 'Devis', bl: 'Bon de livraison',
    proforma: 'Proforma', avoir: 'Avoir', purchase_order: 'Bon de commande',
    bl_reception: 'Réception', purchase_invoice: 'Facture achat', import_invoice: 'Facture import',
  }

  function getSource(m: StockMovement): { text: string; clickable: boolean } {
    if (m.document_id) {
      const typeLabel = m.document_type ? (DOC_TYPE_LABELS[m.document_type] ?? m.document_type) : 'Document'
      const num = m.document_number ?? `#${m.document_id}`
      return { text: `${typeLabel} ${num}`, clickable: true }
    }
    if (m.production_id)     return { text: `Ordre de prod. #${m.production_id}`, clickable: false }
    if (m.transformation_id) return { text: `Transformation #${m.transformation_id}`, clickable: false }
    if (m.manual_ref)        return { text: m.manual_ref, clickable: false }
    return { text: '—', clickable: false }
  }

  const filtered = rows.filter(m =>
    !search || m.product_name?.toLowerCase().includes(search.toLowerCase()) ||
    m.product_code?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {(['all', 'pending', 'applied'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all
                ${filter === f
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}>
              {f === 'all' ? 'Tous' : f === 'pending' ? '⏳ En attente' : '✅ Appliqués'}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input max-w-xs"
          placeholder="Rechercher un produit..."
        />
        <button onClick={load} className="btn-secondary btn-sm ml-auto">↻ Actualiser</button>
      </div>

      {/* Table */}
      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm table-fixed border-collapse">
          <colgroup>
            <col style={{ width: '88px' }} />
            <col style={{ width: '180px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '96px' }} />
            <col style={{ width: '120px' }} />
            <col style={{ width: '168px' }} />
            <col style={{ width: '130px' }} />
            <col style={{ width: '120px' }} />
          </colgroup>
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 [&_th]:border [&_th]:border-gray-200 dark:[&_th]:border-gray-600">
            <tr className="divide-x divide-gray-200 dark:divide-gray-600">
              <th className="px-2 py-3 text-center align-middle font-medium text-gray-600 whitespace-nowrap">Date</th>
              <th className="px-3 py-3 text-center align-middle font-medium text-gray-600">Produit</th>
              <th className="px-2 py-3 text-center align-middle font-medium text-gray-600 whitespace-nowrap">Mouvement</th>
              <th className="px-2 py-3 text-center align-middle font-medium text-gray-600 whitespace-nowrap">Quantité</th>
              <th className="px-2 py-3 text-center align-middle font-medium text-gray-600 whitespace-nowrap">Coût unitaire</th>
              <th className="px-2 py-3 text-center align-middle font-medium text-gray-600 whitespace-nowrap">CMUP avant → après</th>
              <th className="px-2 py-3 text-center align-middle font-medium text-gray-600 whitespace-nowrap">Source</th>
              <th className="px-2 py-3 text-center align-middle font-medium text-gray-600 whitespace-nowrap">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700 [&_td]:border [&_td]:border-gray-100 dark:[&_td]:border-gray-700">
            {loading && [...Array(5)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                {[...Array(8)].map((_, j) => (
                  <td key={j} className="px-3 py-3">
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                  </td>
                ))}
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-16">
                <div className="text-4xl mb-3">📋</div>
                <div className="text-gray-500 font-medium">Aucun mouvement</div>
                <div className="text-gray-400 text-xs mt-1">Les mouvements apparaissent lors de la confirmation des documents</div>
              </td></tr>
            )}
            {!loading && filtered.map(m => (
              <tr key={m.id} className="group hover:bg-gray-50 dark:hover:bg-gray-700/30 divide-x divide-gray-100 dark:divide-gray-700">
                {/* Date */}
                <td className="px-2 py-3 text-center align-middle text-gray-500 text-xs whitespace-nowrap">
                  {new Date(m.date).toLocaleDateString('fr-FR')}
                </td>
                {/* Produit */}
                <td className="px-3 py-3 min-w-0 text-center align-middle">
                  <div className="font-medium truncate">{m.product_name}</div>
                  <div className="text-xs text-gray-400 font-mono truncate">{m.product_code} · {m.unit}</div>
                </td>
                {/* Mouvement */}
                <td className="px-2 py-3 text-center align-middle">
                  <span className={`inline-flex items-center justify-center gap-1 px-2 py-1 rounded-full text-xs font-bold w-full
                    ${m.type === 'in'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                    {m.type === 'in' ? '▲ Entrée' : '▼ Sortie'}
                  </span>
                </td>
                {/* Quantité */}
                <td className="px-2 py-3 text-center align-middle">
                  <span className={`font-bold ${m.type === 'in' ? 'text-green-600' : 'text-red-500'}`}>
                    {m.type === 'in' ? '+' : '-'}{fmt(m.quantity)}
                  </span>
                </td>
                {/* Coût unitaire */}
                <td className="px-2 py-3 text-center align-middle text-gray-600 text-xs whitespace-nowrap">{fmt(m.unit_cost)} MAD</td>
                {/* CMUP */}
                <td className="px-2 py-3 text-center align-middle text-xs text-gray-500 whitespace-nowrap">
                  {m.applied
                    ? <span>{fmt(m.cmup_before)} <span className="text-gray-300">→</span> <span className="font-medium text-gray-700 dark:text-gray-300">{fmt(m.cmup_after)}</span></span>
                    : <span className="text-gray-400">{fmt(m.cmup_before)} → ?</span>
                  }
                </td>
                {/* Source */}
                <td className="px-2 py-3 min-w-0 text-center align-middle">
                  {(() => {
                    const src = getSource(m)
                    return src.clickable
                      ? <button
                          onClick={() => setSelectedDocId(m.document_id!)}
                          className="text-xs text-primary font-medium hover:underline truncate block w-full"
                          title={src.text}
                        >{src.text}</button>
                      : <span className="text-xs text-gray-500 truncate block">{src.text}</span>
                  })()}
                  {m.notes && <div className="text-xs text-gray-400 truncate mt-0.5">{m.notes}</div>}
                </td>
                {/* Statut */}
                <td className="px-2 py-3 text-center align-middle whitespace-nowrap">
                  {m.applied
                    ? <span className="badge-green">✅ Appliqué</span>
                    : <div className="relative inline-block">
                        <span className="badge-orange group-hover:hidden">⏳</span>
                        <div className="hidden group-hover:flex items-center gap-1 justify-center">
                          <button
                            onClick={() => handleApply(m.id)}
                            className="p-1 rounded-full bg-green-100 text-green-600 hover:bg-green-200 hover:scale-110 transition-all"
                            title="Appliquer"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          </button>
                          <button
                            onClick={() => handleDelete(m)}
                            className="p-1 rounded-full bg-red-100 text-red-500 hover:bg-red-200 hover:scale-110 transition-all"
                            title="Supprimer"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      </div>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-xs text-gray-500">
          <span>{total} mouvement(s)</span>
          <span className="text-green-600">▲ entrées: {filtered.filter(m => m.type === 'in').length}</span>
          <span className="text-red-500">▼ sorties: {filtered.filter(m => m.type === 'out').length}</span>
          <span className="text-orange-500">⏳ en attente: {filtered.filter(m => !m.applied).length}</span>
        </div>
        <Pagination page={page} total={total} limit={LIMIT} onChange={setPage} />
      </div>

      {/* Document Drawer */}
      <Drawer open={selectedDocId !== null} onClose={() => setSelectedDocId(null)} title="Détails du document">
        {selectedDocId !== null && (
          <DocumentDetail docId={selectedDocId} onClose={() => setSelectedDocId(null)} onUpdated={load} />
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete?.document_id ? 'Annuler le document lié ?' : 'Supprimer ce mouvement ?'}
        message={confirmDelete?.document_id
          ? 'Le document lié à ce mouvement sera annulé. Cette action est irréversible.'
          : 'Ce mouvement en attente sera supprimé définitivement.'}
        confirmLabel="Confirmer"
        danger
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
