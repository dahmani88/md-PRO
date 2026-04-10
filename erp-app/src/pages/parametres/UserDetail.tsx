import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useAuthStore, isUserOnline, getSessionStart } from '../../store/auth.store'

const ALL_PAGES = [
  { id: 'rapports', label: 'Rapports', icon: '📈' },
  { id: 'documents', label: 'Documents', icon: '📄' },
  { id: 'paiements', label: 'Paiements', icon: '💳' },
  { id: 'parties', label: 'Parties', icon: '👥' },
  { id: 'stock', label: 'Stock', icon: '📦' },
  { id: 'achats', label: 'Achats', icon: '🛒' },
  { id: 'production', label: 'Production', icon: '🏭' },
  { id: 'comptabilite', label: 'Comptabilité', icon: '📊' },
  { id: 'parametres', label: 'Paramètres', icon: '⚙️' },
]

const ACTION_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  CREATE:      { label: 'Création',       color: 'text-green-600',  icon: '➕' },
  CONFIRM:     { label: 'Confirmation',   color: 'text-blue-600',   icon: '✅' },
  CANCEL:      { label: 'Annulation',     color: 'text-red-500',    icon: '❌' },
  PAYMENT:     { label: 'Paiement',       color: 'text-amber-600',  icon: '💳' },
  LOGIN:       { label: 'Connexion',      color: 'text-gray-500',   icon: '🔑' },
  UPDATE:      { label: 'Modification',   color: 'text-blue-500',   icon: '✏️' },
  DELETE:      { label: 'Suppression',    color: 'text-red-600',    icon: '🗑️' },
  APPLY_STOCK: { label: 'Stock appliqué', color: 'text-purple-600', icon: '📦' },
  DUPLICATE:   { label: 'Duplication',    color: 'text-indigo-500', icon: '📋' },
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur', accountant: 'Comptable', sales: 'Commercial', warehouse: 'Magasinier',
}

interface Props { userId: number; isOnline: boolean; onClose: () => void }

export default function UserDetail({ userId, isOnline: _isOnline, onClose }: Props) {
  const { user: currentUser } = useAuthStore()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'activity' | 'access'>('overview')
  const [sessionTime, setSessionTime] = useState(0)

  const online = isUserOnline(userId)
  const isSelf = userId === currentUser?.id

  useEffect(() => {
    setLoading(true)
    const fallback = () => api.getUsers().then((users: any) => {
      const u = (users ?? []).find((x: any) => x.id === userId)
      if (u) setData({ user: u, stats: { totalActions: 0, docsCreated: 0, paymentsCreated: 0, loginCount: 0, activeDaysLast30: 0, monthHours: 0 }, actionsBreakdown: [], recentActivity: [], last7Days: [] })
    }).finally(() => setLoading(false))

    api.getUserStats(userId)
      .then((r: any) => { if (r && r.user) { setData(r); setLoading(false) } else fallback() })
      .catch(() => fallback())
  }, [userId])

  // عداد الجلسة الحالية (فقط للمستخدم الحالي)
  useEffect(() => {
    if (!isSelf) return
    const start = getSessionStart()
    if (!start) return
    const update = () => setSessionTime(Math.floor((Date.now() - start) / 1000))
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [isSelf])

  function fmtTime(s: number) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`
    return `${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`
  }

  function fmtDate(d: string) {
    return new Date(d.endsWith('Z') ? d : d + 'Z')
      .toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  if (loading) return (
    <div className="p-8 text-center text-gray-400 animate-pulse">
      <div className="text-3xl mb-2">👤</div>
      <div className="text-sm">Chargement...</div>
    </div>
  )
  if (!data) return null

  const { user, stats, actionsBreakdown, recentActivity, last7Days = [], busiestDay, dailySessions = [], allTimeSessions } = data
  const fmt = (n: number) => new Intl.NumberFormat('fr-MA').format(n ?? 0)

  const TABS = [
    { id: 'overview', label: 'Vue d\'ensemble', icon: '📊' },
    { id: 'activity', label: 'Activité',        icon: '⚡' },
    { id: 'temps',    label: 'Temps',           icon: '⏱️' },
    { id: 'access',   label: 'Accès',           icon: '🔐' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 pb-0">
        <div className="flex items-start gap-4 mb-5">
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white text-xl font-bold">
              {user.name[0]?.toUpperCase()}
            </div>
            <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white dark:border-gray-800 ${online ? 'bg-green-500' : 'bg-gray-300'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{user.name}</h2>
              {isSelf && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Vous</span>}
              {online
                ? <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-2 py-0.5 rounded-full font-medium">● En ligne</span>
                : <span className="text-xs bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 px-2 py-0.5 rounded-full">Hors ligne</span>
              }
            </div>
            <div className="text-sm text-gray-500 mt-0.5">{user.email}</div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-gray-400">
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${user.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500'}`}>
                {user.is_active ? '✓ Actif' : '✗ Inactif'}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-px
                ${tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* ── Vue d'ensemble ── */}
        {tab === 'overview' && (
          <>
            {/* Compteur session en cours */}
            {isSelf && sessionTime > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center gap-3">
                <div className="text-2xl">⏱️</div>
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Session en cours</div>
                  <div className="text-2xl font-mono font-bold text-primary">{fmtTime(sessionTime)}</div>
                </div>
              </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Actions totales',    value: fmt(stats.totalActions),        icon: '⚡', color: 'text-primary' },
                { label: 'Documents créés',    value: fmt(stats.docsCreated),         icon: '📄', color: 'text-blue-600' },
                { label: 'Paiements',          value: fmt(stats.paymentsCreated),     icon: '💳', color: 'text-green-600' },
                { label: 'Connexions',         value: fmt(stats.loginCount),          icon: '🔑', color: 'text-amber-600' },
                { label: 'Jours actifs (30j)', value: (stats.activeDaysLast30 ?? 0) + ' j', icon: '📅', color: 'text-indigo-600' },
                { label: 'Temps ce mois', value: (() => {
            const h = Math.floor((stats.monthHours ?? 0))
            const totalSec = (stats.monthHours ?? 0) * 3600
            const m = Math.floor((totalSec % 3600) / 60)
            if (h === 0 && m === 0) return '< 1 min'
            if (h === 0) return m + ' min'
            return h + 'h ' + String(m).padStart(2,'0') + 'm'
          })(), icon: '⏱️', color: 'text-purple-600' },
              ].map(k => (
                <div key={k.label} className="card p-3 flex items-center gap-3">
                  <span className="text-xl">{k.icon}</span>
                  <div>
                    <div className={`text-lg font-bold ${k.color}`}>{k.value}</div>
                    <div className="text-xs text-gray-400">{k.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Activité 7 jours */}
            {last7Days.length > 0 && (
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center justify-between">
                  <span>Activité — 7 derniers jours</span>
                  {busiestDay && <span className="text-xs text-gray-400">Pic: {busiestDay.day} ({busiestDay.count})</span>}
                </div>
                <div className="flex items-end gap-1 h-16">
                  {(() => {
                    const days: string[] = []
                    for (let i = 6; i >= 0; i--) {
                      const d = new Date(); d.setDate(d.getDate() - i)
                      days.push(d.toISOString().split('T')[0])
                    }
                    const max = Math.max(...last7Days.map((d: any) => d.count), 1)
                    return days.map(day => {
                      const entry = last7Days.find((d: any) => d.day === day)
                      const count = entry?.count ?? 0
                      const pct = Math.max((count / max) * 100, count > 0 ? 8 : 0)
                      return (
                        <div key={day} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full flex items-end justify-center" style={{ height: '48px' }}>
                            <div className={`w-full rounded-t transition-all ${count > 0 ? 'bg-primary' : 'bg-gray-100 dark:bg-gray-700'}`}
                              style={{ height: `${pct}%` }} title={`${count} actions`} />
                          </div>
                          <span className="text-[9px] text-gray-400">
                            {new Date(day).toLocaleDateString('fr-FR', { weekday: 'short' })}
                          </span>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            )}

            {/* Infos */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-gray-500">Membre depuis</span>
                <span className="font-medium">{new Date(user.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Dernier accès</span>
                <span className="font-medium text-gray-700 dark:text-gray-200">
                  {user.last_login ? fmtDate(user.last_login) : <span className="text-gray-400">Jamais connecté</span>}
                </span>
              </div>
            </div>
          </>
        )}

        {/* ── Activité ── */}
        {tab === 'activity' && (
          <>
            {/* Répartition par catégorie */}
            {actionsBreakdown.length > 0 && (() => {
              const categories = [
                { label: 'Documents',   actions: ['CREATE','CONFIRM','CANCEL','UPDATE'], icon: '📄', color: 'bg-blue-500' },
                { label: 'Paiements',   actions: ['PAYMENT'],                            icon: '💳', color: 'bg-green-500' },
                { label: 'Stock',       actions: ['APPLY_STOCK'],                        icon: '📦', color: 'bg-purple-500' },
                { label: 'Connexions',  actions: ['LOGIN','LOGOUT'],                     icon: '🔑', color: 'bg-gray-400' },
                { label: 'Autres',      actions: ['DELETE','DUPLICATE'],                 icon: '⚙️', color: 'bg-amber-500' },
              ]
              const catTotals = categories.map(cat => ({
                ...cat,
                count: actionsBreakdown.filter((a: any) => cat.actions.includes(a.action)).reduce((s: number, a: any) => s + a.count, 0)
              })).filter(c => c.count > 0)
              const max = Math.max(...catTotals.map(c => c.count), 1)
              return (
                <div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Par catégorie</div>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {catTotals.map(c => (
                      <div key={c.label} className="card p-3 flex items-center gap-2">
                        <span className="text-lg">{c.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-500">{c.label}</div>
                          <div className="font-bold text-gray-800 dark:text-gray-100">{c.count}</div>
                        </div>
                        <div className="w-1.5 h-8 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                          <div className={`w-full ${c.color} rounded-full transition-all`} style={{ height: `${Math.round((c.count/max)*100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Détail</div>
                  <div className="space-y-2">
                    {actionsBreakdown.map((a: any) => {
                      const cfg = ACTION_LABELS[a.action] ?? { label: a.action, color: 'text-gray-500', icon: '•' }
                      const pct = stats.totalActions > 0 ? Math.round((a.count / stats.totalActions) * 100) : 0
                      return (
                        <div key={a.action} className="flex items-center gap-3 text-sm">
                          <span className="text-base w-6 text-center">{cfg.icon}</span>
                          <span className={`w-28 shrink-0 font-medium ${cfg.color}`}>{cfg.label}</span>
                          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                            <div className="bg-primary h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-gray-500 text-xs w-14 text-right">{a.count} · {pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Activité récente */}
            <div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Activité récente</div>
              {recentActivity.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-6">Aucune activité enregistrée</div>
              ) : (
                <div className="space-y-0">
                  {recentActivity.map((a: any, i: number) => {
                    const cfg = ACTION_LABELS[a.action] ?? { label: a.action, color: 'text-gray-500', icon: '•' }
                    const tableLabels: Record<string, string> = {
                      documents: 'Document', payments: 'Paiement', clients: 'Client',
                      suppliers: 'Fournisseur', products: 'Produit', users: 'Utilisateur',
                    }
                    const refLabel = (a as any).ref_label
                    const newVals = a.new_values ? (() => { try { return typeof a.new_values === 'string' ? JSON.parse(a.new_values) : a.new_values } catch { return null } })() : null
                    const docRef = refLabel ?? newVals?.number ?? newVals?.name ?? ''
                    const tableLabel = tableLabels[a.table_name] ?? a.table_name
                    const description = docRef ? `${tableLabel} — ${docRef}` : tableLabel
                    return (
                      <div key={i} className="flex items-center gap-3 py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                        <span className="text-base w-6 text-center shrink-0">{cfg.icon}</span>
                        <div className="flex-1 min-w-0">
                          <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                          <span className="text-xs text-gray-500 ml-2">{description}</span>
                        </div>
                        <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">{fmtDate(a.created_at)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Temps ── */}
        {tab === 'temps' && (
          <>
            {/* Résumé */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total toutes sessions', value: (() => {
                    const s = allTimeSessions?.t ?? 0
                    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60)
                    return h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : m > 0 ? `${m} min` : '—'
                  })(), icon: '⏱️', color: 'text-purple-600' },
                { label: 'Sessions enregistrées', value: String(allTimeSessions?.c ?? 0), icon: '🔑', color: 'text-amber-600' },
              ].map(k => (
                <div key={k.label} className="card p-3 flex items-center gap-3">
                  <span className="text-xl">{k.icon}</span>
                  <div>
                    <div className={`text-lg font-bold ${k.color}`}>{k.value}</div>
                    <div className="text-xs text-gray-400">{k.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tableau des jours */}
            {dailySessions.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <div className="text-3xl mb-2">📅</div>
                <div className="text-sm">Aucune session enregistrée</div>
                <div className="text-xs mt-1 text-gray-300">Les sessions seront enregistrées à partir de maintenant</div>
              </div>
            ) : (
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Historique — 30 derniers jours</div>
                <div className="space-y-1">
                  {dailySessions.map((d: any) => {
                    const h = Math.floor(d.total_seconds / 3600)
                    const m = Math.floor((d.total_seconds % 3600) / 60)
                    const timeStr = h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : m > 0 ? `${m} min` : '< 1 min'
                    const maxSec = Math.max(...dailySessions.map((x: any) => x.total_seconds), 1)
                    const pct = Math.max((d.total_seconds / maxSec) * 100, d.total_seconds > 0 ? 4 : 0)
                    const dayLabel = new Date(d.day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
                    return (
                      <div key={d.day} className="flex items-center gap-3 py-1.5">
                        <span className="text-xs text-gray-500 w-28 shrink-0">{dayLabel}</span>
                        <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                          <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 w-16 text-right">{timeStr}</span>
                        <span className="text-xs text-gray-400 w-16 text-right">{d.sessions} session{d.sessions > 1 ? 's' : ''}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Accès ── */}
        {tab === 'access' && (
          <>
            <div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Modules accessibles</div>
              {user.role === 'admin' ? (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">
                  🔓 Accès complet à tous les modules
                </div>
              ) : (user.permissions ?? []).length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-6">Aucun accès configuré</div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {ALL_PAGES.map(p => {
                    const hasAccess = (user.permissions ?? []).includes(p.id)
                    return (
                      <div key={p.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all
                        ${hasAccess
                          ? 'bg-primary/5 border-primary/20 text-gray-700 dark:text-gray-200'
                          : 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700 text-gray-400 opacity-50'}`}>
                        <span className="text-lg">{p.icon}</span>
                        <span className="text-sm font-medium">{p.label}</span>
                        <span className="ml-auto text-xs">{hasAccess ? '✓' : '✗'}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
