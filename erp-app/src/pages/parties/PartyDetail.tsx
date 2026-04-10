import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import PaymentForm from '../../components/forms/PaymentForm'
import PartyForm from '../../components/forms/PartyForm'
import AttachmentsPanel from '../../components/AttachmentsPanel'
import DocumentDetail from '../../components/DocumentDetail'
import type { Client, Supplier, Document, Payment } from '../../types'

const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

const METHOD_LABELS: Record<string, string> = {
  cash: '💵 Espèces', bank: '🏦 Virement', cheque: '📝 Chèque', lcn: '📋 LCN', avoir: '↩️ Avoir',
}
const STATUS_DOC: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Brouillon',  cls: 'badge-gray' },
  confirmed: { label: 'Confirmée', cls: 'badge-blue' },
  partial:   { label: 'Partiel',   cls: 'badge-orange' },
  paid:      { label: 'Payée',     cls: 'badge-green' },
  delivered: { label: 'Livrée',    cls: 'badge-green' },
  cancelled: { label: 'Annulée',   cls: 'badge-red' },
}
const DOC_LABELS: Record<string, string> = {
  invoice: 'Facture', quote: 'Devis', bl: 'BL', proforma: 'Proforma',
  avoir: 'Avoir', purchase_order: 'BC', purchase_invoice: 'Facture Fourn.',
  bl_reception: 'Bon Réception', import_invoice: 'Importation',
}
const DOC_TYPES_CLIENT = ['invoice', 'quote', 'bl', 'proforma', 'avoir']
const DOC_TYPES_SUPPLIER = ['purchase_invoice', 'import_invoice', 'purchase_order', 'bl_reception']

type Tab = 'documents' | 'payments' | 'cheques' | 'files'

interface Props {
  id: number
  type: 'client' | 'supplier'
  onClose?: () => void
  onUpdated?: () => void
}

export default function PartyDetail({ id, type, onUpdated }: Props) {
  const [party, setParty]       = useState<(Client | Supplier) & { balance?: number } | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [payments, setPayments]   = useState<Payment[]>([])
  const [tab, setTab]             = useState<Tab>('documents')
  const [docTypeFilter, setDocTypeFilter] = useState('all')
  const [paymentModal, setPaymentModal]   = useState(false)
  const [editModal, setEditModal]         = useState(false)
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null)
  const [loading, setLoading]     = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const fn = type === 'client' ? api.getClient : api.getSupplier
      const [p, docs, pays] = await Promise.all([
        fn(id),
        api.getDocuments({ party_id: id, limit: 9999 }),
        api.getPayments({ party_id: id, party_type: type }),
      ])
      setParty(p as any)
      setDocuments((docs as any).rows ?? [])
      setPayments((pays as any) ?? [])
    } finally {
      setLoading(false)
    }
  }, [id, type])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <div className="text-center"><div className="text-2xl mb-2 animate-pulse">⏳</div><div className="text-sm">Chargement...</div></div>
    </div>
  )
  if (!party) return (
    <div className="flex items-center justify-center h-64 text-gray-400">Introuvable</div>
  )

  // ── Calculs (après guard) ─────────────────────────────────────────────────
  // balance = source unique de vérité depuis le backend
  // = total_invoiced - total_payments_cleared (incluant avances)
  const balance = (party as any).balance ?? 0
  const invoiceTypes = type === 'client' ? ['invoice'] : ['purchase_invoice', 'import_invoice']
  const totalInvoiced = documents
    .filter(d => invoiceTypes.includes(d.type) && ['confirmed', 'partial', 'paid', 'delivered'].includes(d.status))
    .reduce((s, d) => s + d.total_ttc, 0)
  const totalPaid = Math.max(0, totalInvoiced - balance)

  const cheques = payments.filter(p => p.method === 'cheque' || p.method === 'lcn')
  const pendingCheques = cheques.filter(p => p.status === 'pending')

  const docTypes = type === 'client' ? DOC_TYPES_CLIENT : DOC_TYPES_SUPPLIER
  const filteredDocs = docTypeFilter === 'all'
    ? documents
    : documents.filter(d => d.type === docTypeFilter)

  // آخر تعامل
  const lastDoc = documents.sort((a, b) => b.date.localeCompare(a.date))[0]
  const lastPay = payments.sort((a, b) => b.date.localeCompare(a.date))[0]

  const openInvoices = documents.filter(d =>
    invoiceTypes.includes(d.type) && ['confirmed', 'partial'].includes(d.status)
  ).length

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ── */}
      <div className="p-5 border-b border-gray-100 dark:border-gray-700 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-800 dark:text-white truncate">{party.name}</h2>
              <button onClick={() => setEditModal(true)}
                className="shrink-0 text-xs text-gray-400 hover:text-primary transition-colors px-2 py-0.5 rounded hover:bg-primary/5">
                ✏️ Modifier
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
              {party.phone   && <span>📞 {party.phone}</span>}
              {party.email   && <span>✉️ {party.email}</span>}
              {party.ice     && <span className="font-mono text-xs">ICE: {party.ice}</span>}
              {party.if_number && <span className="font-mono text-xs">IF: {party.if_number}</span>}
              {party.rc      && <span className="font-mono text-xs">RC: {party.rc}</span>}
              {party.address && <span>📍 {party.address}</span>}
            </div>
            {party.notes && (
              <div className="mt-1.5 text-xs text-gray-400 italic">{party.notes}</div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-gray-400 mb-0.5">Solde dû</div>
            <div className={`text-2xl font-bold ${balance > 0 ? 'text-orange-500' : 'text-green-600'}`}>
              {fmt(balance)} MAD
            </div>
            {openInvoices > 0 && (
              <div className="text-xs text-orange-400 mt-0.5">{openInvoices} facture(s) ouverte(s)</div>
            )}
            <button onClick={() => setPaymentModal(true)}
              className="btn-primary btn-sm mt-2 w-full justify-center">
              {type === 'client' ? '💰 Encaisser' : '💸 Régler'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total facturé',  value: fmt(totalInvoiced) + ' MAD', color: 'text-gray-700 dark:text-gray-200' },
            { label: 'Total encaissé', value: fmt(totalPaid) + ' MAD',     color: 'text-green-600' },
            { label: 'Solde dû',       value: fmt(balance) + ' MAD', color: balance > 0 ? 'text-orange-500' : 'text-green-600' },
          ].map(s => (
            <div key={s.label} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5 text-center">
              <div className="text-xs text-gray-400 mb-0.5">{s.label}</div>
              <div className={`font-bold text-sm ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Derniers échanges */}
        <div className="flex gap-3 text-xs text-gray-400">
          {lastDoc && <span>📄 Dernier doc: {new Date(lastDoc.date).toLocaleDateString('fr-FR')}</span>}
          {lastPay && <span>💳 Dernier paiement: {new Date(lastPay.date).toLocaleDateString('fr-FR')}</span>}
        </div>

        {/* Credit limit warning */}
        {type === 'client' && (party as Client).credit_limit > 0 && balance > (party as Client).credit_limit && (
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 text-sm text-red-700 dark:text-red-400">
            <span>🔴</span>
            <span className="font-semibold">Limite de crédit dépassée</span>
            <span className="text-red-500 ml-1 text-xs">
              Limite: {fmt((party as Client).credit_limit)} MAD · Dépassement: {fmt(balance - (party as Client).credit_limit)} MAD
            </span>
          </div>
        )}

        {/* Chèques en attente alert */}
        {pendingCheques.length > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            <span>⏳</span>
            <span>{pendingCheques.length} chèque(s)/LCN en attente d'encaissement</span>
            <button onClick={() => setTab('cheques')} className="ml-auto text-xs underline">Voir</button>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4">
        <div className="flex gap-1 py-1.5 overflow-x-auto">
          {([
            { id: 'documents', label: 'Documents', count: documents.length },
            { id: 'payments',  label: 'Paiements', count: payments.length },
            { id: 'cheques',   label: 'Chèques & LCN', count: cheques.length, alert: pendingCheques.length > 0 },
            { id: 'files',     label: 'Pièces jointes' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={'px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ' + (tab === t.id
                ? 'bg-white dark:bg-gray-700 text-primary shadow-sm border border-gray-200 dark:border-gray-600'
                : 'text-gray-500 hover:text-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/50')}>
              {t.label}
              {(t as any).count !== undefined && (
                <span className={'text-xs px-1.5 py-0.5 rounded-full ' + ((t as any).alert ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300')}>
                  {(t as any).count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto p-4">

        {/* Documents */}
        {tab === 'documents' && (
          <div className="space-y-3">
            <div className="flex gap-1 flex-wrap">
              {['all', ...docTypes].filter(t => t === 'all' || documents.some(d => d.type === t)).map(t => (
                <button key={t} onClick={() => setDocTypeFilter(t)}
                  className={'px-2.5 py-1 rounded-full text-xs font-medium transition-all ' + (docTypeFilter === t ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 hover:bg-gray-200')}>
                  {t === 'all' ? 'Tous' : DOC_LABELS[t] ?? t}
                  {t !== 'all' && <span className="ml-1 opacity-60">({documents.filter(d => d.type === t).length})</span>}
                </button>
              ))}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Numéro</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Date</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Type</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Total TTC</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-300">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredDocs.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">Aucun document</td></tr>
                )}
                {filteredDocs.map(d => {
                  const st = STATUS_DOC[d.status] ?? { label: d.status, cls: 'badge-gray' }
                  return (
                    <tr key={d.id} onMouseDown={e => { (e.currentTarget as any)._mdX = e.clientX; (e.currentTarget as any)._mdY = e.clientY }}
                  onClick={e => {
                    const el = e.currentTarget as any
                    if (Math.abs(e.clientX-(el._mdX??e.clientX))>5||Math.abs(e.clientY-(el._mdY??e.clientY))>5) return
                    if ((e.target as HTMLElement).closest('button')) return
                    setSelectedDocId(d.id)
                  }}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors">
                      <td className="px-3 py-2.5 font-mono text-xs font-bold text-primary">{d.number}</td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{new Date(d.date).toLocaleDateString('fr-FR')}</td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 text-xs">{DOC_LABELS[d.type] ?? d.type}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">{fmt(d.total_ttc)} MAD</td>
                      <td className="px-3 py-2.5 text-center"><span className={st.cls}>{st.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paiements */}
        {tab === 'payments' && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Date</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Mode</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Montant</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-300">Statut</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {payments.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">Aucun paiement</td></tr>
              )}
              {payments.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-3 py-2.5 text-gray-500 text-xs">{new Date(p.date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-2.5 text-xs">{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-primary">{fmt(p.amount)} MAD</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={['cleared','collected'].includes(p.status) ? 'badge-green' : ['bounced','rejected'].includes(p.status) ? 'badge-red' : 'badge-orange'}>
                      {['cleared','collected'].includes(p.status) ? '✅' : ['bounced','rejected'].includes(p.status) ? '❌' : '⏳'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-400 text-xs">{p.notes ?? '—'}</td>
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
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Type</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Numéro</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Banque</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-300">Montant</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Échéance</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-300">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {cheques.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-sm">Aucun chèque / LCN</td></tr>
              )}
              {cheques.map(p => {
                const isPending = p.status === 'pending'
                const daysLeft = p.due_date
                  ? Math.ceil((new Date(p.due_date).getTime() - Date.now()) / 86400000)
                  : null
                // Alertes uniquement pour les chèques en attente
                const isOverdue = isPending && daysLeft !== null && daysLeft < 0
                const isUrgent  = isPending && daysLeft !== null && daysLeft >= 0 && daysLeft <= 7
                return (
                  <tr key={p.id} className={'hover:bg-gray-50 dark:hover:bg-gray-700/30 ' + (isOverdue ? 'bg-red-50/40 dark:bg-red-900/10' : isUrgent ? 'bg-amber-50/40 dark:bg-amber-900/10' : '')}>
                    <td className="px-3 py-2.5">
                      <span className={p.method === 'lcn' ? 'badge-blue' : 'badge-gray'}>
                        {p.method === 'lcn' ? 'LCN' : 'Chèque'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{p.cheque_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 text-xs">{p.bank ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{fmt(p.amount)} MAD</td>
                    <td className="px-3 py-2.5 text-xs">
                      {p.due_date ? (
                        <span className={isOverdue ? 'text-red-600 font-semibold' : isUrgent ? 'text-amber-600 font-medium' : 'text-gray-600'}>
                          {new Date(p.due_date).toLocaleDateString('fr-FR')}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={['cleared','collected'].includes(p.status) ? 'badge-green' : ['bounced','rejected'].includes(p.status) ? 'badge-red' : 'badge-orange'}>
                        {['cleared','collected'].includes(p.status) ? '✅ Encaissé' : ['bounced','rejected'].includes(p.status) ? '❌ Rejeté' : '⏳ En attente'}
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
          <AttachmentsPanel entityType={type} entityId={id} />
        )}
      </div>

      {/* ── Modals ── */}
      <Modal open={paymentModal} onClose={() => setPaymentModal(false)} title="Enregistrer un paiement">
        <PaymentForm partyId={id} partyType={type}
          maxAmount={balance > 0 ? balance : undefined}
          onSaved={() => { setPaymentModal(false); load(); onUpdated?.() }}
          onCancel={() => setPaymentModal(false)} />
      </Modal>

      <Modal open={editModal} onClose={() => setEditModal(false)} title={'Modifier ' + party.name}>
        <PartyForm type={type} initial={party as any}
          onSaved={() => { setEditModal(false); load(); onUpdated?.() }}
          onCancel={() => setEditModal(false)} />
      </Modal>

      {selectedDocId !== null && (
        <Modal open onClose={() => setSelectedDocId(null)} title="Détails du document" size="xl">
          <DocumentDetail docId={selectedDocId}
            onUpdated={() => { load(); onUpdated?.() }}
            onClose={() => setSelectedDocId(null)} />
        </Modal>
      )}
    </div>
  )
}
