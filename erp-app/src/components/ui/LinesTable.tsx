import { useState, useEffect } from 'react'
import { UseFormSetValue, UseFieldArrayReturn } from 'react-hook-form'
import { Combobox } from './Combobox'
import type { Product } from '../../types'

export interface LineData {
  product_id?: number
  description?: string
  quantity: number
  unit_price: number
  discount?: number
  tva_rate?: number
}

interface Props {
  fields: UseFieldArrayReturn<any, 'lines'>['fields']
  lines: LineData[]
  products: Product[]
  register: any
  setValue: UseFormSetValue<any>
  onRemove: (i: number) => void
  onAdd: () => void
  showDiscount?: boolean
  showTva?: boolean
  showMargin?: boolean
  productFilter?: (p: Product) => boolean
  // pour les lignes de réception/import: pas de prix de vente, juste coût
  priceLabel?: string
  readonlyPrice?: boolean
}

const DEFAULT_TVA_KEY = 'erp_last_tva_rate'

function getDefaultTva(): number {
  try {
    const saved = localStorage.getItem(DEFAULT_TVA_KEY)
    if (saved !== null) return Number(saved)
  } catch {}
  return 20
}

function saveDefaultTva(rate: number) {
  try { localStorage.setItem(DEFAULT_TVA_KEY, String(rate)) } catch {}
}

export { getDefaultTva }

function calcLine(l: Partial<LineData>) {
  const qty   = Number(l.quantity)   || 0
  const price = Number(l.unit_price) || 0
  const disc  = Number(l.discount)   || 0
  const tva   = Number(l.tva_rate)   || 0
  const ht    = qty * price * (1 - disc / 100)
  return { ht, tvaAmt: ht * tva / 100, ttc: ht + ht * tva / 100 }
}

export function LinesTable({
  fields, lines, products, register, setValue,
  onRemove, onAdd,
  showDiscount = true, showTva = true, showMargin = false,
  productFilter, priceLabel = 'Prix HT', readonlyPrice = false,
}: Props) {
  const [productSearches, setProductSearches] = useState<string[]>(
    () => lines.map(l => (l as any).description ?? '')
  )
  const [lineCmups, setLineCmups] = useState<number[]>(
    () => lines.map(() => 0)
  )
  // track selected product per line for stock warning
  const [lineProducts, setLineProducts] = useState<(Product | null)[]>(
    () => lines.map(() => null)
  )

  // sync arrays length with fields
  useEffect(() => {
    setProductSearches(prev => {
      const next = lines.map((l, i) => prev[i] !== undefined ? prev[i] : ((l as any).description ?? ''))
      while (next.length < fields.length) next.push('')
      return next.slice(0, fields.length)
    })
    setLineCmups(prev => {
      const next = [...prev]
      while (next.length < fields.length) next.push(0)
      return next.slice(0, fields.length)
    })
    setLineProducts(prev => {
      const next = [...prev]
      while (next.length < fields.length) next.push(null)
      return next.slice(0, fields.length)
    })
  }, [fields.length])

  // Sync productSearches when lines change (edit mode: reset() called with defaultValues)
  useEffect(() => {
    setProductSearches(lines.map(l => (l as any).description ?? ''))
  }, [JSON.stringify(lines.map(l => (l as any).product_id))])

  const filteredProducts = productFilter ? products.filter(productFilter) : products

  const productItems = filteredProducts.map(p => ({
    id: p.id,
    label: p.name,
    sub: `${p.code} · ${p.unit}`,
    extra: p.sale_price > 0 ? `${new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(p.sale_price)} MAD` : undefined,
    badge: p.stock_quantity <= (p.min_stock ?? 0) && p.min_stock > 0 ? '⚠' : undefined,
  }))

  function selectProduct(i: number, product: Product) {
    setValue(`lines.${i}.product_id`, product.id)
    setValue(`lines.${i}.unit_price`, product.sale_price)
    setValue(`lines.${i}.tva_rate`, product.tva_rate_value ?? 20)
    setValue(`lines.${i}.description`, product.name)
    const s = [...productSearches]; s[i] = product.name; setProductSearches(s)
    const c = [...lineCmups]; c[i] = product.cmup_price ?? 0; setLineCmups(c)
    const lp = [...lineProducts]; lp[i] = product; setLineProducts(lp)
  }

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  // colonnes dynamiques
  const cols = [
    { key: 'product', label: 'Désignation', span: showDiscount && showMargin ? 3 : showDiscount ? 4 : 5 },
    { key: 'qty',     label: 'Qté',         span: 2 },
    { key: 'price',   label: priceLabel,    span: 2 },
    ...(showDiscount ? [{ key: 'disc', label: 'Rem%', span: 1 }] : []),
    ...(showTva      ? [{ key: 'tva',  label: 'TVA%', span: 1 }] : []),
    { key: 'ttc',     label: 'TTC',         span: 1 },
    ...(showMargin   ? [{ key: 'margin', label: 'Marge%', span: 1 }] : []),
    { key: 'del',     label: '',            span: 1 },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Lignes <span className="text-red-500">*</span>
        </label>
        <button type="button" onClick={onAdd} className="btn-secondary btn-sm">
          + Ajouter une ligne
        </button>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-visible">
        {/* Header */}
        <div className="grid gap-1 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500 rounded-t-xl"
          style={{ gridTemplateColumns: cols.map(c => `${c.span}fr`).join(' ') }}>
          {cols.map(c => (
            <div key={c.key} className={c.key === 'ttc' || c.key === 'price' || c.key === 'qty' || c.key === 'disc' || c.key === 'margin' ? 'text-right' : ''}>
              {c.label}
            </div>
          ))}
        </div>

        {/* Rows */}
        {fields.map((field, i) => {
          const line = lines[i] ?? {}
          const { ttc } = calcLine(line)
          const cmup = lineCmups[i] ?? 0
          const qty = Number(line.quantity) || 0
          const price = Number(line.unit_price) || 0
          const disc = Number(line.discount) || 0
          const htLine = qty * price * (1 - disc / 100)
          const marginPct = cmup > 0 && htLine > 0 ? ((htLine - qty * cmup) / htLine * 100) : null

          return (
            <div
              key={field.id}
              className="grid gap-1 px-3 py-2 pb-3 border-t border-gray-100 dark:border-gray-700 items-center"
              style={{ gridTemplateColumns: cols.map(c => `${c.span}fr`).join(' ') }}
            >
              {/* Désignation */}
              <div>
                <Combobox
                  items={productItems}
                  value={productSearches[i] ?? ''}
                  onChange={v => {
                    const s = [...productSearches]; s[i] = v; setProductSearches(s)
                    setValue(`lines.${i}.product_id`, undefined)
                    setValue(`lines.${i}.description`, v)
                  }}
                  onSelect={(_, item) => {
                    const p = products.find(p => p.id === item.id)
                    if (p) selectProduct(i, p)
                  }}
                  placeholder="Produit ou description..."
                />
              </div>

              {/* Qté */}
              <div className="relative">
                <input
                  {...register(`lines.${i}.quantity`)}
                  className="input text-xs text-right"
                  type="number" min="0.01" step="0.01"
                />
                {/* stock indicator — inline sous l'input, compact */}
                {(() => {
                  const p = lineProducts[i]
                  if (!p) return null
                  const qty   = Number(lines[i]?.quantity) || 0
                  const stock = p.stock_quantity ?? 0
                  if (stock <= 0)
                    return <div className="absolute -bottom-4 right-0 text-[10px] text-red-500 whitespace-nowrap">⚠ épuisé</div>
                  if (qty > stock)
                    return <div className="absolute -bottom-4 right-0 text-[10px] text-red-500 whitespace-nowrap">⚠ max {stock}</div>
                  if (p.min_stock > 0 && stock <= p.min_stock)
                    return <div className="absolute -bottom-4 right-0 text-[10px] text-amber-500 whitespace-nowrap">⚠ bas {stock}</div>
                  return <div className="absolute -bottom-4 right-0 text-[10px] text-green-600 whitespace-nowrap">✓ {stock}</div>
                })()}
              </div>

              {/* Prix */}
              <div>
                <input
                  {...register(`lines.${i}.unit_price`)}
                  className="input text-xs text-right"
                  type="number" min="0" step="0.01"
                  readOnly={readonlyPrice}
                />
              </div>

              {/* Remise */}
              {showDiscount && (
                <div>
                  <input
                    {...register(`lines.${i}.discount`)}
                    className="input text-xs text-right"
                    type="number" min="0" max="100" step="0.1"
                  />
                </div>
              )}

              {/* TVA */}
              {showTva && (
                <div>
                  <input
                    {...register(`lines.${i}.tva_rate`)}
                    className="input text-xs text-right"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    placeholder="20"
                    onChange={e => {
                      register(`lines.${i}.tva_rate`).onChange(e)
                      const val = Number(e.target.value)
                      if (!isNaN(val) && val >= 0 && val <= 100) saveDefaultTva(val)
                    }}
                  />
                </div>
              )}

              {/* TTC */}
              <div className="text-right text-xs font-semibold text-gray-700 dark:text-gray-200">
                {fmt(ttc)}
              </div>

              {/* Marge */}
              {showMargin && (
                <div className="text-right text-xs font-medium">
                  {marginPct !== null ? (
                    <span className={marginPct < 0 ? 'text-red-500' : marginPct < 10 ? 'text-orange-500' : 'text-green-600'}>
                      {marginPct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </div>
              )}

              {/* Supprimer */}
              <div className="text-right">
                {fields.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className="w-6 h-6 flex items-center justify-center rounded-full
                      text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20
                      transition-all text-lg leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Totaux réutilisables
export function LinesTotals({
  lines,
  currency = 'MAD',
  globalDiscount = 0,
  showMargin = false,
  totalCost = 0,
}: {
  lines: LineData[]
  currency?: string
  globalDiscount?: number
  showMargin?: boolean
  totalCost?: number
}) {
  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  const raw = lines.reduce((acc, l) => {
    const { ht, tvaAmt, ttc } = calcLine(l)
    return { ht: acc.ht + ht, tva: acc.tva + tvaAmt, ttc: acc.ttc + ttc }
  }, { ht: 0, tva: 0, ttc: 0 })

  const discAmt = raw.ht * globalDiscount / 100
  const htNet   = raw.ht - discAmt
  const tvaNet  = raw.tva * (raw.ht > 0 ? htNet / raw.ht : 1)
  const ttcNet  = htNet + tvaNet
  const margin  = htNet - totalCost
  const marginPct = htNet > 0 ? (margin / htNet) * 100 : 0

  return (
    <div className="flex justify-end">
      <div className="w-64 space-y-1.5 text-sm">
        <div className="flex justify-between text-gray-500">
          <span>Total HT</span>
          <span className="font-medium">{fmt(raw.ht)} {currency}</span>
        </div>
        {globalDiscount > 0 && (
          <div className="flex justify-between text-orange-500">
            <span>Remise ({globalDiscount}%)</span>
            <span className="font-medium">− {fmt(discAmt)} {currency}</span>
          </div>
        )}
        <div className="flex justify-between text-gray-500">
          <span>TVA</span>
          <span className="font-medium">{fmt(tvaNet)} {currency}</span>
        </div>
        {showMargin && totalCost > 0 && (
          <div className={`flex justify-between text-xs border-t border-dashed border-gray-200 dark:border-gray-700 pt-1.5 ${margin < 0 ? 'text-red-500' : 'text-green-600'}`}>
            <span>Marge brute</span>
            <span className="font-semibold">{fmt(margin)} {currency} ({marginPct.toFixed(1)}%)</span>
          </div>
        )}
        <div className="flex justify-between text-base font-bold border-t border-gray-200 dark:border-gray-700 pt-2">
          <span>Total TTC</span>
          <span className="text-primary">{fmt(ttcNet)} {currency}</span>
        </div>
      </div>
    </div>
  )
}
