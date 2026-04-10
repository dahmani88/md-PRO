import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth.store'
import { toast } from '../../components/ui/Toast'
import { Combobox } from '../../components/ui/Combobox'
import type { Product } from '../../types'

interface Props { onSaved: () => void; onCancel: () => void }

const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

export default function ProductionForm({ onSaved, onCancel }: Props) {
  const { user } = useAuthStore()
  const userId = user?.id ?? 1

  const [products, setProducts]           = useState<Product[]>([])
  const [allMaterials, setAllMaterials]   = useState<Product[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<number>(0)
  const [boms, setBoms]                   = useState<any[]>([])
  const [selectedBom, setSelectedBom]     = useState<number>(0)
  const [quantity, setQuantity]           = useState(1)
  const [date, setDate]                   = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes]                 = useState('')
  const [loading, setLoading]             = useState(false)

  useEffect(() => {
    api.getProducts({ type: 'finished', limit: 500 }).then((r: any) => setProducts(r.rows ?? []))
    api.getProducts({ limit: 500 }).then((r: any) => setAllMaterials(r.rows ?? []))
  }, [])

  // عند اختيار منتج — جلب BOMs الخاصة به
  useEffect(() => {
    if (!selectedProduct) { setBoms([]); setSelectedBom(0); return }
    api.getBomTemplates(selectedProduct).then((r: any) => {
      const list = r ?? []
      // إذا الـ backend القديم لا يرجع stock_quantity، نكملها من قائمة المنتجات
      const enriched = list.map((bom: any) => ({
        ...bom,
        lines: (bom.lines ?? []).map((l: any) => {
          if (l.stock_quantity !== undefined && l.stock_quantity !== null) return l
          const prod = allMaterials.find((p: any) => p.id === l.material_id)
          return { ...l, stock_quantity: prod?.stock_quantity ?? 0, cmup_price: l.cmup_price ?? prod?.cmup_price ?? 0 }
        }),
      }))
      setBoms(enriched)
      const def = enriched.find((b: any) => b.is_default)
      setSelectedBom(def?.id ?? (enriched[0]?.id ?? 0))
    })
  }, [selectedProduct, allMaterials])

  const productItems = products.map(p => ({
    id: p.id, label: p.name, sub: p.code,
    badge: p.unit,
    extra: `Stock: ${p.stock_quantity ?? 0}`,
  }))

  const selectedBomData = boms.find(b => b.id === selectedBom)

  // حساب التكلفة التقديرية
  const matCost = selectedBomData
    ? (selectedBomData.lines ?? []).reduce((s: number, l: any) =>
        s + (l.cmup_price ?? 0) * l.quantity * quantity, 0)
    : 0
  const laborCost  = (selectedBomData?.labor_cost ?? 0)
  const totalCost  = matCost + laborCost
  const unitCost   = quantity > 0 ? totalCost / quantity : 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProduct) { toast('Choisissez un produit fini', 'error'); return }
    setLoading(true)
    try {
      await api.createProduction({
        product_id: selectedProduct,
        bom_id: selectedBom || null,
        quantity, date, notes,
        created_by: userId,
      })
      toast('Ordre de production créé')
      onSaved()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* ── Produit fini ── */}
      <div>
        <label className="block text-sm font-medium mb-1">
          Produit fini <span className="text-red-500">*</span>
        </label>
        <Combobox
          items={productItems}
          value={productSearch}
          onChange={v => { setProductSearch(v); setSelectedProduct(0) }}
          onSelect={(id, item) => {
            setSelectedProduct(id)
            setProductSearch(`${item.sub} — ${item.label}`)
          }}
          placeholder="Rechercher un produit fini..."
        />
      </div>

      {/* ── Quantité + Date ── */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Quantité à produire <span className="text-red-500">*</span>
          </label>
          <input value={quantity} onChange={e => setQuantity(Number(e.target.value))}
            className="input" type="number" min="0.01" step="0.01" required />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <input value={date} onChange={e => setDate(e.target.value)} className="input" type="date" />
        </div>
      </div>

      {/* ── Nomenclature (BOM) ── */}
      {selectedProduct > 0 && (
        <div>
          <label className="block text-sm font-medium mb-1">Nomenclature (BOM)</label>
          {boms.length === 0 ? (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
              ⚠️ Aucune nomenclature définie pour ce produit — l'ordre sera créé sans BOM.
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <button type="button"
                onClick={() => setSelectedBom(0)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all
                  ${selectedBom === 0
                    ? 'bg-gray-200 dark:bg-gray-600 border-gray-300 text-gray-700 dark:text-gray-200'
                    : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-300'}`}>
                Sans BOM
              </button>
              {boms.map(b => (
                <button key={b.id} type="button"
                  onClick={() => setSelectedBom(b.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all
                    ${selectedBom === b.id
                      ? 'bg-primary text-white border-primary shadow-sm'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary/40'}`}>
                  {b.name}
                  {b.is_default === 1 && <span className="ml-1 text-amber-300">★</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Aperçu BOM ── */}
      {selectedBomData && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-blue-700 dark:text-blue-400">
            📋 Composition — {selectedBomData.name}
          </div>

          {/* Lignes matières */}
          <div className="space-y-1.5">
            {(selectedBomData.lines ?? []).map((l: any, i: number) => {
              const needed   = l.quantity * quantity
              const hasStock = (l.stock_quantity ?? 0) >= needed
              const stockOut = (l.stock_quantity ?? 0) <= 0
              return (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-bold
                      ${stockOut ? 'bg-red-500' : hasStock ? 'bg-green-500' : 'bg-amber-500'}`}>
                      {i + 1}
                    </span>
                    <span className="text-gray-700 dark:text-gray-200 font-medium">{l.material_name}</span>
                    <span className="text-gray-400 font-mono">{l.material_code}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{fmt(needed)} {l.unit}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium
                      ${stockOut ? 'bg-red-100 text-red-600' : hasStock ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
                      Stock: {l.stock_quantity ?? 0}
                    </span>
                    <span className="text-gray-400 w-24 text-right">{fmt((l.cmup_price ?? 0) * needed)} MAD</span>
                  </div>
                </div>
              )
            })}
            {laborCost > 0 && (
              <div className="flex items-center justify-between text-xs border-t border-blue-200 dark:border-blue-700 pt-1.5 mt-1">
                <span className="text-gray-600 dark:text-gray-300">👷 Main d'œuvre</span>
                <span className="font-medium text-orange-600">{fmt(laborCost)} MAD</span>
              </div>
            )}
          </div>

          {/* Totaux */}
          <div className="border-t border-blue-200 dark:border-blue-700 pt-3 grid grid-cols-2 gap-2">
            <div className="bg-white dark:bg-gray-800/50 rounded-lg px-3 py-2 text-center">
              <div className="text-xs text-gray-400 mb-0.5">Coût unitaire</div>
              <div className="font-bold text-primary">{fmt(unitCost)} MAD</div>
            </div>
            <div className="bg-white dark:bg-gray-800/50 rounded-lg px-3 py-2 text-center">
              <div className="text-xs text-gray-400 mb-0.5">Coût total ({quantity} u.)</div>
              <div className="font-bold text-primary">{fmt(totalCost)} MAD</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Notes ── */}
      <div>
        <label className="block text-sm font-medium mb-1">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none" rows={2} placeholder="Remarques..." />
      </div>

      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Annuler</button>
        <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
          {loading ? 'Création...' : '✅ Créer l\'ordre'}
        </button>
      </div>
    </form>
  )
}
