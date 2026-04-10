import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import { useAuthStore } from '../../store/auth.store'

const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

interface Props {
  orderId: number
  onUpdated: () => void
}

export default function ProductionDetail({ orderId, onUpdated }: Props) {
  const { user } = useAuthStore()
  const userId = user?.id ?? 1
  const [order, setOrder]         = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [acting, setActing]       = useState(false)

  async function load() {
    setLoading(true)
    try {
      const orders = await api.getProductionOrders() as any[]
      const found = orders.find((o: any) => o.id === orderId)
      setOrder(found ?? null)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [orderId])

  async function handleConfirm() {
    setActing(true)
    try {
      await api.confirmProduction(orderId, userId)
      toast('Production confirmée — Stock mis à jour ✅')
      load(); onUpdated()
    } catch (e: any) { toast(e.message, 'error') }
    finally { setActing(false) }
  }

  async function handleCancel() {
    setActing(true)
    try {
      await api.cancelProduction(orderId, userId)
      toast('Ordre annulé')
      load(); onUpdated()
    } catch (e: any) { toast(e.message, 'error') }
    finally { setActing(false) }
  }

  if (loading) return (
    <div className="p-6 space-y-4 animate-pulse">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
      ))}
    </div>
  )

  if (!order) return (
    <div className="flex items-center justify-center h-40 text-gray-400">Introuvable</div>
  )

  const snapshot = order.bom_snapshot ? (() => {
    try { return JSON.parse(order.bom_snapshot) } catch { return null }
  })() : null

  const lines = snapshot?.lines ?? []

  const STATUS_CFG: Record<string, { label: string; cls: string }> = {
    draft:     { label: 'Brouillon', cls: 'badge-gray' },
    confirmed: { label: 'Confirmé',  cls: 'badge-green' },
    cancelled: { label: 'Annulé',    cls: 'badge-red' },
  }
  const cfg = STATUS_CFG[order.status] ?? STATUS_CFG.draft

  return (
    <div className="p-6 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-gray-400 mb-1">Ordre de production #{order.id}</div>
          <div className="text-xl font-bold text-gray-800 dark:text-white">{order.product_name}</div>
          <div className="text-xs text-gray-400 font-mono mt-0.5">{order.product_code}</div>
        </div>
        <span className={cfg.cls}>{cfg.label}</span>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Quantité',      value: `${fmt(order.quantity)} ${order.unit}`, color: 'text-primary' },
          { label: 'Coût unitaire', value: `${fmt(order.unit_cost)} MAD`,          color: 'text-gray-700 dark:text-gray-200' },
          { label: 'Coût total',    value: `${fmt(order.total_cost)} MAD`,         color: 'text-primary font-bold' },
        ].map(k => (
          <div key={k.label} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
            <div className="text-xs text-gray-400 mb-1">{k.label}</div>
            <div className={`text-sm font-bold ${k.color}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Infos ── */}
      <div className="space-y-2 text-sm">
        {[
          { label: 'Date',        value: new Date(order.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) },
          { label: 'Nomenclature', value: snapshot?.bom?.name ?? '— Sans BOM —' },
        ].map(f => (
          <div key={f.label} className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700">
            <span className="text-gray-500">{f.label}</span>
            <span className="font-medium">{f.value}</span>
          </div>
        ))}
      </div>

      {/* ── Composition ── */}
      {lines.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            🧱 Matières consommées
          </div>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Matière</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Qté / unité</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Qté totale</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Coût</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {lines.map((l: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800 dark:text-gray-100">{l.material_name}</div>
                      <div className="text-gray-400 font-mono">{l.material_code}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{l.quantity} {l.unit}</td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {fmt(l.quantity * order.quantity)} {l.unit}
                    </td>
                    <td className="px-3 py-2 text-right text-primary font-semibold">
                      {fmt((l.cmup_price ?? 0) * l.quantity * order.quantity)} MAD
                    </td>
                  </tr>
                ))}
                {snapshot?.bom?.labor_cost > 0 && (
                  <tr className="bg-orange-50/50 dark:bg-orange-900/10">
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">👷 Main d'œuvre</td>
                    <td colSpan={2} />
                    <td className="px-3 py-2 text-right font-semibold text-orange-600">
                      {fmt(snapshot.bom.labor_cost)} MAD
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {order.notes && (
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
          📝 {order.notes}
        </div>
      )}

      {/* ── Actions ── */}
      {order.status === 'draft' && (
        <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={handleCancel}
            disabled={acting}
            className="btn-secondary flex-1 justify-center text-red-500 border-red-200 hover:bg-red-50">
            🚫 Annuler l'ordre
          </button>
          <button
            onClick={handleConfirm}
            disabled={acting}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold text-sm transition-colors shadow-sm">
            {acting ? '...' : '✅ Confirmer la production'}
          </button>
        </div>
      )}
    </div>
  )
}
