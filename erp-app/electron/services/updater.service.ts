/**
 * Updater Service — نظام التحديثات عبر الشبكة المحلية
 * يعمل بدون إنترنت — Master يوزع التحديثات على الـ Clients
 */
import crypto from 'crypto'
import { createReadStream, createWriteStream, existsSync, statSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { app } from 'electron'
import { getDb } from '../database/connection'

export interface UpdateInfo {
  version: string
  releaseNotes: string
  fileSize: number
  checksum: string
  isAvailable: boolean
  isMandatory: boolean
  downloadUrl?: string
}

export interface UpdateProgress {
  percent: number
  bytesDownloaded: number
  totalBytes: number
  status: 'idle' | 'checking' | 'downloading' | 'verifying' | 'ready' | 'error'
  error?: string
}

// ==========================================
// MASTER — إدارة التحديثات
// ==========================================

export function publishUpdate(filePath: string, version: string, releaseNotes: string, isMandatory = false): {
  success: boolean
  checksum?: string
  error?: string
} {
  try {
    if (!existsSync(filePath)) return { success: false, error: 'Fichier introuvable' }

    const fileSize = statSync(filePath).size
    const checksum = computeFileChecksum(filePath)

    // نسخ الملف إلى مجلد التحديثات
    const updatesDir = join(app.getPath('userData'), 'updates')
    mkdirSync(updatesDir, { recursive: true })
    const destName = `erp-update-${version}${getExtension(filePath)}`
    const destPath = join(updatesDir, destName)

    // نسخ الملف
    const src = createReadStream(filePath)
    const dst = createWriteStream(destPath)
    src.pipe(dst)

    const db = getDb()
    db.prepare(`
      INSERT INTO update_manifest (version, release_notes, file_path, file_size, checksum, is_mandatory)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(version) DO UPDATE SET
        release_notes = excluded.release_notes,
        file_path = excluded.file_path,
        file_size = excluded.file_size,
        checksum = excluded.checksum,
        is_mandatory = excluded.is_mandatory
    `).run(version, releaseNotes, destPath, fileSize, checksum, isMandatory ? 1 : 0)

    return { success: true, checksum }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export function getLatestUpdate(): UpdateInfo | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT * FROM update_manifest ORDER BY released_at DESC LIMIT 1
  `).get() as any
  if (!row) return null

  const currentVersion = app.getVersion?.() ?? '1.0.0'
  const isAvailable = compareVersions(row.version, currentVersion) > 0

  return {
    version: row.version,
    releaseNotes: row.release_notes ?? '',
    fileSize: row.file_size ?? 0,
    checksum: row.checksum,
    isAvailable,
    isMandatory: row.is_mandatory === 1,
  }
}

export function getUpdateFilePath(version: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT file_path FROM update_manifest WHERE version = ?').get(version) as any
  if (!row || !existsSync(row.file_path)) return null
  return row.file_path
}

export function listUpdates(): any[] {
  const db = getDb()
  return db.prepare('SELECT * FROM update_manifest ORDER BY released_at DESC').all() as any[]
}

// ==========================================
// CLIENT — تحقق وتنزيل التحديثات
// ==========================================

export async function checkForUpdate(serverUrl: string, apiKey: string): Promise<UpdateInfo | null> {
  try {
    const res = await fetchWithTimeout(`${serverUrl}/updates/latest`, {
      headers: { 'x-api-key': apiKey },
    }, 8000)
    if (!res.ok) return null
    const data = await res.json()
    return data as UpdateInfo
  } catch {
    return null
  }
}

export async function downloadUpdate(
  serverUrl: string,
  apiKey: string,
  version: string,
  onProgress: (p: UpdateProgress) => void
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    onProgress({ percent: 0, bytesDownloaded: 0, totalBytes: 0, status: 'downloading' })

    const res = await fetchWithTimeout(`${serverUrl}/updates/download/${version}`, {
      headers: { 'x-api-key': apiKey },
    }, 0) // no timeout for download

    if (!res.ok) return { success: false, error: `HTTP ${res.status}` }

    const totalBytes = parseInt(res.headers.get('content-length') ?? '0', 10)
    const downloadsDir = join(app.getPath('userData'), 'downloads')
    mkdirSync(downloadsDir, { recursive: true })

    const ext = res.headers.get('x-file-ext') ?? '.exe'
    const filePath = join(downloadsDir, `erp-update-${version}${ext}`)
    const writer = createWriteStream(filePath)

    let bytesDownloaded = 0
    const reader = res.body?.getReader()
    if (!reader) return { success: false, error: 'No response body' }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      writer.write(Buffer.from(value))
      bytesDownloaded += value.length
      const percent = totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0
      onProgress({ percent, bytesDownloaded, totalBytes, status: 'downloading' })
    }

    await new Promise<void>((resolve, reject) => {
      writer.end()
      writer.on('finish', resolve)
      writer.on('error', reject)
    })

    onProgress({ percent: 100, bytesDownloaded, totalBytes, status: 'verifying' })
    return { success: true, filePath }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export function verifyUpdateFile(filePath: string, expectedChecksum: string): boolean {
  try {
    const computed = computeFileChecksum(filePath)
    return computed === expectedChecksum
  } catch {
    return false
  }
}

export function installUpdate(filePath: string): void {
  // على Windows: تشغيل الـ installer وإغلاق التطبيق
  const { shell } = require('electron')
  shell.openPath(filePath)
  setTimeout(() => app.quit(), 1000)
}

// ==========================================
// HELPERS
// ==========================================

function computeFileChecksum(filePath: string): string {
  const hash = crypto.createHash('sha256')
  const buffer = require('fs').readFileSync(filePath)
  hash.update(buffer)
  return hash.digest('hex')
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function getExtension(filePath: string): string {
  const ext = filePath.split('.').pop()
  return ext ? `.${ext}` : '.bin'
}

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
