/**
 * Tests — Écritures comptables par type de document
 * Couvre: équilibre débit/crédit, comptes corrects CGNC,
 *         paiements, import, avoir, BL, BR, FF
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_003_production } from '../../database/migrations/003_production'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createAccountingEntry, createPaymentEntry } from '../accounting.service'
import { createDocument, confirmDocument } from '../document.service'

jest.mock('../../database/connection', () => {
  let _db: any = null
  return { getDb: () => _db, __setDb: (db: any) => { _db = db } }
})
const getSetDb = () => require('../../database/connection').__setDb

function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migration_001_initial(db)
  migration_002_accounting(db)
  migration_003_production(db)
  migration_004_settings(db)
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (1,'Admin','a@b.ma','h','admin')`).run()
  db.prepare(`INSERT INTO clients (id,name) VALUES (1,'Client A')`).run()
  db.prepare(`INSERT INTO suppliers (id,name) VALUES (1,'Fournisseur A')`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (1,'P001','Produit A','pcs','finished',200,50,5,120)`).run()
  return db
}

function makeDoc(overrides: any = {}): any {
  return {
    id: 1, type: 'invoice', number: 'F-26-1',
    date: '2026-01-15', party_id: 1, party_type: 'client',
    total_ht: 1000, total_tva: 200, total_ttc: 1200,
    ...overrides,
  }
}

function makeLines(tva_rate = 20, total_ht = 1000, total_tva = 200): any[] {
  return [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate, total_ht, total_tva, total_ttc: total_ht + total_tva }]
}

function getJournalLines(db: Database.Database, entryId: number) {
  return db.prepare(`SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=?`).all(entryId) as any[]
}

function checkBalance(lines: any[]) {
  const totalDebit = lines.reduce((s: number, l: any) => s + l.debit, 0)
  const totalCredit = lines.reduce((s: number, l: any) => s + l.credit, 0)
  expect(totalDebit).toBeCloseTo(totalCredit, 2)
}

describe('Facture client (invoice) — Comptes CGNC', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('débit 3421 (Clients) = TTC', () => {
    const entryId = createAccountingEntry(db, makeDoc(), makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    const line = lines.find((l: any) => l.code === '3421' && l.debit > 0)
    expect(line).toBeDefined()
    expect(line.debit).toBeCloseTo(1200, 2)
  })

  it('crédit 7111 (Ventes marchandises) = HT', () => {
    const entryId = createAccountingEntry(db, makeDoc(), makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    const line = lines.find((l: any) => l.code === '7111' && l.credit > 0)
    expect(line).toBeDefined()
    expect(line.credit).toBeCloseTo(1000, 2)
  })

  it('crédit 4455 (TVA facturée) = TVA', () => {
    const entryId = createAccountingEntry(db, makeDoc(), makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    const line = lines.find((l: any) => l.code === '4455' && l.credit > 0)
    expect(line).toBeDefined()
    expect(line.credit).toBeCloseTo(200, 2)
  })

  it('quid équilibré (débit = crédit)', () => {
    const entryId = createAccountingEntry(db, makeDoc(), makeLines(), 1)!
    checkBalance(getJournalLines(db, entryId))
  })

  it('TVA groupée par taux: 14% et 20% → deux lignes 4455', () => {
    const multiLines = [
      { product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20, total_ht: 1000, total_tva: 200, total_ttc: 1200 },
      { product_id: 1, quantity: 5, unit_price: 100, tva_rate: 14, total_ht: 500, total_tva: 70, total_ttc: 570 },
    ]
    const doc = makeDoc({ total_ht: 1500, total_tva: 270, total_ttc: 1770 })
    const entryId = createAccountingEntry(db, doc, multiLines, 1)!
    const lines = getJournalLines(db, entryId)
    const tvaLines = lines.filter((l: any) => l.code === '4455' && l.credit > 0)
    expect(tvaLines).toHaveLength(2)
    checkBalance(lines)
  })

  it('retourne null pour un type sans handler (quote)', () => {
    const result = createAccountingEntry(db, makeDoc({ type: 'quote' }), makeLines(), 1)
    expect(result).toBeNull()
  })
})

describe('Facture fournisseur (purchase_invoice) — Comptes CGNC', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('débit 6121 (Achats matières) = HT', () => {
    const doc = makeDoc({ type: 'purchase_invoice', party_type: 'supplier' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '6121' && l.debit > 0)?.debit).toBeCloseTo(1000, 2)
  })

  it('débit 3455 (TVA récupérable) = TVA', () => {
    const doc = makeDoc({ type: 'purchase_invoice', party_type: 'supplier' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '3455' && l.debit > 0)?.debit).toBeCloseTo(200, 2)
  })

  it('crédit 4411 (Fournisseurs) = TTC', () => {
    const doc = makeDoc({ type: 'purchase_invoice', party_type: 'supplier' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '4411' && l.credit > 0)?.credit).toBeCloseTo(1200, 2)
  })

  it('quid équilibré', () => {
    const doc = makeDoc({ type: 'purchase_invoice', party_type: 'supplier' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    checkBalance(getJournalLines(db, entryId))
  })
})

describe('Bon de réception (bl_reception) — Comptes CGNC', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('débit 3121 (Stock matières) = HT', () => {
    const doc = makeDoc({ type: 'bl_reception', party_type: 'supplier' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '3121' && l.debit > 0)).toBeDefined()
  })

  it('débit 3455 (TVA récupérable) = TVA', () => {
    const doc = makeDoc({ type: 'bl_reception', party_type: 'supplier' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '3455' && l.debit > 0)).toBeDefined()
  })

  it('crédit 4411 (Fournisseurs) = TTC', () => {
    const doc = makeDoc({ type: 'bl_reception', party_type: 'supplier' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '4411' && l.credit > 0)).toBeDefined()
  })

  it('quid équilibré', () => {
    const doc = makeDoc({ type: 'bl_reception', party_type: 'supplier' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    checkBalance(getJournalLines(db, entryId))
  })
})

describe('Avoir client (avoir) — Comptes CGNC', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('débit 7111 (Ventes) = HT', () => {
    const doc = makeDoc({ type: 'avoir' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '7111' && l.debit > 0)).toBeDefined()
  })

  it('débit 4455 (TVA facturée) = TVA', () => {
    const doc = makeDoc({ type: 'avoir' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '4455' && l.debit > 0)).toBeDefined()
  })

  it('crédit 3421 (Clients) = TTC', () => {
    const doc = makeDoc({ type: 'avoir' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '3421' && l.credit > 0)).toBeDefined()
  })

  it('quid équilibré', () => {
    const doc = makeDoc({ type: 'avoir' })
    const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
    checkBalance(getJournalLines(db, entryId))
  })
})

describe('Paiements (createPaymentEntry) — Comptes CGNC', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('client virement: débit 5141 (Banque), crédit 3421 (Clients)', () => {
    const entryId = createPaymentEntry(db, { id: 1, party_id: 1, party_type: 'client', amount: 1200, method: 'bank', date: '2026-01-20' }, 1)
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '5141' && l.debit > 0)?.debit).toBeCloseTo(1200, 2)
    expect(lines.find((l: any) => l.code === '3421' && l.credit > 0)?.credit).toBeCloseTo(1200, 2)
    checkBalance(lines)
  })

  it('client espèces: débit 5161 (Caisse), crédit 3421 (Clients)', () => {
    const entryId = createPaymentEntry(db, { id: 2, party_id: 1, party_type: 'client', amount: 500, method: 'cash', date: '2026-01-20' }, 1)
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '5161' && l.debit > 0)).toBeDefined()
    expect(lines.find((l: any) => l.code === '3421' && l.credit > 0)).toBeDefined()
    checkBalance(lines)
  })

  it('fournisseur virement: débit 4411 (Fournisseurs), crédit 5141 (Banque)', () => {
    const entryId = createPaymentEntry(db, { id: 3, party_id: 1, party_type: 'supplier', amount: 800, method: 'bank', date: '2026-01-20' }, 1)
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '4411' && l.debit > 0)).toBeDefined()
    expect(lines.find((l: any) => l.code === '5141' && l.credit > 0)).toBeDefined()
    checkBalance(lines)
  })

  it('fournisseur espèces: débit 4411, crédit 5161', () => {
    const entryId = createPaymentEntry(db, { id: 4, party_id: 1, party_type: 'supplier', amount: 300, method: 'cash', date: '2026-01-20' }, 1)
    const lines = getJournalLines(db, entryId)
    expect(lines.find((l: any) => l.code === '4411' && l.debit > 0)).toBeDefined()
    expect(lines.find((l: any) => l.code === '5161' && l.credit > 0)).toBeDefined()
    checkBalance(lines)
  })
})

describe('Facture import (import_invoice) — Comptes CGNC', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('débit 3121 (Stock) = total_cost - tva_import', () => {
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (1,'import_invoice','IMP-26-1','2026-01-15',1,'supplier','draft',5000,0,5000)`).run()
    db.prepare(`INSERT INTO doc_import_invoices (document_id,currency,exchange_rate,invoice_amount,customs,transitaire,tva_import,other_costs,total_cost)
      VALUES (1,'EUR',10.8,400,500,200,300,100,5400)`).run()

    const doc = makeDoc({ type: 'import_invoice', party_type: 'supplier', total_ht: 5000, total_tva: 0, total_ttc: 5000 })
    const entryId = createAccountingEntry(db, doc, [], 1)!
    const lines = getJournalLines(db, entryId)
    const stockLine = lines.find((l: any) => l.code === '3121' && l.debit > 0)
    expect(stockLine?.debit).toBeCloseTo(5100, 2) // 5400 - 300
  })

  it('débit 3455 (TVA import récupérable)', () => {
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (1,'import_invoice','IMP-26-1','2026-01-15',1,'supplier','draft',5000,0,5000)`).run()
    db.prepare(`INSERT INTO doc_import_invoices (document_id,currency,exchange_rate,invoice_amount,customs,transitaire,tva_import,other_costs,total_cost)
      VALUES (1,'EUR',10.8,400,500,200,300,100,5400)`).run()

    const doc = makeDoc({ type: 'import_invoice', party_type: 'supplier', total_ht: 5000, total_tva: 0, total_ttc: 5000 })
    const entryId = createAccountingEntry(db, doc, [], 1)!
    const lines = getJournalLines(db, entryId)
    const tvaLine = lines.find((l: any) => l.code === '3455' && l.debit > 0)
    expect(tvaLine?.debit).toBeCloseTo(300, 2)
  })

  it('crédit 4411 (Fournisseur étranger) = invoice_amount × exchange_rate', () => {
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (1,'import_invoice','IMP-26-1','2026-01-15',1,'supplier','draft',5000,0,5000)`).run()
    db.prepare(`INSERT INTO doc_import_invoices (document_id,currency,exchange_rate,invoice_amount,customs,transitaire,tva_import,other_costs,total_cost)
      VALUES (1,'EUR',10.8,400,500,200,300,100,5400)`).run()

    const doc = makeDoc({ type: 'import_invoice', party_type: 'supplier', total_ht: 5000, total_tva: 0, total_ttc: 5000 })
    const entryId = createAccountingEntry(db, doc, [], 1)!
    const lines = getJournalLines(db, entryId)
    const fourn = lines.find((l: any) => l.code === '4411' && l.credit > 0)
    expect(fourn?.credit).toBeCloseTo(4320, 2) // 400 × 10.8
  })
})

describe('BL autonome (sans facture liée) — Comptes CGNC', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BL autonome: débit 3421 (Clients), crédit 7111 (Ventes), crédit 4455 (TVA)', () => {
    const { id } = createDocument({
      type: 'bl', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='bl' AND source_id=?`).get(id) as any
    const lines = getJournalLines(db, entry.id)
    expect(lines.find((l: any) => l.code === '3421' && l.debit > 0)).toBeDefined()
    expect(lines.find((l: any) => l.code === '7111' && l.credit > 0)).toBeDefined()
    expect(lines.find((l: any) => l.code === '4455' && l.credit > 0)).toBeDefined()
  })

  it('BL lié à une facture: pas de ligne 3421 (pas de double vente)', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(invId, 1)

    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, blId, 'invoice_to_bl')
    confirmDocument(blId, 1)

    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='bl' AND source_id=?`).get(blId) as any
    const lines = getJournalLines(db, entry.id)
    const clientLine = lines.find((l: any) => l.code === '3421')
    expect(clientLine).toBeUndefined()
  })
})

describe('Équilibre général — tous les types', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('tous les quids sont équilibrés (débit = crédit)', () => {
    const types = [
      makeDoc({ type: 'invoice' }),
      makeDoc({ type: 'purchase_invoice', party_type: 'supplier' }),
      makeDoc({ type: 'bl_reception', party_type: 'supplier' }),
      makeDoc({ type: 'avoir' }),
    ]
    for (const doc of types) {
      const entryId = createAccountingEntry(db, doc, makeLines(), 1)!
      checkBalance(getJournalLines(db, entryId))
    }
  })

  it('quid comptable créé avec is_auto=1', () => {
    const entryId = createAccountingEntry(db, makeDoc(), makeLines(), 1)!
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id=?').get(entryId) as any
    expect(entry.is_auto).toBe(1)
  })

  it('quid comptable référence le bon document source', () => {
    const entryId = createAccountingEntry(db, makeDoc({ id: 1, type: 'invoice' }), makeLines(), 1)!
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id=?').get(entryId) as any
    expect(entry.source_type).toBe('invoice')
    expect(entry.source_id).toBe(1)
  })
})
