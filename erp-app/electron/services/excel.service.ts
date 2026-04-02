import ExcelJS from 'exceljs'
import { app } from 'electron'
import { join } from 'path'
import { getDb } from '../database/connection'

const PRIMARY = '1E3A5F'
const ACCENT  = 'F0A500'

function styleHeader(row: ExcelJS.Row) {
  row.eachCell(cell => {
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + PRIMARY } }
    cell.font   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF' + ACCENT } } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  row.height = 28
}

function autoWidth(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach(col => {
    let max = 10
    col.eachCell?.({ includeEmpty: false }, cell => {
      const len = cell.value ? String(cell.value).length : 0
      if (len > max) max = len
    })
    col.width = Math.min(max + 4, 50)
  })
}

// ==========================================
// EXPORT DOCUMENTS (Factures, Devis, etc.)
// ==========================================
export async function exportDocuments(filters: {
  type: string
  start_date?: string
  end_date?: string
}, filePath?: string): Promise<string> {
  const db = getDb()
  const params: any[] = [filters.type]
  let where = "WHERE d.type = ? AND d.is_deleted = 0"
  if (filters.start_date) { where += ' AND d.date >= ?'; params.push(filters.start_date) }
  if (filters.end_date)   { where += ' AND d.date <= ?'; params.push(filters.end_date) }

  const rows = db.prepare(`
    SELECT d.number, d.date, d.status,
      CASE d.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name,
      d.total_ht, d.total_tva, d.total_ttc
    FROM documents d
    LEFT JOIN clients   c ON c.id = d.party_id AND d.party_type = 'client'
    LEFT JOIN suppliers s ON s.id = d.party_id AND d.party_type = 'supplier'
    ${where}
    ORDER BY d.date DESC
  `).all(...params) as any[]

  const wb = new ExcelJS.Workbook()
  wb.creator = 'ERP Pro'
  const ws = wb.addWorksheet('Documents')

  ws.addRow(['Numéro', 'Date', 'Partie', 'Total HT', 'TVA', 'Total TTC', 'Statut'])
  styleHeader(ws.lastRow!)

  for (const r of rows) {
    const row = ws.addRow([
      r.number,
      new Date(r.date).toLocaleDateString('fr-FR'),
      r.party_name ?? '—',
      r.total_ht, r.total_tva, r.total_ttc,
      r.status,
    ])
    // Format monétaire
    ;[4, 5, 6].forEach(i => {
      row.getCell(i).numFmt = '#,##0.00 "MAD"'
    })
  }

  // Totaux
  const totalRow = ws.addRow([
    'TOTAL', '', '',
    rows.reduce((s, r) => s + r.total_ht, 0),
    rows.reduce((s, r) => s + r.total_tva, 0),
    rows.reduce((s, r) => s + r.total_ttc, 0),
    '',
  ])
  totalRow.eachCell(cell => {
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } }
  })
  ;[4, 5, 6].forEach(i => { totalRow.getCell(i).numFmt = '#,##0.00 "MAD"' })

  autoWidth(ws)

  const fileName = `documents-${filters.type}-${Date.now()}.xlsx`
  const resolvedPath = filePath ?? join(app.getPath('downloads'), fileName)
  await wb.xlsx.writeFile(resolvedPath)
  return resolvedPath
}

// ==========================================
// EXPORT CLIENTS / SUPPLIERS
// ==========================================
export async function exportParties(type: 'client' | 'supplier', filePath?: string): Promise<string> {
  const db = getDb()
  const table = type === 'client' ? 'clients' : 'suppliers'

  const rows = db.prepare(`SELECT * FROM ${table} WHERE is_deleted = 0 ORDER BY name ASC`).all() as any[]

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(type === 'client' ? 'Clients' : 'Fournisseurs')

  ws.addRow(['Nom', 'ICE', 'IF', 'RC', 'Téléphone', 'Email', 'Adresse'])
  styleHeader(ws.lastRow!)

  for (const r of rows) {
    ws.addRow([r.name, r.ice ?? '', r.if_number ?? '', r.rc ?? '', r.phone ?? '', r.email ?? '', r.address ?? ''])
  }

  autoWidth(ws)

  const fileName = `${table}-${Date.now()}.xlsx`
  const resolvedPath = filePath ?? join(app.getPath('downloads'), fileName)
  await wb.xlsx.writeFile(resolvedPath)
  return resolvedPath
}

// ==========================================
// EXPORT STOCK
// ==========================================
export async function exportStock(filePath?: string): Promise<string> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT p.code, p.name, p.unit, p.type, p.stock_quantity, p.cmup_price,
      p.stock_quantity * p.cmup_price as stock_value, p.min_stock,
      CASE WHEN p.stock_quantity <= p.min_stock THEN 'Bas' ELSE 'OK' END as etat
    FROM products p WHERE p.is_deleted = 0 ORDER BY p.name ASC
  `).all() as any[]

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Inventaire Stock')

  ws.addRow(['Code', 'Désignation', 'Unité', 'Type', 'Stock', 'CMUP', 'Valeur Stock', 'Stock Min', 'État'])
  styleHeader(ws.lastRow!)

  for (const r of rows) {
    const row = ws.addRow([
      r.code, r.name, r.unit, r.type,
      r.stock_quantity, r.cmup_price, r.stock_value,
      r.min_stock, r.etat,
    ])
    ;[6, 7].forEach(i => { row.getCell(i).numFmt = '#,##0.00 "MAD"' })
    if (r.etat === 'Bas') {
      row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } } })
    }
  }

  autoWidth(ws)

  const fileName = `stock-${Date.now()}.xlsx`
  const resolvedPath = filePath ?? join(app.getPath('downloads'), fileName)
  await wb.xlsx.writeFile(resolvedPath)
  return resolvedPath
}

// ==========================================
// EXPORT BALANCE
// ==========================================
export async function exportBalance(filters: { start_date?: string; end_date?: string }, filePath?: string): Promise<string> {
  const db = getDb()
  const params: any[] = []
  let dateFilter = ''
  if (filters.start_date) { dateFilter += ' AND je.date >= ?'; params.push(filters.start_date) }
  if (filters.end_date)   { dateFilter += ' AND je.date <= ?'; params.push(filters.end_date) }

  const rows = db.prepare(`
    SELECT a.code, a.name, a.type, a.class,
      COALESCE(SUM(jl.debit), 0)  as total_debit,
      COALESCE(SUM(jl.credit), 0) as total_credit,
      COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as balance
    FROM accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.entry_id
    WHERE a.is_active = 1 ${dateFilter}
    GROUP BY a.id
    HAVING total_debit > 0 OR total_credit > 0
    ORDER BY a.code ASC
  `).all(...params) as any[]

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Balance')

  ws.addRow(['Code', 'Intitulé', 'Classe', 'Total Débit', 'Total Crédit', 'Solde Débiteur', 'Solde Créditeur'])
  styleHeader(ws.lastRow!)

  for (const r of rows) {
    const solde = r.total_debit - r.total_credit
    const row = ws.addRow([
      r.code, r.name, r.class,
      r.total_debit, r.total_credit,
      solde > 0 ? solde : 0,
      solde < 0 ? Math.abs(solde) : 0,
    ])
    ;[4, 5, 6, 7].forEach(i => { row.getCell(i).numFmt = '#,##0.00' })
  }

  autoWidth(ws)

  const fileName = `balance-${Date.now()}.xlsx`
  const resolvedPath = filePath ?? join(app.getPath('downloads'), fileName)
  await wb.xlsx.writeFile(resolvedPath)
  return resolvedPath
}

// ==========================================
// EXPORT GENERIC REPORT DATA
// ==========================================
export async function exportReportData(
  reportType: string,
  data: any[],
  filters: Record<string, any>,
  filePath?: string
): Promise<string> {
  if (data.length === 0) throw new Error('Aucune donnée à exporter')

  const wb = new ExcelJS.Workbook()
  wb.creator = 'ERP Pro'

  const REPORT_NAMES: Record<string, string> = {
    sales:          'Rapport Ventes',
    purchases:      'Rapport Achats',
    stock:          'Inventaire Stock',
    stock_movements:'Mouvements Stock',
    receivables:    'Créances Clients',
    cheques:        'Chèques & LCN',
    tva_detail:     'TVA Détaillée',
    profit_loss:    'Résultat P&L',
  }

  const ws = wb.addWorksheet(REPORT_NAMES[reportType] ?? 'Rapport')

  // En-tête avec les colonnes du premier objet
  const keys = Object.keys(data[0]).filter(k => !k.startsWith('_'))
  ws.addRow(keys.map(k => k.replace(/_/g, ' ').toUpperCase()))
  styleHeader(ws.lastRow!)

  for (const row of data) {
    const values = keys.map(k => {
      const v = row[k]
      if (typeof v === 'number') return v
      if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(v).toLocaleDateString('fr-FR')
      return v ?? ''
    })
    const wsRow = ws.addRow(values)
    // Format monétaire pour les colonnes numériques
    keys.forEach((k, i) => {
      if (typeof row[k] === 'number' && (k.includes('amount') || k.includes('total') || k.includes('montant') || k.includes('solde') || k.includes('cost'))) {
        wsRow.getCell(i + 1).numFmt = '#,##0.00 "MAD"'
      }
    })
  }

  autoWidth(ws)

  const fileName = `${reportType}-${Date.now()}.xlsx`
  const resolvedPath = filePath ?? join(app.getPath('downloads'), fileName)
  await wb.xlsx.writeFile(resolvedPath)
  return resolvedPath
}

// ==========================================
// EXPORT MULTIPLE REPORTS IN ONE FILE
// ==========================================
export async function exportMultipleReports(
  reports: Array<{ type: string; label: string; rows: any[] }>,
  filePath: string
): Promise<string> {
  if (reports.length === 0) throw new Error('Aucun rapport à exporter')

  const wb = new ExcelJS.Workbook()
  wb.creator = 'ERP Pro'

  for (const report of reports) {
    if (report.rows.length === 0) continue

    // Nom de l'onglet (max 31 caractères pour Excel)
    const sheetName = report.label.substring(0, 31)
    const ws = wb.addWorksheet(sheetName)

    const keys = Object.keys(report.rows[0]).filter(k => !k.startsWith('_'))

    // En-tête
    ws.addRow(keys.map(k => k.replace(/_/g, ' ').toUpperCase()))
    styleHeader(ws.lastRow!)

    // Données
    for (const row of report.rows) {
      const values = keys.map(k => {
        const v = row[k]
        if (typeof v === 'number') return v
        if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(v).toLocaleDateString('fr-FR')
        return v ?? ''
      })
      const wsRow = ws.addRow(values)
      keys.forEach((k, i) => {
        if (typeof row[k] === 'number' && (k.includes('amount') || k.includes('total') || k.includes('balance') || k.includes('cost'))) {
          wsRow.getCell(i + 1).numFmt = '#,##0.00 "MAD"'
        }
      })
    }

    autoWidth(ws)
  }

  await wb.xlsx.writeFile(filePath)
  return filePath
}

