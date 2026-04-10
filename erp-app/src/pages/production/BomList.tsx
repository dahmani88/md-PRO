import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import BomForm from './BomForm'

const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

export default function BomList() {
  const [rows, setRows]           = useState<any[]>([])
  const [loading, setLoading]     = useState(false)
  const [search, setSearch]       = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editBom, setEditBom]     = useState<any>(null)
  const [deleteId, setDeleteId]   = useState<number | null>(null)
  const [expanded, setExpanded]   = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await api.getAllBoms() as any[]) }
    catch (e: any) { toast(e.message, 'error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const h = () => load()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [load])

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      await api.deleteBomTemplate(deleteId)
      toast('Nomenclature supprimée')
      load()
    } catch (e: any) { toast(e.message, 'error') }
    finally { setDeleteId(null) }
  }

  const filtered = rows.filter(r =>
    !search ||
    r.product_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.product_code?.toLowerCase().includes(search.toLowerCase()) ||
    r.name?.toLowerCase().includes(search.toLowerCase())
  )

  // KPIs
  const totalBoms     = rows.length
  const withLowStock  = rows.filter(r =>
    (r.lines ?? []).some((l: any) => (l.stock_quantity ?? 0) <= 0)
  ).length
  const totalProducts = new Set(rows.map(r => r.product_id)).size
  const avgCost       = totalBoms > 0
    ? rows.reduce((s, r) => {
        const mat = (r.lines ?? []).reduce((a: number, l: any) => a + (l.cmup_price ?? 0) * l.quantity, 0)
        return s + mat + (r.labor_cost ?? 0)
      }, 0) / totalBoms
    : 0
  const productCounts = rows.reduce((acc: Record<number, number>, r) => {
    acc[r.product_id] = (acc[r.product_id] ?? 0) + 1
    return acc
  }, {})
  const multiVariant  = Object.values(productCounts).filter(c => c > 1).length

  return (
    <div className="h-full flex flex-col gap-3">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 shrink-0">
        <button className="btn-primary px-5 py-2.5 text-sm font-semibold shadow-sm"
          onClick={() => { setEditBom(null); setModalOpen(true) }}>
          + Nouvelle Nomenclature
        </button>
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="input max-w-xs text-sm" placeholder="🔍 Rechercher produit ou BOM..." />
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="btn-secondary btn-sm">↻</button>
          <span className="text-sm text-gray-500">{filtered.length} nomenclature(s)</span>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
          {[
            { label: 'Nomenclatures',       value: String(totalBoms),
              sub: `${totalProducts} produit(s) couverts`,
              color: 'text-primary',   bg: 'bg-primary/5', icon: '📋' },
            { label: 'Coût moyen / unité',  value: fmt(avgCost) + ' MAD',
              sub: 'Moyenne toutes recettes',
              color: 'text-blue-600',  bg: 'bg-blue-50 dark:bg-blue-900/10', icon: '💰' },
            { label: 'Multi-variantes',     value: String(multiVariant),
              sub: 'Produits avec > 1 recette',
              color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/10', icon: '🔀' },
            { label: 'Rupture matières',    value: String(withLowStock),
              sub: withLowStock > 0 ? 'Recettes bloquées' : 'Tout est disponible',
              color: withLowStock > 0 ? 'text-red-500' : 'text-green-600',
              bg: withLowStock > 0 ? 'bg-red-50 dark:bg-red-900/10' : 'bg-green-50 dark:bg-green-900/10',
              icon: withLowStock > 0 ? '🔴' : '✅' },
          ].map(c => (
            <div key={c.label} className={`card p-4 ${c.bg}`}>
              <div className="text-lg mb-1">{c.icon}</div>
              <div className="text-xs text-gray-400 mb-1">{c.label}</div>
              <div className={`text-xl font-bold ${c.color}`}>{c.value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>
            </div>
          ))}
        </div>

      {/* ── Table ── */}
      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 w-8"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Produit fini</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Nomenclature</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-gray-300 w-28">Matières</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-300 w-40">Coût de revient</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-gray-300 w-20">Défaut</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-gray-300 w-24">Stock</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && [...Array(4)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                {[...Array(8)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                  </td>
                ))}
              </tr>
            ))}

            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-20">
                <div className="text-5xl mb-3">📋</div>
                <div className="text-gray-500 font-medium text-base">Aucune nomenclature</div>
                <div className="text-gray-400 text-xs mt-1 mb-4">
                  Définissez les matières nécessaires pour chaque produit fini
                </div>
                <button onClick={() => { setEditBom(null); setModalOpen(true) }} className="btn-primary">
                  + Créer la première nomenclature
                </button>
              </td></tr>
            )}

            {!loading && filtered.map(r => {
              const isOpen    = expanded.has(r.id)
              const lines     = r.lines ?? []
              const matCost   = lines.reduce((s: number, l: any) => s + (l.cmup_price ?? 0) * l.quantity, 0)
              const totalCost = matCost + (r.labor_cost ?? 0)
              const hasLow    = lines.some((l: any) => (l.stock_quantity ?? 0) <= 0)
              const hasWarn   = !hasLow && lines.some((l: any) => (l.stock_quantity ?? 0) < l.quantity)

              return (
                <React.Fragment key={r.id}>
                  <tr
                    className={`cursor-pointer transition-colors
                      ${isOpen ? 'bg-blue-50/60 dark:bg-blue-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}
                      ${hasLow ? 'border-l-2 border-l-red-400' : hasWarn ? 'border-l-2 border-l-amber-400' : ''}`}
                    onClick={() => toggleExpand(r.id)}>
                    <td className="px-4 py-3 text-center text-gray-400 text-xs select-none">
                      {isOpen ? '▼' : '▶'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-800 dark:text-gray-100">{r.product_name}</div>
                      <div className="text-xs text-gray-400 font-mono mt-0.5">{r.product_code}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.is_default === 1 && (
                          <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
                            ★ Défaut
                          </span>
                        )}
                      </div>
                      {r.labor_cost > 0 && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          👷 MO: {fmt(r.labor_cost)} MAD
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        {lines.length} ligne{lines.length > 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-bold text-primary">{fmt(totalCost)} MAD</div>
                      {r.labor_cost > 0 && (
                        <div className="text-xs text-gray-400">mat: {fmt(matCost)} MAD</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.is_default === 1
                        ? <span className="text-amber-500 text-lg">★</span>
                        : <span className="text-gray-200 dark:text-gray-600 text-lg">★</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {hasLow
                        ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">🔴 Rupture</span>
                        : hasWarn
                          ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">⚠️ Bas</span>
                          : <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">✅ OK</span>
                      }
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => { setEditBom(r); setModalOpen(true) }}
                          className="btn-secondary btn-sm text-xs" title="Modifier">✏️</button>
                        <button onClick={() => setDeleteId(r.id)}
                          className="btn-secondary btn-sm text-xs text-red-500 hover:text-red-700" title="Supprimer">🗑️</button>
                      </div>
                    </td>
                  </tr>

                  {/* ── Détail expand ── */}
                  {isOpen && (
                    <tr key={`${r.id}-detail`} className="bg-blue-50/40 dark:bg-blue-900/10 px-8 py-4 border-b border-blue-100 dark:border-blue-800">
                      <td colSpan={8} className="px-8 py-4 border-b border-blue-100 dark:border-blue-800">
                        <div className="max-w-3xl">
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                            Composition — {r.name}
                          </div>

                          {/* En-tête colonnes */}
                          <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700/50 rounded-t-lg text-xs font-medium text-gray-500 dark:text-gray-400">
                            <div className="col-span-4">Matière première</div>
                            <div className="col-span-2 text-right">Qté / unité</div>
                            <div className="col-span-2 text-right">Stock actuel</div>
                            <div className="col-span-2 text-right">CMUP</div>
                            <div className="col-span-2 text-right">Coût ligne</div>
                          </div>

                          {lines.map((l: any, i: number) => {
                            const stockOk  = (l.stock_quantity ?? 0) >= l.quantity
                            const stockLow = (l.stock_quantity ?? 0) > 0 && !stockOk
                            const stockOut = (l.stock_quantity ?? 0) <= 0
                            return (
                              <div key={i}
                                className={`grid grid-cols-12 gap-2 px-3 py-2.5 border-b border-blue-100 dark:border-blue-800/50 last:border-0 last:rounded-b-lg text-xs
                                  ${stockOut ? 'bg-red-50/60 dark:bg-red-900/10' : stockLow ? 'bg-amber-50/60 dark:bg-amber-900/10' : 'bg-white dark:bg-gray-800/30'}`}>
                                <div className="col-span-4 flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0">{i + 1}</span>
                                  <div>
                                    <div className="font-medium text-gray-800 dark:text-gray-100">{l.material_name}</div>
                                    <div className="text-gray-400 font-mono">{l.material_code}</div>
                                  </div>
                                </div>
                                <div className="col-span-2 text-right font-semibold text-gray-700 dark:text-gray-200 self-center">
                                  {l.quantity} {l.unit}
                                </div>
                                <div className="col-span-2 text-right self-center">
                                  <span className={`font-semibold ${stockOut ? 'text-red-600' : stockLow ? 'text-amber-600' : 'text-green-600'}`}>
                                    {l.stock_quantity ?? 0} {l.unit}
                                  </span>
                                  {stockOut && <div className="text-red-500 font-medium">Rupture</div>}
                                  {stockLow && <div className="text-amber-500">Insuffisant</div>}
                                </div>
                                <div className="col-span-2 text-right text-gray-500 self-center">
                                  {fmt(l.cmup_price ?? 0)} MAD
                                </div>
                                <div className="col-span-2 text-right font-bold text-primary self-center">
                                  {fmt((l.cmup_price ?? 0) * l.quantity)} MAD
                                </div>
                              </div>
                            )
                          })}

                          {/* Main d'œuvre */}
                          {r.labor_cost > 0 && (
                            <div className="grid grid-cols-12 gap-2 px-3 py-2.5 bg-orange-50/60 dark:bg-orange-900/10 rounded-b-lg text-xs border-t border-orange-100 dark:border-orange-800/50">
                              <div className="col-span-4 flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">👷</span>
                                <span className="font-medium text-gray-700 dark:text-gray-200">Main d'œuvre</span>
                              </div>
                              <div className="col-span-6" />
                              <div className="col-span-2 text-right font-bold text-orange-600 self-center">
                                {fmt(r.labor_cost)} MAD
                              </div>
                            </div>
                          )}

                          {/* Total */}
                          <div className="flex justify-between items-center mt-3 px-3 py-2.5 bg-primary/5 dark:bg-primary/10 rounded-lg border border-primary/20">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                              Coût de revient / unité produite
                            </span>
                            <span className="text-lg font-bold text-primary">{fmt(totalCost)} MAD</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Modals ── */}
      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditBom(null) }}
        title={editBom ? `Modifier — ${editBom.name}` : 'Nouvelle Nomenclature (BOM)'} size="xl">
        <BomForm
          bom={editBom}
          onSaved={() => { setModalOpen(false); setEditBom(null); load() }}
          onCancel={() => { setModalOpen(false); setEditBom(null) }}
        />
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        title="Supprimer la nomenclature"
        message="Cette action est irréversible. La nomenclature sera supprimée définitivement."
        confirmLabel="🗑️ Supprimer"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}
