import { useState } from 'react'
import InvoicesList from './InvoicesList'

const DOC_TYPES = [
  { id: 'invoice',  label: 'Factures',         icon: '🧾' },
  { id: 'quote',    label: 'Devis',             icon: '📋' },
  { id: 'bl',       label: 'Bons de Livraison', icon: '🚚' },
  { id: 'proforma', label: 'Proforma',          icon: '📄' },
  { id: 'avoir',    label: 'Avoirs',            icon: '↩️' },
] as const

type DocTypeId = typeof DOC_TYPES[number]['id']

export default function DocumentsPage() {
  const [activeType, setActiveType] = useState<DocTypeId>('invoice')

  return (
    <div className="h-full flex flex-col">
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sticky top-0 z-10">
        <div className="flex gap-1 py-1.5 overflow-x-auto">
          {DOC_TYPES.map(d => (
            <button key={d.id} onClick={() => setActiveType(d.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all
                ${activeType === d.id
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm border border-gray-200 dark:border-gray-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/50'}`}>
              {d.icon} {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 flex-1 min-h-0 overflow-auto">
        <InvoicesList docType={activeType} />
      </div>
    </div>
  )
}
