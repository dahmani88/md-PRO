import { useState, useEffect, useRef } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/ui/FormField'
import type { Client, Document } from '../../types'

const schema = z.object({
  avoir_type:        z.enum(['retour', 'commercial', 'annulation']),
  party_id:          z.coerce.number().min(1, 'Client requis'),
  date:              z.string().min(1),
  reason:            z.string().min(1, 'Motif requis'),
  source_invoice_id: z.coerce.number().optional(),
  lines: z.array(z.object({
    product_id:  z.number().optional(),
    description: z.string().optional(),
    quantity:    z.coerce.number().min(0.01),
    unit_price:  z.coerce.number().min(0),
    tva_rate:    z.coerce.number().default(20),
  })).min(1),
})

type FormData = z.infer<typeof schema>

const TVA_RATES = [0, 7, 10, 14, 20]

const AVOIR_TYPES = [
  { value: 'retour',     label: '📦 Retour marchandise', desc: 'Retour physique — remet en stock' },
  { value: 'commercial', label: '💸 Avoir commercial',   desc: 'Remise accordée après facturation' },
  { value: 'annulation', label: '🚫 Annulation',         desc: 'Annulation totale de la facture' },
] as const

interface ComboboxProps {
  items: Array<{ id: number; label: string; sub?: string }>
  value: string
  onChange: (v: string) => void
  onSelect: (id: number, label: string) => void
  placeholder: string
  error?: boolean
}

function Combobox({ items, value, onChange, onSelect, placeholder, error }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const filtered = value ? items.filter(i => i.label.toLowerCase().includes(value.toLowerCase())) : items
  return (
    <div ref={ref} className="relative">
      <input value={value} onChange={e => { onChange(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        className={`input ${error ? 'input-error' : ''}`} placeholder={placeholder} autoComplete="off" />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden max-h-48 overflow-y-auto">
          {filtered.slice(0, 10).map(item => (
            <button key={item.id} type="button"
              className="w-full flex flex-col px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-left"
              onMouseDown={e => { e.preventDefault(); onSelect(item.id, item.label); setOpen(false) }}>
              <span className="text-sm font-medium">{item.label}</span>
              {item.sub && <span className="text-xs text-gray-400">{item.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  onSaved: () => void
  onCancel: () => void
  // إذا استُدعي من تفاصيل فاتورة
  sourceInvoice?: Document & { lines?: any[]; party_name?: string }
}

export default function AvoirForm({ onSaved, onCancel, sourceInvoice }: Props) {
  const [clients, setClients] = useState<Client[]>([])
  const [invoices, setInvoices] = useState<Document[]>([])
  const [clientSearch, setClientSearch] = useState(sourceInvoice?.party_name ?? '')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
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
        tva_rate:    l.tva_rate ?? 20,
      })) ?? [{ quantity: 1, unit_price: 0, tva_rate: 20 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = watch('lines')
  const avoirType = watch('avoir_type')
  const partyId = watch('party_id')

  useEffect(() => {
    api.getClients({ limit: 500 }).then((r: any) => {
      const rows = r.rows ?? []
      setClients(rows)
      if (sourceInvoice?.party_id) {
        const c = rows.find((c: Client) => c.id === sourceInvoice.party_id)
        if (c) { setSelectedClient(c); setClientSearch(c.name) }
      }
    })
  }, [])

  useEffect(() => {
    if (!partyId) return
    api.getDocuments({ type: 'invoice', party_id: partyId, limit: 50 } as any)
      .then((r: any) => setInvoices((r.rows ?? []).filter((d: any) => d.status === 'confirmed' || d.status === 'partial')))
  }, [partyId])

  // عند اختيار "annulation" نملأ السطور من الفاتورة المرتبطة تلقائياً
  const sourceInvId = watch('source_invoice_id')
  useEffect(() => {
    if (avoirType !== 'annulation' || !sourceInvId) return
    const inv = invoices.find(i => i.id === Number(sourceInvId)) as any
    if (inv?.lines) {
      inv.lines.forEach((l: any, i: number) => {
        setValue(`lines.${i}.quantity`, l.quantity)
        setValue(`lines.${i}.unit_price`, l.unit_price)
        setValue(`lines.${i}.tva_rate`, l.tva_rate)
        setValue(`lines.${i}.description`, l.description)
      })
    }
  }, [avoirType, sourceInvId])

  function calcLine(l: any) {
    const ht = (l.quantity || 0) * (l.unit_price || 0)
    return { ht, tva: ht * (l.tva_rate || 0) / 100, ttc: ht + ht * (l.tva_rate || 0) / 100 }
  }

  const totals = lines.reduce((acc, l) => {
    const { ht, tva, ttc } = calcLine(l)
    return { ht: acc.ht + ht, tva: acc.tva + tva, ttc: acc.ttc + ttc }
  }, { ht: 0, tva: 0, ttc: 0 })

  const clientItems = clients.map(c => ({ id: c.id, label: c.name, sub: c.ice ? `ICE: ${c.ice}` : undefined }))

  async function onSubmit(data: FormData) {
    try {
      // إنشاء الأفوار
      const affects_stock = data.avoir_type === 'retour'
      const doc = await api.createDocument({
        type: 'avoir',
        date: data.date,
        party_id: data.party_id,
        party_type: 'client',
        lines: data.lines,
        notes: data.reason,
        extra: { avoir_type: data.avoir_type, affects_stock, reason: data.reason },
        created_by: 1,
      }) as any

      // ربط بالفاتورة الأصلية عبر document_links مباشرة (بدون convertDocument)
      if (data.source_invoice_id) {
        await api.linkDocuments?.({ parentId: data.source_invoice_id, childId: doc.id, linkType: `invoice_to_avoir` })
          .catch(() => {}) // إذا لم تكن الدالة موجودة نتجاهل
      }

      // تأكيد الأفوار → قيد محاسبي تلقائي
      await api.confirmDocument(doc.id)
      toast('Avoir créé et confirmé — Écriture comptable générée')
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <div className="space-y-4">
      {/* مصدر الأفوار */}
      {sourceInvoice && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 text-sm">
          <span className="text-blue-600 font-medium">Avoir sur facture </span>
          <span className="font-mono font-bold text-blue-700">{sourceInvoice.number}</span>
          <span className="text-blue-500 ml-2">— {fmt(sourceInvoice.total_ttc)} MAD</span>
        </div>
      )}

      {/* نوع الأفوار */}
      <FormField label="Type d'avoir" required>
        <div className="grid grid-cols-3 gap-2">
          {AVOIR_TYPES.map(t => (
            <label key={t.value}
              className={`p-3 rounded-lg border-2 cursor-pointer transition-all
                ${avoirType === t.value ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'}`}>
              <input {...register('avoir_type')} type="radio" value={t.value} className="hidden" />
              <div className="font-medium text-xs">{t.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{t.desc}</div>
            </label>
          ))}
        </div>
      </FormField>

      {/* العميل */}
      {!sourceInvoice && (
        <FormField label="Client" required error={errors.party_id?.message}>
          <Combobox items={clientItems}
            value={selectedClient ? selectedClient.name : clientSearch}
            onChange={v => { setClientSearch(v); setSelectedClient(null); setValue('party_id', 0) }}
            onSelect={(id, label) => {
              const c = clients.find(c => c.id === id)!
              setSelectedClient(c); setClientSearch(label); setValue('party_id', id)
            }}
            placeholder="Rechercher un client..." error={!!errors.party_id} />
        </FormField>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        {/* ربط بفاتورة إذا لم يكن مستدعى من فاتورة */}
        {!sourceInvoice && invoices.length > 0 && (
          <FormField label="Facture liée">
            <select {...register('source_invoice_id')} className="input">
              <option value="">— Sans facture liée —</option>
              {invoices.map(inv => (
                <option key={inv.id} value={inv.id}>{inv.number} — {fmt(inv.total_ttc)} MAD</option>
              ))}
            </select>
          </FormField>
        )}
      </div>

      <FormField label="Motif" required error={errors.reason?.message}>
        <input {...register('reason')} className="input" placeholder="Ex: Retour produit défectueux, remise accordée..." autoFocus={!!sourceInvoice} />
      </FormField>

      {/* السطور */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">
            Lignes <span className="text-red-500">*</span>
            {avoirType === 'retour' && <span className="ml-2 text-xs text-orange-500">⚠️ Ces quantités seront remises en stock</span>}
          </label>
          <button type="button" onClick={() => append({ quantity: 1, unit_price: 0, tva_rate: 20 })}
            className="btn-secondary btn-sm">+ Ajouter</button>
        </div>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500">
            <div className="col-span-4">Description</div>
            <div className="col-span-2 text-right">Qté</div>
            <div className="col-span-2 text-right">Prix HT</div>
            <div className="col-span-2 text-right">TVA%</div>
            <div className="col-span-1 text-right">TTC</div>
            <div className="col-span-1"></div>
          </div>
          {fields.map((field, i) => {
            const { ttc } = calcLine(lines[i] ?? {})
            return (
              <div key={field.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 items-center">
                <div className="col-span-4">
                  <input {...register(`lines.${i}.description`)} className="input text-xs" placeholder="Description..." />
                </div>
                <div className="col-span-2"><input {...register(`lines.${i}.quantity`)} className="input text-xs text-right" type="number" min="0.01" step="0.01" /></div>
                <div className="col-span-2"><input {...register(`lines.${i}.unit_price`)} className="input text-xs text-right" type="number" min="0" step="0.01" /></div>
                <div className="col-span-2">
                  <select {...register(`lines.${i}.tva_rate`)} className="input text-xs">
                    {TVA_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                  </select>
                </div>
                <div className="col-span-1 text-right text-xs font-semibold">{fmt(ttc)}</div>
                <div className="col-span-1 text-right">
                  {fields.length > 1 && <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-500 text-xl leading-none">×</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* الإجماليات */}
      <div className="flex justify-end">
        <div className="w-56 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600"><span>Total HT</span><span>{fmt(totals.ht)} MAD</span></div>
          <div className="flex justify-between text-gray-600"><span>TVA</span><span>{fmt(totals.tva)} MAD</span></div>
          <div className="flex justify-between font-bold border-t border-gray-200 pt-1">
            <span>Total TTC</span><span className="text-primary">{fmt(totals.ttc)} MAD</span>
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="button" disabled={isSubmitting} onClick={handleSubmit(onSubmit)} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Créer Avoir'}
        </button>
      </div>
    </div>
  )
}
