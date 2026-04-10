/**
 * Tests — Flux avoir (Avoir Flow)
 * Couvre: commercial réduit solde, retour ajoute stock, annulation annule facture,
 *         avoir sans facture liée, quid comptable, cas limites
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
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
  migration_004_settings(db)
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (1,'Admin','a@b.ma','h','admin')`).run()
  db.prepare(`INSERT INTO clients (id,name) VALUES (1,'Client A')`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (1,'P001','Produit A','pcs','finished',200,50,5,120)`).run()
  return db
}

const getStatus = (db: Database.Database, id: number) =>
  (db.prepare('SELECT status FROM documents WHERE id=?').get(id) as any).status

function createConfirmedInvoice(db: Database.Database, qty = 10, price = 100) {
  const { id } = createDocument({
    type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
    lines: [{ product_id: 1, quantity: qty, unit_price: price, tva_rate: 20 }],
    created_by: 1,
  })
  confirmDocument(id, 1)
  return id
}

function createLinkedAvoir(
  db: Database.Database,
  invoiceId: number,
  avoirType: 'commercial' | 'retour' | 'annulation',
  qty = 5,
  price = 100
) {
  const { id: avoirId } = createDocument({
    type: 'avoir', date: '2026-01-20', party_id: 1, party_type: 'client',
    lines: [{ product_id: 1, quantity: qty, unit_price: price, tva_rate: 20 }],
    extra: { avoir_type: avoirType, affects_stock: avoirType === 'retour', reason: 'Test' },
    created_by: 1,
  })
  db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invoiceId, avoirId, 'invoice_to_avoir')
  confirmDocument(avoirId, 1)
  return avoirId
}

describe('Avoir Commercial', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('avoir commercial réduit le solde de la facture', () => {
    const invId = createConfirmedInvoice(db, 10, 100) // TTC = 1200
    createLinkedAvoir(db, invId, 'commercial', 5, 100) // TTC avoir = 600

    const alloc = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(invId) as any).t
    expect(alloc).toBeCloseTo(600, 2)
  })

  it('avoir commercial partiel → facture passe à partial', () => {
    const invId = createConfirmedInvoice(db, 10, 100) // TTC = 1200
    createLinkedAvoir(db, invId, 'commercial', 5, 100) // TTC avoir = 600 < 1200

    expect(getStatus(db, invId)).toBe('partial')
  })

  it('avoir commercial couvrant tout → facture passe à paid', () => {
    const invId = createConfirmedInvoice(db, 10, 100) // TTC = 1200
    createLinkedAvoir(db, invId, 'commercial', 10, 100) // TTC avoir = 1200

    expect(getStatus(db, invId)).toBe('paid')
  })

  it('avoir commercial ne crée pas de mouvement de stock', () => {
    const invId = createConfirmedInvoice(db)
    const avoirId = createLinkedAvoir(db, invId, 'commercial')

    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(avoirId)
    expect(movs).toHaveLength(0)
  })

  it('avoir commercial génère un quid comptable (débit 7111, crédit 3421)', () => {
    const invId = createConfirmedInvoice(db)
    const avoirId = createLinkedAvoir(db, invId, 'commercial')

    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='avoir' AND source_id=?`).get(avoirId) as any
    expect(entry).toBeDefined()
    expect(entry.is_auto).toBe(1)

    const lines = db.prepare(`SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=?`).all(entry.id) as any[]
    expect(lines.find((l: any) => l.code === '7111' && l.debit > 0)).toBeDefined()
    expect(lines.find((l: any) => l.code === '3421' && l.credit > 0)).toBeDefined()
  })

  it('avoir commercial crée un paiement de type avoir', () => {
    const invId = createConfirmedInvoice(db, 10, 100)
    createLinkedAvoir(db, invId, 'commercial', 5, 100)

    const payment = db.prepare(`SELECT * FROM payments WHERE document_id=? AND method='avoir'`).get(invId) as any
    expect(payment).toBeDefined()
    expect(payment.amount).toBeCloseTo(600, 2)
    expect(payment.status).toBe('cleared')
  })

  it('deux avoirs commerciaux successifs réduisent le solde cumulativement', () => {
    const invId = createConfirmedInvoice(db, 10, 100) // TTC = 1200
    createLinkedAvoir(db, invId, 'commercial', 3, 100) // TTC = 360
    createLinkedAvoir(db, invId, 'commercial', 3, 100) // TTC = 360

    const alloc = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(invId) as any).t
    expect(alloc).toBeCloseTo(720, 2)
  })
})

describe('Avoir Retour', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('avoir retour crée un mouvement de stock entrant', () => {
    const invId = createConfirmedInvoice(db)
    const avoirId = createLinkedAvoir(db, invId, 'retour', 5, 100)

    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(avoirId) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('in')
    expect(movs[0].quantity).toBe(5)
  })

  it('avoir retour: mouvement stock en attente (applied=0)', () => {
    const invId = createConfirmedInvoice(db)
    const avoirId = createLinkedAvoir(db, invId, 'retour', 5, 100)

    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(avoirId) as any[]
    expect(movs).toHaveLength(1)
  })

  it('avoir retour impute aussi sur la facture source', () => {
    const invId = createConfirmedInvoice(db, 10, 100)
    createLinkedAvoir(db, invId, 'retour', 5, 100)

    const alloc = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(invId) as any).t
    expect(alloc).toBeGreaterThan(0)
  })

  it('avoir retour génère un quid comptable', () => {
    const invId = createConfirmedInvoice(db)
    const avoirId = createLinkedAvoir(db, invId, 'retour')

    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='avoir' AND source_id=?`).get(avoirId) as any
    expect(entry).toBeDefined()
  })

  it('avoir retour: quantité retournée = quantité du mouvement stock', () => {
    const invId = createConfirmedInvoice(db)
    const avoirId = createLinkedAvoir(db, invId, 'retour', 3, 100)

    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(avoirId) as any[]
    expect(movs[0].quantity).toBe(3)
  })
})

describe('Avoir Annulation', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('avoir annulation → facture source passe à cancelled', () => {
    const invId = createConfirmedInvoice(db)
    createLinkedAvoir(db, invId, 'annulation')
    expect(getStatus(db, invId)).toBe('cancelled')
  })

  it('avoir annulation génère un quid comptable', () => {
    const invId = createConfirmedInvoice(db)
    const avoirId = createLinkedAvoir(db, invId, 'annulation')

    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='avoir' AND source_id=?`).get(avoirId) as any
    expect(entry).toBeDefined()
  })

  it('avoir annulation ne crée pas de mouvement de stock', () => {
    const invId = createConfirmedInvoice(db)
    const avoirId = createLinkedAvoir(db, invId, 'annulation')

    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(avoirId)
    expect(movs).toHaveLength(0)
  })

  it('avoir annulation: facture cancelled ne peut plus être confirmée', () => {
    const invId = createConfirmedInvoice(db)
    createLinkedAvoir(db, invId, 'annulation')
    expect(getStatus(db, invId)).toBe('cancelled')
    expect(() => confirmDocument(invId, 1)).toThrow()
  })
})

describe('Avoir sans facture liée', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('avoir commercial sans lien se confirme sans erreur', () => {
    const { id } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
      extra: { avoir_type: 'commercial', affects_stock: false, reason: 'Sans facture' },
      created_by: 1,
    })
    expect(() => confirmDocument(id, 1)).not.toThrow()
    expect(getStatus(db, id)).toBe('confirmed')
  })

  it('avoir retour sans lien crée quand même un mouvement stock', () => {
    const { id } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 }],
      extra: { avoir_type: 'retour', affects_stock: true, reason: 'Retour sans facture' },
      created_by: 1,
    })
    confirmDocument(id, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(id) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('in')
  })

  it('avoir annulation sans lien se confirme sans erreur', () => {
    const { id } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
      extra: { avoir_type: 'annulation', affects_stock: false, reason: 'Annulation sans facture' },
      created_by: 1,
    })
    expect(() => confirmDocument(id, 1)).not.toThrow()
  })
})

describe('Avoir — Calculs', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('avoir calcule correctement HT/TVA/TTC', () => {
    const { id } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20 }],
      extra: { avoir_type: 'commercial', affects_stock: false },
      created_by: 1,
    })
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(id) as any
    expect(doc.total_ht).toBeCloseTo(500, 2)
    expect(doc.total_tva).toBeCloseTo(100, 2)
    expect(doc.total_ttc).toBeCloseTo(600, 2)
  })

  it('avoir avec remise calcule correctement', () => {
    const { id } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, discount: 10, tva_rate: 20 }],
      extra: { avoir_type: 'commercial', affects_stock: false },
      created_by: 1,
    })
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(id) as any
    // 10 × 100 × 0.9 = 900 HT
    expect(doc.total_ht).toBeCloseTo(900, 2)
  })

  it('avoir génère un numéro avec préfixe AV', () => {
    const { number } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
      extra: { avoir_type: 'commercial', affects_stock: false },
      created_by: 1,
    })
    expect(number).toMatch(/^AV-/)
  })
})
