import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/ui/FormField'
import { PartySelector } from '../../components/ui/PartySelector'
import { LinesTable } from '../../components/ui/LinesTable'
import type { Product } from '../../types'

// ─── Schema ──────────────────────────────────────────────────────────────────
const lineSchema = z.object({
  product_id:  z.coerce.number().optional(),
  description: z.string().optional(),
  quantity:    z.coerce.number().min(0.01, 'Qté > 0'),
  unit_price:  z.coerce.number().min(0).default(0), // prix en devise étrangère (pour répartition par valeur)
  discount:    z.coerce.number().min(0).max(100).default(0),
  tva_rate:    z.coerce.number().default(0),
})

const schema = z.object({
  date:            z.string().min(1, 'Date requise'),
  party_id:        z.coerce.number().min(1, 'Fournisseur requis'),
  currency:        z.string().default('EUR'),
  exchange_rate:   z.coerce.number().min(0.0001, 'Taux requis').default(10.8),
  invoice_amount:  z.coerce.number().min(0).default(0),
  customs:         z.coerce.number().min(0).default(0),
  transitaire:     z.coerce.number().min(0).default(0),
  tva_import:      z.coerce.number().min(0).default(0),
  other_costs:     z.coerce.number().min(0).default(0),
  notes:           z.string().optional(),
  lines:           z.array(lineSchema).min(1, 'Au moins un produit'),
})

type FormData = z.infer<typeof schema>

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CNY', 'AED', 'TRY', 'MAD']

interface Props {
  editDocId?: number
  defaultValues?: Partial<FormData & { docId: number }>
  onSaved: () => void
  onCancel: () => void
}

const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

export default function ImportInvoiceForm({ editDocId, defaultValues, onSaved, onCancel }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const isEdit = !!editDocId

  const { register, control, handleSubmit, watch, setValue, reset,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date:            new Date().toISOString().split('T')[0],
      currency:        'EUR',
      exchange_rate:   10.8,
      invoice_amount:  0,
      customs:         0,
      transitaire:     0,
      tva_import:      0,
      other_costs:     0,
      lines: [{ description: '', quantity: 1, unit_price: 0, discount: 0, tva_rate: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })

  const lines          = watch('lines')
  const currency       = watch('currency')
  const invoiceAmount  = watch('invoice_amount')
  const exchangeRate   = watch('exchange_rate')
  const customs        = watch('customs')
  const transitaire    = watch('transitaire')
  const tvaImport      = watch('tva_import')
  const otherCosts     = watch('other_costs')

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  // Mode édition — pré-remplir
  useEffect(() => {
    if (!defaultValues) return
    reset({
      date:            defaultValues.date            ?? new Date().toISOString().split('T')[0],
      party_id:        defaultValues.party_id        ?? 0,
      currency:        (defaultValues as any).currency        ?? 'EUR',
      exchange_rate:   Number((defaultValues as any).exchange_rate)  || 10.8,
      invoice_amount:  Number((defaultValues as any).invoice_amount) || 0,
      customs:         Number((defaultValues as any).customs)        || 0,
      transitaire:     Number((defaultValues as any).transitaire)    || 0,
      tva_import:      Number((defaultValues as any).tva_import)     || 0,
      other_costs:     Number((defaultValues as any).other_costs)    || 0,
      notes:           defaultValues.notes ?? '',
      lines: (defaultValues.lines as any)?.length
        ? (defaultValues.lines as any).map((l: any) => ({
            product_id:  l.product_id  ?? undefined,
            description: l.description ?? '',
            quantity:    Number(l.quantity)   || 1,
            unit_price:  Number(l.unit_price) || 0,
            discount:    Number(l.discount)   || 0,
            tva_rate:    Number(l.tva_rate)   || 0,
          }))
        : [{ description: '', quantity: 1, unit_price: 0, discount: 0, tva_rate: 0 }],
    })
  }, [defaultValues])

  // ── Calculs Landed Cost ───────────────────────────────────────────────────
  const invoiceMAD = Number(invoiceAmount || 0) * Number(exchangeRate || 1)
  const totalCost  = invoiceMAD
    + Number(customs     || 0)
    + Number(transitaire || 0)
    + Number(tvaImport   || 0)
    + Number(otherCosts  || 0)

  // Répartition: par valeur si les prix sont renseignés, sinon par quantité
  const totalValueBase = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0)
  const useValueMode   = totalValueBase > 0

  const linesWithCost = lines.map(l => {
    const qty   = Number(l.quantity)   || 0
    const price = Number(l.unit_price) || 0
    const base      = useValueMode ? qty * price : qty
    const totalBase = useValueMode
      ? totalValueBase
      : lines.reduce((s, x) => s + (Number(x.quantity) || 0), 0)
    const allocated = totalBase > 0 ? (base / totalBase) * totalCost : 0
    return { allocated, unit_cost: qty > 0 ? allocated / qty : 0 }
  })

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submitForm(data: FormData, confirm: boolean) {
    try {
      const docLines = data.lines.map((l, i) => ({
        product_id:  l.product_id || null,
        description: l.description,
        quantity:    l.quantity,
        unit_price:  linesWithCost[i]?.unit_cost ?? 0, // coût unitaire MAD après répartition
        discount:    0,
        tva_rate:    0,
      }))

      const extra = {
        currency:       data.currency,
        exchange_rate:  data.exchange_rate,
        invoice_amount: data.invoice_amount,
        customs:        data.customs,
        transitaire:    data.transitaire,
        tva_import:     data.tva_import,
        other_costs:    data.other_costs,
        total_cost:     totalCost,
      }

      if (isEdit) {
        // فقط يمكن تعديل المسودات
        const current = await api.getDocument(editDocId!) as any
        if (current.status !== 'draft') {
          throw new Error('Impossible de modifier une importation déjà confirmée. Annulez-la d\'abord.')
        }
        await api.cancelDocument(editDocId!)
      }

      const doc = await api.createDocument({
        type: 'import_invoice', date: data.date,
        party_id: data.party_id, party_type: 'supplier',
        lines: docLines, notes: data.notes, extra, created_by: 1,
      }) as any

      if (confirm) {
        await api.confirmDocument(doc.id)
        toast(isEdit ? 'Importation mise à jour et confirmée ✓' : 'Importation confirmée — Landed Cost réparti ✓')
      } else {
        toast(isEdit ? 'Brouillon mis à jour ✓' : 'Brouillon sauvegardé')
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

      {/* Fournisseur */}
      <FormField label="Fournisseur étranger" required error={errors.party_id?.message}>
        <PartySelector
          type="supplier"
          value={watch('party_id')}
          onChange={id => setValue('party_id', id, { shouldValidate: true })}
          onClear={() => setValue('party_id', 0)}
          error={errors.party_id?.message}
        />
      </FormField>

      {/* Date + Devise + Taux */}
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Date" required error={errors.date?.message}>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Devise">
          <select {...register('currency')} className="input">
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </FormField>
        <FormField label={`Taux (1 ${currency} = ? MAD)`} error={errors.exchange_rate?.message}>
          <input {...register('exchange_rate')} className="input" type="number" min="0.0001" step="0.0001" />
        </FormField>
      </div>

      {/* Landed Cost */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">💰 Détail des coûts (Landed Cost)</h3>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={`Montant facture (${currency})`}>
            <div className="flex gap-2 items-center">
              <input {...register('invoice_amount')} className="input flex-1" type="number" min="0" step="0.01" />
              <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">= {fmt(invoiceMAD)} MAD</span>
            </div>
          </FormField>
          <FormField label="Frais de douane (MAD)">
            <input {...register('customs')} className="input" type="number" min="0" step="0.01" />
          </FormField>
          <FormField label="Frais transitaire (MAD)">
            <input {...register('transitaire')} className="input" type="number" min="0" step="0.01" />
          </FormField>
          <FormField label="TVA import (MAD)">
            <input {...register('tva_import')} className="input" type="number" min="0" step="0.01" />
          </FormField>
          <FormField label="Autres frais (MAD)">
            <input {...register('other_costs')} className="input" type="number" min="0" step="0.01" />
          </FormField>
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-700 font-bold">
          <span className="text-sm">Coût total à répartir</span>
          <span className="text-primary text-lg">{fmt(totalCost)} MAD</span>
        </div>
      </div>

      {/* Produits importés */}
      <LinesTable
        fields={fields}
        lines={lines}
        products={products}
        register={register}
        setValue={setValue}
        onRemove={remove}
        onAdd={() => append({ description: '', quantity: 1, unit_price: 0, discount: 0, tva_rate: 0 })}
        showDiscount={false}
        showTva={false}
        priceLabel={`Prix unit. (${currency}) — optionnel`}
        readonlyPrice={false}
      />

      {/* Résumé répartition landed cost */}
      {lines.length > 0 && totalCost > 0 && (
        <div className="border border-primary/20 rounded-lg overflow-hidden">
          <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-primary/5 text-xs font-medium text-gray-500">
            <div>Produit</div>
            <div className="text-right">Coût alloué</div>
            <div className="text-right">Coût / unité (MAD)</div>
          </div>
          <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
            Répartition {useValueMode ? 'par valeur (qté × prix)' : 'par quantité (prix non renseignés)'}
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-3 gap-2 px-3 py-1.5 border-t border-gray-100 dark:border-gray-700 text-xs">
              <div className="text-gray-600 dark:text-gray-300 truncate">{l.description || `Ligne ${i + 1}`}</div>
              <div className="text-right font-semibold text-primary">{fmt(linesWithCost[i]?.allocated ?? 0)} MAD</div>
              <div className="text-right text-gray-500">{fmt(linesWithCost[i]?.unit_cost ?? 0)}</div>
            </div>
          ))}
          <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700 text-xs font-bold">
            <div>Total</div>
            <div className="text-right text-primary">{fmt(totalCost)} MAD</div>
            <div />
          </div>
        </div>
      )}

      {(errors.lines as any)?.message && (
        <p className="text-xs text-red-500">{(errors.lines as any).message}</p>
      )}

      {/* Info BR */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2.5 text-xs text-blue-700 dark:text-blue-400">
        ℹ️ Après confirmation, créez un <strong>Bon de Réception</strong> depuis les détails pour mettre à jour le stock et le CMUP.
      </div>

      {/* Notes */}
      <FormField label="Notes / Référence douane">
        <textarea {...register('notes')} className="input resize-none" rows={2}
          placeholder="N° déclaration douane, remarques..." />
      </FormField>

      {/* Actions */}
      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => submitForm(d, false))}
          className="btn-secondary flex-1 justify-center">
          {isSubmitting ? '...' : '💾 Brouillon'}
        </button>
        <button type="button" disabled={isSubmitting}
          onClick={handleSubmit(d => submitForm(d, true))}
          className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Confirmer'}
        </button>
      </div>
    </form>
  )
}
