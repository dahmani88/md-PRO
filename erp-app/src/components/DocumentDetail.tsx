import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { toast } from './ui/Toast'
import Modal from './ui/Modal'
import PaymentForm from './forms/PaymentForm'
import AttachmentsPanel from './AttachmentsPanel'
import AvoirForm from '../pages/documents/AvoirForm'
import InvoiceForm from './forms/InvoiceForm'
import QuoteForm from '../pages/documents/QuoteForm'
import ProformaForm from '../pages/documents/ProformaForm'
import BLForm from '../pages/documents/BLForm'
import PurchaseOrderForm from '../pages/achats/PurchaseOrderForm'
import PurchaseInvoiceForm from '../pages/achats/PurchaseInvoiceForm'
import ImportInvoiceForm from '../pages/achats/ImportInvoiceForm'
import type { Document } from '../types'
import ConfirmDialog from './ui/ConfirmDialog'

const DOC_TYPE_LABEL: Record<string, string> = {
  invoice:          'Facture',
  quote:            'Devis',
  bl:               'Bon de Livraison',
  proforma:         'Proforma',
  avoir:            'Avoir',
  purchase_order:   'Bon de Commande',
  bl_reception:     'Bon de Réception',
  purchase_invoice: 'Facture Fournisseur',
  import_invoice:   'Importation',
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-gray', confirmed: 'badge-blue', partial: 'badge-orange',
  paid: 'badge-green', cancelled: 'badge-red', delivered: 'badge-green',
  received: 'badge-green',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', confirmed: 'Confirmée', partial: 'Partiel',
  paid: 'Payée', cancelled: 'Annulée', delivered: 'Livrée',
  received: 'Reçu',
}

// ── due date helper ──────────────────────────────────────────────────────────
function DueDateBanner({ doc }: { doc: Document }) {
  const inv = doc as any
  if (!inv.due_date || ['paid', 'cancelled'].includes(doc.status)) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due   = new Date(inv.due_date); due.setHours(0, 0, 0, 0)
  const days  = Math.ceil((due.getTime() - today.getTime()) / 86_400_000)

  if (days < 0)
    return (
      <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
        <span className="text-base">🔴</span>
        <span className="font-semibold">Retard de {Math.abs(days)} jour(s)</span>
        <span className="text-red-500 ml-1">— Échéance: {new Date(inv.due_date).toLocaleDateString('fr-FR')}</span>
      </div>
    )
  if (days === 0)
    return (
      <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg px-4 py-2.5 text-sm text-orange-700 dark:text-orange-400">
        <span className="text-base">🟠</span>
        <span className="font-semibold">Échéance aujourd'hui</span>
      </div>
    )
  if (days <= 7)
    return (
      <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
        <span className="text-base">🟡</span>
        <span className="font-semibold">{days} jour(s) restants</span>
        <span className="text-amber-500 ml-1">— Échéance: {new Date(inv.due_date).toLocaleDateString('fr-FR')}</span>
      </div>
    )
  return null
}

interface Props {
  docId: number
  onClose: () => void
  onUpdated: () => void
}

// ── Edit wrapper — charge les données existantes dans InvoiceForm ────────────
function EditInvoiceWrapper({ doc, onSaved, onCancel }: {
  doc: Document
  onSaved: () => void
  onCancel: () => void
}) {
  const [initialData, setInitialData] = useState<any>(null)

  useEffect(() => {
    api.getDocument(doc.id).then((fullDoc: any) => {
      setInitialData({
        docId:          fullDoc.id,
        date:           fullDoc.date,
        party_id:       fullDoc.party_id,
        notes:          fullDoc.notes,
        due_date:       fullDoc.due_date ?? '',
        payment_method: fullDoc.payment_method ?? 'cash',
        currency:       fullDoc.currency ?? 'MAD',
        exchange_rate:  fullDoc.exchange_rate ?? 1,
        lines: (fullDoc.lines ?? []).map((l: any) => ({
          product_id:  l.product_id,
          description: l.description ?? '',
          quantity:    l.quantity,
          unit_price:  l.unit_price,
          discount:    l.discount ?? 0,
          tva_rate:    l.tva_rate ?? 20,
        })),
      })
    })
  }, [doc.id])

  if (!initialData) return (
    <div className="p-8 text-center text-gray-400">
      <div className="text-2xl mb-2 animate-pulse">⏳</div>
      <div className="text-sm">Chargement des données...</div>
    </div>
  )

  return (
    <InvoiceForm
      docType={doc.type}
      editDocId={doc.id}
      defaultValues={initialData}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  )
}

// ── Edit wrapper pour Import Invoice ─────────────────────────────────────────
function EditImportWrapper({ doc, onSaved, onCancel }: {
  doc: Document
  onSaved: () => void
  onCancel: () => void
}) {
  const [initialData, setInitialData] = useState<any>(null)

  useEffect(() => {
    api.getDocument(doc.id).then((fullDoc: any) => {
      const extra = fullDoc.extra ?? {}
      setInitialData({
        docId:           fullDoc.id,
        date:            fullDoc.date,
        party_id:        fullDoc.party_id,
        notes:           fullDoc.notes,
        currency:        fullDoc.currency        ?? extra.currency        ?? 'EUR',
        exchange_rate:   Number(fullDoc.exchange_rate  ?? extra.exchange_rate)  || 10.8,
        invoice_amount:  Number(fullDoc.invoice_amount ?? extra.invoice_amount) || 0,
        customs:         Number(fullDoc.customs         ?? extra.customs)        || 0,
        transitaire:     Number(fullDoc.transitaire     ?? extra.transitaire)    || 0,
        tva_import:      Number(fullDoc.tva_import      ?? extra.tva_import)     || 0,
        other_costs:     Number(fullDoc.other_costs     ?? extra.other_costs)    || 0,
        allocation_mode: extra.allocation_mode ?? 'quantity',
        lines: (fullDoc.lines ?? []).map((l: any) => ({
          product_id:  l.product_id,
          description: l.description ?? '',
          quantity:    Number(l.quantity)   || 1,
          unit_price:  Number(l.unit_price) || 0, // prix unitaire MAD (coût réparti)
          discount:    0,
          tva_rate:    0,
        })),
      })
    })
  }, [doc.id])

  if (!initialData) return (
    <div className="p-8 text-center text-gray-400">
      <div className="text-2xl mb-2 animate-pulse">⏳</div>
      <div className="text-sm">Chargement des données...</div>
    </div>
  )

  return (
    <ImportInvoiceForm
      editDocId={doc.id}
      defaultValues={initialData}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  )
}

// ── Edit wrapper pour Purchase Order ─────────────────────────────────────────
function EditPurchaseOrderWrapper({ doc, onSaved, onCancel }: {
  doc: Document
  onSaved: () => void
  onCancel: () => void
}) {
  const [initialData, setInitialData] = useState<any>(null)

  useEffect(() => {
    api.getDocument(doc.id).then((fullDoc: any) => {
      setInitialData({
        docId:    fullDoc.id,
        date:     fullDoc.date,
        party_id: fullDoc.party_id,
        notes:    fullDoc.notes,
        expected_delivery_date: (fullDoc as any).expected_delivery_date ?? '',
        lines: (fullDoc.lines ?? []).map((l: any) => ({
          product_id:  l.product_id,
          description: l.description ?? '',
          quantity:    l.quantity,
          unit_price:  l.unit_price,
          discount:    l.discount ?? 0,
          tva_rate:    l.tva_rate ?? 20,
        })),
      })
    })
  }, [doc.id])

  if (!initialData) return (
    <div className="p-8 text-center text-gray-400">
      <div className="text-2xl mb-2 animate-pulse">⏳</div>
      <div className="text-sm">Chargement des données...</div>
    </div>
  )

  return (
    <PurchaseOrderForm
      editDocId={doc.id}
      defaultValues={initialData}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  )
}

// ── Edit wrapper pour Purchase Invoice ───────────────────────────────────────
function EditPurchaseInvoiceWrapper({ doc, onSaved, onCancel }: {
  doc: Document
  onSaved: () => void
  onCancel: () => void
}) {
  const [initialData, setInitialData] = useState<any>(null)

  useEffect(() => {
    api.getDocument(doc.id).then((fullDoc: any) => {
      setInitialData({
        docId:          fullDoc.id,
        date:           fullDoc.date,
        party_id:       fullDoc.party_id,
        notes:          fullDoc.notes,
        due_date:       fullDoc.due_date       ?? '',
        payment_method: fullDoc.payment_method ?? 'bank',
        lines: (fullDoc.lines ?? []).map((l: any) => ({
          product_id:  l.product_id,
          description: l.description ?? '',
          quantity:    l.quantity,
          unit_price:  l.unit_price,
          discount:    l.discount ?? 0,
          tva_rate:    l.tva_rate ?? 20,
        })),
      })
    })
  }, [doc.id])

  if (!initialData) return (
    <div className="p-8 text-center text-gray-400">
      <div className="text-2xl mb-2 animate-pulse">⏳</div>
      <div className="text-sm">Chargement des données...</div>
    </div>
  )

  return (
    <PurchaseInvoiceForm
      editDocId={doc.id}
      defaultValues={initialData}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  )
}

// ── Document Timeline ────────────────────────────────────────────────────────
function DocumentTimeline({ docId }: { docId: number }) {
  const [events, setEvents] = useState<any[]>([])

  useEffect(() => {
    api.getDocumentTimeline(docId)
      .then((r: any) => setEvents(Array.isArray(r) ? r : []))
      .catch(() => setEvents([]))
  }, [docId])

  if (events.length === 0) return null

  const typeColor: Record<string, string> = {
    created:   'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
    confirmed: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    payment:   'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    delivery:  'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
    avoir:     'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
    cancelled: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  }

  return (
    <div>
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Historique</div>
      <div className="relative">
        {/* ligne verticale */}
        <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
        <div className="space-y-3">
          {events.map((ev, i) => (
            <div key={i} className="flex items-start gap-3 relative">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 z-10 ${typeColor[ev.type] ?? typeColor.created}`}>
                {ev.icon}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{ev.label}</span>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">
                    {new Date(ev.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {ev.detail && (
                  <div className="text-[11px] text-gray-400 mt-0.5">{ev.detail}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Partial Reception Modal ──────────────────────────────────────────────────
// PO Receipt Summary
function POReceiptSummary({ docId }: { docId: number }) {
  const [status, setStatus] = useState<any>(null)
  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

  useEffect(() => {
    api.getPOReceiptStatus(docId)
      .then((r: any) => setStatus(r))
      .catch(() => setStatus({ summary: [], fullyReceived: false, brCount: 0 }))
  }, [docId])

  if (!status || status.summary.length === 0) return null
  const { summary, fullyReceived, brCount } = status
  const totalOrdered   = summary.reduce((s: number, l: any) => s + l.qty_ordered, 0)
  const totalReceived  = summary.reduce((s: number, l: any) => s + l.qty_received, 0)
  const totalRemaining = summary.reduce((s: number, l: any) => s + l.qty_remaining, 0)
  const pct = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0

  return (
    <div className={`border rounded-xl p-4 space-y-3 ${fullyReceived ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10' : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Suivi des receptions</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{brCount} BR cree(s)</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${fullyReceived ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {fullyReceived ? 'Complet' : `${pct}% recu`}
          </span>
        </div>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all ${fullyReceived ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="space-y-1.5">
        {summary.map((l: any) => (
          <div key={l.id} className="flex items-center gap-3 text-xs">
            <span className="flex-1 truncate text-gray-600 dark:text-gray-300">{l.description ?? `Produit #${l.product_id}`}</span>
            <span className="text-gray-400">cmd: <span className="font-medium text-gray-600 dark:text-gray-200">{fmt(l.qty_ordered)}</span></span>
            <span className="text-green-600">recu: <span className="font-medium">{fmt(l.qty_received)}</span></span>
            {l.qty_remaining > 0
              ? <span className="text-amber-600">restant: <span className="font-medium">{fmt(l.qty_remaining)}</span></span>
              : <span className="text-green-500">OK</span>}
          </div>
        ))}
      </div>
      {!fullyReceived && (
        <div className="text-xs text-amber-600 dark:text-amber-400 pt-1 border-t border-amber-200 dark:border-amber-700">
          {fmt(totalRemaining)} unite(s) encore en attente
        </div>
      )}
    </div>
  )
}

// ── Invoice Delivery Summary ─────────────────────────────────────────────────
function InvoiceDeliverySummary({ docId }: { docId: number }) {
  const [status, setStatus] = useState<any>(null)
  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

  useEffect(() => {
    api.getBLDeliveryStatus(docId)
      .then((r: any) => setStatus(r))
      .catch(() => setStatus({ summary: [], fullyDelivered: false, blCount: 0 }))
  }, [docId])

  if (!status || status.summary.length === 0 || status.blCount === 0) return null
  const { summary, fullyDelivered, blCount } = status
  const totalOrdered   = summary.reduce((s: number, l: any) => s + l.qty_ordered, 0)
  const totalDelivered = summary.reduce((s: number, l: any) => s + l.qty_delivered, 0)
  const totalRemaining = summary.reduce((s: number, l: any) => s + l.qty_remaining, 0)
  const pct = totalOrdered > 0 ? Math.round((totalDelivered / totalOrdered) * 100) : 0

  return (
    <div className={`border rounded-xl p-4 space-y-3 ${fullyDelivered ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10' : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Suivi des livraisons</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{blCount} BL créé(s)</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${fullyDelivered ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {fullyDelivered ? 'Livré' : `${pct}% livré`}
          </span>
        </div>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all ${fullyDelivered ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="space-y-1.5">
        {summary.map((l: any) => (
          <div key={l.id} className="flex items-center gap-3 text-xs">
            <span className="flex-1 truncate text-gray-600 dark:text-gray-300">{l.description ?? `Produit #${l.product_id}`}</span>
            <span className="text-gray-400">cmd: <span className="font-medium text-gray-600 dark:text-gray-200">{fmt(l.qty_ordered)}</span></span>
            <span className="text-green-600">livré: <span className="font-medium">{fmt(l.qty_delivered)}</span></span>
            {l.qty_remaining > 0
              ? <span className="text-amber-600">restant: <span className="font-medium">{fmt(l.qty_remaining)}</span></span>
              : <span className="text-green-500">✓</span>}
          </div>
        ))}
      </div>
      {!fullyDelivered && (
        <div className="text-xs text-amber-600 dark:text-amber-400 pt-1 border-t border-amber-200 dark:border-amber-700">
          {fmt(totalRemaining)} unité(s) encore à livrer
        </div>
      )}
    </div>
  )
}

// ── Partial Delivery Modal ───────────────────────────────────────────────────
function PartialDeliveryModal({ doc, onSaved, onCancel }: {
  doc: Document
  onSaved: () => void
  onCancel: () => void
}) {
  const [status, setStatus] = useState<any>(null)
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

  useEffect(() => {
    api.getBLDeliveryStatus(doc.id)
      .then((r: any) => {
        setStatus(r)
        const init: Record<number, number> = {}
        ;(r.summary ?? []).forEach((l: any) => { init[l.id] = l.qty_remaining })
        setQuantities(init)
      })
      .catch((e: any) => {
        toast(e?.message ?? 'Erreur chargement', 'error')
        setStatus({ summary: [], fullyDelivered: false, blCount: 0 })
      })
      .finally(() => setLoading(false))
  }, [doc.id])

  async function handleSubmit() {
    const lines = status.summary
      .filter((l: any) => (quantities[l.id] ?? 0) > 0)
      .map((l: any) => ({ id: l.id, quantity: quantities[l.id] }))

    if (lines.length === 0) {
      toast('Aucune quantité à livrer', 'error')
      return
    }
    setSubmitting(true)
    try {
      const result = await api.convertDocument({
        sourceId: doc.id,
        targetType: 'bl',
        extra: { lines },
      }) as any
      await api.linkDocuments({ parentId: doc.id, childId: result.id, linkType: 'invoice_to_bl' })
      await api.confirmDocument(result.id)
      toast('Bon de livraison créé — Stock en attente ⏳')
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400 animate-pulse">⏳ Chargement...</div>

  const { summary, blCount } = status
  const totalRemaining = summary.reduce((s: number, l: any) => s + l.qty_remaining, 0)

  return (
    <div className="space-y-4">
      {blCount > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2.5 text-xs text-blue-700 dark:text-blue-400">
          🚚 {blCount} bon(s) de livraison déjà créé(s) pour cette facture
        </div>
      )}
      {totalRemaining <= 0 ? (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3 text-sm text-green-700 dark:text-green-400 text-center">
          ✅ Toutes les quantités ont été livrées
        </div>
      ) : (
        <>
          <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500">
              <div className="col-span-4">Produit</div>
              <div className="col-span-2 text-right">Commandé</div>
              <div className="col-span-2 text-right">Livré</div>
              <div className="col-span-2 text-right text-amber-600">Restant</div>
              <div className="col-span-2 text-right text-primary">À livrer</div>
            </div>
            {summary.map((l: any) => (
              <div key={l.id} className="grid grid-cols-12 gap-2 px-3 py-2.5 border-t border-gray-100 dark:border-gray-700 items-center">
                <div className="col-span-4 text-sm font-medium truncate">{l.description ?? `Produit #${l.product_id}`}</div>
                <div className="col-span-2 text-right text-xs text-gray-500">{fmt(l.qty_ordered)}</div>
                <div className="col-span-2 text-right text-xs text-green-600 font-medium">{fmt(l.qty_delivered)}</div>
                <div className={`col-span-2 text-right text-xs font-semibold ${l.qty_remaining > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {fmt(l.qty_remaining)}
                </div>
                <div className="col-span-2">
                  {l.qty_remaining > 0 ? (
                    <input
                      type="number" min={0} max={l.qty_remaining} step="0.01"
                      value={quantities[l.id] ?? l.qty_remaining}
                      onChange={e => setQuantities(q => ({ ...q, [l.id]: Math.min(Number(e.target.value), l.qty_remaining) }))}
                      className="input text-xs text-right w-full"
                    />
                  ) : (
                    <span className="text-xs text-gray-400 text-right block">✅ Livré</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
            <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
            <button type="button" disabled={submitting} onClick={handleSubmit} className="btn-primary flex-1 justify-center">
              {submitting ? '...' : '🚚 Créer le Bon de Livraison'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function PartialReceptionModal({ doc, onSaved, onCancel }: {
  doc: Document
  onSaved: () => void
  onCancel: () => void
}) {
  const [status, setStatus] = useState<any>(null)
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

  useEffect(() => {
    api.getPOReceiptStatus(doc.id)
      .then((r: any) => {
        setStatus(r)
        const init: Record<number, number> = {}
        ;(r.summary ?? []).forEach((l: any) => { init[l.id] = l.qty_remaining })
        setQuantities(init)
      })
      .catch((e: any) => {
        toast(e?.message ?? 'Erreur chargement', 'error')
        setStatus({ summary: [], fullyReceived: false, brCount: 0 })
      })
      .finally(() => setLoading(false))
  }, [doc.id])

  async function handleSubmit() {
    const lines = status.summary
      .filter((l: any) => (quantities[l.id] ?? 0) > 0)
      .map((l: any) => ({ id: l.id, quantity: quantities[l.id] }))

    if (lines.length === 0) {
      toast('Aucune quantité à réceptionner', 'error')
      return
    }
    setSubmitting(true)
    try {
      const result = await api.convertDocument({
        sourceId: doc.id,
        targetType: 'bl_reception',
        extra: { lines },
      }) as any
      await api.linkDocuments({ parentId: doc.id, childId: result.id, linkType: 'po_to_reception' })
      await api.confirmDocument(result.id)
      toast('Bon de réception créé — Stock en attente ⏳')
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="p-8 text-center text-gray-400 animate-pulse">⏳ Chargement...</div>
  )

  const { summary, brCount } = status
  const totalRemaining = summary.reduce((s: number, l: any) => s + l.qty_remaining, 0)

  return (
    <div className="space-y-4">
      {/* Historique */}
      {brCount > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2.5 text-xs text-blue-700 dark:text-blue-400">
          📦 {brCount} bon(s) de réception déjà créé(s) pour ce BC
        </div>
      )}

      {totalRemaining <= 0 ? (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3 text-sm text-green-700 dark:text-green-400 text-center">
          ✅ Toutes les quantités ont été réceptionnées
        </div>
      ) : (
        <>
          {/* Tableau des lignes */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500">
              <div className="col-span-4">Produit</div>
              <div className="col-span-2 text-right">Commandé</div>
              <div className="col-span-2 text-right">Reçu</div>
              <div className="col-span-2 text-right text-amber-600">Restant</div>
              <div className="col-span-2 text-right text-primary">À recevoir</div>
            </div>
            {summary.map((l: any) => (
              <div key={l.id} className="grid grid-cols-12 gap-2 px-3 py-2.5 border-t border-gray-100 dark:border-gray-700 items-center">
                <div className="col-span-4 text-sm font-medium truncate">{l.description ?? `Produit #${l.product_id}`}</div>
                <div className="col-span-2 text-right text-xs text-gray-500">{fmt(l.qty_ordered)}</div>
                <div className="col-span-2 text-right text-xs text-green-600 font-medium">{fmt(l.qty_received)}</div>
                <div className={`col-span-2 text-right text-xs font-semibold ${l.qty_remaining > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {fmt(l.qty_remaining)}
                </div>
                <div className="col-span-2">
                  {l.qty_remaining > 0 ? (
                    <input
                      type="number"
                      min={0}
                      max={l.qty_remaining}
                      step="0.01"
                      value={quantities[l.id] ?? l.qty_remaining}
                      onChange={e => setQuantities(q => ({ ...q, [l.id]: Math.min(Number(e.target.value), l.qty_remaining) }))}
                      className="input text-xs text-right w-full"
                    />
                  ) : (
                    <span className="text-xs text-gray-400 text-right block">✅ Complet</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
            <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
            <button type="button" disabled={submitting} onClick={handleSubmit} className="btn-primary flex-1 justify-center">
              {submitting ? '...' : '📥 Créer le Bon de Réception'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function DocumentDetail({ docId, onUpdated }: Omit<Props, 'onClose'> & { onClose?: () => void }) {
  const [doc, setDoc] = useState<Document | null>(null)
  const [loading, setLoading] = useState(true)
  const [paymentModal, setPaymentModal] = useState(false)
  const [htmlPreview, setHtmlPreview] = useState<string | null>(null)
  const [totalPaid, setTotalPaid] = useState(0)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [linkedDocId, setLinkedDocId] = useState<number | null>(null)
  const [avoirModal, setAvoirModal] = useState(false)
  const [stockConfirm, setStockConfirm] = useState(false)
  const [editModal, setEditModal] = useState(false)
  const [receptionModal, setReceptionModal] = useState(false)
  const [deliveryModal, setDeliveryModal] = useState(false)
  const [converting, setConverting] = useState(false)

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  async function load(currentDocId = docId) {
    setLoading(true)
    try {
      const result = await api.getDocument(currentDocId) as unknown as Document
      // تجاهل النتيجة إذا تغير docId أثناء الطلب
      if (currentDocId !== docId) return
      setDoc(result)
      const paidData = await api.getPaymentPaidAmount(currentDocId) as any
      if (currentDocId !== docId) return
      setTotalPaid(paidData?.total ?? 0)
    } catch {
      if (currentDocId === docId) setDoc(null)
    } finally {
      if (currentDocId === docId) setLoading(false)
    }
  }

  useEffect(() => { load(docId) }, [docId])

  // المستندات التي تولد حركات مخزون
  const STOCK_DOC_TYPES = ['bl', 'bl_reception', 'avoir']

  async function handleConfirm() {
    // إذا كان المستند يؤثر على المخزون، اسأل المستخدم
    if (doc && STOCK_DOC_TYPES.includes(doc.type)) {
      setStockConfirm(true)
      return
    }
    await doConfirm(false)
  }

  async function doConfirm(applyStockNow: boolean) {
    try {
      await api.confirmDocument(docId)
      if (applyStockNow) {
        // نجلب الحركات المعلقة ونطبقها
        const updated = await api.getDocument(docId) as any
        for (const mov of (updated.pendingMovements ?? [])) {
          await api.applyStockMovement(mov.id)
        }
        toast('Document confirmé — Stock mis à jour')
      } else {
        toast('Document confirmé — ⚠️ Pensez à appliquer les mouvements de stock')
      }
      load()
      onUpdated()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setStockConfirm(false)
    }
  }

  async function handleCancel() {
    try {
      await api.cancelDocument(docId)
      toast('Document annulé', 'warning')
      load()
      onUpdated()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setCancelConfirm(false)
    }
  }

  async function handleApplyStock(movId: number) {
    try {
      await api.applyStockMovement(movId)
      toast('Mouvement de stock appliqué')
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  async function handlePrint() {
    try {
      const result = await api.generatePdf({ documentId: docId }) as any
      if (result?.canceled) return
      if (result?.path) toast('✅ PDF enregistré: ' + result.path.split('/').pop())
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  async function handlePreview() {
    try {
      const result = await api.pdfGetHtml(docId) as any
      if (result?.html) setHtmlPreview(result.html)
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  if (loading) return (
    <div className="p-6 space-y-5 animate-pulse">
      <div className="flex justify-between">
        <div className="space-y-2">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-36"></div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
        </div>
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full w-20"></div>
      </div>
      <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>)}
      </div>
    </div>
  )
  if (!doc) return (
    <div className="flex items-center justify-center h-64 text-gray-400">Document introuvable</div>
  )

  const remainingAmount = Math.max(0, (doc?.total_ttc ?? 0) - totalPaid)

  return (
    <div className="p-6 space-y-5">
      {/* Header info */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xl font-bold font-mono text-primary">{doc.number}</div>
          <div className="text-sm text-gray-500 mt-1">
            {new Date(doc.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          {(doc as any).due_date && (
            <div className="text-xs mt-1 flex items-center gap-1">
              <span className="text-gray-400">Échéance:</span>
              <span className={`font-medium ${
                !['paid','cancelled'].includes(doc.status) && new Date((doc as any).due_date) < new Date()
                  ? 'text-red-600'
                  : 'text-gray-600 dark:text-gray-300'
              }`}>
                {new Date((doc as any).due_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </div>
          )}
        </div>
        <span className={STATUS_BADGE[doc.status] ?? 'badge-gray'}>
          {STATUS_LABEL[doc.status] ?? doc.status}
        </span>
      </div>
      {/* Due date banner */}
      <DueDateBanner doc={doc} />

      {doc.party_name && (
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-4 py-3">
          <div className="text-xs text-gray-400 mb-1">
            {doc.party_type === 'client' ? 'Client' : 'Fournisseur'}
          </div>
          <div className="font-semibold">{doc.party_name}</div>
        </div>
      )}

      {/* Lignes */}
      {doc.lines && doc.lines.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Lignes</div>
          <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Désignation</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Qté</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Prix HT</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">TVA</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">TTC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {doc.lines.map((line, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{line.product_name ?? line.description ?? '—'}</div>
                      {line.product_code && <div className="text-gray-400 font-mono">{line.product_code}</div>}
                    </td>
                    <td className="px-3 py-2 text-right">{line.quantity} {line.unit}</td>
                    <td className="px-3 py-2 text-right">{fmt(line.unit_price)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{line.tva_rate}%</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmt(line.total_ttc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Totaux */}
      <div className="flex justify-end">
        <div className="w-56 space-y-1 text-sm">
          <div className="flex justify-between text-gray-500">
            <span>Total HT</span><span>{fmt(doc.total_ht)} MAD</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>TVA</span><span>{fmt(doc.total_tva)} MAD</span>
          </div>
          <div className="flex justify-between font-bold text-base border-t border-gray-200 dark:border-gray-700 pt-2 mt-1">
            <span>Total TTC</span>
            <span className="text-primary">{fmt(doc.total_ttc)} MAD</span>
          </div>
          {totalPaid > 0 && (
            <div className="flex justify-between text-green-600 text-sm">
              <span>Payé</span><span>- {fmt(totalPaid)} MAD</span>
            </div>
          )}
          {remainingAmount > 0.01 && ['invoice', 'purchase_invoice', 'import_invoice'].includes(doc.type) && (
            <div className="flex justify-between text-orange-500 font-semibold text-sm border-t border-gray-100 dark:border-gray-700 pt-1">
              <span>Reste à payer</span><span>{fmt(remainingAmount)} MAD</span>
            </div>
          )}
          {remainingAmount <= 0.01 && totalPaid > 0 && ['invoice', 'purchase_invoice', 'import_invoice'].includes(doc.type) && (
            <div className="flex justify-between text-green-600 font-semibold text-sm border-t border-gray-100 dark:border-gray-700 pt-1">
              <span>✅ Soldé</span><span>0,00 MAD</span>
            </div>
          )}
        </div>
      </div>

      {/* ملخص الاستلام للـ BC */}
      {doc.type === 'purchase_order' && doc.status !== 'draft' && (
        <POReceiptSummary docId={doc.id} />
      )}

      {/* ملخص التسليم للفاتورة */}
      {doc.type === 'invoice' && doc.status !== 'draft' && (
        <InvoiceDeliverySummary docId={doc.id} />
      )}

      {/* Mouvements stock en attente */}
      {doc.pendingMovements && doc.pendingMovements.length > 0 && (
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
          <div className="text-sm font-medium text-orange-700 dark:text-orange-400 mb-2">
            ⏳ Mouvements de stock en attente
          </div>
          {doc.pendingMovements.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between text-xs py-1">
              <span className="font-medium">{m.product_name}</span>
              <span className="text-gray-600">{m.type === 'out' ? '−' : '+'}{m.quantity} {m.unit}</span>
              <button onClick={() => handleApplyStock(m.id)} className="btn-primary btn-sm text-xs">
                Appliquer
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Documents liés */}
      {doc.links && doc.links.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Documents liés</div>
          <div className="space-y-1">
            {doc.links.map((link: any) => (
              <button key={link.id} onClick={() => setLinkedDocId(
                link.parent_id === doc.id ? link.child_id : link.parent_id
              )}
                className="w-full flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 hover:bg-primary/5 transition-colors text-left">
                <span className="text-gray-400">🔗</span>
                <span className="font-mono text-primary">{link.related_number}</span>
                <span className="text-gray-400">{DOC_TYPE_LABEL[link.related_type] ?? link.related_type}</span>
                <span className={`ml-auto ${STATUS_BADGE[link.related_status] ?? 'badge-gray'}`}>
                  {STATUS_LABEL[link.related_status] ?? link.related_status}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modal مستند مرتبط */}
      {linkedDocId !== null && (
        <Modal open={true} onClose={() => setLinkedDocId(null)} title="Document lié" size="xl">
          <DocumentDetail docId={linkedDocId} onUpdated={() => { load(); onUpdated() }} onClose={() => setLinkedDocId(null)} />
        </Modal>
      )}

      {/* Notes */}
      {doc.notes && (
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
          {doc.notes}
        </div>
      )}

      {/* Timeline */}
      <DocumentTimeline docId={doc.id} />

      {/* Pièces jointes */}
      <AttachmentsPanel entityType="document" entityId={doc.id} />

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700 flex-wrap">
        {/* أزرار الحالة */}
        {doc.status === 'draft' && (
          <button onClick={() => setEditModal(true)} className="btn-secondary btn-sm">✏️ Modifier</button>
        )}
        {doc.status === 'draft' && (
          <button onClick={handleConfirm} className="btn-primary btn-sm">✅ Confirmer</button>
        )}
        {doc.type === 'quote' && doc.status === 'confirmed' && (
          <button disabled={converting} onClick={async () => {
            if (converting) return
            setConverting(true)
            try {
              await api.convertDocument({ sourceId: doc.id, targetType: 'invoice', extra: { payment_method: 'cash' } })
              toast('Converti en facture'); load(); onUpdated()
            } catch (e: any) { toast(e.message, 'error') }
            finally { setConverting(false) }
          }} className="btn-secondary btn-sm disabled:opacity-50">📄 → Facture</button>
        )}
        {doc.type === 'proforma' && doc.status === 'confirmed' && (
          <button disabled={converting} onClick={async () => {
            if (converting) return
            setConverting(true)
            try {
              await api.convertDocument({ sourceId: doc.id, targetType: 'invoice', extra: { payment_method: 'cash' } })
              toast('Proforma convertie en facture'); load(); onUpdated()
            } catch (e: any) { toast(e.message, 'error') }
            finally { setConverting(false) }
          }} className="btn-secondary btn-sm disabled:opacity-50">🧾 → Facture</button>
        )}
        {doc.type === 'purchase_order' && ['confirmed', 'partial', 'received'].includes(doc.status) && (
          <button onClick={() => setReceptionModal(true)} className="btn-secondary btn-sm">📥 → Bon de Réception</button>
        )}
        {doc.type === 'import_invoice' && doc.status === 'confirmed' && (
          <button disabled={converting} onClick={async () => {
            if (converting) return
            // التحقق من عدم وجود BR مسبق
            const existingBR = (doc.links ?? []).find((l: any) => l.related_type === 'bl_reception' && l.related_status !== 'cancelled')
            if (existingBR) {
              toast('Un bon de réception existe déjà pour cette importation', 'error')
              return
            }
            setConverting(true)
            try {
              const result = await api.convertDocument({ sourceId: doc.id, targetType: 'bl_reception', extra: {} }) as any
              await api.confirmDocument(result.id)
              toast('Bon de réception créé — Stock en attente ⏳'); load(); onUpdated()
            } catch (e: any) { toast(e.message, 'error') }
            finally { setConverting(false) }
          }} className="btn-secondary btn-sm disabled:opacity-50">📥 → Bon de Réception</button>
        )}
        {doc.type === 'invoice' && ['confirmed', 'partial', 'delivered'].includes(doc.status) && (
          <button onClick={() => setAvoirModal(true)} className="btn-secondary btn-sm">↩️ Avoir</button>
        )}
        {doc.type === 'invoice' && ['confirmed', 'partial', 'paid'].includes(doc.status) && (
          <button onClick={() => setDeliveryModal(true)} className="btn-secondary btn-sm">🚚 → BL Partiel</button>
        )}
        {['invoice', 'purchase_invoice', 'import_invoice'].includes(doc.type) && ['confirmed', 'partial', 'delivered'].includes(doc.status) && doc.party_id && (
          <button onClick={() => setPaymentModal(true)} className="btn-primary btn-sm">
            💰 Paiement
          </button>
        )}
        {/* séparateur */}
        <div className="flex-1" />
        {/* actions secondaires */}
        {!['cancelled','paid'].includes(doc.status) && (
          <button onClick={() => setCancelConfirm(true)} className="btn-secondary btn-sm text-red-500">🚫 Annuler</button>
        )}
        <button onClick={handlePreview} className="btn-secondary btn-sm">🖨️ PDF</button>
      </div>

      {/* Payment Modal */}
      <Modal open={paymentModal} onClose={() => setPaymentModal(false)} title="Enregistrer un paiement">
        <PaymentForm
          partyId={doc.party_id!}
          partyType={doc.party_type as 'client' | 'supplier'}
          documentId={doc.id}
          maxAmount={remainingAmount}
          onSaved={() => { setPaymentModal(false); load() }}
          onCancel={() => setPaymentModal(false)}
        />
      </Modal>

      {/* Avoir Modal */}
      <Modal open={avoirModal} onClose={() => setAvoirModal(false)} title="Créer un Avoir" size="lg">
        <AvoirForm
          sourceInvoice={doc as any}
          onSaved={() => { setAvoirModal(false); load() }}
          onCancel={() => setAvoirModal(false)}
        />
      </Modal>

      {/* Edit Modal — brouillons uniquement */}
      {editModal && (
        <Modal open onClose={() => setEditModal(false)}
          title={`Modifier ${doc.number}`}
          size="xl">
          {doc.type === 'purchase_order' ? (
            <EditPurchaseOrderWrapper doc={doc} onSaved={() => { setEditModal(false); load(); onUpdated() }} onCancel={() => setEditModal(false)} />
          ) : doc.type === 'purchase_invoice' ? (
            <EditPurchaseInvoiceWrapper doc={doc} onSaved={() => { setEditModal(false); load(); onUpdated() }} onCancel={() => setEditModal(false)} />
          ) : doc.type === 'import_invoice' ? (
            <EditImportWrapper doc={doc} onSaved={() => { setEditModal(false); load(); onUpdated() }} onCancel={() => setEditModal(false)} />
          ) : (
            <EditInvoiceWrapper doc={doc} onSaved={() => { setEditModal(false); load(); onUpdated() }} onCancel={() => setEditModal(false)} />
          )}
        </Modal>
      )}

      <ConfirmDialog
        open={cancelConfirm}
        title="Annuler ce document"
        message="Le document sera marqué comme annulé. Cette action ne peut pas être défaite."
        confirmLabel="Annuler le document"
        danger
        onConfirm={handleCancel}
        onCancel={() => setCancelConfirm(false)}
      />

      {/* Réception partielle Modal */}
      {receptionModal && doc && (
        <Modal open onClose={() => setReceptionModal(false)} title="Créer un Bon de Réception" size="lg">
          <PartialReceptionModal
            doc={doc}
            onSaved={() => { setReceptionModal(false); load(); onUpdated() }}
            onCancel={() => setReceptionModal(false)}
          />
        </Modal>
      )}

      {/* Livraison partielle Modal */}
      {deliveryModal && doc && (
        <Modal open onClose={() => setDeliveryModal(false)} title="Créer un Bon de Livraison" size="lg">
          <PartialDeliveryModal
            doc={doc}
            onSaved={() => { setDeliveryModal(false); load(); onUpdated() }}
            onCancel={() => setDeliveryModal(false)}
          />
        </Modal>
      )}

      {/* Stock confirmation dialog */}
      {stockConfirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 shadow-xl space-y-4">
            <div className="text-base font-semibold text-gray-800 dark:text-white">
              📦 Mise à jour du stock
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Ce document va générer des mouvements de stock. Voulez-vous les appliquer maintenant ?
            </p>
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 rounded-lg px-4 py-3 text-xs text-orange-700 dark:text-orange-400">
              ⚠️ Si vous choisissez "Plus tard", le stock ne sera pas mis à jour immédiatement. Un rappel sera affiché sur le document.
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setStockConfirm(false)} className="btn-secondary flex-1 justify-center text-sm">
                Annuler
              </button>
              <button onClick={() => doConfirm(false)} className="btn-secondary flex-1 justify-center text-sm text-orange-600 border-orange-300">
                ⏳ Plus tard
              </button>
              <button onClick={() => doConfirm(true)} className="btn-primary flex-1 justify-center text-sm">
                ✅ Maintenant
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Preview */}
      {htmlPreview && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/80">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900 shrink-0">
            <span className="text-white font-medium">Aperçu — {doc.number}</span>
            <div className="flex gap-2">
              <button onClick={handlePrint} className="btn-primary btn-sm">
                💾 Enregistrer PDF
              </button>
              <button onClick={() => setHtmlPreview(null)}
                className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20">
                Fermer
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-gray-200 p-4">
            <div className="max-w-3xl mx-auto bg-white shadow-xl rounded"
              dangerouslySetInnerHTML={{ __html: htmlPreview }} />
          </div>
        </div>
      )}
    </div>
  )
}
