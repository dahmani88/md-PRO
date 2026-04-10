import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)

function pctChange(curr: number, prev: number) {
  if (!prev) return null
  return ((curr - prev) / prev) * 100
}

function Badge({ value }: { value: number | null }) {
  if (value === null) return null
  const pos = value >= 0
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pos ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
      {pos ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

type Period = 'month' | 'year' | 'all'

export default function RapportsPage() {
  const [period, setPeriod] = useState<Period>('month')
  const [loading, setLoading] = useState(true)

  // KPIs
  const [kpi, setKpi] = useState({
    sales: 0, prevSales: 0,
    purchases: 0, prevPurchases: 0,
    unpaid: 0, overdueAmount: 0, clientDebt: 0, supplierDebt: 0,
    invoiceCount: 0, paidCount: 0, unpaidCount: 0, overdueCount: 0,
  })

  // Stock
  const [stockStats, setStockStats] = useState({
    total: 0, value: 0, low: 0, outOf: 0,
  })
  const [lowStockItems, setLowStockItems] = useState<any[]>([])

  // TVA
  const [tva, setTva] = useState({ collected: 0, deductible: 0 })

  // Chèques
  const [cheques, setCheques] = useState<any[]>([])

  // Factures en retard
  const [overdueInvoices, setOverdueInvoices] = useState<any[]>([])

  // Top clients
  const [topClients, setTopClients] = useState<any[]>([])

  // Activité récente
  const [recentInvoices, setRecentInvoices] = useState<any[]>([])
  const [recentPayments, setRecentPayments] = useState<any[]>([])
  const [productionStats, setProductionStats] = useState<any>(null)

  const getRange = useCallback(() => {
    const now = new Date()
    const y = now.getFullYear(), m = now.getMonth()
    if (period === 'month') {
      const from = new Date(y, m, 1).toISOString().split('T')[0]
      const to   = now.toISOString().split('T')[0]
      const pFrom = new Date(y, m - 1, 1).toISOString().split('T')[0]
      const pTo   = new Date(y, m, 0).toISOString().split('T')[0]
      return { from, to, pFrom, pTo }
    }
    if (period === 'year') {
      return { from: `${y}-01-01`, to: now.toISOString().split('T')[0],
               pFrom: `${y - 1}-01-01`, pTo: `${y - 1}-12-31` }
    }
    return { from: '2020-01-01', to: now.toISOString().split('T')[0],
             pFrom: '2019-01-01', pTo: '2019-12-31' }
  }, [period])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to, pFrom, pTo } = getRange()

      const results = await Promise.allSettled([
        api.getReport({ type: 'sales',       filters: { start_date: from, end_date: to } }),
        api.getReport({ type: 'sales',       filters: { start_date: pFrom, end_date: pTo } }),
        api.getReport({ type: 'purchases',   filters: { start_date: from, end_date: to } }),
        api.getReport({ type: 'purchases',   filters: { start_date: pFrom, end_date: pTo } }),
        api.getReport({ type: 'stock',       filters: {} }),
        api.getReport({ type: 'receivables', filters: {} }),
        api.getReport({ type: 'payables',    filters: {} }),
        api.getReport({ type: 'cheques',     filters: {} }),
        api.getTvaDeclaration({ start_date: from, end_date: to }),
        api.getDocuments({ type: 'invoice', limit: 5 }),
        api.getPayments({ limit: 5 }),
        api.getNotifications(),
        api.getReport({ type: 'overdue', filters: {} }),
        api.getReport({ type: 'production', filters: { start_date: from, end_date: to } }),
      ])

      const get = (i: number): any => results[i].status === 'fulfilled' ? results[i].value : null

      const salesR       = get(0)
      const prevSalesR   = get(1)
      const purchasesR   = get(2)
      const prevPurchasesR = get(3)
      const stockR       = get(4)
      const receivablesR = get(5)
      const payablesR    = get(6)
      const chequesR     = get(7)
      const tvaR         = get(8)
      const recentDocsR  = get(9)
      const paymentsR    = get(10)
      const notifR       = get(11)
      const overdueR     = get(12)
      const productionR  = get(13)

      // log errors
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.warn(`[Rapports] call ${i} failed:`, r.reason)
      })

      // normaliser les arrays
      const toArr = (r: any): any[] => {
        if (!r) return []
        if (Array.isArray(r)) return r
        if (r?.rows) return r.rows
        return []
      }

      const sales     = toArr(salesR).reduce((s: number, r: any) => s + (r.total_ttc ?? 0), 0)
      const prevSales = toArr(prevSalesR).reduce((s: number, r: any) => s + (r.total_ttc ?? 0), 0)
      const purchases     = toArr(purchasesR).reduce((s: number, r: any) => s + (r.total_ttc ?? 0), 0)
      const prevPurchases = toArr(prevPurchasesR).reduce((s: number, r: any) => s + (r.total_ttc ?? 0), 0)

      const salesArr       = toArr(salesR)
      const stockArr       = toArr(stockR)
      const receivablesArr = toArr(receivablesR)
      const payablesArr    = toArr(payablesR)
      const chequesArr     = toArr(chequesR)
      const notifArr       = toArr(notifR)

      const paid    = salesArr.filter((r: any) => r.payment_status === 'paid').length
      const unpaidC = salesArr.filter((r: any) => r.payment_status !== 'paid').length
      const overdueArr = toArr(overdueR)
      const overdue = overdueArr.length
      const overdueAmt = overdueArr.reduce((s: number, r: any) => s + (r.remaining ?? 0), 0)

      setKpi({
        sales, prevSales, purchases, prevPurchases,
        unpaid: salesArr.filter((r: any) => r.payment_status !== 'paid').reduce((s: number, r: any) => s + (r.total_ttc ?? 0), 0),
        overdueAmount: overdueAmt,
        clientDebt:   receivablesArr.reduce((s: number, r: any) => s + (r.balance ?? 0), 0),
        supplierDebt: payablesArr.reduce((s: number, r: any) => s + (r.balance ?? 0), 0),
        invoiceCount: salesArr.length, paidCount: paid, unpaidCount: unpaidC, overdueCount: overdue,
      })

      const low = stockArr.filter((r: any) => r.is_low)
      setStockStats({
        total: stockArr.length,
        value: stockArr.reduce((s: number, r: any) => s + (r.stock_value ?? 0), 0),
        low:   low.length,
        outOf: stockArr.filter((r: any) => (r.stock_quantity ?? 0) <= 0).length,
      })
      setLowStockItems(low.slice(0, 6))

      setTva({
        collected:  tvaR?.totalCollectee   ?? 0,
        deductible: tvaR?.totalRecuperable ?? 0,
      })

      // شيكات: المتأخرة + التي تستحق خلال 7 أيام
      const today = new Date(); today.setHours(0,0,0,0)
      const in7days = new Date(today.getTime() + 7 * 86400000)
      const urgent = chequesArr.filter((c: any) => {
        if (c.status !== 'pending') return false
        if (!c.due_date) return true  // شيك بدون تاريخ استحقاق → يظهر دائماً
        const d = new Date(c.due_date)
        if (isNaN(d.getTime())) return true  // تاريخ غير صحيح → يظهر
        d.setHours(0,0,0,0)
        return d <= in7days
      }).sort((a: any, b: any) => {
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date)
      })
      setCheques(urgent.slice(0, 10))

      setOverdueInvoices(overdueArr.slice(0, 5))

      const top = [...receivablesArr]
        .sort((a: any, b: any) => b.total_invoiced - a.total_invoiced)
        .slice(0, 5)
      setTopClients(top)

      setRecentInvoices(toArr(recentDocsR).slice(0, 5))
      setRecentPayments(toArr(paymentsR).slice(0, 5))
      setProductionStats(productionR ?? null)

    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [getRange])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const h = () => load()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [load])

  const profit       = kpi.sales - kpi.purchases
  const profitMargin = kpi.sales > 0 ? (profit / kpi.sales) * 100 : 0
  const salesChange  = pctChange(kpi.sales, kpi.prevSales)
  const buyChange    = pctChange(kpi.purchases, kpi.prevPurchases)
  const tvaDue       = tva.collected - tva.deductible

  const PERIOD_LABEL: Record<Period, string> = {
    month: 'Ce mois', year: 'Cette année', all: 'Tout',
  }

  if (loading) return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center text-gray-400">
        <div className="text-3xl mb-2 animate-pulse">📊</div>
        <div className="text-sm">Chargement des données...</div>
      </div>
    </div>
  )

  return (
    <div className="h-full overflow-auto p-5 space-y-6">

      {/* ── Header + period filter ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-white">Tableau de bord</h1>
          <p className="text-xs text-gray-400 mt-0.5">{PERIOD_LABEL[period]}</p>
        </div>
        <div className="flex gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
          {(['month', 'year', 'all'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all
                ${period === p ? 'bg-primary text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Ventes',    value: fmt(kpi.sales) + ' MAD',    sub: `${kpi.invoiceCount} facture(s)`, color: 'text-green-600',  border: 'border-b-green-500',  icon: '📈', change: salesChange },
          { label: 'Achats',    value: fmt(kpi.purchases) + ' MAD', sub: 'Fournisseurs',                  color: 'text-red-500',    border: 'border-b-red-500',    icon: '📉', change: buyChange },
          { label: 'Bénéfice', value: fmt(profit) + ' MAD',        sub: `Marge ${profitMargin.toFixed(1)}%`, color: profit >= 0 ? 'text-primary' : 'text-red-500', border: 'border-b-primary', icon: '💰', change: null },
          { label: 'Impayé',   value: fmt(kpi.unpaid) + ' MAD',    sub: `${kpi.unpaidCount} facture(s)`, color: 'text-orange-600', border: 'border-b-orange-500', icon: '⏳', change: null },
          { label: 'En retard', value: fmt(kpi.overdueAmount) + ' MAD', sub: `${kpi.overdueCount} facture(s)`, color: 'text-red-600', border: 'border-b-red-500', icon: '🔴', change: null },
        ].map(c => (
          <div key={c.label} className={`card p-4 border-b-4 ${c.border}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-lg">{c.icon}</span>
              <Badge value={c.change} />
            </div>
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{c.label}</div>
            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Row 2: Factures + Stock ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Factures */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">🧾 État des factures</h3>
          <div className="space-y-3">
            {[
              { label: 'Payées',    value: kpi.paidCount,    total: kpi.invoiceCount, color: 'bg-green-500' },
              { label: 'Impayées', value: kpi.unpaidCount,  total: kpi.invoiceCount, color: 'bg-orange-400' },
              { label: 'En retard', value: kpi.overdueCount, total: Math.max(kpi.unpaidCount, kpi.overdueCount), color: 'bg-red-500' },
            ].map(r => (
              <div key={r.label} className="flex items-center gap-3">
                <div className="text-xs text-gray-500 w-20 shrink-0">{r.label}</div>
                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                  <div className={`${r.color} h-2 rounded-full`}
                    style={{ width: r.total > 0 ? `${Math.min((r.value / r.total) * 100, 100)}%` : '0%' }} />
                </div>
                <div className="text-xs font-semibold w-6 text-right text-gray-700 dark:text-gray-200">{r.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 gap-3">
            <div className="bg-orange-50 dark:bg-orange-900/10 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Créances Clients</div>
              <div className="font-bold text-orange-600 text-sm">{fmt(kpi.clientDebt)} MAD</div>
            </div>
            <div className="bg-red-50 dark:bg-red-900/10 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Dettes Fournisseurs</div>
              <div className="font-bold text-red-500 text-sm">{fmt(kpi.supplierDebt)} MAD</div>
            </div>
          </div>
        </div>

        {/* Stock */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">📦 État du stock</h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { label: 'Produits',     value: String(stockStats.total),       color: 'text-primary',    bg: 'bg-primary/5' },
              { label: 'Valeur stock', value: fmt(stockStats.value) + ' MAD', color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-900/10' },
              { label: 'Stock bas',    value: String(stockStats.low),         color: stockStats.low > 0 ? 'text-amber-600' : 'text-gray-400', bg: 'bg-amber-50 dark:bg-amber-900/10' },
              { label: 'Rupture',      value: String(stockStats.outOf),       color: stockStats.outOf > 0 ? 'text-red-500' : 'text-gray-400', bg: 'bg-red-50 dark:bg-red-900/10' },
            ].map(s => (
              <div key={s.label} className={`rounded-xl p-3 ${s.bg}`}>
                <div className="text-xs text-gray-400 mb-1">{s.label}</div>
                <div className={`font-bold text-sm ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
          {lowStockItems.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-gray-400 font-medium mb-2">Produits critiques</div>
              {lowStockItems.map((p: any, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate text-gray-700 dark:text-gray-200 max-w-[160px]">{p.name}</span>
                  <span className={`font-semibold ${p.stock_quantity <= 0 ? 'text-red-500' : 'text-amber-600'}`}>
                    {p.stock_quantity} {p.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 3: Chèques + TVA ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Chèques urgents */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4 flex items-center gap-2 flex-wrap">
            🏦 Chèques & LCN à encaisser
            {cheques.length > 0 && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{cheques.length}</span>}
            {cheques.length > 0 && (
              <span className="ml-auto text-xs font-bold text-primary">
                {fmt(cheques.reduce((s, c) => s + (c.amount ?? 0), 0))} MAD
              </span>
            )}
          </h3>
          {cheques.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-6">Aucun chèque en attente</div>
          ) : (
            <div className="space-y-2">
              {cheques.map((c: any, i) => {
                const dueDate = c.due_date ? new Date(c.due_date) : null
                const validDate = dueDate && !isNaN(dueDate.getTime())
                const days = validDate ? Math.ceil((dueDate!.getTime() - Date.now()) / 86400000) : null
                const isOverdue = days !== null && days < 0
                return (
                  <div key={i} className={`flex items-center justify-between text-xs rounded-lg px-3 py-2
                    ${isOverdue ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' : days === 0 ? 'bg-orange-50 dark:bg-orange-900/20' : 'bg-amber-50 dark:bg-amber-900/10'}`}>
                    <div>
                      <div className="font-medium text-gray-700 dark:text-gray-200">{c.party_name}</div>
                      <div className="text-gray-400">
                        {c.method === 'lcn' ? 'LCN' : 'Chèque'} · {c.cheque_number ?? '—'}
                        <span className="ml-1 text-gray-300">·</span>
                        <span className="ml-1">{c.party_type === 'client' ? 'Client' : 'Fournisseur'}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-gray-800 dark:text-gray-100">{fmt(c.amount)} MAD</div>
                      <div className={`font-semibold ${isOverdue ? 'text-red-500' : days === 0 ? 'text-orange-500' : 'text-amber-600'}`}>
                        {days === null ? '⚠ Sans échéance' : isOverdue ? `${Math.abs(days)}j retard` : days === 0 ? "Aujourd'hui" : `${days}j`}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* TVA du mois */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">🧾 TVA — {PERIOD_LABEL[period]}</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-xs text-gray-500">TVA collectée (ventes)</span>
              <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">{fmt(tva.collected)} MAD</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-xs text-gray-500">TVA récupérable (achats)</span>
              <span className="font-semibold text-sm text-green-600">− {fmt(tva.deductible)} MAD</span>
            </div>
            <div className={`flex justify-between items-center py-3 rounded-xl px-3 ${tvaDue >= 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                {tvaDue >= 0 ? 'TVA due' : 'Crédit TVA'}
              </span>
              <span className={`text-lg font-bold ${tvaDue >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                {fmt(Math.abs(tvaDue))} MAD
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 4: Top clients + Factures en retard ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top clients */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">🏆 Top clients</h3>
          {topClients.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-6">Aucune donnée</div>
          ) : (
            <div className="space-y-2">
              {topClients.map((c: any, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-300 w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate text-gray-700 dark:text-gray-200">{c.client_name}</div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 mt-1">
                      <div className="bg-primary h-1.5 rounded-full"
                        style={{ width: topClients[0]?.total_invoiced > 0 ? `${(c.total_invoiced / topClients[0].total_invoiced) * 100}%` : '0%' }} />
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-primary shrink-0">{fmt(c.total_invoiced)} MAD</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Factures en retard */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">
            ⚠️ Factures en retard
            {overdueInvoices.length > 0 && <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{overdueInvoices.length}</span>}
          </h3>
          {overdueInvoices.length === 0 ? (
            <div className="text-xs text-green-600 text-center py-6">✓ Aucune facture en retard</div>
          ) : (
            <div className="space-y-2">
              {overdueInvoices.map((n: any, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                  <div>
                    <div className="font-mono font-bold text-primary">{n.number}</div>
                    <div className="text-gray-600 dark:text-gray-300">{n.client_name ?? '—'}</div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <div className="text-red-600 font-bold">{new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n.remaining ?? 0)} MAD</div>
                    <div className="text-red-500">{n.days_overdue}j retard</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 5: Activité récente ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Dernières factures */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">📄 Dernières factures</h3>
          {recentInvoices.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-6">Aucune facture</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {recentInvoices.map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-mono text-xs font-bold text-primary">{doc.number}</div>
                    <div className="text-xs text-gray-500">{doc.party_name ?? '—'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">{fmt(doc.total_ttc)} MAD</div>
                    <div className="text-xs text-gray-400">{new Date(doc.date).toLocaleDateString('fr-FR')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Derniers paiements */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">💳 Derniers paiements</h3>
          {recentPayments.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-6">Aucun paiement</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {recentPayments.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-200">{p.party_name ?? '—'}</div>
                    <div className="text-xs text-gray-400 capitalize">{p.method} · {new Date(p.date).toLocaleDateString('fr-FR')}</div>
                  </div>
                  <div className="text-xs font-bold text-green-600">{fmt(p.amount)} MAD</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 6: Production ── */}
      {productionStats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* KPIs إنتاج */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">🏭 Production — {PERIOD_LABEL[period]}</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: 'Ordres confirmés', value: String(productionStats.summary?.totalOrders ?? 0),       color: 'text-primary',   bg: 'bg-primary/5' },
                { label: 'Qté produite',     value: String(productionStats.summary?.totalQty ?? 0),          color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/10' },
                { label: 'Coût total',       value: fmt(productionStats.summary?.totalCost ?? 0) + ' MAD',   color: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-50 dark:bg-gray-700/30' },
                { label: 'Coût moy./unité',  value: fmt(productionStats.summary?.avgUnitCost ?? 0) + ' MAD', color: 'text-blue-600',  bg: 'bg-blue-50 dark:bg-blue-900/10' },
              ].map(s => (
                <div key={s.label} className={`rounded-xl p-3 ${s.bg}`}>
                  <div className="text-xs text-gray-400 mb-1">{s.label}</div>
                  <div className={`font-bold text-sm ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
            {/* Derniers ordres */}
            {(productionStats.orders ?? []).length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-gray-400 font-medium mb-2">Derniers ordres</div>
                {(productionStats.orders ?? []).slice(0, 4).map((o: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-200">{o.product_name}</span>
                      <span className="text-gray-400 ml-2">{new Date(o.date).toLocaleDateString('fr-FR')}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-primary">{fmt(o.quantity)} {o.unit}</span>
                      <span className="text-gray-400 ml-2">{fmt(o.total_cost)} MAD</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Par produit */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">📦 Production par produit</h3>
            {(productionStats.byProduct ?? []).length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-6">Aucune production cette période</div>
            ) : (
              <div className="space-y-3">
                {(productionStats.byProduct ?? []).slice(0, 6).map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-300 w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700 dark:text-gray-200 truncate">{p.product_name}</span>
                        <span className="text-gray-500 shrink-0 ml-2">{fmt(p.qty)} {p.unit}</span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                        <div className="bg-primary h-1.5 rounded-full"
                          style={{ width: (productionStats.byProduct[0]?.cost ?? 0) > 0
                            ? `${(p.cost / productionStats.byProduct[0].cost) * 100}%`
                            : '0%' }} />
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-primary shrink-0">{fmt(p.cost)} MAD</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
