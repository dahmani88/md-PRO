/**
 * Sync IPC Handler — واجهة المزامنة للـ Frontend
 */
import { handle } from './index'
import { getDb } from '../database/connection'
import { getDeviceConfig } from '../services/config.service'
import {
  getOrCreateDeviceId,
  getSyncState,
  updateSyncState,
  getOfflineQueue,
  markQueueItemDone,
  markQueueItemFailed,
  getRegisteredDevices,
  getPendingChangesCount,
  applyChanges,
  getChangesSince,
} from '../services/sync.service'
import {
  checkForUpdate,
  downloadUpdate,
  verifyUpdateFile,
  installUpdate,
  publishUpdate,
  listUpdates,
  getLatestUpdate,
  UpdateProgress,
} from '../services/updater.service'
import { getApiKey, startApiServer, stopApiServer, getServerPort } from '../api/server'
import { BrowserWindow } from 'electron'

// ==========================================
// SYNC HANDLERS
// ==========================================

export function registerSyncHandlers(): void {

  // معلومات الجهاز الحالي
  handle('sync:deviceInfo', () => {
    const db = getDb()
    const deviceId = getOrCreateDeviceId()
    const config = getDeviceConfig()
    const state = getSyncState(db, deviceId)
    const pending = getPendingChangesCount(db, deviceId)
    return {
      deviceId,
      mode: config?.mode ?? 'standalone',
      serverIp: config?.server_ip,
      serverPort: config?.server_port ?? 3000,
      apiKey: config?.mode === 'master' ? getApiKey() : undefined,
      syncState: state,
      pendingChanges: pending,
    }
  })

  // قائمة الأجهزة المتصلة (Master فقط)
  handle('sync:getDevices', () => {
    const db = getDb()
    return getRegisteredDevices(db)
  })

  // مزامنة يدوية — سحب من Master
  handle('sync:pull', async () => {
    const config = getDeviceConfig()
    if (config?.mode !== 'client') throw new Error('Seulement disponible en mode client')

    const db = getDb()
    const deviceId = getOrCreateDeviceId()
    const state = getSyncState(db, deviceId)
    const sinceId = state?.last_change_id ?? 0

    updateSyncState(db, deviceId, { status: 'syncing' })

    try {
      const url = `http://${config.server_ip}:${config.server_port}`
      const apiKey = getApiKey()

      const res = await fetchWithTimeout(`${url}/sync/pull?since_id=${sinceId}`, {
        headers: { 'x-api-key': apiKey, 'x-device-id': deviceId },
      }, 10000)

      if (!res.ok) throw new Error(`Serveur: HTTP ${res.status}`)

      const data = await res.json()
      const result = applyChanges(db, data.changes ?? [])

      updateSyncState(db, deviceId, {
        last_pull_at: new Date().toISOString(),
        last_change_id: data.latest_id ?? sinceId,
        status: 'idle',
        error_message: null,
      })

      return { success: true, applied: result.applied, conflicts: result.conflicts }
    } catch (err: any) {
      updateSyncState(db, deviceId, { status: 'error', error_message: err.message })
      throw err
    }
  })

  // مزامنة يدوية — دفع إلى Master
  handle('sync:push', async () => {
    const config = getDeviceConfig()
    if (config?.mode !== 'client') throw new Error('Seulement disponible en mode client')

    const db = getDb()
    const deviceId = getOrCreateDeviceId()
    const state = getSyncState(db, deviceId)
    const sinceId = state?.last_push_at ? 0 : 0 // نرسل كل التغييرات المعلقة

    const changes = getChangesSince(db, 0, undefined)
      .filter(c => c.device_id === deviceId && c.synced === 0)

    if (changes.length === 0) return { success: true, applied: 0, message: 'Rien à synchroniser' }

    updateSyncState(db, deviceId, { status: 'syncing' })

    try {
      const url = `http://${config.server_ip}:${config.server_port}`
      const apiKey = getApiKey()

      const res = await fetchWithTimeout(`${url}/sync/push`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'x-device-id': deviceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ changes, device_id: deviceId }),
      }, 15000)

      if (!res.ok) throw new Error(`Serveur: HTTP ${res.status}`)

      const result = await res.json()

      // تحديد التغييرات كـ synced
      markQueueItemDone(db, 0) // placeholder
      const changeIds = changes.map(c => c.id)
      db.prepare(`UPDATE change_log SET synced = 1 WHERE id IN (${changeIds.map(() => '?').join(',')})`).run(...changeIds)

      updateSyncState(db, deviceId, {
        last_push_at: new Date().toISOString(),
        status: 'idle',
        error_message: null,
        pending_count: 0,
      })

      return { success: true, applied: result.applied, conflicts: result.conflicts }
    } catch (err: any) {
      updateSyncState(db, deviceId, { status: 'error', error_message: err.message })
      throw err
    }
  })

  // أول مزامنة — تنزيل snapshot كامل من Master
  handle('sync:initialSnapshot', async () => {
    const config = getDeviceConfig()
    if (config?.mode !== 'client') throw new Error('Seulement disponible en mode client')

    const db = getDb()
    const deviceId = getOrCreateDeviceId()
    const apiKey = getApiKey()
    const url = `http://${config.server_ip}:${config.server_port}`

    updateSyncState(db, deviceId, { status: 'syncing' })

    try {
      const res = await fetchWithTimeout(`${url}/sync/snapshot`, {
        headers: { 'x-api-key': apiKey, 'x-device-id': deviceId },
      }, 30000)

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const { snapshot, latest_change_id } = await res.json()
      const result = applyChanges(db, Object.entries(snapshot).flatMap(([table, rows]) =>
        (rows as any[]).map(row => ({
          id: 0, device_id: 'master', table_name: table,
          record_id: row.id, operation: 'INSERT' as const,
          data: row, checksum: '', synced: 1, created_at: new Date().toISOString(),
        }))
      ))

      updateSyncState(db, deviceId, {
        last_pull_at: new Date().toISOString(),
        last_change_id: latest_change_id,
        status: 'idle',
        error_message: null,
      })

      return { success: true, applied: result.applied }
    } catch (err: any) {
      updateSyncState(db, deviceId, { status: 'error', error_message: err.message })
      throw err
    }
  })

  // تشغيل/إيقاف الـ API server (Master)
  handle('sync:startServer', (port?: number) => {
    const config = getDeviceConfig()
    if (config?.mode !== 'master') throw new Error('Seulement disponible en mode master')
    startApiServer(port ?? config.server_port ?? 3000)
    return { success: true, port: port ?? config.server_port ?? 3000 }
  })

  handle('sync:stopServer', () => {
    stopApiServer()
    return { success: true }
  })

  handle('sync:getApiKey', () => {
    const config = getDeviceConfig()
    if (config?.mode !== 'master') throw new Error('Seulement disponible en mode master')
    return { apiKey: getApiKey() }
  })

  // ==========================================
  // UPDATE HANDLERS
  // ==========================================

  // تحقق من وجود تحديث
  handle('update:check', async () => {
    const config = getDeviceConfig()

    if (config?.mode === 'master') {
      // Master يتحقق من قاعدة بياناته
      return getLatestUpdate()
    }

    if (config?.mode === 'client' && config.server_ip) {
      const apiKey = getApiKey()
      const url = `http://${config.server_ip}:${config.server_port}`
      return await checkForUpdate(url, apiKey)
    }

    return null
  })

  // تنزيل تحديث (Client)
  handle('update:download', async (version: string) => {
    const config = getDeviceConfig()
    if (config?.mode !== 'client') throw new Error('Seulement disponible en mode client')

    const apiKey = getApiKey()
    const url = `http://${config.server_ip}:${config.server_port}`
    const win = BrowserWindow.getAllWindows()[0]

    const result = await downloadUpdate(url, apiKey, version, (progress: UpdateProgress) => {
      win?.webContents.send('update:progress', progress)
    })

    return result
  })

  // التحقق من سلامة ملف التحديث
  handle('update:verify', (data: { filePath: string; checksum: string }) => {
    return { valid: verifyUpdateFile(data.filePath, data.checksum) }
  })

  // تثبيت التحديث
  handle('update:install', (filePath: string) => {
    installUpdate(filePath)
    return { success: true }
  })

  // نشر تحديث جديد (Master فقط)
  handle('update:publish', (data: { filePath: string; version: string; releaseNotes: string; isMandatory?: boolean }) => {
    const config = getDeviceConfig()
    if (config?.mode !== 'master') throw new Error('Seulement disponible en mode master')
    return publishUpdate(data.filePath, data.version, data.releaseNotes, data.isMandatory)
  })

  // قائمة التحديثات المتاحة
  handle('update:list', () => {
    return listUpdates()
  })

  // اختبار الاتصال بالـ Master
  handle('sync:testConnection', async (data?: { ip?: string; port?: number }) => {
    const config = getDeviceConfig()
    const ip   = data?.ip   ?? config?.server_ip
    const port = data?.port ?? config?.server_port ?? 3000

    if (!ip) throw new Error('IP du serveur non configurée')

    try {
      const res = await fetchWithTimeout(`http://${ip}:${port}/health`, {}, 5000)
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
      const info = await res.json()
      return { ok: true, ...info }
    } catch (err: any) {
      return { ok: false, message: err.message }
    }
  })
}

// ==========================================
// HELPERS
// ==========================================

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  if (timeoutMs > 0) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, { ...options, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
  return fetch(url, options)
}
