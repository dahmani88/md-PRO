/**
 * Migration 010 — Automatic Change Tracking Triggers
 * يُسجّل كل INSERT/UPDATE/DELETE تلقائياً في change_log
 */
import Database from 'better-sqlite3'

// الجداول التي لها عمود id وتحتاج تتبع
const TRACKED_WITH_ID = [
  'clients', 'suppliers', 'products',
  'documents', 'document_lines',
  'payments', 'stock_movements',
  'production_orders', 'bom_templates',
]

// الجداول التي تدعم soft delete
const SOFT_DELETE_TABLES = ['clients', 'suppliers', 'products', 'documents']

export function migration_010_change_tracking(db: Database.Database): void {
  for (const table of TRACKED_WITH_ID) {
    const exists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(table)
    if (!exists) continue

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_cl_${table}_insert
      AFTER INSERT ON ${table}
      BEGIN
        INSERT INTO change_log (device_id, table_name, record_id, operation, data)
        VALUES (
          COALESCE((SELECT value FROM app_settings WHERE key='device_id'), 'local'),
          '${table}',
          NEW.id,
          'INSERT',
          json_object('id', NEW.id)
        );
      END;

      CREATE TRIGGER IF NOT EXISTS trg_cl_${table}_update
      AFTER UPDATE ON ${table}
      BEGIN
        INSERT INTO change_log (device_id, table_name, record_id, operation, data)
        VALUES (
          COALESCE((SELECT value FROM app_settings WHERE key='device_id'), 'local'),
          '${table}',
          NEW.id,
          'UPDATE',
          json_object('id', NEW.id)
        );
      END;
    `)
  }

  for (const table of SOFT_DELETE_TABLES) {
    const exists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(table)
    if (!exists) continue

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_cl_${table}_delete
      AFTER UPDATE OF is_deleted ON ${table}
      WHEN NEW.is_deleted = 1
      BEGIN
        INSERT INTO change_log (device_id, table_name, record_id, operation, data)
        VALUES (
          COALESCE((SELECT value FROM app_settings WHERE key='device_id'), 'local'),
          '${table}',
          NEW.id,
          'DELETE',
          json_object('id', NEW.id)
        );
      END;
    `)
  }
}
