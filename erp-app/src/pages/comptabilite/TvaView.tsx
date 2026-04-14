import { useState } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'

function getCurrentMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  return { start: fmt(start), end: fmt(end) }
}

export default function TvaView() {
  const range = getCurrentMonthRange()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [startDate, setStartDate] = useState(range.start)
  const [endDate, setEndDate] = useState(range.end)

  async function load() {
    if (!startDate || !endDate) return
    setLoading(true)
    try {
      const result = await api.getTvaDeclaration({ start_date: startDate, end_date: endDate })
      setData(result)
    } finally { setLoading(false) }
  }

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  return (
    <div className="flex flex-col gap-4">
      {/* Période */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">Période:</label>
        <input value={startDate} onChange={e => setStartDate(e.target.value)} className="input w-36" type="date" />
        <span className="text-gray-400">→</span>
        <input value={endDate} onChange={e => setEndDate(e.target.value)} className="input w-36" type="date" />
        <button onClick={load} disabled={!startDate || !endDate} className="btn-primary">
          Calculer
        </button>
        {data && (
          <div className="flex gap-2 ml-auto">
            <button onClick={async () => {
              try {
                const rows = [
                  { label: 'TVA Collectée', amount: data.totalCollectee ?? 0 },
                  { label: 'TVA Récupérable', amount: data.totalRecuperable ?? 0 },
                  { label: 'TVA Due', amount: data.tvaDue ?? 0 },
                ]
                await api.excelExportReport({ type: 'tva', rows, filters: { startDate, endDate } })
                toast('Fichier Excel enregistré ✓')
              } catch (e: any) { toast(e.message, 'error') }
            }} className="btn-secondary btn-sm">📊 Excel</button>
            <button onClick={async () => {
              const html = `
                <html><head><title>Déclaration TVA</title>
                <style>
                  body { font-family: Arial, sans-serif; padding: 30px; color: #111; }
                  h2 { margin-bottom: 4px; }
                  .period { color: #666; font-size: 13px; margin-bottom: 24px; }
                  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                  th { background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 13px; }
                  td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
                  .total-row td { font-weight: bold; border-top: 2px solid #d1d5db; }
                  .result { text-align: center; padding: 20px; border: 2px solid ${(data.tvaDue ?? 0) >= 0 ? '#fca5a5' : '#86efac'}; border-radius: 8px; background: ${(data.tvaDue ?? 0) >= 0 ? '#fef2f2' : '#f0fdf4'}; }
                  .result .amount { font-size: 28px; font-weight: bold; color: ${(data.tvaDue ?? 0) >= 0 ? '#dc2626' : '#16a34a'}; }
                  @page { size: A4; margin: 15mm; }
                </style></head><body>
                <h2>Déclaration TVA</h2>
                <div class="period">Période: ${startDate} → ${endDate}</div>
                <table>
                  <tr><th>TVA Facturée (Collectée)</th><th style="text-align:right">Montant</th></tr>
                  ${(data.collectee ?? []).map((r: any) => `<tr><td>${r.tva_rate}</td><td style="text-align:right">${fmt(r.amount)} MAD</td></tr>`).join('')}
                  <tr class="total-row"><td>Total</td><td style="text-align:right;color:#dc2626">${fmt(data.totalCollectee ?? 0)} MAD</td></tr>
                </table>
                <table>
                  <tr><th>TVA Récupérable (Déductible)</th><th style="text-align:right">Montant</th></tr>
                  ${(data.recuperable ?? []).map((r: any) => `<tr><td>${r.tva_rate}</td><td style="text-align:right">${fmt(r.amount)} MAD</td></tr>`).join('')}
                  <tr class="total-row"><td>Total</td><td style="text-align:right;color:#16a34a">${fmt(data.totalRecuperable ?? 0)} MAD</td></tr>
                </table>
                <div class="result">
                  <div style="font-size:13px;color:#666;margin-bottom:6px">${(data.tvaDue ?? 0) >= 0 ? 'TVA due à payer' : 'Crédit de TVA'}</div>
                  <div class="amount">${fmt(Math.abs(data.tvaDue ?? 0))} MAD</div>
                  <div style="font-size:12px;color:#999;margin-top:6px">${fmt(data.totalCollectee ?? 0)} − ${fmt(data.totalRecuperable ?? 0)} = ${fmt(data.tvaDue ?? 0)} MAD</div>
                </div>
                </body></html>
              `
              try {
                await api.generatePdfFromHtml({ html, filename: `TVA-${startDate}-${endDate}.pdf` })
                toast('PDF enregistré ✓')
              } catch (e: any) { toast(e.message, 'error') }
            }} className="btn-secondary btn-sm">📄 PDF</button>
          </div>
        )}
      </div>

      {loading && <div className="text-center py-12 text-gray-400">Calcul en cours...</div>}

      {data && (
        <div className="grid grid-cols-2 gap-4 flex-1 overflow-auto">
          {/* TVA Facturée */}
          <div className="card p-5">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500"></span>
              TVA Facturée (Collectée)
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="py-2 text-left font-medium text-gray-500">Taux</th>
                  <th className="py-2 text-right font-medium text-gray-500">Montant</th>
                </tr>
              </thead>
              <tbody>
                {(data.collectee ?? []).map((r: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50">
                    <td className="py-2 text-gray-600">{r.tva_rate}</td>
                    <td className="py-2 text-right font-medium">{fmt(r.amount)} MAD</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-gray-600 font-bold">
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right text-red-600">{fmt(data.totalCollectee ?? 0)} MAD</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* TVA Récupérable */}
          <div className="card p-5">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-green-500"></span>
              TVA Récupérable (Déductible)
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="py-2 text-left font-medium text-gray-500">Taux</th>
                  <th className="py-2 text-right font-medium text-gray-500">Montant</th>
                </tr>
              </thead>
              <tbody>
                {(data.recuperable ?? []).map((r: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50">
                    <td className="py-2 text-gray-600">{r.tva_rate}</td>
                    <td className="py-2 text-right font-medium">{fmt(r.amount)} MAD</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-gray-600 font-bold">
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right text-green-700">{fmt(data.totalRecuperable ?? 0)} MAD</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Résultat TVA */}
          <div className="col-span-2">
            <div className={`card p-6 text-center ${(data.tvaDue ?? 0) >= 0 ? 'border-red-200 bg-red-50 dark:bg-red-900/10' : 'border-green-200 bg-green-50 dark:bg-green-900/10'}`}>
              <div className="text-sm text-gray-500 mb-1">
                {(data.tvaDue ?? 0) >= 0 ? 'TVA due à payer' : 'Crédit de TVA'}
              </div>
              <div className={`text-3xl font-bold ${(data.tvaDue ?? 0) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                {fmt(Math.abs(data.tvaDue ?? 0))} MAD
              </div>
              <div className="text-xs text-gray-400 mt-2">
                {fmt(data.totalCollectee ?? 0)} − {fmt(data.totalRecuperable ?? 0)} = {fmt(data.tvaDue ?? 0)} MAD
              </div>
            </div>
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="card p-12 text-center text-gray-400">
          <div className="text-4xl mb-3">🧾</div>
          <div>Sélectionnez une période pour calculer la TVA</div>
        </div>
      )}
    </div>
  )
}
