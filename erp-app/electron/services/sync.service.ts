/**
 * Sync Service — قلب نظام المزامنة
 * يدير المزامنة بين Master و Clients على الشبكة المحلية
 */
import Database from 'better-sqlite3'
import crypto from 'crypto'
import { getDb } from '../database/connection'

// الجداول التي تُزامَن
export const SYNC_TABLES = [
  'clients', 'suppliers', 'products',
  'documents', 'document_lines', 'document_links',
  'payments', 'payment_allocations',
  'stock_movements', 'tva_rates',
  'production_orders', 'bom_templates', 'bom_lines', 'transformations',
  'journal_entries', 'journal_lines',
  'app_settings',
] as const

export type SyncTable = typeof SYNC_TABLES[number]

export interface ChangeEntry {
  id: number
  device_id: string
  table_name: string
  record_id: number
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  data: Record<string, unknown> | null
  checksum: string
  synced: number
  created_at: string
}

export interface SyncPayload {
  device_id: string
  changes: ChangeEntry[]
  from_change_id: number
  timestamp: string
}

export interface SyncResult {
  applied: number
  conflicts: number
  errors: string[]
}

// ==========================================
// DEVICE MANAGEMENT
// ==========================================

export function getOrCreateDeviceId(): string {
  const db = getDb()
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'device_id'").get() as any
  if (row?.value) return row.value

  const id = crypto.randomUUID()
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('device_id', ?)").run(id)
  return id
}

export function registerDevice(db: Database.Database, deviceId: string, name: string, role: 'master' | 'client', apiKey: string): void {
  db.prepare(`
    INSERT INTO devices (id, name, role, api_key, last_seen, version)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      last_seen = CURRENT_TIMESTAMP,
      version = excluded.version
  `).run(deviceId, name, role, apiKey, process.env.npm_package_version ?? '1.0.0')
}

export function updateDeviceLastSeen(db: Database.Database, deviceId: string, ip?: string): void {
  db.prepare(`
    UPDATE devices SET last_seen = CURRENT_TIMESTAMP, ip_address = COALESCE(?, ip_address)
    WHERE id = ?
  `).run(ip ?? null, deviceId)
}

export function getRegisteredDevices(db: Database.Database): any[] {
  return db.prepare(`
    SELECT d.*, ss.last_pull_at, ss.last_push_at, ss.status, ss.pending_count
    FROM devices d
    LEFT JOIN sync_state ss ON ss.device_id = d.id
    WHERE d.is_active = 1
    ORDER BY d.last_seen DESC
  `).all() as any[]
}

// ==========================================
// CHANGE LOG
// ==========================================

export function logChange(
  db: Database.Database,
  deviceId: string,
  tableName: string,
  recordId: number,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  data?: Record<string, unknown>
): void {
  const json = data ? JSON.stringify(data) : null
  const checksum = json
    ? crypto.createHash('sha256').update(json).digest('hex').substring(0, 16)
    : ''

  db.prepare(`
    INSERT INTO change_log (device_id, table_name, record_id, operation, data, checksum)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(deviceId, tableName, recordId, operation, json, checksum)
}

export function getChangesSince(db: Database.Database, sinceId: number, excludeDevice?: string): ChangeEntry[] {
  let query = `SELECT * FROM change_log WHERE id > ?`
  const params: any[] = [sinceId]
  if (excludeDevice) {
    query += ` AND device_id != ?`
    params.push(excludeDevice)
  }
  query += ` ORDER BY id ASC LIMIT 500`
  return db.prepare(query).all(...params) as ChangeEntry[]
}

export function markChangesSynced(db: Database.Database, changeIds: number[]): void {
  if (changeIds.length === 0) return
  const placeholders = changeIds.map(() => '?').join(',')
  db.prepare(`UPDATE change_log SET synced = 1 WHERE id IN (${placeholders})`).run(...changeIds)
}

export function getPendingChangesCount(db: Database.Database, deviceId: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM change_log WHERE device_id = ? AND synced = 0
  `).get(deviceId) as any
  return row?.c ?? 0
}

// ==========================================
// SYNC STATE
// ==========================================

export function getSyncState(db: Database.Database, deviceId: string): any {
  return db.prepare('SELECT * FROM sync_state WHERE device_id = ?').get(deviceId)
}

export function updateSyncState(db: Database.Database, deviceId: string, updates: {
  last_pull_at?: string
  last_push_at?: string
  last_change_id?: number
  status?: string
  error_message?: string | null
  pending_count?: number
}): void {
  const existing = db.prepare('SELECT device_id FROM sync_state WHERE device_id = ?').get(deviceId)
  if (!existing) {
    db.prepare(`
      INSERT INTO sync_state (device_id, last_pull_at, last_push_at, last_change_id, status, error_message, pending_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      deviceId,
      updates.last_pull_at ?? null,
      updates.last_push_at ?? null,
      updates.last_change_id ?? 0,
      updates.status ?? 'idle',
      updates.error_message ?? null,
      updates.pending_count ?? 0
    )
  } else {
    const fields: string[] = ['updated_at = CURRENT_TIMESTAMP']
    const values: any[] = []
    if (updates.last_pull_at !== undefined)  { fields.push('last_pull_at = ?');  values.push(updates.last_pull_at) }
    if (updates.last_push_at !== undefined)  { fields.push('last_push_at = ?');  values.push(updates.last_push_at) }
    if (updates.last_change_id !== undefined){ fields.push('last_change_id = ?');values.push(updates.last_change_id) }
    if (updates.status !== undefined)        { fields.push('status = ?');         values.push(updates.status) }
    if (updates.error_message !== undefined) { fields.push('error_message = ?');  values.push(updates.error_message) }
    if (updates.pending_count !== undefined) { fields.push('pending_count = ?');  values.push(updates.pending_count) }
    values.push(deviceId)
    db.prepare(`UPDATE sync_state SET ${fields.join(', ')} WHERE device_id = ?`).run(...values)
  }
}

// ==========================================
// APPLY CHANGES (على الـ Master أو Client)
// ==========================================

export function applyChanges(db: Database.Database, changes: ChangeEntry[]): SyncResult {
  const result: SyncResult = { applied: 0, conflicts: 0, errors: [] }

  const tx = db.transaction(() => {
    for (const change of changes) {
      try {
        applyOneChange(db, change)
        result.applied++
      } catch (err: any) {
        // تعارض أو خطأ — نسجله ونكمل
        result.errors.push(`${change.table_name}#${change.record_id}: ${err.message}`)
        try {
          recordConflict(db, change, err.message)
          result.conflicts++
        } catch {}
      }
    }
  })

  tx()
  return result
}

function applyOneChange(db: Database.Database, change: ChangeEntry): void {
  if (!SYNC_TABLES.includes(change.table_name as SyncTable)) {
    throw new Error(`Table non autorisée: ${change.table_name}`)
  }

  const data = change.data ? (typeof change.data === 'string' ? JSON.parse(change.data) : change.data) : null

  if (change.operation === 'DELETE') {
    db.prepare(`UPDATE ${change.table_name} SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(change.record_id)
    return
  }

  if (!data) return

  if (change.operation === 'INSERT') {
    // UPSERT — si existe déjà, on compare les timestamps
    const existing = db.prepare(`SELECT updated_at FROM ${change.table_name} WHERE id = ?`).get(change.record_id) as any
    if (existing) {
      // Last-write-wins basé sur updated_at
      const remoteTs = data.updated_at as string ?? change.created_at
      if (remoteTs > existing.updated_at) {
        upsertRecord(db, change.table_name, data)
      }
    } else {
      upsertRecord(db, change.table_name, data)
    }
    return
  }

  if (change.operation === 'UPDATE') {
    const existing = db.prepare(`SELECT updated_at FROM ${change.table_name} WHERE id = ?`).get(change.record_id) as any
    if (!existing) {
      upsertRecord(db, change.table_name, data)
      return
    }
    const remoteTs = data.updated_at as string ?? change.created_at
    if (remoteTs >= existing.updated_at) {
      upsertRecord(db, change.table_name, data)
    }
    // else: local is newer → keep local (last-write-wins)
  }
}

function upsertRecord(db: Database.Database, table: string, data: Record<string, unknown>): void {
  const keys = Object.keys(data)
  if (keys.length === 0) return
  const placeholders = keys.map(() => '?').join(', ')
  const updates = keys.filter(k => k !== 'id').map(k => `${k} = excluded.${k}`).join(', ')
  db.prepare(`
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${updates}
  `).run(...Object.values(data))
}

function recordConflict(db: Database.Database, change: ChangeEntry, errorMsg: string): void {
  const existing = db.prepare(`SELECT * FROM ${change.table_name} WHERE id = ?`).get(change.record_id)
  db.prepare(`
    INSERT INTO sync_conflicts (table_name, record_id, local_data, remote_data, remote_device)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    change.table_name,
    change.record_id,
    existing ? JSON.stringify(existing) : null,
    typeof change.data === 'string' ? change.data : JSON.stringify(change.data),
    change.device_id
  )
}

// ==========================================
// OFFLINE QUEUE
// ==========================================

export function enqueueOffline(db: Database.Database, operation: string, payload: unknown, priority = 5): void {
  db.prepare(`
    INSERT INTO offline_queue (operation, payload, priority)
    VALUES (?, ?, ?)
  `).run(operation, JSON.stringify(payload), priority)
}

export function getOfflineQueue(db: Database.Database): any[] {
  return db.prepare(`
    SELECT * FROM offline_queue
    WHERE status = 'pending' AND attempts < max_attempts
    ORDER BY priority ASC, created_at ASC
    LIMIT 50
  `).all() as any[]
}

export function markQueueItemDone(db: Database.Database, id: number): void {
  db.prepare(`UPDATE offline_queue SET status = 'done', processed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
}

export function markQueueItemFailed(db: Database.Database, id: number, error: string): void {
  db.prepare(`
    UPDATE offline_queue
    SET attempts = attempts + 1,
        error = ?,
        status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END
    WHERE id = ?
  `).run(error, id)
}

// ==========================================
// INTEGRITY CHECK
// ==========================================

export function verifyChecksum(data: Record<string, unknown>, checksum: string): boolean {
  const json = JSON.stringify(data)
  const computed = crypto.createHash('sha256').update(json).digest('hex').substring(0, 16)
  return computed === checksum
}
