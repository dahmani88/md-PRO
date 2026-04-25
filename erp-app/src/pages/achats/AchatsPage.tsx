import { useState } from 'react'
import PurchaseOrdersList from './PurchaseOrdersList'
import ReceptionsList from './ReceptionsList'
import PurchaseInvoicesList from './PurchaseInvoicesList'
import ImportInvoicesList from './ImportInvoicesList'

const TABS = [
  { id: 'orders',     label: 'Bons de Commande',      icon: '🛒' },
  { id: 'receptions', label: 'Bons de Réception',      icon: '📦' },
  { id: 'invoices',   label: 'Factures Fournisseurs',  icon: '🧾', badge: 'Local' },
  { id: 'imports',    label: 'Importations',            icon: '🌍', badge: 'Landed Cost' },
] as const

export default function AchatsPage() {
  const [tab, setTab] = useState<string>('orders')
  return (
    <div className="h-full flex flex-col">
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sticky top-0 z-10">
        <div className="flex gap-1 py-1.5 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5
                ${tab === t.id
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm border border-gray-200 dark:border-gray-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'}`}>
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {'badge' in t && t.badge && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none
                  ${t.id === 'imports'
                    ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-600 dark:text-gray-300'}`}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 flex-1 min-h-0 overflow-auto">
        {tab === 'orders'     && <PurchaseOrdersList />}
        {tab === 'receptions' && <ReceptionsList />}
        {tab === 'invoices'   && <PurchaseInvoicesList />}
        {tab === 'imports'    && <ImportInvoicesList />}
      </div>
    </div>
  )
}
