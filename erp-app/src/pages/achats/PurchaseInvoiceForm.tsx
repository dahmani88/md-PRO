import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/ui/FormField'
import { PartySelector } from '../../components/ui/PartySelector'
import { LinesTable, getDefaultTva, LinesTotals } from '../../components/ui/LinesTable'
import type { Product } from '../../types'

const PAYMENT_METHODS = [
  { value: 'cash',   label: 'Espèces' },
  { value: 'bank',   label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'lcn',    label: 'LCN' },
]

const schema = z.object({
  date:           z.string().min(1, 'Date requise'),
  due_date:       z.string().optional(),
  party_id:       z.coerce.number().min(1, 'Fournisseur requis'),
  payment_method: z.string().default('bank'),
  notes:          z.string().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01),
    unit_price:  z.coerce.number().min(0),
    discount:    z.coerce.number().min(0).max(100).default(0),
    tva_rate:    z.coerce.number().default(20),
  })).min(1),
})

type FormData = z.infer<typeof schema>

interface Props {
  onSaved: () => void
  onCancel: () => void
  editDocId?: number
  defaultValues?: Partial<FormData & { docId: number }>
}

export default function PurchaseInvoiceForm({ onSaved, onCancel, editDocId, defaultValues }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const isEdit = !!editDocId

  const { register, control, handleSubmit, watch, setValue, reset,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      payment_method: 'bank',
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines     = watch('lines')
  const payMethod = watch('payment_method')

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  useEffect(() => {
    if (!defaultValues) return
    reset({
      date:           defaultValues.date           ?? new Date().toISOString().split('T')[0],
      due_date:       (defaultValues as any).due_date       ?? '',
      party_id:       defaultValues.party_id       ?? 0,
      payment_method: (defaultValues as any).payment_method ?? 'bank',
      notes:          defaultValues.notes          ?? '',
      lines: defaultValues.lines?.length
        ? defaultValues.lines as FormData['lines']
        : [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    })
  }, [defaultValues])

  async function onSubmit(data: FormData, confirm: boolean) {
    try {
      if (isEdit) {
        await api.cancelDocument(editDocId!)
      }
      const doc = await api.createDocument({
        type: 'purchase_invoice', date: data.date,
        party_id: data.party_id, party_type: 'supplier',
        lines: data.lines, notes: data.notes,
        extra: { payment_method: data.payment_method, due_date: data.due_date },
        created_by: 1,
      }) as any
      if (confirm) {
        await api.confirmDocument(doc.id)
        toast(isEdit ? 'Facture mise à jour et confirmée ✓' : 'Facture fournisseur enregistrée ✓')
      } else {
        toast(isEdit ? 'Brouillon mis à jour ✓' : 'Brouillon sauvegardé')
      }
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form className="space-y-5">
      {isEdit && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          ✏️ Mode édition — le brouillon actuel sera remplacé.
        </div>
      )}

      <FormField label="Fournisseur" required error={errors.party_id?.message}>
        <PartySelector
          type="supplier"
          value={watch('party_id')}
          onChange={(id) => setValue('party_id', id)}
          onClear={() => setValue('party_id', 0)}
          error={errors.party_id?.message}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date facture" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Date d'échéance">
          <input {...register('due_date')} className="input" type="date" />
        </FormField>
      </div>

      <FormField label="Mode de paiement">
        <div className="flex gap-1.5">
          {PAYMENT_METHODS.map(m => (
            <label key={m.value}
              className={`flex-1 text-center py-2 rounded-lg border text-xs font-medium cursor-pointer transition-all
                ${payMethod === m.value
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 hover:border-primary/40'}`}>
              <input {...register('payment_method')} type="radio" value={m.value} className="hidden" />
              {m.label}
            </label>
          ))}
        </div>
      </FormField>

      <LinesTable
        fields={fields}
        lines={lines}
        products={products}
        register={register}
        setValue={setValue}
        onRemove={remove}
        onAdd={() => append({ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() })}
        showDiscount
        showTva
        priceLabel="Prix d'achat HT"
      />

      <LinesTotals lines={lines} />

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => onSubmit(d, false))}
          className="btn-secondary flex-1 justify-center">
          {isSubmitting ? '...' : '💾 Brouillon'}
        </button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => onSubmit(d, true))}
          className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Confirmer facture'}
        </button>
      </div>
    </form>
  )
}
