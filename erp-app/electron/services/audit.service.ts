import Database from 'better-sqlite3'

export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE'
  | 'CONFIRM' | 'CANCEL'
  | 'LOGIN' | 'LOGOUT'
  | 'PAYMENT' | 'APPLY_STOCK'

export interface AuditEntry {
  user_id: number
  action: AuditAction
  table_name: string
  record_id?: number
  old_values?: Record<string, unknown>
  new_values?: Record<string, unknown>
  reason?: string
}

export interface AuditFilters {
  user_id?: number
  action?: AuditAction
  table_name?: string
  start_date?: string
  end_date?: string
  page?: number
  limit?: number
}

export function logAudit(db: Database.Database, entry: AuditEntry): void {
  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, action, table_name, record_id, old_values, new_values, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.user_id,
      entry.action,
      entry.table_name,
      entry.record_id ?? null,
      entry.old_values ? JSON.stringify(entry.old_values) : null,
      entry.new_values ? JSON.stringify(entry.new_values) : null,
      entry.reason ?? null
    )
  } catch {
    // Audit ne doit jamais bloquer l'opération principale
  }
}

export function getAuditLog(db: Database.Database, filters: AuditFilters = {}): {
  rows: any[]
  total: number
  page: number
  limit: number
} {
  const page  = filters.page  ?? 1
  const limit = filters.limit ?? 100
  const offset = (page - 1) * limit
  const params: any[] = []

  let where = 'WHERE 1=1'
  if (filters.user_id)    { where += ' AND al.user_id = ?';    params.push(filters.user_id) }
  if (filters.action)     { where += ' AND al.action = ?';     params.push(filters.action) }
  if (filters.table_name) { where += ' AND al.table_name = ?'; params.push(filters.table_name) }
  if (filters.start_date) { where += ' AND al.created_at >= ?'; params.push(filters.start_date) }
  if (filters.end_date)   { where += ' AND al.created_at <= ?'; params.push(filters.end_date + ' 23:59:59') }

  const rows = db.prepare(`
    SELECT al.*, u.name as user_name
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    ${where}
    ORDER BY al.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  const total = (db.prepare(`
    SELECT COUNT(*) as c FROM audit_log al ${where}
  `).get(...params) as any).c

  return {
    rows: rows.map(r => ({
      ...r,
      old_values: r.old_values ? JSON.parse(r.old_values) : null,
      new_values: r.new_values ? JSON.parse(r.new_values) : null,
    })),
    total,
    page,
    limit,
  }
}
