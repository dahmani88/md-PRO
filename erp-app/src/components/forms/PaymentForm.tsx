import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../ui/Toast'
import FormField from '../ui/FormField'

const schema = z.object({
  amount:        z.coerce.number().min(0.01, 'Montant requis'),
  method:        z.enum(['cash', 'bank', 'cheque', 'lcn']),
  date:          z.string().min(1, 'Date requise'),
  due_date:      z.string().optional(),
  cheque_number: z.string().optional(),
  bank:          z.string().optional(),
  notes:         z.string().optional(),
})

type FormData = z.infer<typeof schema>

const METHODS = [
  { value: 'cash',   label: '💵 Espèces' },
  { value: 'bank',   label: '🏦 Virement' },
  { value: 'cheque', label: '📝 Chèque' },
  { value: 'lcn',    label: '📋 LCN' },
]

interface Props {
  partyId: number
  partyType: 'client' | 'supplier'
  documentId?: number   // إذا كان محدداً، الدفعة مرتبطة بفاتورة واحدة
  maxAmount?: number
  onSaved: () => void
  onCancel: () => void
}

export default function PaymentForm({ partyId, partyType, documentId, maxAmount, onSaved, onCancel }: Props) {
  const [unpaidDocs, setUnpaidDocs] = useState<any[]>([])
  const [selectedDocId, setSelectedDocId] = useState<number | null>(documentId ?? null)
  const [paidAmounts, setPaidAmounts] = useState<Record<number, number>>({})

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      method: 'cash',
      date:   new Date().toISOString().split('T')[0],
      amount: maxAmount ?? 0,
    },
  })

  const method = watch('method')
  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  // إذا لم يكن documentId محدداً، نجلب الفواتير غير المدفوعة
  useEffect(() => {
    if (documentId) return
    api.getDocuments({ party_id: partyId, limit: 100 } as any).then(async (r: any) => {
      const invoices = (r.rows ?? []).filter((d: any) =>
        d.type === 'invoice' && (d.status === 'confirmed' || d.status === 'partial')
      )
      // نجلب المبلغ المدفوع لكل فاتورة
      const amounts: Record<number, number> = {}
      for (const inv of invoices) {
        const paid = await api.getPaymentPaidAmount(inv.id) as any
        amounts[inv.id] = paid?.total ?? 0
      }
      setPaidAmounts(amounts)
      setUnpaidDocs(invoices.filter((d: any) => (d.total_ttc - (amounts[d.id] ?? 0)) > 0.01))
    })
  }, [partyId, documentId])

  // عند اختيار فاتورة، نملأ المبلغ تلقائياً
  function handleSelectDoc(docId: number | null) {
    setSelectedDocId(docId)
    if (docId) {
      const doc = unpaidDocs.find(d => d.id === docId)
      if (doc) {
        const remaining = doc.total_ttc - (paidAmounts[docId] ?? 0)
        setValue('amount', Math.round(remaining * 100) / 100)
      }
    }
  }

  async function onSubmit(data: FormData) {
    try {
      await api.createPayment({
        ...data,
        party_id:    partyId,
        party_type:  partyType,
        document_id: selectedDocId ?? null,
        status: data.method === 'cash' || data.method === 'bank' ? 'collected' : 'pending',
        created_by: 1,
      })
      toast('Paiement enregistré')
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="space-y-4">
      {/* اختيار الفاتورة إذا لم تكن محددة مسبقاً */}
      {!documentId && unpaidDocs.length > 0 && (
        <FormField label="Imputer sur une facture">
          <div className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2">
            <label className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm
              ${selectedDocId === null ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              <input type="radio" checked={selectedDocId === null} onChange={() => handleSelectDoc(null)} className="accent-primary" />
              <span className="text-gray-500 italic">Sans imputation (acompte général)</span>
            </label>
            {unpaidDocs.map(doc => {
              const remaining = doc.total_ttc - (paidAmounts[doc.id] ?? 0)
              return (
                <label key={doc.id} className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer text-sm
                  ${selectedDocId === doc.id ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  <div className="flex items-center gap-2">
                    <input type="radio" checked={selectedDocId === doc.id} onChange={() => handleSelectDoc(doc.id)} className="accent-primary" />
                    <span className="font-mono text-xs font-bold">{doc.number}</span>
                    <span className="text-gray-400 text-xs">{new Date(doc.date).toLocaleDateString('fr-FR')}</span>
                  </div>
                  <span className="font-semibold text-orange-500">{fmt(remaining)} MAD</span>
                </label>
              )
            })}
          </div>
        </FormField>
      )}

      {/* Montant */}
      <FormField label="Montant (MAD)" required error={errors.amount?.message}>
        <input {...register('amount')} className="input text-lg font-semibold" type="number"
          min="0.01" step="0.01" autoFocus />
        {maxAmount && !selectedDocId && (
          <p className="text-xs text-gray-400 mt-1">Solde total: {fmt(maxAmount)} MAD</p>
        )}
      </FormField>

      {/* Mode */}
      <FormField label="Mode de paiement" required error={errors.method?.message}>
        <div className="grid grid-cols-4 gap-2">
          {METHODS.map(m => (
            <label key={m.value}
              className={`text-center py-2.5 rounded-lg border text-xs font-medium cursor-pointer transition-all
                ${watch('method') === m.value
                  ? 'bg-primary text-white border-primary'
                  : 'border-gray-200 text-gray-600 hover:border-primary/50'}`}>
              <input {...register('method')} type="radio" value={m.value} className="hidden" />
              {m.label}
            </label>
          ))}
        </div>
      </FormField>

      {/* Date */}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date de paiement" required error={errors.date?.message}>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        {(method === 'cheque' || method === 'lcn') && (
          <FormField label="Date d'échéance" error={errors.due_date?.message}>
            <input {...register('due_date')} className="input" type="date" />
          </FormField>
        )}
      </div>

      {(method === 'cheque' || method === 'lcn') && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Numéro" error={errors.cheque_number?.message}>
            <input {...register('cheque_number')} className="input font-mono"
              placeholder={method === 'cheque' ? 'N° chèque' : 'N° LCN'} />
          </FormField>
          <FormField label="Banque" error={errors.bank?.message}>
            <input {...register('bank')} className="input" placeholder="Nom de la banque" />
          </FormField>
        </div>
      )}

      <FormField label="Notes" error={errors.notes?.message}>
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="button" disabled={isSubmitting} onClick={handleSubmit(onSubmit)} className="btn-primary flex-1 justify-center">
          {isSubmitting ? 'Enregistrement...' : '✅ Enregistrer paiement'}
        </button>
      </div>
    </div>
  )
}
