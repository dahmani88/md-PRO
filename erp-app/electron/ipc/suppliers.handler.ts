import { handle } from './index'
import { getDb } from '../database/connection'

export function registerSupplierHandlers(): void {
  handle('suppliers:getAll', (filters?: { search?: string; page?: number; limit?: number }) => {
    const db = getDb()
    const page  = filters?.page  ?? 1
    const limit = filters?.limit ?? 50
    const offset = (page - 1) * limit

    let query = 'SELECT * FROM suppliers WHERE is_deleted = 0'
    const params: any[] = []

    if (filters?.search) {
      query += ' AND (name LIKE ? OR ice LIKE ? OR phone LIKE ?)'
      const s = `%${filters.search}%`
      params.push(s, s, s)
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(query).all(...params)
    const countQuery = filters?.search
      ? `SELECT COUNT(*) as c FROM suppliers WHERE is_deleted = 0 AND (name LIKE ? OR ice LIKE ? OR phone LIKE ?)`
      : `SELECT COUNT(*) as c FROM suppliers WHERE is_deleted = 0`
    const countParams = filters?.search ? [`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`] : []
    const total = (db.prepare(countQuery).get(...countParams) as any).c

    // إضافة balance لكل مورد
    const rowsWithBalance = (rows as any[]).map(supplier => {
      const invRow = (db.prepare(`
        SELECT COALESCE(SUM(total_ttc), 0) as t FROM documents
        WHERE party_id=? AND party_type='supplier'
          AND type IN ('purchase_invoice','import_invoice')
          AND is_deleted=0 AND status IN ('confirmed','partial','paid','delivered')
      `).get(supplier.id) as any)
      const payRow = (db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as t FROM payments
        WHERE party_id=? AND party_type='supplier'
          AND NOT (method IN ('cheque','lcn') AND status='pending')
          AND status != 'bounced'
      `).get(supplier.id) as any)
      const balance = (invRow.t ?? 0) - (payRow.t ?? 0)
      return { ...supplier, balance }
    })

    return { rows: rowsWithBalance, total, page, limit }
  })

  handle('suppliers:getOne', (id: number) => {
    const db = getDb()
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND is_deleted = 0').get(id)
    if (!supplier) throw new Error('Fournisseur introuvable')

    // Solde: somme des TTC non payées (fac confirmées uniquement)
    const invRow2 = (db.prepare(`
      SELECT COALESCE(SUM(total_ttc), 0) as t FROM documents
      WHERE party_id=? AND party_type='supplier'
        AND type IN ('purchase_invoice','import_invoice')
        AND is_deleted=0 AND status IN ('confirmed','partial','paid','delivered')
    `).get(id) as any)
    const payRow2 = (db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as t FROM payments
      WHERE party_id=? AND party_type='supplier'
        AND NOT (method IN ('cheque','lcn') AND status='pending')
        AND status != 'bounced'
    `).get(id) as any)
    const balance = (invRow2.t ?? 0) - (payRow2.t ?? 0)

    return { ...supplier, balance }
  })

  handle('suppliers:create', (data) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO suppliers (name, address, email, phone, ice, if_number, rc, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name, data.address ?? null, data.email ?? null, data.phone ?? null,
      data.ice ?? null, data.if_number ?? null, data.rc ?? null,
      data.notes ?? null, data.created_by ?? 1
    )
    return { id: result.lastInsertRowid }
  })

  handle('suppliers:update', (data) => {
    const db = getDb()
    db.prepare(`
      UPDATE suppliers SET name=?, address=?, email=?, phone=?, ice=?, if_number=?, rc=?,
        notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(data.name, data.address, data.email, data.phone, data.ice, data.if_number, data.rc, data.notes, data.id)
    return { success: true }
  })

  handle('suppliers:delete', (id: number) => {
    const db = getDb()
    db.prepare('UPDATE suppliers SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
    return { success: true }
  })
}
