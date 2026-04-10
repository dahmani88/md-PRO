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

const schema = z.object({
  date:                   z.string().min(1, 'Date requise'),
  expected_delivery_date: z.string().optional(),
  party_id:               z.coerce.number().min(1, 'Fournisseur requis'),
  notes:                  z.string().optional(),
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

export default function PurchaseOrderForm({ onSaved, onCancel, editDocId, defaultValues }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const isEdit = !!editDocId

  const { register, control, handleSubmit, watch, setValue, reset,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = watch('lines')

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  // pré-remplir en mode édition
  useEffect(() => {
    if (!defaultValues) return
    reset({
      date:                   defaultValues.date ?? new Date().toISOString().split('T')[0],
      expected_delivery_date: (defaultValues as any).expected_delivery_date ?? '',
      party_id:               defaultValues.party_id ?? 0,
      notes:                  defaultValues.notes ?? '',
      lines:                  defaultValues.lines?.length
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
        type: 'purchase_order', date: data.date,
        party_id: data.party_id, party_type: 'supplier',
        lines: data.lines, notes: data.notes,
        extra: { expected_delivery_date: data.expected_delivery_date },
        created_by: 1,
      }) as any
      if (confirm) {
        await api.confirmDocument(doc.id)
        toast(isEdit ? 'BC mis à jour et confirmé ✓' : 'Bon de commande confirmé ✓')
      } else {
        toast(isEdit ? 'BC mis à jour ✓' : 'Brouillon sauvegardé')
      }
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form className="space-y-5">
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
        <FormField label="Date" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Livraison prévue">
          <input {...register('expected_delivery_date')} className="input" type="date" />
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
        priceLabel="Prix HT unitaire"
      />

      <LinesTotals lines={lines} />

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques, conditions..." />
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
          {isSubmitting ? '...' : '✅ Confirmer BC'}
        </button>
      </div>
    </form>
  )
}
