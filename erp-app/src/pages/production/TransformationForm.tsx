import { useState, useEffect } from 'react'
import { useAuthStore } from '../../store/auth.store'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import { Combobox } from '../../components/ui/Combobox'
import type { Product } from '../../types'

interface OutputLine { product_id: number; quantity: number; search: string }
interface Props { onSaved: () => void; onCancel: () => void }

const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

export default function TransformationForm({ onSaved, onCancel }: Props) {
  const [allProducts, setAllProducts]     = useState<Product[]>([])
  const [materialId, setMaterialId]       = useState(0)
  const [materialSearch, setMaterialSearch] = useState('')
  const [inputQty, setInputQty]           = useState(1)
  const [costPerUnit, setCostPerUnit]     = useState(0)
  const [date, setDate]                   = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes]                 = useState('')
  const [outputs, setOutputs]             = useState<OutputLine[]>([{ product_id: 0, quantity: 1, search: '' }])
  const { user } = useAuthStore()
  const userId = user?.id ?? 1
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => setAllProducts(r.rows ?? []))
  }, [])

  const rawProducts      = allProducts.filter(p => p.type === 'raw' || p.type === 'semi_finished')
  const finishedProducts = allProducts.filter(p => p.type === 'finished' || p.type === 'semi_finished')

  const rawItems = rawProducts.map(p => ({
    id: p.id, label: p.name, sub: p.code, badge: p.unit,
    extra: (p.stock_quantity ?? 0) <= 0 ? '⚠ Rupture' : `Stock: ${p.stock_quantity}`,
  }))

  const finishedItems = finishedProducts.map(p => ({
    id: p.id, label: p.name, sub: p.code, badge: p.unit,
    extra: `Stock: ${p.stock_quantity ?? 0}`,
  }))

  const selectedMaterial = allProducts.find(m => m.id === materialId)
  const material_cost    = (selectedMaterial?.cmup_price ?? 0) * inputQty
  const transform_cost   = costPerUnit * inputQty
  const total_cost       = material_cost + transform_cost
  const totalOutputQty   = outputs.reduce((s, o) => s + (o.quantity || 0), 0)

  function addOutput() {
    setOutputs(p => [...p, { product_id: 0, quantity: 1, search: '' }])
  }
  function removeOutput(i: number) {
    setOutputs(p => p.filter((_, idx) => idx !== i))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!materialId) { toast('Choisissez une matière première', 'error'); return }
    if (outputs.some(o => !o.product_id || o.quantity <= 0)) {
      toast('Vérifiez les produits de sortie', 'error'); return
    }
    setLoading(true)
    try {
      await api.createTransformation({
        raw_material_id: materialId,
        input_quantity: inputQty,
        cost_per_unit: costPerUnit,
        date, notes,
        outputs: outputs.map(o => ({ product_id: o.product_id, quantity: o.quantity })),
        created_by: userId,
      })
      toast('Transformation créée — Stock mis à jour')
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* ── Matière entrante ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">
            Matière première <span className="text-red-500">*</span>
          </label>
          <Combobox
            items={rawItems}
            value={materialSearch}
            onChange={v => { setMaterialSearch(v); setMaterialId(0) }}
            onSelect={(id, item) => {
              setMaterialId(id)
              setMaterialSearch(`${item.sub} — ${item.label}`)
            }}
            placeholder="Rechercher matière..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Quantité entrée</label>
          <input value={inputQty} onChange={e => setInputQty(Number(e.target.value))}
            className="input" type="number" min="0.01" step="0.01" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Coût transformation / unité (MAD)</label>
          <input value={costPerUnit} onChange={e => setCostPerUnit(Number(e.target.value))}
            className="input" type="number" min="0" step="0.01" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <input value={date} onChange={e => setDate(e.target.value)} className="input" type="date" />
        </div>
      </div>

      {/* ── Résumé coûts ── */}
      {materialId > 0 && (
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-gray-500">Coût matière ({fmt(selectedMaterial?.cmup_price ?? 0)} × {inputQty})</span>
            <span className="font-medium">{fmt(material_cost)} MAD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Coût transformation ({fmt(costPerUnit)} × {inputQty})</span>
            <span className="font-medium">{fmt(transform_cost)} MAD</span>
          </div>
          <div className="flex justify-between font-bold border-t border-gray-200 dark:border-gray-600 pt-1.5">
            <span>Coût total à répartir sur les produits</span>
            <span className="text-primary">{fmt(total_cost)} MAD</span>
          </div>
        </div>
      )}

      {/* ── Produits obtenus ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            📦 Produits obtenus <span className="text-red-500">*</span>
          </label>
          <button type="button" onClick={addOutput} className="btn-secondary btn-sm">+ Ajouter</button>
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Produit</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-400 w-28">Quantité</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-400 w-32">Coût alloué</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {outputs.map((o, i) => {
                const allocated = totalOutputQty > 0
                  ? (o.quantity / totalOutputQty) * total_cost
                  : 0
                return (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <Combobox
                        items={finishedItems}
                        value={o.search}
                        onChange={v => setOutputs(p => p.map((x, idx) =>
                          idx === i ? { ...x, search: v, product_id: 0 } : x
                        ))}
                        onSelect={(id, item) => setOutputs(p => p.map((x, idx) =>
                          idx === i ? { ...x, product_id: id, search: `${item.sub} — ${item.label}` } : x
                        ))}
                        placeholder="Rechercher produit..."
                        maxItems={8}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={o.quantity}
                        onChange={e => setOutputs(p => p.map((x, idx) =>
                          idx === i ? { ...x, quantity: Number(e.target.value) } : x
                        ))}
                        className="input text-xs py-1.5 text-right w-full"
                        type="number" min="0.01" step="0.01"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-semibold text-primary">
                      {total_cost > 0 ? fmt(allocated) + ' MAD' : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {outputs.length > 1 && (
                        <button type="button" onClick={() => removeOutput(i)}
                          className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none" rows={2} placeholder="Remarques..." />
      </div>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
          {loading ? 'Traitement...' : '✅ Confirmer la transformation'}
        </button>
      </div>
    </form>
  )
}
