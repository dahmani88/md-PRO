import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { toast } from './ui/Toast'
import Modal from './ui/Modal'
import PaymentForm from './forms/PaymentForm'
import AttachmentsPanel from './AttachmentsPanel'
import AvoirForm from '../pages/documents/AvoirForm'
import type { Document } from '../types'
import ConfirmDialog from './ui/ConfirmDialog'

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-gray', confirmed: 'badge-blue', partial: 'badge-orange',
  paid: 'badge-green', cancelled: 'badge-red', delivered: 'badge-green',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', confirmed: 'Confirmée', partial: 'Partiel',
  paid: 'Payée', cancelled: 'Annulée', delivered: 'Livrée',
}

interface Props {
  docId: number
  onClose: () => void
  onUpdated: () => void
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

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  async function load() {
    setLoading(true)
    try {
      const result = await api.getDocument(docId) as unknown as Document
      setDoc(result)
      // نجلب المبلغ المدفوع الدقيق من payment_allocations
      const paidData = await api.getPaymentPaidAmount(docId) as any
      setTotalPaid(paidData?.total ?? 0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [docId])

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
        </div>
        <span className={STATUS_BADGE[doc.status] ?? 'badge-gray'}>
          {STATUS_LABEL[doc.status] ?? doc.status}
        </span>
      </div>

      {/* Client */}
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
          {remainingAmount > 0.01 && (
            <div className="flex justify-between text-orange-500 font-semibold text-sm border-t border-gray-100 dark:border-gray-700 pt-1">
              <span>Reste à payer</span><span>{fmt(remainingAmount)} MAD</span>
            </div>
          )}
          {remainingAmount <= 0.01 && totalPaid > 0 && (
            <div className="flex justify-between text-green-600 font-semibold text-sm border-t border-gray-100 dark:border-gray-700 pt-1">
              <span>✅ Soldé</span><span>0,00 MAD</span>
            </div>
          )}
        </div>
      </div>

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
                <span className="text-gray-400 capitalize">{link.related_type}</span>
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

      {/* Pièces jointes */}
      <AttachmentsPanel entityType="document" entityId={doc.id} />

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700 flex-wrap">
        {/* أزرار الحالة */}
        {doc.status === 'draft' && (
          <button onClick={handleConfirm} className="btn-primary btn-sm">✅ Confirmer</button>
        )}
        {doc.type === 'quote' && doc.status === 'confirmed' && (
          <button onClick={async () => {
            try {
              await api.convertDocument({ sourceId: doc.id, targetType: 'invoice', extra: { payment_method: 'cash' } })
              toast('Converti en facture'); load(); onUpdated()
            } catch (e: any) { toast(e.message, 'error') }
          }} className="btn-secondary btn-sm">📄 → Facture</button>
        )}
        {doc.type === 'invoice' && doc.status === 'confirmed' && (
          <button onClick={() => setAvoirModal(true)} className="btn-secondary btn-sm">↩️ Avoir</button>
        )}
        {doc.type === 'invoice' && doc.status === 'confirmed' && (
          <button onClick={async () => {
            try {
              await api.convertDocument({ sourceId: doc.id, targetType: 'bl', extra: {} })
              toast('Bon de livraison créé'); load(); onUpdated()
            } catch (e: any) { toast(e.message, 'error') }
          }} className="btn-secondary btn-sm">🚚 → BL</button>
        )}
        {doc.type === 'invoice' && (doc.status === 'confirmed' || doc.status === 'partial') && doc.party_id && (
          <button onClick={() => setPaymentModal(true)} className="btn-primary btn-sm">
            💰 Paiement
          </button>
        )}
        {/* séparateur */}
        <div className="flex-1" />
        {/* actions secondaires */}
        {doc.status !== 'cancelled' && doc.status !== 'paid' && (
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
          onSaved={() => { setPaymentModal(false); load(); onUpdated() }}
          onCancel={() => setPaymentModal(false)}
        />
      </Modal>

      {/* Avoir Modal */}
      <Modal open={avoirModal} onClose={() => setAvoirModal(false)} title="Créer un Avoir" size="lg">
        <AvoirForm
          sourceInvoice={doc as any}
          onSaved={() => { setAvoirModal(false); load(); onUpdated() }}
          onCancel={() => setAvoirModal(false)}
        />
      </Modal>

      <ConfirmDialog
        open={cancelConfirm}
        title="Annuler ce document"
        message="Le document sera marqué comme annulé. Cette action ne peut pas être défaite."
        confirmLabel="Annuler le document"
        danger
        onConfirm={handleCancel}
        onCancel={() => setCancelConfirm(false)}
      />

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
