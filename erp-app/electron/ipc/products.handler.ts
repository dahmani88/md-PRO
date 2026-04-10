import { handle } from './index'
import { getDb } from '../database/connection'

export function registerProductHandlers(): void {
  handle('products:getAll', (filters?: { search?: string; type?: string; page?: number; limit?: number }) => {
    const db = getDb()
    const page  = filters?.page  ?? 1
    const limit = filters?.limit ?? 50
    const offset = (page - 1) * limit
    const params: any[] = []

    let query = 'SELECT p.*, t.rate as tva_rate_value FROM products p LEFT JOIN tva_rates t ON t.id = p.tva_rate_id WHERE p.is_deleted = 0'

    if (filters?.search) {
      query += ' AND (p.name LIKE ? OR p.code LIKE ?)'
      const s = `%${filters.search}%`
      params.push(s, s)
    }
    if (filters?.type) {
      query += ' AND p.type = ?'
      params.push(filters.type)
    }

    query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(query).all(...params)
    let countQ = 'SELECT COUNT(*) as c FROM products p WHERE p.is_deleted = 0'
    const countP: any[] = []
    if (filters?.search) { countQ += ' AND (p.name LIKE ? OR p.code LIKE ?)'; const s = `%${filters.search}%`; countP.push(s, s) }
    if (filters?.type)   { countQ += ' AND p.type = ?'; countP.push(filters.type) }
    const total = (db.prepare(countQ).get(...countP) as any).c
    return { rows, total, page, limit }
  })

  handle('products:getOne', (id: number) => {
    const db = getDb()
    const product = db.prepare(`
      SELECT p.*, t.rate as tva_rate_value, t.label as tva_label
      FROM products p
      LEFT JOIN tva_rates t ON t.id = p.tva_rate_id
      WHERE p.id = ? AND p.is_deleted = 0
    `).get(id)
    if (!product) throw new Error('Produit introuvable')
    return product
  })

  handle('products:create', (data) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO products (code, name, unit, type, min_stock, sale_price, tva_rate_id, supplier_id, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.code, data.name, data.unit ?? 'unité', data.type ?? 'finished',
      data.min_stock ?? 0, data.sale_price ?? 0, data.tva_rate_id ?? 5,
      data.supplier_id ?? null, data.notes ?? null, data.created_by ?? 1
    )
    return { id: result.lastInsertRowid }
  })

  handle('products:update', (data) => {
    const db = getDb()
    db.prepare(`
      UPDATE products SET code=?, name=?, unit=?, type=?, min_stock=?, sale_price=?,
        tva_rate_id=?, supplier_id=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(
      data.code, data.name, data.unit, data.type, data.min_stock,
      data.sale_price, data.tva_rate_id, data.supplier_id, data.notes, data.id
    )
    return { success: true }
  })

  handle('products:delete', (id: number) => {
    const db = getDb()
    db.prepare('UPDATE products SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
    return { success: true }
  })
}
