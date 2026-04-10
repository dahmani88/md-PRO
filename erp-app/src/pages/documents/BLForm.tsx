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
  delivery_date:     z.string().optional(),
  delivery_address:  z.string().optional(),
  party_id:          z.coerce.number().min(1, 'Client requis'),
  source_invoice_id: z.coerce.number().optional(),
  notes:             z.string().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01),
    unit_price:  z.coerce.number().min(0).default(0),
    discount:    z.coerce.number().min(0).max(100).default(0),
    tva_rate:    z.coerce.number().default(20),
  })).min(1),
})

type FormData = z.infer<typeof schema>

interface Props { onSaved: () => void; onCancel: () => void }

export default function BLForm({ onSaved, onCancel }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [invoices, setInvoices] = useState<Document[]>([])

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
  }, [])

  useEffect(() => {
    if (!partyId) return
    api.getDocuments({ type: 'invoice', party_id: partyId, status: 'confirmed' })
      .then((r: any) => setInvoices(r.rows ?? []))
  }, [partyId])

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  async function onSubmit(data: FormData) {
    try {
      const doc = await api.createDocument({
        type: 'bl', date: data.date,
        party_id: data.party_id, party_type: 'client',
        lines: data.lines, notes: data.notes,
        extra: {
          delivery_address: data.delivery_address,
          delivery_date: data.delivery_date,
        },
        created_by: 1,
      }) as any

      // Lier à la facture source si sélectionnée
      if (data.source_invoice_id) {
        await api.linkDocuments({
          parentId: data.source_invoice_id,
          childId: doc.id,
          linkType: 'invoice_to_bl',
        }).catch(() => {})
      }

      await api.confirmDocument(doc.id)
      toast('Bon de livraison créé — Mouvement stock en attente ⏳')
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
          onClear={() => { setValue('party_id', 0); setInvoices([]) }}
          error={errors.party_id?.message}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date BL" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Date de livraison prévue">
          <input {...register('delivery_date')} className="input" type="date" />
        </FormField>
      </div>

      <FormField label="Adresse de livraison">
        <input {...register('delivery_address')} className="input" placeholder="Adresse de livraison..." />
      </FormField>

      {invoices.length > 0 && (
        <FormField label="Facture liée (optionnel)">
          <select {...register('source_invoice_id')} className="input">
            <option value="">— BL autonome (sans facture) —</option>
            {invoices.map(inv => (
              <option key={inv.id} value={inv.id}>
                {inv.number} — {fmt(inv.total_ttc)} MAD
              </option>
            ))}
          </select>
        </FormField>
      )}

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
        productFilter={p => p.type === 'finished' || p.type === 'semi_finished'}
      />

      <LinesTotals lines={lines} />

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
        ℹ️ Le mouvement de stock sera créé en attente. Vous pourrez l'appliquer depuis les détails du BL.
      </div>

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="submit" disabled={isSubmitting} onClick={handleSubmit(onSubmit)} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Créer BL'}
        </button>
      </div>
    </form>
  )
}
