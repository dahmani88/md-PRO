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

const AVOIR_TYPES = [
  { value: 'retour',     label: 'Retour marchandise', icon: '📦', desc: 'Retour physique — remet en stock' },
  { value: 'commercial', label: 'Avoir commercial',   icon: '💸', desc: 'Remise accordée après facturation' },
  { value: 'annulation', label: 'Annulation facture', icon: '🚫', desc: 'Annulation totale — inverse le quid' },
] as const

const schema = z.object({
  avoir_type:        z.enum(['retour', 'commercial', 'annulation']),
  party_id:          z.coerce.number().min(1, 'Client requis'),
  date:              z.string().min(1, 'Date requise'),
  reason:            z.string().min(1, 'Motif requis'),
  source_invoice_id: z.coerce.number().optional(),
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
  sourceInvoice?: Document & { lines?: any[]; party_name?: string }
}

export default function AvoirForm({ onSaved, onCancel, sourceInvoice }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [invoices, setInvoices] = useState<Document[]>([])

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  const { register, control, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      avoir_type:        'commercial',
      party_id:          sourceInvoice?.party_id ?? 0,
      date:              new Date().toISOString().split('T')[0],
      reason:            '',
      source_invoice_id: sourceInvoice?.id,
      lines: sourceInvoice?.lines?.map((l: any) => ({
        product_id:  l.product_id ?? undefined,
        description: l.description ?? '',
        quantity:    l.quantity,
        unit_price:  l.unit_price,
        discount:    l.discount ?? 0,
        tva_rate:    l.tva_rate ?? 20,
      })) ?? [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: getDefaultTva() }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines       = watch('lines')
  const avoirType   = watch('avoir_type')
  const partyId     = watch('party_id')
  const sourceInvId = watch('source_invoice_id')

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  useEffect(() => {
    if (!partyId) return
    api.getDocuments({ type: 'invoice', party_id: partyId, limit: 50 } as any)
      .then((r: any) => setInvoices(
        (r.rows ?? []).filter((d: any) => ['confirmed', 'partial', 'paid'].includes(d.status))
      ))
  }, [partyId])

  // Annulation: pré-remplir depuis la facture source
  useEffect(() => {
    if (avoirType !== 'annulation' || !sourceInvId) return
    const inv = invoices.find(i => i.id === Number(sourceInvId)) as any
    if (!inv?.lines) return
    inv.lines.forEach((l: any, i: number) => {
      setValue(`lines.${i}.quantity`,   l.quantity)
      setValue(`lines.${i}.unit_price`, l.unit_price)
      setValue(`lines.${i}.tva_rate`,   l.tva_rate)
      setValue(`lines.${i}.description`, l.description ?? '')
      setValue(`lines.${i}.product_id`, l.product_id)
    })
  }, [avoirType, sourceInvId, invoices])

  async function onSubmit(data: FormData) {
    try {
      const affects_stock = data.avoir_type === 'retour'

      const doc = await api.createDocument({
        type: 'avoir', date: data.date,
        party_id: data.party_id, party_type: 'client',
        lines: data.lines, notes: data.reason,
        extra: { avoir_type: data.avoir_type, affects_stock, reason: data.reason },
        created_by: 1,
      }) as any

      if (data.source_invoice_id) {
        await api.linkDocuments({
          parentId: data.source_invoice_id,
          childId: doc.id,
          linkType: 'invoice_to_avoir',
        }).catch(() => {})
      }

      await api.confirmDocument(doc.id)

      const msg = affects_stock
        ? 'Avoir créé — Mouvement stock en attente ⏳'
        : 'Avoir créé — Écriture comptable générée ✓'
      toast(msg)
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <div className="space-y-5">
      {/* Facture source */}
      {sourceInvoice && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 text-sm flex items-center gap-3">
          <span className="text-blue-500">🔗</span>
          <span className="text-blue-600 font-medium">Avoir sur</span>
          <span className="font-mono font-bold text-blue-700">{sourceInvoice.number}</span>
          <span className="text-blue-500 ml-auto">{fmt(sourceInvoice.total_ttc)} MAD</span>
        </div>
      )}

      {/* Type d'avoir */}
      <FormField label="Type d'avoir" required>
        <div className="grid grid-cols-3 gap-2">
          {AVOIR_TYPES.map(t => (
            <label key={t.value}
              className={`p-3 rounded-xl border-2 cursor-pointer transition-all
                ${avoirType === t.value
                  ? 'border-primary bg-primary/5 dark:bg-primary/10'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
              <input {...register('avoir_type')} type="radio" value={t.value} className="hidden" />
              <div className="text-lg mb-1">{t.icon}</div>
              <div className="font-medium text-xs text-gray-800 dark:text-gray-200">{t.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{t.desc}</div>
            </label>
          ))}
        </div>
      </FormField>

      {/* Client */}
      {!sourceInvoice && (
        <FormField label="Client" required error={errors.party_id?.message}>
          <PartySelector
            type="client"
            value={watch('party_id')}
            onChange={(id) => setValue('party_id', id)}
            onClear={() => { setValue('party_id', 0); setInvoices([]) }}
            error={errors.party_id?.message}
          />
        </FormField>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        {!sourceInvoice && invoices.length > 0 && (
          <FormField label="Facture liée">
            <select {...register('source_invoice_id')} className="input">
              <option value="">— Sans facture liée —</option>
              {invoices.map(inv => (
                <option key={inv.id} value={inv.id}>
                  {inv.number} — {fmt(inv.total_ttc)} MAD
                </option>
              ))}
            </select>
          </FormField>
        )}
      </div>

      <FormField label="Motif" required error={errors.reason?.message}>
        <input
          {...register('reason')}
          className="input"
          placeholder="Ex: Retour produit défectueux, remise accordée..."
          autoFocus={!!sourceInvoice}
        />
      </FormField>

      {avoirType === 'retour' && (
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg px-4 py-2.5 text-xs text-orange-700 dark:text-orange-400">
          ⚠️ Les quantités ci-dessous seront remises en stock au CMUP actuel.
        </div>
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
      />

      <LinesTotals lines={lines} />

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleSubmit(onSubmit)}
          className="btn-primary flex-1 justify-center"
        >
          {isSubmitting ? '...' : '✅ Créer Avoir'}
        </button>
      </div>
    </div>
  )
}
