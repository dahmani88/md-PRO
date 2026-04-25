import { useState } from 'react'
import { useAuthStore } from '../store/auth.store'
import { useAppStore } from '../store/app.store'
import NotificationCenter from '../components/NotificationCenter'
import SyncStatusBar from '../components/SyncStatusBar'
import { canAccess } from '../lib/permissions'
import { api } from '../lib/api'
import { emitRefresh } from '../lib/refresh'
import ErrorBoundary from '../components/ErrorBoundary'
import Modal from '../components/ui/Modal'
import { toast } from '../components/ui/Toast'

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
  const { user, logout } = useAuthStore()
  const { theme, toggleTheme } = useAppStore()

  const firstAllowed = NAV_ITEMS.find(item => canAccess(user, item.id))?.id ?? 'rapports'
  const [activeNav, setActiveNav] = useState<NavId>(firstAllowed)

  const [refreshing, setRefreshing] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (pwForm.next !== pwForm.confirm) { toast('Les mots de passe ne correspondent pas', 'error'); return }
    if (pwForm.next.length < 6) { toast('Minimum 6 caractères', 'error'); return }
    setPwSaving(true)
    try {
      await api.login({ email: user!.email, password: pwForm.current })
      await api.updateUser({
        id: user!.id,
        name: user!.name,
        email: user!.email,
        role: user!.role,
        is_active: 1,
        password: pwForm.next,
        permissions: (user as any).permissions ?? [],
      })
      toast('Mot de passe modifié avec succès')
      setShowPwModal(false)
      setPwForm({ current: '', next: '', confirm: '' })
    } catch (e: any) {
      toast(e.message?.includes('incorrect') ? 'Mot de passe actuel incorrect' : e.message, 'error')
    } finally {
      setPwSaving(false)
    }
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
            <span className="text-[10px] text-primary-100 leading-tight">{user?.role}</span>
          </div>
          <button
            onClick={() => setShowPwModal(true)}
            title="Changer le mot de passe"
            className="p-1.5 rounded-lg hover:bg-white/10 text-primary-100 text-sm">
            🔒
          </button>
          <button onClick={async () => {
              const store = useAuthStore.getState()
              await api.logout({ userId: store.user?.id, sessionId: store.sessionId }).catch(() => {})
              logout()
            }}
            className="text-xs text-primary-100 hover:text-white ml-1">
            ⏻
          </button>
        </div>
      </div>
    </header>

      {/* Page content */}
      <main className="flex-1 min-h-0 overflow-auto">
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

      {/* Modal — Changer mot de passe */}
      <Modal open={showPwModal} onClose={() => { setShowPwModal(false); setPwForm({ current: '', next: '', confirm: '' }) }}
        title="Changer le mot de passe" size="sm">
        <form onSubmit={handleChangePassword} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mot de passe actuel</label>
            <input type="password" value={pwForm.current}
              onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
              className="input" placeholder="••••••••" required autoFocus autoComplete="current-password" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nouveau mot de passe</label>
            <input type="password" value={pwForm.next}
              onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
              className="input" placeholder="Min. 6 caractères" required autoComplete="new-password" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Confirmer</label>
            <input type="password" value={pwForm.confirm}
              onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
              className={`input ${pwForm.confirm && pwForm.confirm !== pwForm.next ? 'border-red-400' : ''}`}
              placeholder="••••••••" required autoComplete="new-password" />
            {pwForm.confirm && pwForm.confirm !== pwForm.next && (
              <p className="text-xs text-red-500 mt-1">Les mots de passe ne correspondent pas</p>
            )}
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setShowPwModal(false)} className="btn-secondary flex-1 justify-center">Annuler</button>
            <button type="submit"
              disabled={pwSaving || !pwForm.current || !pwForm.next || pwForm.next !== pwForm.confirm}
              className="btn-primary flex-1 justify-center disabled:opacity-50">
              {pwSaving ? '...' : '🔒 Modifier'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
