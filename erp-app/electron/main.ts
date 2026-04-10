import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { initDatabase } from './database/connection'
import { registerAllHandlers } from './ipc'
import { startApiServer, stopApiServer } from './api/server'
import { getDeviceConfig } from './services/config.service'
import { getOrCreateDeviceId, updateSyncState, getSyncState, getChangesSince, applyChanges, markChangesSynced } from './services/sync.service'
import { checkForUpdate } from './services/updater.service'
import { copyFileSync, mkdirSync } from 'fs'
import { getDb } from './database/connection'

let mainWindow: BrowserWindow | null = null
let syncInterval: NodeJS.Timeout | null = null
let updateCheckInterval: NodeJS.Timeout | null = null

// ==========================================
// WINDOW
// ==========================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  })

  if (process.env.NODE_ENV === 'development') {
    const port = process.env.VITE_PORT ?? '5173'
    mainWindow.loadURL(`http://localhost:${port}`)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

// ==========================================
// APP LIFECYCLE
// ==========================================

app.whenReady().then(async () => {
  initDatabase()
  registerAllHandlers()

  const config = getDeviceConfig()

  // تشغيل API server إذا كان Master
  if (config?.mode === 'master') {
    startApiServer(config.server_port ?? 3000)
    scheduleAutoSync('master')
  } else if (config?.mode === 'client') {
    scheduleAutoSync('client')
  }

  // جدولة التحقق من التحديثات
  scheduleUpdateCheck()

  createWindow()
  scheduleAutoBackup()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopApiServer()
  if (syncInterval) clearInterval(syncInterval)
  if (updateCheckInterval) clearInterval(updateCheckInterval)
  if (process.platform !== 'darwin') app.quit()
})

// ==========================================
// AUTO SYNC SCHEDULER
// ==========================================

function scheduleAutoSync(mode: 'master' | 'client'): void {
  const SYNC_INTERVAL = 30_000 // كل 30 ثانية

  syncInterval = setInterval(async () => {
    try {
      if (mode === 'client') {
        await performClientSync()
      }
      // Master لا يحتاج sync — الـ Clients يتصلون به
    } catch (err: any) {
      console.error('[Sync] Auto-sync error:', err.message)
    }
  }, SYNC_INTERVAL)

  console.log(`[Sync] Auto-sync scheduled every ${SYNC_INTERVAL / 1000}s (${mode} mode)`)
}

async function performClientSync(): Promise<void> {
  const config = getDeviceConfig()
  if (!config?.server_ip) return

  const db = getDb()
  const deviceId = getOrCreateDeviceId()
  const state = getSyncState(db, deviceId)
  const sinceId = state?.last_change_id ?? 0

  updateSyncState(db, deviceId, { status: 'syncing' })

  try {
    const url = `http://${config.server_ip}:${config.server_port ?? 3000}`
    const apiKey = require('./api/server').getApiKey()

    // 1. Pull — سحب التغييرات من Master
    const pullRes = await fetchWithTimeout(`${url}/sync/pull?since_id=${sinceId}`, {
      headers: { 'x-api-key': apiKey, 'x-device-id': deviceId },
    }, 8000)

    if (pullRes.ok) {
      const pullData = await pullRes.json()
      if (pullData.changes?.length > 0) {
        const result = applyChanges(db, pullData.changes)
        console.log(`[Sync] Pull: ${result.applied} applied, ${result.conflicts} conflicts`)
      }
      updateSyncState(db, deviceId, {
        last_pull_at: new Date().toISOString(),
        last_change_id: pullData.latest_id ?? sinceId,
      })
    }

    // 2. Push — دفع التغييرات المحلية إلى Master
    const localChanges = getChangesSince(db, 0).filter(c => c.device_id === deviceId && c.synced === 0)
    if (localChanges.length > 0) {
      const pushRes = await fetchWithTimeout(`${url}/sync/push`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'x-device-id': deviceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ changes: localChanges, device_id: deviceId }),
      }, 10000)

      if (pushRes.ok) {
        const ids = localChanges.map(c => c.id)
        markChangesSynced(db, ids)
        console.log(`[Sync] Push: ${localChanges.length} changes sent`)
      }
    }

    updateSyncState(db, deviceId, { status: 'idle', error_message: null })

    // إشعار الـ Frontend بالتحديث
    mainWindow?.webContents.send('sync:updated', { timestamp: new Date().toISOString() })

  } catch (err: any) {
    updateSyncState(db, deviceId, { status: 'offline', error_message: err.message })
    mainWindow?.webContents.send('sync:offline', { error: err.message })
  }
}

// ==========================================
// UPDATE CHECK SCHEDULER
// ==========================================

function scheduleUpdateCheck(): void {
  const CHECK_INTERVAL = 60 * 60 * 1000 // كل ساعة

  // تحقق فوري عند البدء (بعد 10 ثوانٍ)
  setTimeout(() => checkAndNotifyUpdate(), 10_000)

  updateCheckInterval = setInterval(() => checkAndNotifyUpdate(), CHECK_INTERVAL)
}

async function checkAndNotifyUpdate(): Promise<void> {
  try {
    const config = getDeviceConfig()
    if (config?.mode !== 'client' || !config.server_ip) return

    const apiKey = require('./api/server').getApiKey()
    const url = `http://${config.server_ip}:${config.server_port ?? 3000}`
    const update = await checkForUpdate(url, apiKey)

    if (update?.isAvailable) {
      console.log(`[Update] New version available: ${update.version}`)
      mainWindow?.webContents.send('update:available', update)
    }
  } catch {}
}

// ==========================================
// AUTO BACKUP
// ==========================================

function scheduleAutoBackup(): void {
  const INTERVAL = 24 * 60 * 60 * 1000
  setInterval(() => {
    try {
      const userData  = app.getPath('userData')
      const backupDir = join(userData, 'backups')
      mkdirSync(backupDir, { recursive: true })
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      copyFileSync(join(userData, 'erp.db'), join(backupDir, `erp-auto-${ts}.db`))
      console.log('[Backup] Auto backup created')
    } catch (e) {
      console.error('[Backup] Auto backup failed:', e)
    }
  }, INTERVAL)
}

// ==========================================
// HELPERS
// ==========================================

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
