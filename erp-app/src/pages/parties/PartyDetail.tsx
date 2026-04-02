import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import PaymentForm from '../../components/forms/PaymentForm'
import AttachmentsPanel from '../../components/AttachmentsPanel'
import type { Client, Supplier, Document, Payment } from '../../types'

interface Props {
  id: number
  type: 'client' | 'supplier'
  onClose: () => void
}

type Tab = 'documents' | 'payments' | 'cheques' | 'files' | 'balance'

export default function PartyDetail({ id, type }: Omit<Props, 'onClose'> & { onClose?: () => void }) {
  const [party, setParty] = useState<(Client | Supplier) & { balance?: number } | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [tab, setTab] = useState<Tab>('documents')
  const [docTypeFilter, setDocTypeFilter] = useState<string>('all')
  const [paymentModal, setPaymentModal] = useState(false)
  const [loading, setLoading] = useState(true)

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const fn = type === 'client' ? api.getClient : api.getSupplier
      const p = await fn(id) as any
      setParty(p)

      const docs = await api.getDocuments({ party_id: id, limit: 100 }) as any
      setDocuments(docs.rows ?? [])

      const pays = await api.getPayments({ party_id: id, party_type: type }) as Payment[]
      setPayments(pays ?? [])
    } finally {
      setLoading(false)
    }
  }, [id, type])

  useEffect(() => { load() }, [load])

  const cheques = payments.filter(p => p.method === 'cheque' || p.method === 'lcn')
  const totalInvoiced = documents
    .filter(d => d.type === 'invoice' && d.status !== 'cancelled')
    .reduce((s, d) => s + d.total_ttc, 0)
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0)
  const balance = totalInvoiced - totalPaid

  const DOC_TYPES = [
    { value: 'all',             label: 'Tous' },
    { value: 'invoice',         label: 'Factures' },
    { value: 'quote',           label: 'Devis' },
    { value: 'bl',              label: 'Bons de Livraison' },
    { value: 'proforma',        label: 'Proforma' },
    { value: 'avoir',           label: 'Avoirs' },
    { value: 'purchase_order',  label: 'Bons de Commande' },
    { value: 'purchase_invoice',label: 'Factures Fournisseur' },
  ]

  const DOC_LABELS: Record<string, string> = {
    invoice: 'Facture', quote: 'Devis', bl: 'Bon de Livraison',
    proforma: 'Proforma', avoir: 'Avoir', purchase_order: 'Bon de Commande',
    purchase_invoice: 'Facture Fourn.', bl_reception: 'Bon de Réception',
    import_invoice: 'Importation',
  }

  const filteredDocs = docTypeFilter === 'all'
    ? documents
    : documents.filter(d => d.type === docTypeFilter)

  const STATUS_BADGE: Record<string, string> = {
    draft: 'badge-gray', confirmed: 'badge-blue', partial: 'badge-orange',
    paid: 'badge-green', cancelled: 'badge-red',
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">Chargement...</div>
  )
  if (!party) return (
    <div className="flex items-center justify-center h-64 text-gray-400">Introuvable</div>
  )

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">{party.name}</h2>
            <div className="mt-2 space-y-1 text-sm text-gray-500">
              {party.phone && <div>📞 {party.phone}</div>}
              {party.email && <div>✉️ {party.email}</div>}
              {party.ice   && <div className="font-mono">ICE: {party.ice}</div>}
              {party.address && <div>📍 {party.address}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-1">Solde</div>
            <div className={`text-2xl font-bold ${balance > 0 ? 'text-orange-500' : 'text-green-600'}`}>
              {fmt(balance)} MAD
            </div>
            {type === 'client' && (
              <button onClick={() => setPaymentModal(true)} className="btn-primary btn-sm mt-2">
                💰 Encaisser
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            { label: 'Total facturé', value: fmt(totalInvoiced) + ' MAD', color: 'text-gray-700' },
            { label: 'Total payé',    value: fmt(totalPaid)    + ' MAD', color: 'text-green-600' },
            { label: 'Reste à payer', value: fmt(balance)      + ' MAD', color: balance > 0 ? 'text-orange-500' : 'text-green-600' },
          ].map(s => (
            <div key={s.label} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">{s.label}</div>
              <div className={`font-bold text-sm ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4">
        <div className="flex gap-1 py-1.5">
          {([
            { id: 'documents', label: `Documents (${documents.length})` },
            { id: 'payments',  label: `Paiements (${payments.length})` },
            { id: 'cheques',   label: `Chèques & LCN (${cheques.length})` },
            { id: 'files',     label: 'Pièces jointes' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all
                ${tab === t.id
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm border border-gray-200 dark:border-gray-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {/* Documents */}
        {tab === 'documents' && (
          <>
            <div className="flex gap-1 flex-wrap mb-3">
              {DOC_TYPES.filter(t => t.value === 'all' || documents.some(d => d.type === t.value)).map(t => (
                <button key={t.value} onClick={() => setDocTypeFilter(t.value)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all
                    ${docTypeFilter === t.value ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 hover:bg-gray-200'}`}>
                  {t.label}
                  {t.value !== 'all' && (
                    <span className="ml-1 opacity-70">({documents.filter(d => d.type === t.value).length})</span>
                  )}
                </button>
              ))}
            </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Numéro</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Date</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Total TTC</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredDocs.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">Aucun document</td></tr>
              )}
              {filteredDocs.map(d => (
                <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-3 py-2 font-mono text-xs font-bold text-primary">{d.number}</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(d.date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-2 text-gray-600">{DOC_LABELS[d.type] ?? d.type}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmt(d.total_ttc)} MAD</td>
                  <td className="px-3 py-2 text-center">
                    <span className={STATUS_BADGE[d.status] ?? 'badge-gray'}>{d.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}

        {/* Paiements */}
        {tab === 'payments' && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Date</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Mode</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Montant</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600">Statut</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {payments.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">Aucun paiement</td></tr>
              )}
              {payments.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-3 py-2 text-gray-500">{new Date(p.date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-2 capitalize">{p.method}</td>
                  <td className="px-3 py-2 text-right font-semibold text-green-600">{fmt(p.amount)} MAD</td>
                  <td className="px-3 py-2 text-center">
                    <span className={p.status === 'collected' ? 'badge-green' : p.status === 'rejected' ? 'badge-red' : 'badge-orange'}>
                      {p.status === 'collected' ? '✅' : p.status === 'rejected' ? '❌' : '⏳'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-400 text-xs">{p.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Chèques & LCN */}
        {tab === 'cheques' && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Numéro</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Banque</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Montant</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Échéance</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {cheques.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">Aucun chèque / LCN</td></tr>
              )}
              {cheques.map(p => {
                const daysLeft = p.due_date
                  ? Math.ceil((new Date(p.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  : null
                const isUrgent = daysLeft !== null && daysLeft <= 7 && daysLeft >= 0
                return (
                  <tr key={p.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${isUrgent ? 'bg-orange-50/50' : ''}`}>
                    <td className="px-3 py-2">
                      <span className={p.method === 'lcn' ? 'badge-blue' : 'badge-gray'}>
                        {p.method === 'lcn' ? 'LCN' : 'Chèque'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{p.cheque_number ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{p.bank ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmt(p.amount)} MAD</td>
                    <td className="px-3 py-2">
                      {p.due_date ? (
                        <span className={isUrgent ? 'text-orange-500 font-medium' : 'text-gray-600'}>
                          {new Date(p.due_date).toLocaleDateString('fr-FR')}
                          {daysLeft !== null && daysLeft >= 0 && ` (${daysLeft}j)`}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={p.status === 'collected' ? 'badge-green' : p.status === 'rejected' ? 'badge-red' : 'badge-orange'}>
                        {p.status === 'collected' ? '✅ Encaissé' : p.status === 'rejected' ? '❌ Rejeté' : '⏳ En attente'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {/* Pièces jointes */}
        {tab === 'files' && (
          <div className="p-2">
            <AttachmentsPanel
              entityType={type}
              entityId={id}
            />
          </div>
        )}
      </div>

      {/* Payment Modal */}
      <Modal open={paymentModal} onClose={() => setPaymentModal(false)} title="Enregistrer un paiement">
        <PaymentForm
          partyId={id}
          partyType={type}
          maxAmount={balance > 0 ? balance : undefined}
          onSaved={() => { setPaymentModal(false); load() }}
          onCancel={() => setPaymentModal(false)}
        />
      </Modal>
    </div>
  )
}
