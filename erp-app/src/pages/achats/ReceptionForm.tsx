import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/ui/FormField'
import { PartySelector } from '../../components/ui/PartySelector'
import { LinesTable, getDefaultTva, LinesTotals } from '../../components/ui/LinesTable'
import type { Product, Document } from '../../types'

const schema = z.object({
  date:              z.string().min(1, 'Date requise'),
  party_id:          z.coerce.number().min(1, 'Fournisseur requis'),
  purchase_order_id: z.coerce.number().optional(),
  notes:             z.string().optional(),
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

interface Props { onSaved: () => void; onCancel: () => void }

export default function ReceptionForm({ onSaved, onCancel }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<Document[]>([])

  const { register, control, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines   = watch('lines')
  const partyId = watch('party_id')

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
    api.getDocuments({ type: 'purchase_order', status: 'confirmed' })
      .then((r: any) => setPurchaseOrders(r.rows ?? []))
  }, [])

  // Filtrer les BC par fournisseur sélectionné
  const filteredOrders = partyId
    ? purchaseOrders.filter(po => po.party_id === partyId)
    : purchaseOrders

  async function onSubmit(data: FormData) {
    try {
      const doc = await api.createDocument({
        type: 'bl_reception', date: data.date,
        party_id: data.party_id, party_type: 'supplier',
        lines: data.lines, notes: data.notes,
        extra: { purchase_order_id: data.purchase_order_id || null },
        created_by: 1,
      }) as any

      // Lier au BC si sélectionné
      if (data.purchase_order_id) {
        await api.linkDocuments({
          parentId: data.purchase_order_id,
          childId: doc.id,
          linkType: 'po_to_reception',
        }).catch(() => {})
      }

      await api.confirmDocument(doc.id)
      toast('Bon de réception créé — Mouvement stock en attente ⏳')
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
        <FormField label="Date réception" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Bon de commande lié">
          <select {...register('purchase_order_id')} className="input">
            <option value="">— Sans BC lié —</option>
            {filteredOrders.map(po => (
              <option key={po.id} value={po.id}>{po.number} — {po.party_name}</option>
            ))}
          </select>
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
        priceLabel="Prix d'achat HT"
        productFilter={p => p.type === 'raw' || p.type === 'semi_finished'}
      />

      <LinesTotals lines={lines} />

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
        ℹ️ Le mouvement de stock sera créé en attente. Appliquez-le depuis les détails du BR.
      </div>

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="submit" disabled={isSubmitting} onClick={handleSubmit(onSubmit)} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Enregistrer réception'}
        </button>
      </div>
    </form>
  )
}
