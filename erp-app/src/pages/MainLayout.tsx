import { useState, useEffect } from 'react'
import { useAuthStore, getSessionStart } from '../store/auth.store'
import { useAppStore } from '../store/app.store'
import NotificationCenter from '../components/NotificationCenter'
import SyncStatusBar from '../components/SyncStatusBar'
import { canAccess } from '../lib/permissions'
import { api } from '../lib/api'
import { emitRefresh } from '../lib/refresh'
import ErrorBoundary from '../components/ErrorBoundary'

// Pages
import DocumentsPage   from './documents/DocumentsPage'
import PartiesPage     from './parties/PartiesPage'
import StockPage       from './stock/StockPage'
import AchatsPage      from './achats/AchatsPage'
import ProductionPage  from './production/ProductionPage'
import ComptaPage      from './comptabilite/ComptaPage'
import RapportsPage    from './rapports/RapportsPage'
import ParamsPage      from './parametres/ParamsPage'
import PaiementsPage   from './paiements/PaiementsPage'

const NAV_ITEMS = [
  { id: 'rapports',     label: 'Rapports',     icon: '📈' },
  { id: 'documents',    label: 'Documents',    icon: '📄' },
  { id: 'paiements',    label: 'Paiements',    icon: '💳' },
  { id: 'parties',      label: 'Parties',      icon: '👥' },
  { id: 'stock',        label: 'Stock',        icon: '📦' },
  { id: 'achats',       label: 'Achats',       icon: '🛒' },
  { id: 'production',   label: 'Production',   icon: '🏭' },
  { id: 'comptabilite', label: 'Comptabilité', icon: '📊' },
] as const

type NavId = typeof NAV_ITEMS[number]['id'] | 'parametres'

export default function MainLayout() {
  const [activeNav, setActiveNav] = useState<NavId>('rapports')
  const [refreshing, setRefreshing] = useState(false)
  const [sessionTime, setSessionTime] = useState(0)
  const { user, logout } = useAuthStore()
  const { theme, toggleTheme } = useAppStore()

  useEffect(() => {
    const start = getSessionStart()
    if (!start) return
    const update = () => setSessionTime(Math.floor((Date.now() - start) / 1000))
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [])

  function fmtTime(s: number) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  }

  function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    emitRefresh()
    setTimeout(() => setRefreshing(false), 800)
  }

  const pages: Record<NavId, JSX.Element> = {
    documents:    <DocumentsPage />,
    paiements:    <PaiementsPage />,
    parties:      <PartiesPage />,
    stock:        <StockPage />,
    achats:       <AchatsPage />,
    production:   <ProductionPage />,
    comptabilite: <ComptaPage />,
    rapports:     <RapportsPage />,
    parametres:   <ParamsPage />,
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-900">
    <header className="bg-primary px-4 h-12 flex items-center gap-2 shrink-0">
      {/* Nav items */}
      <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
        {NAV_ITEMS.filter(item => canAccess(user, item.id)).map(item => (
          <button
            key={item.id}
            onClick={() => setActiveNav(item.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all
              ${activeNav === item.id
                ? 'bg-white text-primary shadow-sm'
                : 'text-primary-100 hover:bg-white/10'
              }`}
          >
            <span className="text-base">{item.icon}</span>
            <span className="hidden lg:block">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Right actions */}
      <div className="flex items-center gap-1 ml-auto">
        <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-white/10 text-primary-100">
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <button onClick={handleRefresh} title="Actualiser"
          className={`p-2 rounded-lg hover:bg-white/10 text-primary-100 text-base transition-transform ${refreshing ? 'animate-spin' : ''}`}>
          🔄
        </button>
        <NotificationCenter />
        {canAccess(user, 'parametres') && (
          <button
            onClick={() => setActiveNav('parametres')}
            title="Paramètres"
            className={`p-2 rounded-lg transition-all text-base
              ${activeNav === 'parametres'
                ? 'bg-white text-primary shadow-sm'
                : 'hover:bg-white/10 text-primary-100'}`}>
            ⚙️
          </button>
        )}
        <div className="flex items-center gap-2 pl-2 border-l border-white/20">
          <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold">
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="hidden xl:flex flex-col items-start">
            <span className="text-xs font-medium text-white leading-tight">{user?.name}</span>
            {sessionTime > 0 && (
              <span className="text-[10px] text-primary-100 font-mono leading-tight">⏱ {fmtTime(sessionTime)}</span>
            )}
          </div>
          <button onClick={async () => {
              const store = useAuthStore.getState()
              await api.logout({ userId: store.user?.id, sessionId: store.sessionId } as any).catch(() => {})
              logout()
            }}
            className="text-xs text-primary-100 hover:text-white ml-1">
            ⏻
          </button>
        </div>
      </div>
    </header>

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        <ErrorBoundary>
          {canAccess(user, activeNav)
            ? pages[activeNav]
            : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <div className="text-5xl mb-4">🔒</div>
                <div className="font-semibold text-lg">Accès refusé</div>
                <div className="text-sm mt-1">Vous n'avez pas les droits pour accéder à cette page</div>
              </div>
            )
          }
        </ErrorBoundary>
      </main>
      <SyncStatusBar />
    </div>
  )
}
