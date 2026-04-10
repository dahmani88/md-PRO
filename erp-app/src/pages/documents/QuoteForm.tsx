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
  date:            z.string().min(1, 'Date requise'),
  validity_date:   z.string().optional(),
  party_id:        z.coerce.number().min(1, 'Client requis'),
  global_discount: z.coerce.number().min(0).max(100).default(0),
  notes:           z.string().optional(),
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
  docType: 'quote'
  onSaved: () => void
  onCancel: () => void
}

export default function QuoteForm({ onSaved, onCancel }: Props) {
  const [products, setProducts] = useState<Product[]>([])

  const { register, control, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      global_discount: 0,
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines          = watch('lines')
  const globalDiscount = watch('global_discount') || 0

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  // coût total pour calcul marge
  const totalCost = lines.reduce((acc, l) => {
    const p = products.find(p => p.id === l.product_id)
    return acc + (Number(l.quantity) || 0) * (p?.cmup_price ?? 0)
  }, 0)

  async function submitDoc(data: FormData, confirm: boolean) {
    try {
      const doc = await api.createDocument({
        type: 'quote', date: data.date,
        party_id: data.party_id, party_type: 'client',
        lines: data.lines, notes: data.notes,
        extra: { validity_date: data.validity_date, global_discount: data.global_discount },
        created_by: 1,
      }) as any
      if (confirm) { await api.confirmDocument(doc.id); toast('Devis confirmé ✓') }
      else toast('Brouillon sauvegardé')
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form className="space-y-5">
      <FormField label="Client" required error={errors.party_id?.message}>
        <PartySelector
          type="client"
          value={watch('party_id')}
          onChange={(id) => setValue('party_id', id)}
          onClear={() => setValue('party_id', 0)}
          error={errors.party_id?.message}
        />
      </FormField>

      <div className="grid grid-cols-3 gap-3">
        <FormField label="Date" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Valide jusqu'au">
          <input {...register('validity_date')} className="input" type="date" />
        </FormField>
        <FormField label="Remise globale (%)">
          <input {...register('global_discount')} className="input" type="number" min="0" max="100" step="0.1" placeholder="0" />
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
        showMargin
      />

      <LinesTotals
        lines={lines}
        globalDiscount={globalDiscount}
        showMargin
        totalCost={totalCost}
      />

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Conditions, remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="button" disabled={isSubmitting} onClick={handleSubmit(d => submitDoc(d, false))} className="btn-secondary flex-1 justify-center">
          {isSubmitting ? '...' : '💾 Brouillon'}
        </button>
        <button type="button" disabled={isSubmitting} onClick={handleSubmit(d => submitDoc(d, true))} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Confirmer'}
        </button>
      </div>
    </form>
  )
}
