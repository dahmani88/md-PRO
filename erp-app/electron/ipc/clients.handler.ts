import { handle } from './index'
import { getDb } from '../database/connection'

export function registerClientHandlers(): void {
  handle('clients:getAll', (filters?: { search?: string; page?: number; limit?: number }) => {
    const db = getDb()
    const page  = filters?.page  ?? 1
    const limit = filters?.limit ?? 50
    const offset = (page - 1) * limit

    let query = 'SELECT * FROM clients WHERE is_deleted = 0'
    const params: any[] = []

    if (filters?.search) {
      query += ' AND (name LIKE ? OR ice LIKE ? OR phone LIKE ?)'
      const s = `%${filters.search}%`
      params.push(s, s, s)
    }

    query += ' ORDER BY name ASC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(query).all(...params)
    const countQuery = filters?.search
      ? `SELECT COUNT(*) as c FROM clients WHERE is_deleted = 0 AND (name LIKE ? OR ice LIKE ? OR phone LIKE ?)`
      : `SELECT COUNT(*) as c FROM clients WHERE is_deleted = 0`
    const countParams = filters?.search ? [`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`] : []
    const total = (db.prepare(countQuery).get(...countParams) as any).c

    // إضافة balance لكل عميل
    const rowsWithBalance = (rows as any[]).map(client => {
      const balance = (db.prepare(`
        SELECT COALESCE(SUM(d.total_ttc), 0) - COALESCE(SUM(pa.amount), 0) as balance
        FROM documents d
        LEFT JOIN payment_allocations pa ON pa.document_id = d.id
        WHERE d.party_id = ? AND d.party_type = 'client'
          AND d.type = 'invoice' AND d.is_deleted = 0
          AND d.status IN ('confirmed', 'partial', 'paid')
      `).get(client.id) as any).balance
      return { ...client, balance }
    })

    return { rows: rowsWithBalance, total, page, limit }
  })

  handle('clients:getOne', (id: number) => {
    const db = getDb()
    const client = db.prepare('SELECT * FROM clients WHERE id = ? AND is_deleted = 0').get(id)
    if (!client) throw new Error('Client introuvable')

    // Solde: somme des TTC non payées (fac confirmées uniquement)
    const balance = (db.prepare(`
      SELECT COALESCE(SUM(d.total_ttc), 0) - COALESCE(SUM(pa.amount), 0) as balance
      FROM documents d
      LEFT JOIN payment_allocations pa ON pa.document_id = d.id
      WHERE d.party_id = ? AND d.party_type = 'client'
        AND d.type = 'invoice' AND d.is_deleted = 0
        AND d.status IN ('confirmed', 'partial', 'paid')
    `).get(id) as any).balance

    return { ...client, balance }
  })

  handle('clients:create', (data) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO clients (name, address, email, phone, ice, if_number, rc, credit_limit, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name, data.address ?? null, data.email ?? null, data.phone ?? null,
      data.ice ?? null, data.if_number ?? null, data.rc ?? null,
      data.credit_limit ?? 0, data.notes ?? null, data.created_by ?? 1
    )
    return { id: result.lastInsertRowid }
  })

  handle('clients:update', (data) => {
    const db = getDb()
    db.prepare(`
      UPDATE clients SET name=?, address=?, email=?, phone=?, ice=?, if_number=?, rc=?,
        credit_limit=?, notes=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      data.name, data.address, data.email, data.phone,
      data.ice, data.if_number, data.rc, data.credit_limit, data.notes, data.id
    )
    return { success: true }
  })

  handle('clients:delete', (id: number) => {
    const db = getDb()
    db.prepare('UPDATE clients SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
    return { success: true }
  })
}
