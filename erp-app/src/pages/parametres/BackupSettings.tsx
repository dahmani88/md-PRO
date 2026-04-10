import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'

export default function BackupSettings() {
  const [backups, setBackups] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => { loadBackups() }, [])

  useEffect(() => {
    const h = () => loadBackups()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [])

  async function loadBackups() {
    setLoading(true)
    try { setBackups(await api.listBackups() as any[]) }
    finally { setLoading(false) }
  }

  async function handleCreate() {
    setCreating(true)
    try {
      const result = await api.createBackup() as any
      toast(`Sauvegarde créée: ${result.timestamp}`)
      loadBackups()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleRestore(path: string) {
    if (!confirm('⚠️ Cette action remplacera toutes les données actuelles. Continuer ?')) return
    try {
      await api.restoreBackup(path)
      toast('Restauration effectuée — Redémarrez l\'application', 'warning')
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Sauvegarde & Restauration</h2>
        <button onClick={handleCreate} disabled={creating} className="btn-primary">
          {creating ? 'Sauvegarde...' : '💾 Sauvegarder maintenant'}
        </button>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4 text-sm text-blue-700 dark:text-blue-400">
        ℹ️ Les sauvegardes sont stockées localement. Les 30 dernières sont conservées automatiquement.
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Fichier</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Taille</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && <tr><td colSpan={4} className="text-center py-8 text-gray-400">Chargement...</td></tr>}
            {!loading && backups.length === 0 && (
              <tr><td colSpan={4} className="text-center py-8 text-gray-400">Aucune sauvegarde</td></tr>
            )}
            {backups.map((b, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 font-mono text-xs">{b.name}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(b.date).toLocaleString('fr-FR')}</td>
                <td className="px-4 py-3 text-right text-gray-500">{fmtSize(b.size)}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleRestore(b.path)}
                    className="text-xs text-orange-500 hover:text-orange-700 font-medium">
                    Restaurer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
