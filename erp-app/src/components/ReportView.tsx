/**
 * ReportView — مكون تقارير مشترك يُستخدم في كل وحدة
 * يقبل قائمة تقارير خاصة بالوحدة ويعرضها مع فلاتر وتصدير Excel
 */
import { useState } from 'react'
import { api } from '../lib/api'
import { toast } from './ui/Toast'

export interface ReportDef {
  id: string
  icon: string
  label: string
  desc?: string
  /** فلاتر إضافية ثابتة تُمرر دائماً */
  fixedFilters?: Record<string, any>
  /** هل يحتاج فلتر تاريخ */
  dateFilter?: boolean
  /** هل يحتاج فلتر طرف (client/supplier) */
  partyFilter?: 'client' | 'supplier' | false
}

interface Props {
  reports: ReportDef[]
  /** عنوان القسم */
  title?: string
}

const COL_LABELS: Record<string, string> = {
  number: 'Numéro', date: 'Date', client_name: 'Client', supplier_name: 'Fournisseur',
  party_name: 'Partie', total_ht: 'Total HT', total_tva: 'TVA', total_ttc: 'Total TTC',
  payment_status: 'Statut paiement', status: 'Statut', quantity: 'Quantité',
  unit_price: 'Prix unit.', tva_rate: 'TVA%', product_name: 'Produit',
  product_code: 'Code', unit: 'Unité', stock_quantity: 'Stock', cmup_price: 'CMUP',
  stock_value: 'Valeur stock', min_stock: 'Stock min', is_low: 'Alerte',
  balance: 'Solde', total_invoiced: 'Total facturé', total_paid: 'Total payé',
  amount: 'Montant', method: 'Mode', due_date: 'Échéance', cheque_number: 'N° chèque',
  bank: 'Banque', code: 'Code', name: 'Intitulé', type: 'Type', class: 'Classe',
  total_debit: 'Total débit', total_credit: 'Total crédit',
  tva_rate_label: 'Taux TVA', base_ht: 'Base HT', tva_amount: 'Montant TVA',
  revenues: 'Produits', expenses: 'Charges', result: 'Résultat',
  phone: 'Téléphone', ice: 'ICE',
}

function formatCell(key: string, val: any): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'number') {
    if (key.includes('rate') || key.includes('pct') || key === 'is_low') return String(val)
    return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(val)
  }
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
    return new Date(val).toLocaleDateString('fr-FR')
  }
  if (typeof val === 'boolean') return val ? 'Oui' : 'Non'
  return String(val)
}

export default function ReportView({ reports, title }: Props) {
  const [selected, setSelected] = useState(reports[0]?.id ?? '')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [hasLoaded, setHasLoaded] = useState(false)

  const currentReport = reports.find(r => r.id === selected)

  async function loadReport(reportId: string) {
    const report = reports.find(r => r.id === reportId)
    if (!report) return
    setSelected(reportId)
    setLoading(true)
    setHasLoaded(true)
    try {
      const filters: Record<string, any> = {
        ...(report.fixedFilters ?? {}),
        ...(startDate ? { start_date: startDate } : {}),
        ...(endDate   ? { end_date:   endDate   } : {}),
      }
      const result = await api.getReport({ type: reportId, filters }) as any

      // P&L retourne un objet structuré
      if (reportId === 'profit_loss') {
        const rows = [
          ...(result.revenues ?? []).map((r: any) => ({ ...r, _section: 'Produits' })),
          ...(result.expenses ?? []).map((r: any) => ({ ...r, _section: 'Charges' })),
          { code: '', name: 'RÉSULTAT NET', amount: result.result ?? 0, _section: 'Résultat' },
        ]
        setData(rows)
      } else {
        setData(Array.isArray(result) ? result : [])
      }
    } catch (e: any) {
      toast(e.message, 'error')
      setData([])
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    if (!data.length) return
    try {
      await api.excelExportReport({
        type: selected,
        rows: data,
        filters: { start_date: startDate, end_date: endDate },
      })
      toast('✅ Fichier Excel enregistré')
    } catch (e: any) { toast(e.message, 'error') }
  }

  const visibleKeys = data.length > 0
    ? Object.keys(data[0]).filter(k => !k.startsWith('_'))
    : []

  const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)

  // Calcul totaux pour colonnes numériques
  const numericKeys = visibleKeys.filter(k =>
    data.length > 0 && typeof data[0][k] === 'number' &&
    !['tva_rate', 'class', 'is_low'].includes(k)
  )
  const totals = numericKeys.reduce((acc, k) => {
    acc[k] = data.reduce((s, r) => s + (Number(r[k]) || 0), 0)
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="h-full flex flex-col gap-3">
      {title && (
        <div className="text-sm font-semibold text-gray-600 dark:text-gray-400">{title}</div>
      )}

      {/* Sélecteur de rapport */}
      <div className="flex gap-1.5 flex-wrap">
        {reports.map(r => (
          <button
            key={r.id}
            onClick={() => loadReport(r.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
              ${selected === r.id
                ? 'bg-primary text-white shadow-sm'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            <span>{r.icon}</span>
            <span>{r.label}</span>
          </button>
        ))}
      </div>

      {/* Filtres */}
      {currentReport?.dateFilter !== false && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-500">Période:</span>
          <input
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="input w-36 text-sm"
            type="date"
          />
          <span className="text-gray-400 text-xs">→</span>
          <input
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="input w-36 text-sm"
            type="date"
          />
          <button
            onClick={() => loadReport(selected)}
            className="btn-primary btn-sm"
          >
            ↻ Actualiser
          </button>
          {data.length > 0 && (
            <button onClick={handleExport} className="btn-secondary btn-sm ml-auto">
              📥 Excel
            </button>
          )}
        </div>
      )}

      {/* Résultats */}
      <div className="card flex-1 overflow-auto">
        {!hasLoaded && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <span className="text-4xl">{currentReport?.icon ?? '📊'}</span>
            <span className="font-medium">{currentReport?.label}</span>
            <span className="text-sm">{currentReport?.desc}</span>
            <button onClick={() => loadReport(selected)} className="btn-primary btn-sm mt-2">
              Charger le rapport
            </button>
          </div>
        )}

        {hasLoaded && loading && (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <div className="text-2xl mb-2 animate-spin">⏳</div>
              <div className="text-sm">Chargement...</div>
            </div>
          </div>
        )}

        {hasLoaded && !loading && data.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <span className="text-3xl">{currentReport?.icon ?? '📊'}</span>
            <span className="font-medium">Aucune donnée</span>
            <span className="text-sm">Ajustez la période et actualisez</span>
          </div>
        )}

        {hasLoaded && !loading && data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
              <tr>
                {visibleKeys.map(k => (
                  <th key={k} className="px-3 py-2.5 text-left font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap text-xs">
                    {COL_LABELS[k] ?? k.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.map((row, i) => (
                <tr
                  key={i}
                  className={`hover:bg-gray-50 dark:hover:bg-gray-700/30
                    ${row._section === 'Résultat' ? 'bg-primary/5 font-bold' : ''}
                    ${row._section === 'Produits' ? 'text-green-700 dark:text-green-400' : ''}
                    ${row._section === 'Charges'  ? 'text-red-600 dark:text-red-400' : ''}`}
                >
                  {visibleKeys.map(k => (
                    <td key={k} className="px-3 py-2 whitespace-nowrap text-xs">
                      {typeof row[k] === 'number' && !['tva_rate', 'class', 'is_low'].includes(k)
                        ? <span className="font-medium">{fmt(row[k])}</span>
                        : formatCell(k, row[k])
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {/* Ligne totaux */}
            {numericKeys.length > 0 && (
              <tfoot className="bg-gray-100 dark:bg-gray-700/70 sticky bottom-0 z-10">
                <tr>
                  {visibleKeys.map((k, i) => (
                    <td key={k} className="px-3 py-2 text-xs font-bold whitespace-nowrap">
                      {i === 0 ? `Total (${data.length})` : numericKeys.includes(k) ? fmt(totals[k]) : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  )
}
