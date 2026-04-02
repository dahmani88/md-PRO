import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import InvoiceForm from '../../components/forms/InvoiceForm'
import DocumentDetail from '../../components/DocumentDetail'
import BatchToolbar from '../../components/ui/BatchToolbar'
import Pagination from '../../components/ui/Pagination'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import type { Document, PaginatedResponse } from '../../types'

const STATUS_BADGE: Record<string, string> = {
  draft:     'badge-gray',
  confirmed: 'badge-blue',
  partial:   'badge-orange',
  paid:      'badge-green',
  cancelled: 'badge-red',
  delivered: 'badge-green',
}

const STATUS_LABEL: Record<string, string> = {
  draft:     'Brouillon',
  confirmed: 'Confirmée',
  partial:   'Partiel',
  paid:      'Payée',
  cancelled: 'Annulée',
  delivered: 'Livrée',
}

const DOC_LABELS: Record<string, string> = {
  invoice:  'Facture',
  quote:    'Devis',
  bl:       'Bon de Livraison',
  proforma: 'Proforma',
  avoir:    'Avoir',
  purchase_order:   'Bon de Commande',
  bl_reception:     'Bon de Réception',
  purchase_invoice: 'Facture Fournisseur',
  import_invoice:   'Importation',
}

interface Props { docType: string; hideNewButton?: boolean }

export default function InvoicesList({ docType, hideNewButton = false }: Props) {
  const [data, setData] = useState<PaginatedResponse<Document> | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === (data?.rows.length ?? 0)) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(data?.rows.map(d => d.id) ?? []))
    }
  }

  async function handleBatchExport() {
    try {
      await api.excelExportDocuments({ type: docType })
      toast('Excel exporté dans Téléchargements')
    } catch (e: any) { toast(e.message, 'error') }
  }

  useKeyboardShortcuts({ onNew: () => setModalOpen(true) })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.getDocuments({ type: docType, search, page, limit: 50 }) as PaginatedResponse<Document>
      setData(result)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [docType, search, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handler = () => load()
    window.addEventListener('app:refresh', handler)
    return () => window.removeEventListener('app:refresh', handler)
  }, [load])

  const formatAmount = (n: number) =>
    new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n) + ' MAD'

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        {!hideNewButton && (
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            + Nouveau {DOC_LABELS[docType] ?? 'Document'}
          </button>
        )}
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="input max-w-xs"
          placeholder="Rechercher..."
        />
        <div className="ml-auto flex gap-2">
          <button onClick={async () => {
            try {
              const r = await api.excelExportDocuments({ type: docType }) as any
              if (r?.path) toast('✅ Fichier Excel enregistré')
            } catch (e: any) { toast(e.message, 'error') }
          }} className="btn-secondary btn-sm">📥 Excel</button>
        </div>
      </div>

      {/* Table */}
      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
            <tr>
              <th className="w-8 px-3 py-3">
                <input type="checkbox"
                  checked={selectedIds.size > 0 && selectedIds.size === (data?.rows.length ?? 0)}
                  onChange={toggleAll} />
              </th>
              <th className="px-3 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Numéro</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Date</th>
              <th className="px-3 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Client / Fournisseur</th>
              <th className="px-3 py-3 text-right font-medium text-gray-600 dark:text-gray-300">Total HT</th>
              <th className="px-3 py-3 text-right font-medium text-gray-600 dark:text-gray-300">Total TTC</th>
              <th className="px-3 py-3 text-center font-medium text-gray-600 dark:text-gray-300">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Chargement...</td></tr>
            )}
            {!loading && data?.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-16">
                  <div className="text-4xl mb-3">📄</div>
                  <div className="text-gray-500 font-medium">Aucun document</div>
                  <div className="text-gray-400 text-xs mt-1">Créez votre premier {DOC_LABELS[docType]?.toLowerCase()}</div>
                </td>
              </tr>
            )}
            {data?.rows.map(doc => (
              <tr key={doc.id}
                onClick={() => setSelectedDocId(doc.id)}
                className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer
                  ${selectedIds.has(doc.id) ? 'bg-primary/5' : ''}`}>
                <td className="px-3 py-3">
                  <input type="checkbox" checked={selectedIds.has(doc.id)}
                    onChange={() => toggleSelect(doc.id)} onClick={e => e.stopPropagation()} />
                </td>
                <td className="px-3 py-3 font-mono text-xs font-medium text-primary">{doc.number}</td>
                <td className="px-3 py-3 text-gray-600">{new Date(doc.date).toLocaleDateString('fr-FR')}</td>
                <td className="px-3 py-3 font-medium">{doc.party_name ?? '—'}</td>
                <td className="px-3 py-3 text-right text-gray-600">{formatAmount(doc.total_ht)}</td>
                <td className="px-3 py-3 text-right font-semibold">{formatAmount(doc.total_ttc)}</td>
                <td className="px-3 py-3 text-center">
                  <span className={STATUS_BADGE[doc.status] ?? 'badge-gray'}>
                    {STATUS_LABEL[doc.status] ?? doc.status}
                  </span>
                  {(doc as any).pending_stock_count > 0 && (
                    <span className="ml-1 badge-orange text-xs" title="Mouvements de stock en attente">⚠️ Stock</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total > 50 && (
        <Pagination page={page} total={data.total} limit={50} onChange={setPage} />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Nouveau ${DOC_LABELS[docType] ?? 'Document'}`}
        size="xl"
      >
        <InvoiceForm
          docType={docType}
          onSaved={() => { setModalOpen(false); load() }}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>

      <Drawer
        open={selectedDocId !== null}
        onClose={() => setSelectedDocId(null)}
        title="Détails du document"
      >
        {selectedDocId !== null && (
          <DocumentDetail
            docId={selectedDocId}
            onClose={() => setSelectedDocId(null)}
            onUpdated={load}
          />
        )}
      </Drawer>

      <BatchToolbar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={[
          { icon: '📥', label: 'Exporter Excel', onClick: handleBatchExport },
        ]}
      />
    </div>
  )
}
