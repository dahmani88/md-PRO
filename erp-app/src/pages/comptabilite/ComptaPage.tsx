import { useState } from 'react'
import PlanComptable from './PlanComptable'
import JournalView from './JournalView'
import GrandLivreView from './GrandLivreView'
import BalanceView from './BalanceView'
import TvaView from './TvaView'

const TABS = [
  { id: 'plan',    label: 'Plan Comptable' },
  { id: 'journal', label: 'Journal' },
  { id: 'grand',   label: 'Grand Livre' },
  { id: 'balance', label: 'Balance' },
  { id: 'tva',     label: 'Déclaration TVA' },
] as const

export default function ComptaPage() {
  const [tab, setTab] = useState<string>('plan')
  return (
    <div className="h-full flex flex-col">
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sticky top-0 z-10">
        <div className="flex gap-1 py-1.5 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all
                ${tab === t.id
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm border border-gray-200 dark:border-gray-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 flex-1 min-h-0 overflow-auto">
        {tab === 'plan'    && <PlanComptable />}
        {tab === 'journal' && <JournalView />}
        {tab === 'grand'   && <GrandLivreView />}
        {tab === 'balance' && <BalanceView />}
        {tab === 'tva'     && <TvaView />}
      </div>
    </div>
  )
}
