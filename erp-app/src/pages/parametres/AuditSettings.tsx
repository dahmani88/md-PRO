import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Pagination from '../../components/ui/Pagination'

const ACTION_LABELS: Record<string, string> = {
  CREATE: '➕ Création',
  UPDATE: '✏️ Modification',
  DELETE: '🗑️ Suppression',
  CONFIRM: '✅ Confirmation',
  CANCEL: '❌ Annulation',
  LOGIN: '🔑 Connexion',
  LOGOUT: '🚪 Déconnexion',
  PAYMENT: '💳 Paiement',
  APPLY_STOCK: '📦 Stock appliqué',
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'badge-green',
  UPDATE: 'badge-blue',
  DELETE: 'badge-red',
  CONFIRM: 'badge-green',
  CANCEL: 'badge-red',
  LOGIN: 'badge-gray',
  LOGOUT: 'badge-gray',
  PAYMENT: 'badge-orange',
  APPLY_STOCK: 'badge-blue',
}

export default function AuditSettings() {
  const [rows, setRows]         = useState<any[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(false)
  const [users, setUsers]       = useState<any[]>([])
  const [filters, setFilters]   = useState({
    start_date: '', end_date: '', action: '', user_id: '',
  })
  const [expanded, setExpanded] = useState<number | null>(null)

  const LIMIT = 50

  useEffect(() => {
    api.getAuditUsers().then(setUsers).catch(() => {})
  }, [])

  useEffect(() => {
    load()
  }, [page])

  useEffect(() => {
    const h = () => { api.getAuditUsers().then(setUsers).catch(() => {}); load() }
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [])

  async function load() {
    setLoading(true)
    try {
      const result = await api.getAuditLog({
        ...filters,
        user_id: filters.user_id ? Number(filters.user_id) : undefined,
        page,
        limit: LIMIT,
      }) as any
      setRows(result.rows ?? [])
      setTotal(result.total ?? 0)
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function handleSearch() {
    setPage(1)
    load()
  }

  return (
    <div className="max-w-5xl">
      <h2 className="text-lg font-semibold mb-4">Journal d'Audit</h2>

      {/* Filtres */}
      <div className="card p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Du</label>
          <input type="date" value={filters.start_date}
            onChange={e => setFilters(f => ({ ...f, start_date: e.target.value }))}
            className="input w-36" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Au</label>
          <input type="date" value={filters.end_date}
            onChange={e => setFilters(f => ({ ...f, end_date: e.target.value }))}
            className="input w-36" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Action</label>
          <select value={filters.action}
            onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
            className="input w-40">
            <option value="">Toutes</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Utilisateur</label>
          <select value={filters.user_id}
            onChange={e => setFilters(f => ({ ...f, user_id: e.target.value }))}
            className="input w-40">
            <option value="">Tous</option>
            {users.map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <button onClick={handleSearch} className="btn-primary btn-sm">
          🔍 Filtrer
        </button>
        <button onClick={() => { setFilters({ start_date: '', end_date: '', action: '', user_id: '' }); setPage(1); }} className="btn-secondary btn-sm">
          ✕ Réinitialiser
        </button>
        <span className="text-xs text-gray-400 ml-auto">{total} entrée(s)</span>
      </div>

      {/* Tableau */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">Chargement...</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400">
            <div className="text-3xl mb-2">📋</div>
            <div className="text-sm">Aucune entrée d'audit</div>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Utilisateur</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Action</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Table</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Détails</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map((row: any) => (
                  <>
                    <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString('fr-FR')}
                      </td>
                      <td className="px-4 py-2 font-medium">{row.user_name ?? '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[row.action] ?? 'badge-gray'}`}>
                          {ACTION_LABELS[row.action] ?? row.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">{row.table_name}</td>
                      <td className="px-4 py-2 text-xs text-gray-400">{row.record_id ?? '—'}</td>
                      <td className="px-4 py-2">
                        {(row.new_values || row.old_values) && (
                          <button
                            onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                            className="text-xs text-primary hover:underline">
                            {expanded === row.id ? '▲ Masquer' : '▼ Voir'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === row.id && (
                      <tr key={`${row.id}-detail`} className="bg-gray-50 dark:bg-gray-800/50">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            {row.old_values && (
                              <div>
                                <div className="font-semibold text-red-500 mb-1">Avant</div>
                                <pre className="bg-red-50 dark:bg-red-900/10 p-2 rounded text-gray-600 dark:text-gray-300 overflow-auto max-h-32">
                                  {JSON.stringify(row.old_values, null, 2)}
                                </pre>
                              </div>
                            )}
                            {row.new_values && (
                              <div>
                                <div className="font-semibold text-green-500 mb-1">Après</div>
                                <pre className="bg-green-50 dark:bg-green-900/10 p-2 rounded text-gray-600 dark:text-gray-300 overflow-auto max-h-32">
                                  {JSON.stringify(row.new_values, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
            <Pagination page={page} total={total} limit={LIMIT} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}
