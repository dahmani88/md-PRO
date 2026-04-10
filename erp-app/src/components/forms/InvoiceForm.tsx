import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../ui/Toast'
import FormField from '../ui/FormField'
import { PartySelector } from '../ui/PartySelector'
import { LinesTable, getDefaultTva, LinesTotals } from '../ui/LinesTable'
import type { Product } from '../../types'

const schema = z.object({
  date:           z.string().min(1, 'Date requise'),
  due_date:       z.string().optional(),
  party_id:       z.coerce.number().min(1, 'Client requis'),
  payment_method: z.string().default('cash'),
  currency:       z.string().default('MAD'),
  exchange_rate:  z.coerce.number().min(0.0001).default(1),
  notes:          z.string().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01, 'Qté > 0'),
    unit_price:  z.coerce.number().min(0),
    discount:    z.coerce.number().min(0).max(100).default(0),
    tva_rate:    z.coerce.number().default(20),
  })).min(1, 'Au moins une ligne'),
})

type FormData = z.infer<typeof schema>

const PAYMENT_METHODS = [
  { value: 'cash',   label: 'Espèces' },
  { value: 'bank',   label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'lcn',    label: 'LCN' },
]

interface Props {
  docType?: string
  editDocId?: number          // si défini → mode édition
  defaultValues?: Partial<FormData & { docId: number }>
  onSaved: () => void
  onCancel: () => void
}

export default function InvoiceForm({
  docType = 'invoice',
  editDocId,
  defaultValues,
  onSaved,
  onCancel,
}: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const isEdit = !!editDocId

  const { register, control, handleSubmit, watch, setValue, reset,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date:           new Date().toISOString().split('T')[0],
      currency:       'MAD',
      exchange_rate:  1,
      payment_method: 'cash',
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines     = watch('lines')
  const currency  = watch('currency')
  const payMethod = watch('payment_method')

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  // pré-remplir en mode édition
  useEffect(() => {
    if (!defaultValues) return
    reset({
      date:           defaultValues.date           ?? new Date().toISOString().split('T')[0],
      due_date:       (defaultValues as any).due_date ?? '',
      party_id:       defaultValues.party_id       ?? 0,
      payment_method: (defaultValues as any).payment_method ?? 'cash',
      currency:       (defaultValues as any).currency       ?? 'MAD',
      exchange_rate:  (defaultValues as any).exchange_rate  ?? 1,
      notes:          defaultValues.notes          ?? '',
      lines:          defaultValues.lines?.length
        ? defaultValues.lines as FormData['lines']
        : [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    })
  }, [defaultValues])

  async function submitDoc(data: FormData, confirm: boolean) {
    try {
      if (isEdit) {
        // mise à jour du brouillon existant
        await api.updateDocument({
          id:    editDocId,
          notes: data.notes,
          // on recrée les lignes via un endpoint dédié si disponible
          // sinon on passe par createDocument en écrasant
        })
        // recréer les lignes n'est pas supporté directement —
        // on annule l'ancien et on crée un nouveau
        await api.cancelDocument(editDocId!)
        const doc = await api.createDocument({
          type: docType, date: data.date,
          party_id: data.party_id, party_type: 'client',
          lines: data.lines, notes: data.notes,
          extra: {
            currency: data.currency, exchange_rate: data.exchange_rate,
            payment_method: data.payment_method, due_date: data.due_date,
          },
          created_by: 1,
        }) as any
        if (confirm) {
          await api.confirmDocument(doc.id)
          toast('Document mis à jour et confirmé ✓')
        } else {
          toast('Brouillon mis à jour ✓')
        }
      } else {
        const doc = await api.createDocument({
          type: docType, date: data.date,
          party_id: data.party_id, party_type: 'client',
          lines: data.lines, notes: data.notes,
          extra: {
            currency: data.currency, exchange_rate: data.exchange_rate,
            payment_method: data.payment_method, due_date: data.due_date,
          },
          created_by: 1,
        }) as any
        if (confirm) {
          await api.confirmDocument(doc.id)
          toast('Document confirmé — Écriture comptable générée ✓')
        } else {
          toast('Brouillon sauvegardé')
        }
      }
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <form className="space-y-5">
      {isEdit && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          ✏️ Mode édition — le brouillon actuel sera remplacé par cette version.
        </div>
      )}

      {/* Client */}
      <FormField label="Client" required error={errors.party_id?.message}>
        <PartySelector
          type="client"
          value={watch('party_id')}
          onChange={(id) => setValue('party_id', id)}
          onClear={() => setValue('party_id', 0)}
          error={errors.party_id?.message}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Date" required error={errors.date?.message}>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Date d'échéance">
          <input {...register('due_date')} className="input" type="date" />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Mode de paiement">
          <div className="flex gap-1.5">
            {PAYMENT_METHODS.map(m => (
              <label key={m.value}
                className={`flex-1 text-center py-2 rounded-lg border text-xs font-medium cursor-pointer transition-all
                  ${payMethod === m.value
                    ? 'bg-primary text-white border-primary shadow-sm'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-primary/40'}`}>
                <input {...register('payment_method')} type="radio" value={m.value} className="hidden" />
                {m.label}
              </label>
            ))}
          </div>
        </FormField>

        <FormField label="Devise">
          <div className="flex gap-2">
            <select {...register('currency')} className="input flex-1">
              {['MAD', 'EUR', 'USD', 'GBP', 'AED', 'CNY'].map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {currency !== 'MAD' && (
              <input {...register('exchange_rate')} className="input w-28"
                type="number" step="0.0001" min="0.0001" placeholder="Taux" />
            )}
          </div>
        </FormField>
      </div>

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
      />

      <LinesTotals lines={lines} currency={currency} />

      <FormField label="Notes / Observations">
        <textarea {...register('notes')} className="input resize-none" rows={2}
          placeholder="Conditions de paiement, remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => submitDoc(d, false))}
          className="btn-secondary flex-1 justify-center">
          {isSubmitting ? '...' : '💾 Brouillon'}
        </button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => submitDoc(d, true))}
          className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Confirmer'}
        </button>
      </div>
    </form>
  )
}
