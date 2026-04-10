/**
 * Migration 009 — Network Sync & Update System
 * جداول نظام المزامنة والتحديثات
 */
import Database from 'better-sqlite3'

export function migration_009_network_sync(db: Database.Database): void {
  db.exec(`
    -- ==========================================
    -- DEVICE REGISTRY — سجل الأجهزة
    -- ==========================================
    CREATE TABLE IF NOT EXISTS devices (
      id          TEXT PRIMARY KEY,          -- UUID فريد للجهاز
      name        TEXT NOT NULL,             -- اسم الجهاز
      role        TEXT NOT NULL DEFAULT 'client', -- 'master' | 'client'
      api_key     TEXT NOT NULL UNIQUE,      -- مفتاح API خاص بكل جهاز
      ip_address  TEXT,
      last_seen   DATETIME,
      version     TEXT,                      -- إصدار التطبيق
      is_active   INTEGER DEFAULT 1,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ==========================================
    -- CHANGE LOG — سجل التغييرات للمزامنة
    -- ==========================================
    CREATE TABLE IF NOT EXISTS change_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id   TEXT NOT NULL,             -- الجهاز الذي أجرى التغيير
      table_name  TEXT NOT NULL,
      record_id   INTEGER NOT NULL,
      operation   TEXT NOT NULL,             -- 'INSERT' | 'UPDATE' | 'DELETE'
      data        TEXT,                      -- JSON snapshot of the record
      checksum    TEXT,                      -- SHA256 of data for integrity
      synced      INTEGER DEFAULT 0,         -- 0=pending, 1=synced
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_change_log_device   ON change_log(device_id);
    CREATE INDEX IF NOT EXISTS idx_change_log_synced   ON change_log(synced);
    CREATE INDEX IF NOT EXISTS idx_change_log_table    ON change_log(table_name);
    CREATE INDEX IF NOT EXISTS idx_change_log_created  ON change_log(created_at);

    -- ==========================================
    -- SYNC STATE — حالة المزامنة لكل جهاز
    -- ==========================================
    CREATE TABLE IF NOT EXISTS sync_state (
      device_id       TEXT PRIMARY KEY REFERENCES devices(id),
      last_pull_at    DATETIME,              -- آخر سحب من الـ master
      last_push_at    DATETIME,              -- آخر دفع إلى الـ master
      last_change_id  INTEGER DEFAULT 0,     -- آخر change_log.id تمت مزامنته
      status          TEXT DEFAULT 'idle',   -- 'idle'|'syncing'|'error'|'offline'
      error_message   TEXT,
      pending_count   INTEGER DEFAULT 0,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ==========================================
    -- SYNC CONFLICTS — تعارضات المزامنة
    -- ==========================================
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name    TEXT NOT NULL,
      record_id     INTEGER NOT NULL,
      local_data    TEXT,                    -- JSON البيانات المحلية
      remote_data   TEXT,                    -- JSON البيانات من الـ master
      local_device  TEXT,
      remote_device TEXT,
      resolved      INTEGER DEFAULT 0,       -- 0=pending, 1=resolved
      resolution    TEXT,                    -- 'local'|'remote'|'manual'
      resolved_at   DATETIME,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ==========================================
    -- UPDATE MANIFEST — نظام التحديثات
    -- ==========================================
    CREATE TABLE IF NOT EXISTS update_manifest (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      version       TEXT NOT NULL UNIQUE,    -- '1.2.3'
      release_notes TEXT,
      file_path     TEXT NOT NULL,           -- مسار ملف التحديث على الـ master
      file_size     INTEGER,
      checksum      TEXT NOT NULL,           -- SHA256 للتحقق من سلامة الملف
      min_version   TEXT,                    -- الحد الأدنى للإصدار المطلوب
      is_mandatory  INTEGER DEFAULT 0,       -- تحديث إجباري؟
      released_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ==========================================
    -- OFFLINE QUEUE — طابور العمليات بدون اتصال
    -- ==========================================
    CREATE TABLE IF NOT EXISTS offline_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      operation   TEXT NOT NULL,             -- 'ipc_channel'
      payload     TEXT NOT NULL,             -- JSON
      priority    INTEGER DEFAULT 5,         -- 1=high, 10=low
      attempts    INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      status      TEXT DEFAULT 'pending',    -- 'pending'|'processing'|'done'|'failed'
      error       TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_offline_queue_status ON offline_queue(status, priority);
  `)
}
