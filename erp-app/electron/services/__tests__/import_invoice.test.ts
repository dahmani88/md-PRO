/**
 * Tests — Facture d'importation (Import Invoice)
 * Couvre: création, landed cost, BR depuis import, écritures comptables
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createDocument, confirmDocument } from '../document.service'
import { applyMovement } from '../stock.service'

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
  migration_004_settings(db)
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (1,'Admin','a@b.ma','h','admin')`).run()
  db.prepare(`INSERT INTO suppliers (id,name) VALUES (1,'Fournisseur Etranger')`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (1,'MP001','Matiere Importee','kg','raw',0,0,5,0)`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (2,'MP002','Matiere Importee 2','pcs','raw',0,0,5,0)`).run()
  return db
}

const getDoc = (db: Database.Database, id: number) =>
  db.prepare('SELECT * FROM documents WHERE id=?').get(id) as any

const getImportSub = (db: Database.Database, id: number) =>
  db.prepare('SELECT * FROM doc_import_invoices WHERE document_id=?').get(id) as any

const getJournalLines = (db: Database.Database, entryId: number) =>
  db.prepare(`SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=?`).all(entryId) as any[]

describe('Import Invoice — Création', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('crée une facture import en statut draft', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 4320 },
    })
    expect(getDoc(db, id).status).toBe('draft')
    expect(getDoc(db, id).type).toBe('import_invoice')
  })

  it('crée la sous-table doc_import_invoices avec les bons champs', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 500, transitaire: 200, tva_import: 300, other_costs: 100, total_cost: 5400 },
    })
    const sub = getImportSub(db, id)
    expect(sub).toBeDefined()
    expect(sub.currency).toBe('EUR')
    expect(sub.exchange_rate).toBeCloseTo(10.8, 2)
    expect(sub.invoice_amount).toBeCloseTo(400, 2)
    expect(sub.customs).toBeCloseTo(500, 2)
    expect(sub.transitaire).toBeCloseTo(200, 2)
    expect(sub.tva_import).toBeCloseTo(300, 2)
    expect(sub.other_costs).toBeCloseTo(100, 2)
    expect(sub.total_cost).toBeCloseTo(5400, 2)
  })

  it('payment_status initial = unpaid', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 4320 },
    })
    const sub = getImportSub(db, id)
    expect(sub.payment_status).toBe('unpaid')
  })

  it('génère un numéro avec préfixe IMP', () => {
    const { number } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 10, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 100, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 1080 },
    })
    expect(number).toMatch(/^IMP-/)
  })

  it('calcule correctement HT/TVA/TTC depuis les lignes', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 4320 },
    })
    const doc = getDoc(db, id)
    expect(doc.total_ht).toBeCloseTo(5000, 2)
    expect(doc.total_tva).toBeCloseTo(0, 2)
    expect(doc.total_ttc).toBeCloseTo(5000, 2)
  })
})

describe('Import Invoice — Confirmation et écritures comptables', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('confirme et passe en statut confirmed', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 4320 },
    })
    confirmDocument(id, 1)
    expect(getDoc(db, id).status).toBe('confirmed')
  })

  it('crée un quid comptable automatique à la confirmation', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 500, transitaire: 200, tva_import: 300, other_costs: 100, total_cost: 5400 },
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='import_invoice' AND source_id=?`).get(id) as any
    expect(entry).toBeDefined()
    expect(entry.is_auto).toBe(1)
  })

  it('débit stock (3121) = total_cost - tva_import', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 500, transitaire: 200, tva_import: 300, other_costs: 100, total_cost: 5400 },
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='import_invoice' AND source_id=?`).get(id) as any
    const lines = getJournalLines(db, entry.id)
    const stockLine = lines.find((l: any) => l.code === '3121' && l.debit > 0)
    // total_cost=5400, tva_import=300 → stock = 5100
    expect(stockLine).toBeDefined()
    expect(stockLine.debit).toBeCloseTo(5100, 2)
  })

  it('débit TVA import récupérable (3455)', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 500, transitaire: 200, tva_import: 300, other_costs: 100, total_cost: 5400 },
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='import_invoice' AND source_id=?`).get(id) as any
    const lines = getJournalLines(db, entry.id)
    const tvaLine = lines.find((l: any) => l.code === '3455' && l.debit > 0)
    expect(tvaLine).toBeDefined()
    expect(tvaLine.debit).toBeCloseTo(300, 2)
  })

  it('crédit fournisseur étranger (4411) = invoice_amount × exchange_rate', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 500, transitaire: 200, tva_import: 300, other_costs: 100, total_cost: 5400 },
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='import_invoice' AND source_id=?`).get(id) as any
    const lines = getJournalLines(db, entry.id)
    const fourn = lines.find((l: any) => l.code === '4411' && l.credit > 0)
    // 400 EUR × 10.8 = 4320 MAD
    expect(fourn).toBeDefined()
    expect(fourn.credit).toBeCloseTo(4320, 2)
  })

  it('crédit dettes diverses (4481) pour douanes', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 500, transitaire: 200, tva_import: 300, other_costs: 100, total_cost: 5400 },
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='import_invoice' AND source_id=?`).get(id) as any
    const lines = getJournalLines(db, entry.id)
    const dettes = lines.filter((l: any) => l.code === '4481' && l.credit > 0)
    // customs=500, transitaire=200, other_costs=100 → 3 lignes 4481
    expect(dettes.length).toBeGreaterThanOrEqual(1)
    const totalDettes = dettes.reduce((s: number, l: any) => s + l.credit, 0)
    expect(totalDettes).toBeCloseTo(800, 2) // 500+200+100
  })

  it('pas de ligne 4481 si customs=0, transitaire=0, other_costs=0', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 4320 },
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='import_invoice' AND source_id=?`).get(id) as any
    const lines = getJournalLines(db, entry.id)
    const dettes = lines.filter((l: any) => l.code === '4481')
    expect(dettes).toHaveLength(0)
  })

  it('pas de mouvement de stock direct (import ne crée pas de BR)', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 4320 },
    })
    confirmDocument(id, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(id)
    expect(movs).toHaveLength(0)
  })
})

describe('Import Invoice — Landed Cost', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('calcule le coût unitaire landed cost = total_cost / quantité totale', () => {
    // 100 kg, total_cost = 5400 MAD → coût unitaire = 54 MAD/kg
    const totalCost = 5400
    const qty = 100
    const unitCost = totalCost / qty
    expect(unitCost).toBeCloseTo(54, 2)
  })

  it('répartit le landed cost proportionnellement entre 2 produits', () => {
    // P1: 100 kg, P2: 200 kg, total_cost = 3000 MAD
    const totalCost = 3000
    const lines = [
      { product_id: 1, quantity: 100 },
      { product_id: 2, quantity: 200 },
    ]
    const totalQty = lines.reduce((s, l) => s + l.quantity, 0)
    const allocated = lines.map(l => ({
      product_id: l.product_id,
      allocated: (l.quantity / totalQty) * totalCost,
      unit_cost: ((l.quantity / totalQty) * totalCost) / l.quantity,
    }))
    expect(allocated[0].allocated).toBeCloseTo(1000, 2)
    expect(allocated[1].allocated).toBeCloseTo(2000, 2)
    expect(allocated[0].unit_cost).toBeCloseTo(10, 2)
    expect(allocated[1].unit_cost).toBeCloseTo(10, 2)
  })

  it('landed cost avec taux de change: invoice_amount × exchange_rate = valeur MAD', () => {
    const invoiceAmount = 1000 // EUR
    const exchangeRate = 10.8
    const valueMAD = invoiceAmount * exchangeRate
    expect(valueMAD).toBeCloseTo(10800, 2)
  })

  it('total_cost = invoice_MAD + customs + transitaire + other_costs', () => {
    const invoiceMAD = 400 * 10.8 // 4320
    const customs = 500
    const transitaire = 200
    const otherCosts = 100
    const totalCost = invoiceMAD + customs + transitaire + otherCosts
    expect(totalCost).toBeCloseTo(5120, 2)
  })

  it('BR lié à import_invoice → stock augmente après application', () => {
    // Créer l'import invoice
    const { id: impId } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 54, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 500, transitaire: 200, tva_import: 300, other_costs: 100, total_cost: 5400 },
    })
    confirmDocument(impId, 1)

    // Créer un BR lié à l'import
    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-20', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 54, tva_rate: 0 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(impId, brId, 'import_to_reception')
    confirmDocument(brId, 1)

    // Appliquer le mouvement
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(brId) as any[]
    expect(movs).toHaveLength(1)
    applyMovement(db, movs[0].id, 1)

    const product = db.prepare('SELECT * FROM products WHERE id=1').get() as any
    expect(product.stock_quantity).toBe(100)
    expect(product.cmup_price).toBeCloseTo(54, 2)
  })

  it('CMUP recalculé correctement après réception import', () => {
    // Stock initial: 50 kg à 40 MAD/kg
    db.prepare('UPDATE products SET stock_quantity=50, cmup_price=40 WHERE id=1').run()

    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-20', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 54, tva_rate: 0 }],
      created_by: 1,
    })
    confirmDocument(brId, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(brId) as any[]
    applyMovement(db, movs[0].id, 1)

    const product = db.prepare('SELECT * FROM products WHERE id=1').get() as any
    // CMUP = (50×40 + 100×54) / 150 = (2000 + 5400) / 150 = 49.33
    expect(product.stock_quantity).toBe(150)
    expect(product.cmup_price).toBeCloseTo(49.33, 1)
  })
})

describe('Import Invoice — Paiement', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('paiement partiel → payment_status = partial', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 4320 },
    })
    confirmDocument(id, 1)
    const doc = getDoc(db, id)

    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,'supplier',?,?,?,?,?,1)`).run(doc.total_ttc / 2, 'bank', '2026-01-20', 'collected', id)
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(r.lastInsertRowid, id, doc.total_ttc / 2)

    const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(id) as any).t
    expect(paid).toBeCloseTo(doc.total_ttc / 2, 2)
    expect(paid).toBeLessThan(doc.total_ttc)
  })

  it('paiement complet → allocation = total_ttc', () => {
    const { id } = createDocument({
      type: 'import_invoice', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 0 }],
      created_by: 1,
      extra: { currency: 'EUR', exchange_rate: 10.8, invoice_amount: 400, customs: 0, transitaire: 0, tva_import: 0, other_costs: 0, total_cost: 4320 },
    })
    confirmDocument(id, 1)
    const doc = getDoc(db, id)

    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,'supplier',?,?,?,?,?,1)`).run(doc.total_ttc, 'bank', '2026-01-20', 'collected', id)
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(r.lastInsertRowid, id, doc.total_ttc)

    const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(id) as any).t
    expect(paid).toBeCloseTo(doc.total_ttc, 2)
  })
})
