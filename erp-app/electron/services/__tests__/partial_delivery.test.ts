/**
 * Tests — Livraison partielle (Partial Delivery)
 * Couvre: BL partiel → facture partial, BL complet → delivered,
 *         deux BL partiels couvrant la facture, cas limites
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
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (2,'P002','Produit B','pcs','finished',200,30,5,80)`).run()
  return db
}

const getStatus = (db: Database.Database, id: number) =>
  (db.prepare('SELECT status FROM documents WHERE id=?').get(id) as any).status

function createConfirmedInvoice(db: Database.Database, lines: any[]) {
  const { id } = createDocument({
    type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
    lines, created_by: 1,
  })
  confirmDocument(id, 1)
  return id
}

function createLinkedBL(db: Database.Database, invoiceId: number, lines: any[]) {
  const { id: blId } = createDocument({
    type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
    lines, created_by: 1,
  })
  db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invoiceId, blId, 'invoice_to_bl')
  confirmDocument(blId, 1)
  return blId
}

describe('Livraison partielle — statut facture', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BL partiel → facture reste partial', () => {
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }])
    createLinkedBL(db, invId, [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('partial')
  })

  it('BL complet → facture passe à delivered', () => {
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }])
    createLinkedBL(db, invId, [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('delivered')
  })

  it('deux BL partiels couvrant exactement la facture → delivered', () => {
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }])
    createLinkedBL(db, invId, [{ product_id: 1, quantity: 6, unit_price: 120, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('partial')
    createLinkedBL(db, invId, [{ product_id: 1, quantity: 4, unit_price: 120, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('delivered')
  })

  it('trois BL partiels couvrant la facture → delivered', () => {
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 12, unit_price: 120, tva_rate: 20 }])
    createLinkedBL(db, invId, [{ product_id: 1, quantity: 4, unit_price: 120, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('partial')
    createLinkedBL(db, invId, [{ product_id: 1, quantity: 4, unit_price: 120, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('partial')
    createLinkedBL(db, invId, [{ product_id: 1, quantity: 4, unit_price: 120, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('delivered')
  })

  it('BL avec quantité supérieure à la facture → delivered (sur-livraison)', () => {
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }])
    createLinkedBL(db, invId, [{ product_id: 1, quantity: 8, unit_price: 120, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('delivered')
  })

  it('facture multi-produits: BL partiel sur un seul produit → partial', () => {
    const invId = createConfirmedInvoice(db, [
      { product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 },
      { product_id: 2, quantity: 5, unit_price: 80, tva_rate: 20 },
    ])
    // Livrer seulement le produit 1
    createLinkedBL(db, invId, [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('partial')
  })

  it('facture multi-produits: BL couvrant tous les produits → delivered', () => {
    const invId = createConfirmedInvoice(db, [
      { product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 },
      { product_id: 2, quantity: 5, unit_price: 80, tva_rate: 20 },
    ])
    createLinkedBL(db, invId, [
      { product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 },
      { product_id: 2, quantity: 5, unit_price: 80, tva_rate: 20 },
    ])
    expect(getStatus(db, invId)).toBe('delivered')
  })

  it('facture multi-produits: deux BL couvrant chacun un produit → delivered', () => {
    const invId = createConfirmedInvoice(db, [
      { product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 },
      { product_id: 2, quantity: 5, unit_price: 80, tva_rate: 20 },
    ])
    createLinkedBL(db, invId, [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('partial')
    createLinkedBL(db, invId, [{ product_id: 2, quantity: 5, unit_price: 80, tva_rate: 20 }])
    expect(getStatus(db, invId)).toBe('delivered')
  })

  it('BL sans lien à une facture ne change pas le statut de la facture', () => {
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }])
    // BL sans lien
    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(blId, 1)
    // La facture reste confirmed (pas de lien)
    expect(getStatus(db, invId)).toBe('confirmed')
  })

  it('facture paid reste paid même après un BL complet', () => {
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }])
    // Simuler paiement complet
    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=?').get(invId) as any
    db.prepare(`UPDATE documents SET status='paid' WHERE id=?`).run(invId)
    db.prepare(`UPDATE doc_invoices SET payment_status='paid' WHERE document_id=?`).run(invId)

    // Créer un BL complet
    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, blId, 'invoice_to_bl')
    confirmDocument(blId, 1)

    // La facture doit rester paid
    expect(getStatus(db, invId)).toBe('paid')
  })
})

describe('Livraison partielle — mouvements de stock', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('chaque BL crée un mouvement de stock sortant', () => {
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }])
    const blId = createLinkedBL(db, invId, [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }])
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(blId) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('out')
    expect(movs[0].quantity).toBe(5)
  })

  it('deux BL partiels créent deux mouvements de stock distincts', () => {
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }])
    const bl1Id = createLinkedBL(db, invId, [{ product_id: 1, quantity: 6, unit_price: 120, tva_rate: 20 }])
    const bl2Id = createLinkedBL(db, invId, [{ product_id: 1, quantity: 4, unit_price: 120, tva_rate: 20 }])

    const movs1 = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(bl1Id) as any[]
    const movs2 = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(bl2Id) as any[]
    expect(movs1[0].quantity).toBe(6)
    expect(movs2[0].quantity).toBe(4)
  })

  it('BL refuse si stock insuffisant', () => {
    // Stock = 200, mais on essaie de livrer 300
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 300, unit_price: 120, tva_rate: 20 }])
    expect(() => createLinkedBL(db, invId, [{ product_id: 1, quantity: 300, unit_price: 120, tva_rate: 20 }])).toThrow()
  })
})

describe('Livraison partielle — quid comptable BL', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BL lié à une facture crée un quid de sortie stock (pas de double vente)', () => {
    const invId = createConfirmedInvoice(db, [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }])
    const blId = createLinkedBL(db, invId, [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }])

    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='bl' AND source_id=?`).get(blId) as any
    expect(entry).toBeDefined()
    // BL lié à facture → pas de ligne 3421 (clients) ni 7111 (ventes)
    const lines = db.prepare(`SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=?`).all(entry.id) as any[]
    const clientLine = lines.find((l: any) => l.code === '3421')
    expect(clientLine).toBeUndefined()
  })
})
