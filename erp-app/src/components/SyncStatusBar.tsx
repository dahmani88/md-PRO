/**
 * SyncStatusBar — شريط حالة المزامنة في أسفل الشاشة
 * يظهر فقط في وضع Client أو Master
 */
import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../store/app.store'

interface SyncState {
  status: 'idle' | 'syncing' | 'error' | 'offline'
  lastSync?: string
  pending?: number
  error?: string
}

interface UpdateInfo {
  version: string
  releaseNotes: string
  isAvailable: boolean
  isMandatory: boolean
  fileSize: number
  checksum: string
}

interface DownloadProgress {
  percent: number
  bytesDownloaded: number
  totalBytes: number
  status: string
}

export default function SyncStatusBar() {
  const { config } = useAppStore()
  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle' })
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [syncing, setSyncing] = useState(false)

  const loadSyncState = useCallback(async () => {
    if (!window.api?.syncDeviceInfo) return
    try {
      const res = await window.api.syncDeviceInfo() as any
      if (res?.success && res.data) {
        const s = res.data.syncState
        setSyncState({
          status: s?.status ?? 'idle',
          lastSync: s?.last_pull_at,
          pending: res.data.pendingChanges ?? 0,
          error: s?.error_message,
        })
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (!config || config.mode === 'standalone') return

    loadSyncState()
    const interval = setInterval(loadSyncState, 15_000)

    // استماع لأحداث الـ Main process
    const unsubUpdated  = window.api?.onSyncUpdated?.(() => loadSyncState())
    const unsubOffline  = window.api?.onSyncOffline?.((d: any) => setSyncState(s => ({ ...s, status: 'offline', error: d?.error })))
    const unsubUpdate   = window.api?.onUpdateAvailable?.((u: any) => setUpdate(u))
    const unsubProgress = window.api?.onUpdateProgress?.((p: any) => setProgress(p))

    return () => {
      clearInterval(interval)
      unsubUpdated?.()
      unsubOffline?.()
      unsubUpdate?.()
      unsubProgress?.()
    }
  }, [config, loadSyncState])

  async function handleManualSync() {
    if (syncing || config?.mode !== 'client') return
    setSyncing(true)
    try {
      await window.api.syncPull()
      await window.api.syncPush()
      await loadSyncState()
    } catch (err: any) {
      setSyncState(s => ({ ...s, status: 'error', error: err.message }))
    } finally {
      setSyncing(false)
    }
  }

  async function handleDownloadUpdate() {
    if (!update || downloading) return
    setDownloading(true)
    try {
      const res = await window.api.updateDownload(update.version) as any
      if (res?.success && res.data?.filePath) {
        const verified = await window.api.updateVerify({ filePath: res.data.filePath, checksum: update.checksum }) as any
        if (verified?.data?.valid) {
          if (confirm(`✅ Mise à jour ${update.version} prête. Installer maintenant ?`)) {
            await window.api.updateInstall(res.data.filePath)
          }
        } else {
          alert('❌ Fichier corrompu — réessayez')
        }
      }
    } catch (err: any) {
      alert(`Erreur: ${err.message}`)
    } finally {
      setDownloading(false)
      setProgress(null)
    }
  }

  if (!config || config.mode === 'standalone') return null

  const statusColor = {
    idle:    'text-green-500',
    syncing: 'text-blue-500',
    error:   'text-red-500',
    offline: 'text-yellow-500',
  }[syncState.status]

  const statusIcon = {
    idle:    '🟢',
    syncing: '🔄',
    error:   '🔴',
    offline: '🟡',
  }[syncState.status]

  const statusLabel = {
    idle:    'Synchronisé',
    syncing: 'Synchronisation...',
    error:   'Erreur sync',
    offline: 'Hors ligne',
  }[syncState.status]

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 px-4 py-1.5 flex items-center gap-4 text-xs">

      {/* Mode badge */}
      <span className={`font-medium ${config.mode === 'master' ? 'text-blue-600' : 'text-purple-600'}`}>
        {config.mode === 'master' ? '🌐 Serveur' : '💻 Client'}
      </span>

      {/* Sync status */}
      <div className="flex items-center gap-1.5">
        <span className={`${statusColor} ${syncState.status === 'syncing' ? 'animate-spin' : ''}`}>
          {statusIcon}
        </span>
        <span className={`${statusColor} font-medium`}>{statusLabel}</span>
        {syncState.lastSync && (
          <span className="text-gray-400">
            — {formatTime(syncState.lastSync)}
          </span>
        )}
        {syncState.error && (
          <span className="text-red-400 truncate max-w-48" title={syncState.error}>
            : {syncState.error}
          </span>
        )}
      </div>

      {/* Pending changes */}
      {(syncState.pending ?? 0) > 0 && (
        <span className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 px-2 py-0.5 rounded-full font-medium">
          {syncState.pending} en attente
        </span>
      )}

      {/* Download progress */}
      {downloading && progress && (
        <div className="flex items-center gap-2 flex-1 max-w-48">
          <div className="flex-1 bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="text-gray-500">{progress.percent}%</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Manual sync button (Client only) */}
      {config.mode === 'client' && (
        <button
          onClick={handleManualSync}
          disabled={syncing}
          className="text-gray-500 hover:text-blue-600 transition-colors disabled:opacity-50 flex items-center gap-1"
          title="Synchroniser maintenant"
        >
          <span className={syncing ? 'animate-spin' : ''}>🔄</span>
          <span>Sync</span>
        </button>
      )}

      {/* Update notification */}
      {update?.isAvailable && (
        <button
          onClick={handleDownloadUpdate}
          disabled={downloading}
          className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-full font-medium flex items-center gap-1.5 transition-colors"
        >
          <span>⬆️</span>
          <span>{downloading ? 'Téléchargement...' : `Mise à jour ${update.version}`}</span>
          {update.isMandatory && <span className="bg-red-500 text-white text-xs px-1 rounded">Obligatoire</span>}
        </button>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
    if (diff < 60)  return `il y a ${diff}s`
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
