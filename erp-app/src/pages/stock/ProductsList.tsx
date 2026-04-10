import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import ProductForm from '../../components/forms/ProductForm'
import ProductDetail from './ProductDetail'
import ImportButton from '../../components/ImportButton'
import type { Product } from '../../types'

import SkeletonRows from '../../components/ui/SkeletonRows'

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  raw:           { label: 'Matière 1ère', cls: 'badge-blue' },
  finished:      { label: 'Produit fini', cls: 'badge-green' },
  semi_finished: { label: 'Semi-fini',    cls: 'badge-orange' },
}

const TYPE_FILTER = [
  { value: '',              label: 'Tous les types' },
  { value: 'raw',           label: 'Matières premières' },
  { value: 'finished',      label: 'Produits finis' },
  { value: 'semi_finished', label: 'Semi-finis' },
]

const STOCK_FILTER = [
  { value: 'all',      label: 'Tout le stock' },
  { value: 'critical', label: '🔴 Critique' },
  { value: 'low',      label: '🟡 Bas' },
  { value: 'ok',       label: '🟢 OK' },
]

export default function ProductsList() {
  const [rows, setRows]           = useState<Product[]>([])
  const [search, setSearch]       = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('all')
  const [loading, setLoading]     = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]     = useState<Product | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const LIMIT = 50
  const searchRef = useRef<ReturnType<typeof setTimeout>>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Si filtre stock actif, on charge tout pour filtrer correctement
      const useLimit = stockFilter !== 'all' ? 9999 : LIMIT
      const usePage  = stockFilter !== 'all' ? 1 : page
      const result = await api.getProducts({ type: typeFilter || undefined, search, page: usePage, limit: useLimit }) as any
      setRows(result.rows ?? [])
      setTotal(result.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [typeFilter, search, page, stockFilter])

  useEffect(() => { load() }, [load])

  function handleSearch(v: string) {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => setSearch(v), 300)
  }
  useEffect(() => { setPage(1) }, [search, typeFilter, stockFilter])

  useEffect(() => {
    const handler = () => load()
    window.addEventListener('app:refresh', handler)
    return () => window.removeEventListener('app:refresh', handler)
  }, [load])

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  // stock filter
  const filteredRows = rows.filter(p => {
    if (stockFilter === 'critical') return p.stock_quantity <= 0
    if (stockFilter === 'low')      return p.stock_quantity > 0 && p.min_stock > 0 && p.stock_quantity <= p.min_stock
    if (stockFilter === 'ok')       return p.min_stock === 0 || p.stock_quantity > p.min_stock
    return true
  })

  // stats
  const totalValue    = rows.reduce((s, p) => s + p.stock_quantity * p.cmup_price, 0)
  const criticalCount = rows.filter(p => p.stock_quantity <= 0).length
  const lowCount      = rows.filter(p => p.stock_quantity > 0 && p.min_stock > 0 && p.stock_quantity <= p.min_stock).length

  return (
    <div className="h-full flex flex-col gap-3">

      {/* Header: boutons + KPI */}
      <div className="flex items-center justify-between shrink-0">
        <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true) }}>
          + Nouveau Produit
        </button>
        <div className="flex gap-2">
          <ImportButton type="products" onImported={load} />
          <button onClick={async () => {
            try {
              await api.excelExportStock()
              toast('✅ Fichier Excel enregistré')
            } catch (e: any) { toast(e.message, 'error') }
          }} className="btn-secondary btn-sm">📤 Exporter</button>
        </div>
      </div>

      {/* KPI mini-cards */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        {[
          { label: 'Produits',       value: String(rows.length),       color: 'text-primary',    bg: 'bg-primary/5' },
          { label: 'Valeur stock',   value: fmt(totalValue) + ' MAD',  color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/10' },
          { label: 'Stock critique', value: String(criticalCount),     color: 'text-red-600',    bg: criticalCount > 0 ? 'bg-red-50 dark:bg-red-900/10' : 'bg-gray-50 dark:bg-gray-700/30' },
          { label: 'Stock bas',      value: String(lowCount),          color: 'text-amber-600',  bg: lowCount > 0 ? 'bg-amber-50 dark:bg-amber-900/10' : 'bg-gray-50 dark:bg-gray-700/30' },
        ].map(c => (
          <div key={c.label} className={`card p-4 ${c.bg}`}>
            <div className="text-xs text-gray-500">{c.label}</div>
            <div className={`text-lg font-bold mt-1 ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar: filtres */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <input onChange={e => handleSearch(e.target.value)}
          className="input max-w-xs" placeholder="Rechercher par code ou nom..." />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input w-44">
          {TYPE_FILTER.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={stockFilter} onChange={e => setStockFilter(e.target.value)} className="input w-36">
          {STOCK_FILTER.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '80px' }} />
            <col style={{ width: '180px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '70px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '147px' }} />
            <col style={{ width: '68px' }} />
            <col style={{ width: '72px' }} />
          </colgroup>
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 [&_th]:border [&_th]:border-gray-200 dark:[&_th]:border-gray-600">
            <tr>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600">Code</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600">Désignation</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600">Type</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600">Unité</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600">Stock</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600">CMUP</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600">Valeur</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600">État</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700 [&_td]:border [&_td]:border-gray-100 dark:[&_td]:border-gray-700">
            {loading && <SkeletonRows cols={9} />}
            {!loading && filteredRows.length === 0 && (
              <tr><td colSpan={9} className="text-center py-16">
                <div className="text-4xl mb-3">📦</div>
                <div className="text-gray-500 font-medium">Aucun produit</div>
                <button onClick={() => { setEditing(null); setModalOpen(true) }}
                  className="btn-primary mt-3">+ Créer le premier</button>
              </td></tr>
            )}
            {filteredRows.map(p => {
              const isLow = p.min_stock > 0 && p.stock_quantity <= p.min_stock
              const typeBadge = TYPE_BADGE[p.type] ?? { label: p.type, cls: 'badge-gray' }
              return (
                <tr key={p.id}
                  onMouseDown={e => { (e.currentTarget as any)._mdX = e.clientX; (e.currentTarget as any)._mdY = e.clientY }}
                  onClick={e => {
                    const el = e.currentTarget as any
                    if (Math.abs(e.clientX-(el._mdX??e.clientX))>5||Math.abs(e.clientY-(el._mdY??e.clientY))>5) return
                    if ((e.target as HTMLElement).closest('button')) return
                    setSelectedId(p.id)
                  }}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer">
                  <td className="px-4 py-3 text-center align-middle font-mono text-xs font-bold text-primary">{p.code}</td>
                  <td className="px-4 py-3 text-center align-middle font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-center align-middle">
                    <span className={typeBadge.cls}>{typeBadge.label}</span>
                  </td>
                  <td className="px-4 py-3 text-center align-middle text-gray-500">{p.unit}</td>
                  <td className={`px-4 py-3 text-center align-middle font-semibold ${isLow ? 'text-red-500' : ''}`}>
                    {fmt(p.stock_quantity)}
                  </td>
                  <td className="px-4 py-3 text-center align-middle text-gray-600">{fmt(p.cmup_price)}</td>
                  <td className="px-4 py-3 text-center align-middle font-medium">{fmt(p.stock_quantity * p.cmup_price)} MAD</td>
                  <td className="px-4 py-3 text-center align-middle">
                    <span className={isLow ? 'badge-red' : 'badge-green'}>
                      {isLow ? '⚠ Bas' : '✓ OK'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center align-middle">
                    <div className="flex gap-1 justify-center" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditing(p); setModalOpen(true) }}
                        className="btn-secondary btn-sm text-xs">✏️</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {total > LIMIT && (
        <div className="flex items-center justify-between shrink-0 text-xs text-gray-500">
          <span>{total} produit(s)</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn-secondary btn-sm disabled:opacity-40">←</button>
            <span className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              {page} / {Math.ceil(total / LIMIT)}
            </span>
            <button disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage(p => p + 1)} className="btn-secondary btn-sm disabled:opacity-40">→</button>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? 'Modifier Produit' : 'Nouveau Produit'}>
        <ProductForm
          initial={editing ?? undefined}
          onSaved={() => { setModalOpen(false); load() }}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>

      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} title="Fiche Produit" width="w-[700px]">
        {selectedId !== null && <ProductDetail id={selectedId} onClose={() => setSelectedId(null)} onStockChanged={load} />}
      </Drawer>
    </div>
  )
}
