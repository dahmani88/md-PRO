/**
 * NetworkSettings — إعدادات الشبكة والمزامنة والتحديثات
 */
import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/app.store'

interface DeviceInfo {
  deviceId: string
  mode: string
  serverIp?: string
  serverPort?: number
  apiKey?: string
  syncState?: { status: string; last_pull_at?: string; last_push_at?: string; pending_count?: number; error_message?: string }
  pendingChanges?: number
}

interface ConnectedDevice {
  id: string
  name: string
  role: string
  ip_address?: string
  last_seen?: string
  version?: string
  status?: string
}

interface UpdateInfo {
  version: string
  releaseNotes: string
  isAvailable: boolean
  isMandatory: boolean
  fileSize: number
  checksum: string
}

export default function NetworkSettings() {
  const { config } = useAppStore()
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [devices, setDevices] = useState<ConnectedDevice[]>([])
  const [updates, setUpdates] = useState<any[]>([])
  const [latestUpdate, setLatestUpdate] = useState<UpdateInfo | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 10_000)
    return () => clearInterval(interval)
  }, [])

  async function loadData() {
    try {
      if (window.api?.syncDeviceInfo) {
        const res = await window.api.syncDeviceInfo() as any
        if (res?.success) setDeviceInfo(res.data)
      }
      if (config?.mode === 'master') {
        const devRes = await window.api?.syncGetDevices() as any
        if (devRes?.success) setDevices(devRes.data ?? [])
        const updRes = await window.api?.updateList() as any
        if (updRes?.success) setUpdates(updRes.data ?? [])
      }
      if (config?.mode === 'client') {
        const updRes = await window.api?.updateCheck() as any
        if (updRes?.success) setLatestUpdate(updRes.data)
      }
    } catch {}
    setLoading(false)
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.api?.syncTestConnection() as any
      if (res?.success && res.data?.ok) {
        setTestResult({ ok: true, message: `✅ Connecté — v${res.data.version ?? '?'} — ${res.data.company ?? ''}` })
      } else {
        setTestResult({ ok: false, message: `❌ ${res?.data?.message ?? 'Connexion impossible'}` })
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: `❌ ${e.message}` })
    } finally {
      setTesting(false)
    }
  }

  async function handleManualSync() {
    if (syncing) return
    setSyncing(true)
    setSyncResult(null)
    try {
      const pull = await window.api?.syncPull() as any
      const push = await window.api?.syncPush() as any
      const applied = (pull?.data?.applied ?? 0) + (push?.data?.applied ?? 0)
      setSyncResult(`✅ ${applied} changements synchronisés`)
      await loadData()
    } catch (e: any) {
      setSyncResult(`❌ ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  async function handleInitialSnapshot() {
    if (!confirm('Télécharger toutes les données du serveur ? Cela remplacera les données locales.')) return
    setSyncing(true)
    try {
      const res = await window.api?.syncInitialSnapshot() as any
      setSyncResult(`✅ ${res?.data?.applied ?? 0} enregistrements importés`)
      await loadData()
    } catch (e: any) {
      setSyncResult(`❌ ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  async function handlePublishUpdate() {
    const filePath = prompt('Chemin du fichier de mise à jour (.exe, .dmg, .AppImage):')
    if (!filePath) return
    const version = prompt('Version (ex: 1.2.0):')
    if (!version) return
    const notes = prompt('Notes de version:') ?? ''
    const mandatory = confirm('Mise à jour obligatoire ?')

    try {
      const res = await window.api?.updatePublish({ filePath, version, releaseNotes: notes, isMandatory: mandatory }) as any
      if (res?.success) {
        alert(`✅ Mise à jour ${version} publiée (checksum: ${res.data?.checksum?.substring(0, 8)}...)`)
        await loadData()
      } else {
        alert(`❌ ${res?.error}`)
      }
    } catch (e: any) {
      alert(`❌ ${e.message}`)
    }
  }

  if (loading) return <div className="text-gray-400 text-sm">Chargement...</div>

  return (
    <div className="max-w-2xl space-y-6">

      {/* ── Mode & Status ─────────────────────────────────── */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">Mode de fonctionnement</h3>

        <div className="flex items-center justify-between">
          <span className="text-sm">Mode actuel</span>
          <span className={`badge font-medium ${
            config?.mode === 'standalone' ? 'badge-green' :
            config?.mode === 'master'     ? 'badge-blue'  : 'badge-purple'
          }`}>
            {config?.mode === 'standalone' ? '🖥️ Poste unique' :
             config?.mode === 'master'     ? '🌐 Serveur réseau' : '💻 Client réseau'}
          </span>
        </div>

        {deviceInfo?.deviceId && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">ID Appareil</span>
            <span className="font-mono text-xs text-gray-400">{deviceInfo.deviceId.substring(0, 16)}...</span>
          </div>
        )}

        {config?.mode !== 'standalone' && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Serveur</span>
            <span className="font-mono text-sm">
              {config?.mode === 'master' ? `0.0.0.0:${config.server_port ?? 3000}` : `${config?.server_ip}:${config?.server_port ?? 3000}`}
            </span>
          </div>
        )}

        {/* API Key (Master) */}
        {config?.mode === 'master' && deviceInfo?.apiKey && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Clé API</span>
              <button onClick={() => setShowApiKey(s => !s)} className="text-xs text-blue-500 hover:underline">
                {showApiKey ? 'Masquer' : 'Afficher'}
              </button>
            </div>
            {showApiKey && (
              <div className="bg-gray-50 dark:bg-slate-700 rounded p-2 font-mono text-xs break-all select-all">
                {deviceInfo.apiKey}
              </div>
            )}
          </div>
        )}

        {/* Sync State */}
        {deviceInfo?.syncState && (
          <div className="pt-2 border-t border-gray-100 dark:border-gray-700 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">État sync</span>
              <span className={`text-sm font-medium ${
                deviceInfo.syncState.status === 'idle'    ? 'text-green-500' :
                deviceInfo.syncState.status === 'syncing' ? 'text-blue-500'  :
                deviceInfo.syncState.status === 'offline' ? 'text-yellow-500': 'text-red-500'
              }`}>
                {deviceInfo.syncState.status === 'idle'    ? '🟢 Synchronisé' :
                 deviceInfo.syncState.status === 'syncing' ? '🔄 En cours...' :
                 deviceInfo.syncState.status === 'offline' ? '🟡 Hors ligne'  : '🔴 Erreur'}
              </span>
            </div>
            {deviceInfo.syncState.last_pull_at && (
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Dernier pull</span>
                <span>{new Date(deviceInfo.syncState.last_pull_at).toLocaleString('fr-FR')}</span>
              </div>
            )}
            {(deviceInfo.pendingChanges ?? 0) > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">En attente</span>
                <span className="text-orange-500 font-medium">{deviceInfo.pendingChanges} changements</span>
              </div>
            )}
            {deviceInfo.syncState.error_message && (
              <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-2">
                {deviceInfo.syncState.error_message}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Actions Client ────────────────────────────────── */}
      {config?.mode === 'client' && (
        <div className="card p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">Actions</h3>

          <button onClick={testConnection} disabled={testing} className="btn-secondary w-full justify-center">
            {testing ? '⏳ Test...' : '🔌 Tester la connexion'}
          </button>

          {testResult && (
            <div className={`text-sm px-3 py-2 rounded-lg ${testResult.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
              {testResult.message}
            </div>
          )}

          <button onClick={handleManualSync} disabled={syncing} className="btn-primary w-full justify-center">
            {syncing ? '🔄 Synchronisation...' : '🔄 Synchroniser maintenant'}
          </button>

          <button onClick={handleInitialSnapshot} disabled={syncing} className="btn-secondary w-full justify-center text-orange-600 border-orange-300 hover:bg-orange-50">
            📥 Importer toutes les données du serveur
          </button>

          {syncResult && (
            <div className={`text-sm px-3 py-2 rounded-lg ${syncResult.startsWith('✅') ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
              {syncResult}
            </div>
          )}
        </div>
      )}

      {/* ── Connected Devices (Master) ────────────────────── */}
      {config?.mode === 'master' && (
        <div className="card p-5 space-y-3">
          <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
            Appareils connectés ({devices.length})
          </h3>
          {devices.length === 0 ? (
            <p className="text-sm text-gray-400">Aucun client connecté</p>
          ) : (
            <div className="space-y-2">
              {devices.map(d => (
                <div key={d.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div>
                    <div className="text-sm font-medium">{d.name}</div>
                    <div className="text-xs text-gray-400">{d.ip_address ?? '—'} · v{d.version ?? '?'}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs font-medium ${d.status === 'idle' ? 'text-green-500' : 'text-gray-400'}`}>
                      {d.status ?? 'inconnu'}
                    </div>
                    {d.last_seen && (
                      <div className="text-xs text-gray-400">
                        {formatRelativeTime(d.last_seen)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Updates (Master — publier) ────────────────────── */}
      {config?.mode === 'master' && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">Mises à jour</h3>
            <button onClick={handlePublishUpdate} className="btn-primary btn-sm">
              📤 Publier une mise à jour
            </button>
          </div>
          {updates.length === 0 ? (
            <p className="text-sm text-gray-400">Aucune mise à jour publiée</p>
          ) : (
            <div className="space-y-2">
              {updates.map((u: any) => (
                <div key={u.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div>
                    <div className="text-sm font-medium">v{u.version}</div>
                    <div className="text-xs text-gray-400">{u.release_notes?.substring(0, 60) ?? '—'}</div>
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    {u.is_mandatory ? <span className="text-red-500 font-medium">Obligatoire</span> : 'Optionnel'}
                    <div>{formatBytes(u.file_size)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Updates (Client — télécharger) ───────────────── */}
      {config?.mode === 'client' && latestUpdate?.isAvailable && (
        <div className="card p-5 border-2 border-green-300 dark:border-green-700 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⬆️</span>
            <div>
              <div className="font-semibold">Mise à jour disponible — v{latestUpdate.version}</div>
              <div className="text-sm text-gray-500">{latestUpdate.releaseNotes}</div>
            </div>
            {latestUpdate.isMandatory && (
              <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-full">Obligatoire</span>
            )}
          </div>
          <div className="text-xs text-gray-400">Taille: {formatBytes(latestUpdate.fileSize)}</div>
          <button
            onClick={async () => {
              const res = await window.api?.updateDownload(latestUpdate.version) as any
              if (res?.success && res.data?.filePath) {
                const v = await window.api?.updateVerify({ filePath: res.data.filePath, checksum: latestUpdate.checksum }) as any
                if (v?.data?.valid && confirm('Installer maintenant ?')) {
                  await window.api?.updateInstall(res.data.filePath)
                }
              }
            }}
            className="btn-primary w-full justify-center"
          >
            📥 Télécharger et installer
          </button>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Pour modifier le mode réseau, relancez le wizard de configuration.
      </p>
    </div>
  )
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 60)   return `il y a ${diff}s`
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`
    if (diff < 86400)return `il y a ${Math.floor(diff / 3600)}h`
    return `il y a ${Math.floor(diff / 86400)}j`
  } catch { return '—' }
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
