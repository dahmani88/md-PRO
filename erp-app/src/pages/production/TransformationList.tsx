import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import TransformationForm from './TransformationForm'

const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

export default function TransformationList() {
  const [rows, setRows]           = useState<any[]>([])
  const [loading, setLoading]     = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [expanded, setExpanded]   = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await api.getTransformations() as any[]) }
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

  // KPIs
  const totalCostAll = rows.reduce((s, r) => s + (r.total_cost ?? 0), 0)
  const totalOutputs = rows.reduce((s, r) => s + (r.outputs?.length ?? 0), 0)

  return (
    <div className="h-full flex flex-col gap-3">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 shrink-0">
        <button className="btn-primary px-5 py-2.5 text-sm font-semibold shadow-sm"
          onClick={() => setModalOpen(true)}>
          + Nouvelle Transformation
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="btn-secondary btn-sm">↻</button>
          <span className="text-sm text-gray-500">{rows.length} transformation(s)</span>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
          {[
            { label: 'Transformations', value: String(rows.length),         color: 'text-primary',   bg: 'bg-primary/5',                     icon: '🔄' },
            { label: 'Produits obtenus', value: String(totalOutputs),       color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/10', icon: '📦' },
            { label: 'Coût total',       value: fmt(totalCostAll) + ' MAD', color: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-50 dark:bg-gray-700/30', icon: '💰' },
          ].map(c => (
            <div key={c.label} className={`card p-4 ${c.bg}`}>
              <div className="text-lg mb-1">{c.icon}</div>
              <div className="text-xs text-gray-400 mb-1">{c.label}</div>
              <div className={`text-xl font-bold ${c.color}`}>{c.value}</div>
            </div>
          ))}
        </div>

      {/* ── Table ── */}
      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 w-8"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Matière entrée</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-300">Qté entrée</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Produits obtenus</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-300">Coût total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && [...Array(4)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                {[...Array(6)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                  </td>
                ))}
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-20">
                <div className="text-5xl mb-3">🔄</div>
                <div className="text-gray-500 font-medium text-base">Aucune transformation</div>
                <div className="text-gray-400 text-xs mt-1 mb-4">
                  Ex: 100 kg Aluminium → 50 Profilés + 20 Plaques
                </div>
                <button onClick={() => setModalOpen(true)} className="btn-primary">
                  + Créer la première
                </button>
              </td></tr>
            )}

            {!loading && rows.map(r => {
              const isOpen  = expanded.has(r.id)
              const outputs = r.outputs ?? []

              return (
                <React.Fragment key={r.id}>
                  <tr
                    className={`cursor-pointer transition-colors
                      ${isOpen ? 'bg-green-50/50 dark:bg-green-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}
                    onClick={() => toggleExpand(r.id)}>
                    <td className="px-4 py-3 text-center text-gray-400 text-xs select-none">
                      {isOpen ? '▼' : '▶'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(r.date).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-800 dark:text-gray-100">{r.material_name}</div>
                      <div className="text-xs text-gray-400 font-mono">{r.material_code}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {r.input_quantity}
                    </td>
                    <td className="px-4 py-3">
                      {/* Résumé inline des produits obtenus */}
                      <div className="flex flex-wrap gap-1">
                        {outputs.slice(0, 3).map((o: any, i: number) => (
                          <span key={i}
                            className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">
                            {o.product_name}
                            <span className="font-bold">×{o.quantity}</span>
                          </span>
                        ))}
                        {outputs.length > 3 && (
                          <span className="text-xs text-gray-400">+{outputs.length - 3} autres</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-primary">
                      {fmt(r.total_cost)} MAD
                    </td>
                  </tr>

                  {/* ── Détail expand ── */}
                  {isOpen && (
                    <tr className="bg-green-50/40 dark:bg-green-900/10">
                      <td colSpan={6} className="px-8 py-4 border-b border-green-100 dark:border-green-800">
                        <div className="max-w-2xl space-y-3">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Détail de la transformation
                          </div>

                          {/* Entrée */}
                          <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/50 rounded-lg px-4 py-3">
                            <span className="text-base">📤</span>
                            <div className="flex-1">
                              <div className="text-xs text-gray-500 mb-0.5">Matière consommée</div>
                              <div className="font-semibold text-gray-800 dark:text-gray-100">
                                {r.material_name}
                                <span className="ml-2 font-mono text-xs text-gray-400">{r.material_code}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-red-600 text-sm">− {r.input_quantity}</div>
                              {r.cost_per_unit > 0 && (
                                <div className="text-xs text-gray-400">
                                  Coût transfo: {fmt(r.cost_per_unit)} MAD/u
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Flèche */}
                          <div className="flex justify-center text-gray-400 text-lg">↓</div>

                          {/* Sorties */}
                          <div className="space-y-1.5">
                            {outputs.map((o: any, i: number) => (
                              <div key={i}
                                className="flex items-center gap-3 bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-800/50 rounded-lg px-4 py-3">
                                <span className="text-base">📥</span>
                                <div className="flex-1">
                                  <div className="text-xs text-gray-500 mb-0.5">Produit obtenu</div>
                                  <div className="font-semibold text-gray-800 dark:text-gray-100">
                                    {o.product_name}
                                    <span className="ml-2 font-mono text-xs text-gray-400">{o.product_code}</span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="font-bold text-green-600 text-sm">+ {o.quantity} {o.unit}</div>
                                  <div className="text-xs text-gray-400">
                                    Coût alloué: {fmt(o.allocated_cost ?? 0)} MAD
                                  </div>
                                  <div className="text-xs text-gray-400">
                                    CMUP: {fmt(o.quantity > 0 ? (o.allocated_cost ?? 0) / o.quantity : 0)} MAD/u
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Total */}
                          <div className="flex justify-between items-center px-4 py-2.5 bg-primary/5 rounded-lg border border-primary/20">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Coût total réparti</span>
                            <span className="text-base font-bold text-primary">{fmt(r.total_cost)} MAD</span>
                          </div>

                          {r.notes && (
                            <div className="text-xs text-gray-500 italic px-1">📝 {r.notes}</div>
                          )}
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle Transformation" size="lg">
        <TransformationForm onSaved={() => { setModalOpen(false); load() }} onCancel={() => setModalOpen(false)} />
      </Modal>
    </div>
  )
}
