import { useState } from 'react'
import ProductionList from './ProductionList'
import TransformationList from './TransformationList'
import BomList from './BomList'

const TABS = [
  { id: 'orders',    label: '🏭 Ordres de Production' },
  { id: 'bom',       label: '📋 Nomenclatures (BOM)' },
  { id: 'transform', label: '🔄 Transformation' },
] as const

type TabId = typeof TABS[number]['id']

export default function ProductionPage() {
  const [tab, setTab] = useState<TabId>('orders')
  return (
    <div className="h-full flex flex-col">
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sticky top-0 z-10">
        <div className="flex gap-1 py-1.5">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all
                ${tab === t.id
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm border border-gray-200 dark:border-gray-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60 dark:hover:bg-gray-700/50'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 flex-1 min-h-0 overflow-auto">
        {tab === 'orders'    && <ProductionList />}
        {tab === 'bom'       && <BomList />}
        {tab === 'transform' && <TransformationList />}
      </div>
    </div>
  )
}
