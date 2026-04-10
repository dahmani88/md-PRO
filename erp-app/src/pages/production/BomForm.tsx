import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import { Combobox } from '../../components/ui/Combobox'
import type { Product } from '../../types'

interface BomLine { material_id: number; quantity: number; unit: string }
interface Props {
  bom?: any
  onSaved: () => void
  onCancel: () => void
}

export default function BomForm({ bom, onSaved, onCancel }: Props) {
  const isEdit = !!bom

  const [rawMaterials, setRawMaterials]   = useState<Product[]>([])
  const [finishedProducts, setFinished]   = useState<Product[]>([])
  const [productId, setProductId]         = useState<number>(bom?.product_id ?? 0)
  const [productSearch, setProductSearch] = useState(
    bom ? `${bom.product_code} — ${bom.product_name}` : ''
  )
  const [version, setVersion]     = useState(bom?.name ?? '')
  const [isDefault, setIsDefault] = useState(bom?.is_default === 1)
  const [laborCost, setLaborCost] = useState<number>(bom?.labor_cost ?? 0)
  const [notes, setNotes]         = useState(bom?.notes ?? '')
  const [lines, setLines]         = useState<BomLine[]>(
    bom?.lines?.length
      ? bom.lines.map((l: any) => ({ material_id: l.material_id, quantity: l.quantity, unit: l.unit ?? 'unité' }))
      : [{ material_id: 0, quantity: 1, unit: 'unité' }]
  )
  // search state per line
  const [lineSearch, setLineSearch] = useState<string[]>(
    bom?.lines?.length
      ? bom.lines.map((l: any) => l.material_name ? `${l.material_code} — ${l.material_name}` : '')
      : ['']
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.getProducts({ limit: 500 }).then((r: any) => {
      const all = r.rows ?? []
      setRawMaterials(all.filter((p: any) => p.type === 'raw' || p.type === 'semi_finished'))
      setFinished(all.filter((p: any) => p.type === 'finished' || p.type === 'semi_finished'))
    })
  }, [])

  // Combobox items
  const finishedItems = finishedProducts.map(p => ({
    id: p.id,
    label: p.name,
    sub: p.code,
    extra: p.stock_quantity !== undefined ? `Stock: ${p.stock_quantity}` : undefined,
  }))

  const rawItems = rawMaterials.map(p => ({
    id: p.id,
    label: p.name,
    sub: p.code,
    badge: p.unit,
    extra: (p.stock_quantity ?? 0) <= 0 ? '⚠ Rupture' : `Stock: ${p.stock_quantity}`,
  }))

  function addLine() {
    setLines(p => [...p, { material_id: 0, quantity: 1, unit: 'unité' }])
    setLineSearch(p => [...p, ''])
  }

  function removeLine(i: number) {
    setLines(p => p.filter((_, idx) => idx !== i))
    setLineSearch(p => p.filter((_, idx) => idx !== i))
  }

  function selectMaterial(i: number, id: number) {
    const prod = rawMaterials.find(p => p.id === id)
    setLines(p => p.map((l, idx) => idx === i
      ? { ...l, material_id: id, unit: prod?.unit ?? 'unité' }
      : l
    ))
    setLineSearch(p => p.map((s, idx) => idx === i
      ? `${prod?.code} — ${prod?.name}`
      : s
    ))
  }

  const estimatedCost = lines.reduce((sum, l) => {
    const prod = rawMaterials.find(p => p.id === l.material_id)
    return sum + (prod?.cmup_price ?? 0) * l.quantity
  }, 0) + laborCost

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!productId)    { toast('Choisissez un produit fini', 'error'); return }
    if (!version.trim()) { toast('Indiquez une version / variante', 'error'); return }
    if (lines.some(l => !l.material_id || l.quantity <= 0)) {
      toast('Vérifiez les lignes de matières', 'error'); return
    }
    setLoading(true)
    try {
      const payload = { name: version, is_default: isDefault, labor_cost: laborCost, notes, lines }
      if (isEdit) {
        await api.updateBomTemplate({ id: bom.id, ...payload })
        toast('Nomenclature mise à jour')
      } else {
        await api.createBomTemplate({ product_id: productId, ...payload })
        toast('Nomenclature créée')
      }
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* ── Produit fini ── */}
      {!isEdit ? (
        <div>
          <label className="block text-sm font-medium mb-1">
            Produit fini <span className="text-red-500">*</span>
          </label>
          <Combobox
            items={finishedItems}
            value={productSearch}
            onChange={v => { setProductSearch(v); setProductId(0) }}
            onSelect={(id, item) => {
              setProductId(id)
              setProductSearch(`${item.sub} — ${item.label}`)
            }}
            placeholder="Rechercher un produit fini..."
          />
          {!productId && productSearch.length > 0 && (
            <p className="text-xs text-red-400 mt-1">Sélectionnez un produit dans la liste</p>
          )}
        </div>
      ) : (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2.5 text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2">
          <span>📦</span>
          <span className="font-semibold">{bom.product_name}</span>
          <span className="font-mono text-xs text-blue-400">{bom.product_code}</span>
        </div>
      )}

      {/* ── Version + Défaut ── */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Version / Variante <span className="text-red-500">*</span>
          </label>
          <input
            value={version}
            onChange={e => setVersion(e.target.value)}
            className="input"
            placeholder="Ex: Standard, Économique, Export..."
            required
          />
          <p className="text-xs text-gray-400 mt-1">
            Identifie cette recette parmi d'autres pour le même produit
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Coût main d'œuvre (MAD)</label>
            <input value={laborCost} onChange={e => setLaborCost(Number(e.target.value))}
              className="input" type="number" min="0" step="0.01" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none mt-1">
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)}
              className="w-4 h-4 rounded accent-primary" />
            <span className="text-sm font-medium">Utiliser par défaut ★</span>
          </label>
        </div>
      </div>

      {/* ── Lignes matières ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">🧱 Matières premières</span>
          <button type="button" onClick={addLine} className="btn-secondary btn-sm">+ Ajouter</button>
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Matière première</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-400 w-28">Quantité</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 w-24">Unité</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-gray-400 w-32">Coût estimé</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {lines.map((line, i) => {
                const prod     = rawMaterials.find(p => p.id === line.material_id)
                const lineCost = (prod?.cmup_price ?? 0) * line.quantity
                return (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-3 py-2">
                      <Combobox
                        items={rawItems}
                        value={lineSearch[i] ?? ''}
                        onChange={v => {
                          setLineSearch(p => p.map((s, idx) => idx === i ? v : s))
                          if (!v) setLines(p => p.map((l, idx) => idx === i ? { ...l, material_id: 0 } : l))
                        }}
                        onSelect={(id) => selectMaterial(i, id)}
                        placeholder="Rechercher matière..."
                        maxItems={8}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={line.quantity}
                        onChange={e => setLines(p => p.map((l, idx) => idx === i ? { ...l, quantity: Number(e.target.value) } : l))}
                        className="input text-xs py-1.5 text-right" type="number" min="0.001" step="0.001"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={line.unit}
                        onChange={e => setLines(p => p.map((l, idx) => idx === i ? { ...l, unit: e.target.value } : l))}
                        className="input text-xs py-1.5" placeholder="unité"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-medium text-gray-600 dark:text-gray-400">
                      {prod ? fmt(lineCost) : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => removeLine(i)}
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

      {/* ── Résumé coût ── */}
      <div className="bg-gradient-to-r from-primary/5 to-blue-50 dark:from-primary/10 dark:to-blue-900/10 border border-primary/20 rounded-lg p-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-600 dark:text-gray-400">Coût matières</span>
          <span className="font-medium">{fmt(estimatedCost - laborCost)} MAD</span>
        </div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-600 dark:text-gray-400">Main d'œuvre</span>
          <span className="font-medium">{fmt(laborCost)} MAD</span>
        </div>
        <div className="flex justify-between text-sm font-bold border-t border-primary/20 pt-2">
          <span className="text-primary">Coût de revient / unité</span>
          <span className="text-primary text-base">{fmt(estimatedCost)} MAD</span>
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
          {loading ? 'Enregistrement...' : isEdit ? '💾 Mettre à jour' : '✅ Créer la nomenclature'}
        </button>
      </div>
    </form>
  )
}
