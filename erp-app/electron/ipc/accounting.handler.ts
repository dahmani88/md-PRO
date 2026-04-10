import { handle } from './index'
import { getDb } from '../database/connection'

export function registerAccountingHandlers(): void {
  handle('accounting:getAccounts', (filters?: { search?: string; class?: number }) => {
    const db = getDb()
    let query = 'SELECT * FROM accounts WHERE is_active = 1'
    const params: any[] = []
    if (filters?.search) { query += ' AND (code LIKE ? OR name LIKE ?)'; const s = `%${filters.search}%`; params.push(s, s) }
    if (filters?.class)  { query += ' AND class = ?'; params.push(filters.class) }
    query += ' ORDER BY code ASC'
    return db.prepare(query).all(...params)
  })

  handle('accounting:getEntries', (filters?: { period_id?: number; source_type?: string; start_date?: string; end_date?: string; page?: number; limit?: number }) => {
    const db = getDb()
    const page  = filters?.page  ?? 1
    const limit = filters?.limit ?? 50
    const offset = (page - 1) * limit
    const params: any[] = []

    let query = 'SELECT je.*, u.name as created_by_name FROM journal_entries je LEFT JOIN users u ON u.id = je.created_by WHERE 1=1'
    if (filters?.period_id)   { query += ' AND je.period_id = ?';   params.push(filters.period_id) }
    if (filters?.source_type) { query += ' AND je.source_type = ?'; params.push(filters.source_type) }
    if (filters?.start_date)  { query += ' AND je.date >= ?';       params.push(filters.start_date) }
    if (filters?.end_date)    { query += ' AND je.date <= ?';       params.push(filters.end_date) }
    query += ' ORDER BY je.date DESC, je.id DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(query).all(...params) as any[]

    // إضافة سطور كل قيد
    return rows.map(entry => ({
      ...entry,
      lines: db.prepare(`
        SELECT jl.*, a.code as account_code, a.name as account_name
        FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ?
      `).all(entry.id),
    }))
  })

  handle('accounting:getGrandLivre', (filters: { account_id: number; start_date?: string; end_date?: string }) => {
    const db = getDb()
    const params: any[] = [filters.account_id]
    let dateFilter = ''
    if (filters.start_date) { dateFilter += ' AND je.date >= ?'; params.push(filters.start_date) }
    if (filters.end_date)   { dateFilter += ' AND je.date <= ?'; params.push(filters.end_date) }

    const lines = db.prepare(`
      SELECT jl.*, je.date, je.reference, je.description
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      WHERE jl.account_id = ? ${dateFilter}
      ORDER BY je.date ASC, je.id ASC
    `).all(...params) as any[]

    // رصيد تراكمي
    let balance = 0
    return lines.map(line => {
      balance += line.debit - line.credit
      return { ...line, balance }
    })
  })

  handle('accounting:getBalance', (filters?: { start_date?: string; end_date?: string }) => {
    const db = getDb()
    const params: any[] = []
    let dateFilter = ''
    if (filters?.start_date) { dateFilter += ' AND je.date >= ?'; params.push(filters.start_date) }
    if (filters?.end_date)   { dateFilter += ' AND je.date <= ?'; params.push(filters.end_date) }

    return db.prepare(`
      SELECT a.code, a.name, a.type, a.class,
        COALESCE(SUM(jl.debit), 0)  as total_debit,
        COALESCE(SUM(jl.credit), 0) as total_credit,
        COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as balance
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jl.entry_id
      WHERE a.is_active = 1 ${dateFilter}
      GROUP BY a.id
      ORDER BY a.code ASC
    `).all(...params)
  })

  handle('accounting:getTva', (filters: { start_date: string; end_date: string }) => {
    const db = getDb()

    const collectee = db.prepare(`
      SELECT jl.notes as tva_rate, SUM(jl.credit) as amount
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE a.code = '4455' AND je.date BETWEEN ? AND ?
      GROUP BY jl.notes
    `).all(filters.start_date, filters.end_date)

    const recuperable = db.prepare(`
      SELECT jl.notes as tva_rate, SUM(jl.debit) as amount
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE a.code = '3455' AND je.date BETWEEN ? AND ?
      GROUP BY jl.notes
    `).all(filters.start_date, filters.end_date)

    const totalCollectee  = (collectee  as any[]).reduce((s, r) => s + r.amount, 0)
    const totalRecuperable = (recuperable as any[]).reduce((s, r) => s + r.amount, 0)

    return {
      collectee,
      recuperable,
      totalCollectee,
      totalRecuperable,
      tvaDue: totalCollectee - totalRecuperable,
    }
  })

  handle('accounting:getPeriods', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM accounting_periods ORDER BY start_date DESC').all()
  })

  handle('accounting:closePeriod', (id: number) => {
    const db = getDb()
    db.prepare(`UPDATE accounting_periods SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
    return { success: true }
  })

  handle('accounting:getTvaRates', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM tva_rates ORDER BY rate ASC').all()
  })

  handle('accounting:createTvaRate', (data: { rate: number; label: string }) => {
    const db = getDb()
    if (data.rate < 0 || data.rate > 100) throw new Error('Le taux doit être entre 0 et 100')
    const existing = db.prepare('SELECT id FROM tva_rates WHERE rate = ?').get(data.rate)
    if (existing) throw new Error(`Le taux ${data.rate}% existe déjà`)
    const result = db.prepare('INSERT INTO tva_rates (rate, label, is_active) VALUES (?, ?, 1)').run(
      data.rate,
      data.label || `TVA ${data.rate}%`
    )
    return { id: result.lastInsertRowid }
  })

  handle('accounting:createAccount', (data: { code: string; name: string; type: string; class: number; parent_id?: number }) => {
    const db = getDb()
    if (!data.code?.trim() || !data.name?.trim()) throw new Error('Code et intitulé requis')
    const existing = db.prepare('SELECT id FROM accounts WHERE code = ?').get(data.code.trim())
    if (existing) throw new Error(`Le compte ${data.code} existe déjà`)
    const result = db.prepare(`
      INSERT INTO accounts (code, name, type, class, parent_id, is_active, is_system)
      VALUES (?, ?, ?, ?, ?, 1, 0)
    `).run(data.code.trim(), data.name.trim(), data.type, data.class, data.parent_id ?? null)
    return { id: result.lastInsertRowid }
  })

  handle('accounting:createEntry', (data) => {
    const db = getDb()
    const tx = db.transaction(() => {
      const entry = db.prepare(`
        INSERT INTO journal_entries (date, reference, description, is_auto, created_by)
        VALUES (?, ?, ?, 0, ?)
      `).run(data.date, data.reference ?? null, data.description, data.created_by ?? 1)

      const entryId = entry.lastInsertRowid as number

      for (const line of data.lines) {
        db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit, notes) VALUES (?, ?, ?, ?, ?)').run(
          entryId, line.account_id, line.debit ?? 0, line.credit ?? 0, line.notes ?? null
        )
      }
      return { id: entryId }
    })
    return tx()
  })
}
