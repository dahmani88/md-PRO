import { useState, useEffect, useRef } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import FormField from '../../components/ui/FormField'
import Modal from '../../components/ui/Modal'
import PartyForm from '../../components/forms/PartyForm'
import type { Client, Product } from '../../types'

const schema = z.object({
  date:             z.string().min(1),
  validity_date:    z.string().optional(),
  party_id:         z.coerce.number().min(1, 'Client requis'),
  global_discount:  z.coerce.number().min(0).max(100).default(0),
  notes:            z.string().optional(),
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

const TVA_RATES = [0, 7, 10, 14, 20]

interface ComboboxProps {
  items: Array<{ id: number; label: string; sub?: string; extra?: string }>
  value: string
  onChange: (val: string) => void
  onSelect: (id: number, label: string) => void
  placeholder: string
  error?: boolean
}

function Combobox({ items, value, onChange, onSelect, placeholder, error }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = value
    ? items.filter(i => i.label.toLowerCase().includes(value.toLowerCase()) || (i.sub ?? '').includes(value))
    : items

  return (
    <div ref={ref} className="relative">
      <input value={value} onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        className={`input ${error ? 'input-error' : ''}`}
        placeholder={placeholder} autoComplete="off" />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white dark:bg-gray-800
          border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
          {filtered.slice(0, 10).map(item => (
            <button key={item.id} type="button"
              className="w-full flex items-center justify-between px-4 py-2.5
                hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition-colors"
              onMouseDown={e => { e.preventDefault(); onSelect(item.id, item.label); setOpen(false) }}>
              <div>
                <div className="text-sm font-medium">{item.label}</div>
                {item.sub && <div className="text-xs text-gray-400 font-mono">{item.sub}</div>}
              </div>
              {item.extra && <span className="text-xs text-orange-500 font-medium ml-2">{item.extra}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  docType: 'quote' | 'proforma'
  onSaved: () => void
  onCancel: () => void
}

export default function QuoteForm({ docType, onSaved, onCancel }: Props) {
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [productSearches, setProductSearches] = useState<string[]>([''])
  const [lineCmups, setLineCmups] = useState<number[]>([0])
  const [lineMargins, setLineMargins] = useState<string[]>([''])
  const [newClientModal, setNewClientModal] = useState(false)

  const isProforma = docType === 'proforma'
  const title = isProforma ? 'Facture Proforma' : 'Devis'

  const { register, control, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      global_discount: 0,
      lines: [{ quantity: 1, unit_price: 0, discount: 0, tva_rate: 20 }],
    },
  })

  const { fields, remove, prepend } = useFieldArray({ control, name: 'lines' })
  const lines = watch('lines')

  useEffect(() => {
    loadClients()
    api.getProducts({ limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
  }, [])

  function loadClients() {
    api.getClients({ limit: 500 }).then((r: any) => setClients(r.rows ?? []))
  }

  function calcLine(l: any) {
    const ht = (l.quantity || 0) * (l.unit_price || 0) * (1 - (l.discount || 0) / 100)
    const tvaAmt = ht * (l.tva_rate || 0) / 100
    return { ht, tvaAmt, ttc: ht + tvaAmt }
  }

  const global_discount = watch('global_discount') || 0

  const totals = lines.reduce((acc, l) => {
    const { ht, tvaAmt, ttc } = calcLine(l)
    return { ht: acc.ht + ht, tva: acc.tva + tvaAmt, ttc: acc.ttc + ttc }
  }, { ht: 0, tva: 0, ttc: 0 })

  const discountAmt = totals.ht * global_discount / 100
  const htAfterDiscount = totals.ht - discountAmt
  const tvaAfterDiscount = htAfterDiscount * (totals.tva / (totals.ht || 1))
  const ttcFinal = htAfterDiscount + tvaAfterDiscount

  const totalCost = lines.reduce((acc, l, i) => {
    const qty = Number(l.quantity) || 0
    return acc + qty * (lineCmups[i] ?? 0)
  }, 0)
  const totalMargin = htAfterDiscount - totalCost
  const marginPct = htAfterDiscount > 0 ? (totalMargin / htAfterDiscount) * 100 : 0

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  function selectProduct(i: number, p: Product) {
    setValue(`lines.${i}.product_id`, p.id)
    setValue(`lines.${i}.unit_price`, p.sale_price)
    setValue(`lines.${i}.tva_rate`, p.tva_rate_value ?? 20)
    setValue(`lines.${i}.description`, p.name)
    const s = [...productSearches]; s[i] = p.name; setProductSearches(s)
    const c = [...lineCmups]; c[i] = p.cmup_price ?? 0; setLineCmups(c)
    // حساب نسبة الربح الحالية من سعر البيع و CMUP
    const cmup = p.cmup_price ?? 0
    const pct = p.sale_price > 0 && cmup > 0 ? ((p.sale_price - cmup) / p.sale_price * 100).toFixed(1) : ''
    const m = [...lineMargins]; m[i] = pct; setLineMargins(m)
  }

  function addLine() {
    prepend({ quantity: 1, unit_price: 0, discount: 0, tva_rate: 20 })
    setProductSearches(prev => ['', ...prev])
    setLineCmups(prev => [0, ...prev])
    setLineMargins(prev => ['', ...prev])
  }

  function removeLine(i: number) {
    remove(i)
    setProductSearches(prev => prev.filter((_, idx) => idx !== i))
    setLineCmups(prev => prev.filter((_, idx) => idx !== i))
    setLineMargins(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleMarginChange(i: number, val: string) {
    const m = [...lineMargins]; m[i] = val; setLineMargins(m)
    const pct = parseFloat(val)
    const cmup = lineCmups[i] ?? 0
    if (!isNaN(pct) && cmup > 0 && pct < 100) {
      // Prix HT = CMUP / (1 - marge%)
      const newPrice = cmup / (1 - pct / 100)
      setValue(`lines.${i}.unit_price`, Math.round(newPrice * 100) / 100)
    }
  }

  function handlePriceChange(i: number, val: string) {
    const price = parseFloat(val)
    const cmup = lineCmups[i] ?? 0
    if (!isNaN(price) && price > 0 && cmup > 0) {
      const pct = ((price - cmup) / price * 100).toFixed(1)
      const m = [...lineMargins]; m[i] = pct; setLineMargins(m)
    } else {
      const m = [...lineMargins]; m[i] = ''; setLineMargins(m)
    }
  }

  const clientItems = clients.map(c => ({ id: c.id, label: c.name, sub: c.ice ? `ICE: ${c.ice}` : undefined }))
  const productItems = products.map(p => ({ id: p.id, label: p.name, sub: `${p.code} · ${p.unit}`, extra: p.sale_price > 0 ? `${fmt(p.sale_price)} MAD` : undefined }))

  async function submitDoc(data: FormData, confirm: boolean) {
    try {
      const doc = await api.createDocument({
        type: docType, date: data.date,
        party_id: data.party_id, party_type: 'client',
        lines: data.lines, notes: data.notes,
        extra: { validity_date: data.validity_date, global_discount: data.global_discount },
        created_by: 1,
      }) as any
      if (confirm) { await api.confirmDocument(doc.id); toast(`${title} confirmé`) }
      else toast('Brouillon sauvegardé')
      onSaved()
    } catch (e: any) { toast(e.message, 'error') }
  }

  return (
    <form onSubmit={handleSubmit(d => submitDoc(d, true))} className="space-y-5">
      {/* Client */}
      <FormField label="Client" required error={errors.party_id?.message}>
        <div className="flex gap-2">
          <div className="flex-1">
            <Combobox items={clientItems}
              value={selectedClient ? selectedClient.name : clientSearch}
              onChange={v => { setClientSearch(v); setSelectedClient(null); setValue('party_id', 0) }}
              onSelect={(id, label) => {
                const c = clients.find(c => c.id === id)!
                setSelectedClient(c); setClientSearch(label); setValue('party_id', id)
              }}
              placeholder="Rechercher un client..." error={!!errors.party_id} />
          </div>
          <button type="button" onClick={() => setNewClientModal(true)} className="btn-secondary btn-sm shrink-0">+ Nouveau</button>
        </div>
        {selectedClient && (
          <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
            {selectedClient.address && <span>📍 {selectedClient.address}</span>}
            {selectedClient.phone && <span>📞 {selectedClient.phone}</span>}
            {selectedClient.ice && <span className="font-mono">ICE: {selectedClient.ice}</span>}
            <button type="button" onClick={() => { setSelectedClient(null); setClientSearch(''); setValue('party_id', 0) }}
              className="ml-auto text-gray-400 hover:text-red-500">✕</button>
          </div>
        )}
      </FormField>

      <div className="grid grid-cols-3 gap-3">
        <FormField label="Date" required>
          <input {...register('date')} className="input" type="date" />
        </FormField>
        <FormField label="Valide jusqu'au">
          <input {...register('validity_date')} className="input" type="date" />
        </FormField>
        {!isProforma && (
          <FormField label="Remise globale (%)">
            <input {...register('global_discount')} className="input" type="number" min="0" max="100" step="0.1" placeholder="0" />
          </FormField>
        )}
      </div>

      {/* Lignes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Lignes <span className="text-red-500">*</span></label>
          <button type="button" onClick={addLine} className="btn-secondary btn-sm">+ Ajouter</button>
        </div>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500">
            <div className="col-span-3">Produit / Description</div>
            <div className="col-span-2 text-right">Qté</div>
            <div className="col-span-2 text-right">Prix HT</div>
            <div className="col-span-1 text-right">Rem%</div>
            <div className="col-span-1 text-right">TVA%</div>
            <div className="col-span-1 text-right">TTC</div>
            <div className="col-span-1 text-right text-green-600">Marge%</div>
            <div className="col-span-1"></div>
          </div>
          {fields.map((field, i) => {
            const l = lines[i] ?? {}
            const { ttc } = calcLine(l)
            const qty = Number(l.quantity) || 0
            const priceHt = Number(l.unit_price) || 0
            const disc = Number(l.discount) || 0
            const htLine = qty * priceHt * (1 - disc / 100)
            const cmup = lineCmups[i] ?? 0
            const costLine = qty * cmup
            const marginLine = htLine - costLine
            const marginPctLine = htLine > 0 ? (marginLine / htLine) * 100 : 0
            return (
              <div key={field.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 items-start">
                <div className="col-span-3 space-y-1">
                  <Combobox items={productItems} value={productSearches[i] ?? ''}
                    onChange={v => { const s = [...productSearches]; s[i] = v; setProductSearches(s); setValue(`lines.${i}.product_id`, undefined); setValue(`lines.${i}.description`, v) }}
                    onSelect={id => { const p = products.find(p => p.id === id); if (p) selectProduct(i, p) }}
                    placeholder="Produit ou description..." />
                </div>
                <div className="col-span-2"><input {...register(`lines.${i}.quantity`)} className="input text-xs text-right" type="number" min="0.01" step="0.01" /></div>
                <div className="col-span-2">
                  <input {...register(`lines.${i}.unit_price`)}
                    className="input text-xs text-right" type="number" min="0" step="0.01"
                    onChange={e => { register(`lines.${i}.unit_price`).onChange(e); handlePriceChange(i, e.target.value) }} />
                </div>
                <div className="col-span-1"><input {...register(`lines.${i}.discount`)} className="input text-xs text-right" type="number" min="0" max="100" /></div>
                <div className="col-span-1">
                  <select {...register(`lines.${i}.tva_rate`)} className="input text-xs">
                    {TVA_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                  </select>
                </div>
                <div className="col-span-1 text-right text-xs font-semibold pt-2">{fmt(ttc)}</div>
                <div className="col-span-1">
                  {cmup > 0 ? (
                    <input
                      value={lineMargins[i] ?? ''}
                      onChange={e => handleMarginChange(i, e.target.value)}
                      className={`input text-xs text-right ${marginPctLine < 0 ? 'text-red-500' : 'text-green-600'}`}
                      type="number" step="0.1" placeholder="—"
                      title={`Coût: ${fmt(cmup)} MAD`}
                    />
                  ) : (
                    <div className="text-xs text-gray-300 text-right pt-2">—</div>
                  )}
                </div>
                <div className="col-span-1 text-right pt-1">
                  {fields.length > 1 && <button type="button" onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 text-xl leading-none">×</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Totaux */}
      <div className="flex justify-end">
        <div className="w-64 space-y-1.5 text-sm">
          <div className="flex justify-between text-gray-600"><span>Total HT</span><span className="font-medium">{fmt(totals.ht)} MAD</span></div>
          {global_discount > 0 && (
            <div className="flex justify-between text-orange-500">
              <span>Remise ({global_discount}%)</span>
              <span className="font-medium">- {fmt(discountAmt)} MAD</span>
            </div>
          )}
          <div className="flex justify-between text-gray-600"><span>TVA</span><span className="font-medium">{fmt(tvaAfterDiscount)} MAD</span></div>
          {totalCost > 0 && (
            <div className={`flex justify-between text-xs border-t border-dashed border-gray-200 pt-1 ${totalMargin < 0 ? 'text-red-500' : 'text-green-600'}`}>
              <span>Marge brute</span>
              <span className="font-medium">{fmt(totalMargin)} MAD ({marginPct.toFixed(1)}%)</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold border-t border-gray-200 dark:border-gray-700 pt-2 mt-1">
            <span>Total TTC</span><span className="text-primary">{fmt(ttcFinal)} MAD</span>
          </div>
        </div>
      </div>

      <FormField label="Notes">
        <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Conditions, remarques..." />
      </FormField>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary justify-center">Annuler</button>
        <button type="button" disabled={isSubmitting} onClick={handleSubmit(d => submitDoc(d, false))} className="btn-secondary flex-1 justify-center">
          {isSubmitting ? '...' : '💾 Brouillon'}
        </button>
        <button type="button" disabled={isSubmitting} onClick={handleSubmit(d => submitDoc(d, true))} className="btn-primary flex-1 justify-center">
          {isSubmitting ? '...' : '✅ Confirmer'}
        </button>
      </div>

      <Modal open={newClientModal} onClose={() => setNewClientModal(false)} title="Nouveau Client">
        <PartyForm type="client" onSaved={async () => {
          setNewClientModal(false)
          const result = await api.getClients({ limit: 500 }) as any
          const rows: Client[] = result.rows ?? []
          setClients(rows)
          const newest = [...rows].sort((a, b) => b.id - a.id)[0]
          if (newest) { setSelectedClient(newest); setClientSearch(newest.name); setValue('party_id', newest.id) }
          toast('Client créé et sélectionné')
        }} onCancel={() => setNewClientModal(false)} />
      </Modal>
    </form>
  )
}
