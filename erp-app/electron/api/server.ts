/**
 * API Server — Express server للـ Master
 * يخدم الـ Clients على الشبكة المحلية
 * - المزامنة (sync pull/push)
 * - التحديثات (updates)
 * - Health check
 * - Device registry
 */
import express from 'express'
import crypto from 'crypto'
import { Server } from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import { basename } from 'path'
import { getDb } from '../database/connection'
import {
  getChangesSince,
  applyChanges,
  updateDeviceLastSeen,
  registerDevice,
  getRegisteredDevices,
  updateSyncState,
  getPendingChangesCount,
  markChangesSynced,
  SYNC_TABLES,
} from '../services/sync.service'
import {
  getLatestUpdate,
  getUpdateFilePath,
  listUpdates,
} from '../services/updater.service'

let server: Server | null = null
let currentPort = 3000

// ==========================================
// API KEY MANAGEMENT
// ==========================================

function getOrCreateApiKey(): string {
  const db = getDb()
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'api_key'").get() as any
  if (row?.value) return row.value
  const newKey = crypto.randomBytes(32).toString('hex')
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('api_key', ?)").run(newKey)
  return newKey
}

export function getApiKey(): string {
  return getOrCreateApiKey()
}

// ==========================================
// MIDDLEWARE
// ==========================================

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const publicPaths = ['/health', '/info']
  if (publicPaths.includes(req.path)) { next(); return }

  const key = req.headers['x-api-key'] as string
  const validKey = getOrCreateApiKey()
  if (!key || key !== validKey) {
    res.status(401).json({ error: 'Unauthorized — clé API invalide' })
    return
  }

  // تحديث last_seen للجهاز
  const deviceId = req.headers['x-device-id'] as string
  if (deviceId) {
    try {
      const db = getDb()
      const ip = req.ip ?? req.socket.remoteAddress
      updateDeviceLastSeen(db, deviceId, ip)
    } catch {}
  }

  next()
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const ip = req.ip ?? 'unknown'
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    next(); return
  }

  entry.count++
  if (entry.count > 200) { // 200 requêtes/minute max
    res.status(429).json({ error: 'Trop de requêtes — réessayez dans un instant' })
    return
  }
  next()
}

// ==========================================
// SERVER FACTORY
// ==========================================

export function startApiServer(port: number): void {
  if (server) stopApiServer()

  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use(rateLimitMiddleware)
  app.use(authMiddleware)

  currentPort = port

  // ── Health & Info ──────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: process.env.npm_package_version ?? '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    })
  })

  app.get('/info', (_req, res) => {
    try {
      const db = getDb()
      const config = db.prepare('SELECT * FROM device_config WHERE id = 1').get() as any
      res.json({
        company: config?.company_name ?? 'ERP Pro',
        version: process.env.npm_package_version ?? '1.0.0',
        mode: 'master',
      })
    } catch {
      res.json({ company: 'ERP Pro', version: '1.0.0', mode: 'master' })
    }
  })

  // ── Device Registry ────────────────────────────────────────
  app.post('/devices/register', (req, res) => {
    try {
      const { device_id, name, api_key } = req.body
      if (!device_id || !name || !api_key) {
        res.status(400).json({ error: 'device_id, name, api_key requis' })
        return
      }
      const db = getDb()
      registerDevice(db, device_id, name, 'client', api_key)
      res.json({ success: true, master_api_key: getOrCreateApiKey() })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/devices', (_req, res) => {
    try {
      const db = getDb()
      res.json(getRegisteredDevices(db))
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── Sync Pull — Client يسحب التغييرات من Master ────────────
  app.get('/sync/pull', (req, res) => {
    try {
      const db = getDb()
      const sinceId = parseInt(req.query.since_id as string ?? '0', 10)
      const deviceId = req.headers['x-device-id'] as string ?? 'unknown'

      const changes = getChangesSince(db, sinceId, deviceId)
      const latestId = changes.length > 0 ? changes[changes.length - 1].id : sinceId

      // تحديث sync state
      updateSyncState(db, deviceId, {
        last_pull_at: new Date().toISOString(),
        last_change_id: latestId,
        status: 'idle',
        error_message: null,
      })

      res.json({
        changes,
        latest_id: latestId,
        total: changes.length,
        timestamp: new Date().toISOString(),
      })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── Sync Push — Client يدفع تغييراته إلى Master ────────────
  app.post('/sync/push', (req, res) => {
    try {
      const db = getDb()
      const { changes, device_id } = req.body

      if (!Array.isArray(changes)) {
        res.status(400).json({ error: 'changes doit être un tableau' })
        return
      }

      // التحقق من الجداول المسموحة
      const invalidTables = changes.filter((c: any) => !SYNC_TABLES.includes(c.table_name))
      if (invalidTables.length > 0) {
        res.status(403).json({ error: `Tables non autorisées: ${invalidTables.map((c: any) => c.table_name).join(', ')}` })
        return
      }

      const result = applyChanges(db, changes)

      // تحديث sync state
      if (device_id) {
        updateSyncState(db, device_id, {
          last_push_at: new Date().toISOString(),
          status: result.errors.length > 0 ? 'error' : 'idle',
          error_message: result.errors.length > 0 ? result.errors[0] : null,
        })
      }

      res.json({
        success: true,
        applied: result.applied,
        conflicts: result.conflicts,
        errors: result.errors,
        timestamp: new Date().toISOString(),
      })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── Sync Status ────────────────────────────────────────────
  app.get('/sync/status', (req, res) => {
    try {
      const db = getDb()
      const deviceId = req.headers['x-device-id'] as string
      const pending = deviceId ? getPendingChangesCount(db, deviceId) : 0
      const devices = getRegisteredDevices(db)
      res.json({ pending, devices, timestamp: new Date().toISOString() })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── Full Snapshot — أول مزامنة للـ Client الجديد ──────────
  app.get('/sync/snapshot', (req, res) => {
    try {
      const db = getDb()
      const snapshot: Record<string, any[]> = {}

      for (const table of SYNC_TABLES) {
        try {
          const hasDeleted = db.prepare(`PRAGMA table_info(${table})`).all()
            .some((col: any) => col.name === 'is_deleted')
          const query = hasDeleted
            ? `SELECT * FROM ${table} WHERE is_deleted = 0`
            : `SELECT * FROM ${table}`
          snapshot[table] = db.prepare(query).all() as any[]
        } catch {
          snapshot[table] = []
        }
      }

      // آخر change_id
      const lastChange = db.prepare('SELECT MAX(id) as id FROM change_log').get() as any

      res.json({
        snapshot,
        latest_change_id: lastChange?.id ?? 0,
        timestamp: new Date().toISOString(),
      })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── Updates ────────────────────────────────────────────────
  app.get('/updates/latest', (_req, res) => {
    try {
      const update = getLatestUpdate()
      if (!update) {
        res.json({ isAvailable: false })
        return
      }
      res.json(update)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/updates/list', (_req, res) => {
    try {
      res.json(listUpdates())
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/updates/download/:version', (req, res) => {
    try {
      const { version } = req.params
      const filePath = getUpdateFilePath(version)
      if (!filePath || !existsSync(filePath)) {
        res.status(404).json({ error: 'Fichier de mise à jour introuvable' })
        return
      }

      const stat = statSync(filePath)
      const ext = filePath.split('.').pop() ?? 'bin'

      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', stat.size)
      res.setHeader('Content-Disposition', `attachment; filename="erp-update-${version}.${ext}"`)
      res.setHeader('x-file-ext', `.${ext}`)
      res.setHeader('x-checksum', require('../services/updater.service').getUpdateFilePath ? '' : '')

      createReadStream(filePath).pipe(res)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── Legacy sync (backward compat) ─────────────────────────
  app.get('/sync', (req, res) => {
    const db = getDb()
    const since = (req.query.since as string) ?? '1970-01-01'
    const tables = ['clients', 'suppliers', 'products', 'documents', 'payments']
    const changes: Record<string, any[]> = {}
    for (const table of tables) {
      try {
        changes[table] = db.prepare(`SELECT * FROM ${table} WHERE updated_at > ?`).all(since) as any[]
      } catch { changes[table] = [] }
    }
    res.json({ changes, timestamp: new Date().toISOString() })
  })

  server = app.listen(port, '0.0.0.0', () => {
    console.log(`[API] Master server running on port ${port}`)
  })

  server.on('error', (err: any) => {
    console.error('[API] Server error:', err.message)
  })
}

export function stopApiServer(): void {
  server?.close()
  server = null
}

export function getServerPort(): number {
  return currentPort
}
