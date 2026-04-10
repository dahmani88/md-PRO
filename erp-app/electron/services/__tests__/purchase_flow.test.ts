/**
 * Tests — Flux d'achat complet
 * Couvre: BC→BR partiel→BC partial, second BR→BC received,
 *         CMUP, FF, paiement fournisseur
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
  db.prepare(`INSERT INTO suppliers (id,name) VALUES (1,'Fournisseur A'),(2,'Fournisseur B')`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (1,'MP001','Matiere A','kg','raw',0,0,5,0)`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (2,'MP002','Matiere B','pcs','raw',50,30,5,0)`).run()
  return db
}

const getDoc = (db: Database.Database, id: number) =>
  db.prepare('SELECT * FROM documents WHERE id=?').get(id) as any

const getStatus = (db: Database.Database, id: number) =>
  (db.prepare('SELECT status FROM documents WHERE id=?').get(id) as any).status

describe('Bon de Commande (BC)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BC créé en statut draft', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    expect(getStatus(db, id)).toBe('draft')
  })

  it('BC confirmé → statut confirmed', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    expect(getStatus(db, id)).toBe('confirmed')
  })

  it('BC confirmé → aucun mouvement de stock', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(id)
    expect(movs).toHaveLength(0)
  })

  it('BC confirmé → aucun quid comptable', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const entry = db.prepare(`SELECT * FROM journal_entries WHERE source_type='purchase_order' AND source_id=?`).get(id)
    expect(entry).toBeUndefined()
  })

  it('BC calcule correctement HT/TVA/TTC', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 10, unit_price: 80, tva_rate: 20 }], created_by: 1,
    })
    const doc = getDoc(db, id)
    expect(doc.total_ht).toBeCloseTo(800, 2)
    expect(doc.total_tva).toBeCloseTo(160, 2)
    expect(doc.total_ttc).toBeCloseTo(960, 2)
  })

  it('BC génère un numéro avec préfixe BC', () => {
    const { number } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 10, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    expect(number).toMatch(/^BC-/)
  })
})

describe('Flux BC → BR partiel → BC partial', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BR partiel lié au BC → BC passe à partial', () => {
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)

    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 40, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, brId, 'po_to_reception')
    confirmDocument(brId, 1)
    expect(getStatus(db, bcId)).toBe('partial')
  })

  it('BR partiel → mouvement stock entrant en attente', () => {
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)

    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 40, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, brId, 'po_to_reception')
    confirmDocument(brId, 1)

    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(brId) as any[]
    expect(movs).toHaveLength(1)
    expect(movs[0].type).toBe('in')
    expect(movs[0].quantity).toBe(40)
  })
})

describe('Flux BC → second BR → BC received', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('deux BR partiels couvrant le BC → BC received', () => {
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)

    // Premier BR: 60 unités
    const { id: br1Id } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 60, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, br1Id, 'po_to_reception')
    confirmDocument(br1Id, 1)
    expect(getStatus(db, bcId)).toBe('partial')

    // Deuxième BR: 40 unités restantes
    const { id: br2Id } = createDocument({
      type: 'bl_reception', date: '2026-01-20', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 40, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, br2Id, 'po_to_reception')
    confirmDocument(br2Id, 1)
    expect(getStatus(db, bcId)).toBe('received')
  })

  it('trois BR partiels couvrant le BC → BC received', () => {
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 90, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)

    for (const qty of [30, 30, 30]) {
      const { id: brId } = createDocument({
        type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
        lines: [{ product_id: 1, quantity: qty, unit_price: 40, tva_rate: 20 }], created_by: 1,
      })
      db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, brId, 'po_to_reception')
      confirmDocument(brId, 1)
    }
    expect(getStatus(db, bcId)).toBe('received')
  })
})

describe('Flux BC → BR → CMUP et stock', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('appliquer BR → stock augmente', () => {
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)

    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, brId, 'po_to_reception')
    confirmDocument(brId, 1)

    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(brId) as any[]
    applyMovement(db, movs[0].id, 1)

    const product = db.prepare('SELECT * FROM products WHERE id=1').get() as any
    expect(product.stock_quantity).toBe(100)
    expect(product.cmup_price).toBeCloseTo(40, 2)
  })

  it('CMUP recalculé correctement avec stock existant', () => {
    // Stock initial: 50 kg à 30 MAD/kg
    db.prepare('UPDATE products SET stock_quantity=50, cmup_price=30 WHERE id=1').run()

    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(brId, 1)

    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(brId) as any[]
    applyMovement(db, movs[0].id, 1)

    const product = db.prepare('SELECT * FROM products WHERE id=1').get() as any
    // CMUP = (50×30 + 100×40) / 150 = (1500 + 4000) / 150 = 36.67
    expect(product.stock_quantity).toBe(150)
    expect(product.cmup_price).toBeCloseTo(36.67, 1)
  })

  it('deux BR successifs → CMUP recalculé à chaque fois', () => {
    const { id: br1Id } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(br1Id, 1)
    const movs1 = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(br1Id) as any[]
    applyMovement(db, movs1[0].id, 1)

    const { id: br2Id } = createDocument({
      type: 'bl_reception', date: '2026-01-20', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 50, unit_price: 60, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(br2Id, 1)
    const movs2 = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(br2Id) as any[]
    applyMovement(db, movs2[0].id, 1)

    const product = db.prepare('SELECT * FROM products WHERE id=1').get() as any
    // CMUP = (100×40 + 50×60) / 150 = (4000 + 3000) / 150 = 46.67
    expect(product.stock_quantity).toBe(150)
    expect(product.cmup_price).toBeCloseTo(46.67, 1)
  })
})

describe('Flux complet: BC → BR → FF → Paiement', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('flux complet achat local avec paiement', () => {
    // 1. BC
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 200, unit_price: 35, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)
    expect(getStatus(db, bcId)).toBe('confirmed')

    // 2. BR lié au BC
    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-12', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 200, unit_price: 35, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, brId, 'po_to_reception')
    confirmDocument(brId, 1)
    expect(getStatus(db, bcId)).toBe('received')

    // 3. Appliquer stock
    const movs = db.prepare('SELECT * FROM stock_movements WHERE document_id=? AND applied=0').all(brId) as any[]
    applyMovement(db, movs[0].id, 1)
    const product = db.prepare('SELECT * FROM products WHERE id=1').get() as any
    expect(product.stock_quantity).toBe(200)
    expect(product.cmup_price).toBeCloseTo(35, 2)

    // 4. Facture fournisseur
    const { id: ffId } = createDocument({
      type: 'purchase_invoice', date: '2026-01-13', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 200, unit_price: 35, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(ffId, 1)
    const ffDoc = getDoc(db, ffId)
    expect(ffDoc.total_ttc).toBeCloseTo(200 * 35 * 1.2, 2)

    // 5. Paiement
    const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,'supplier',?,'bank','2026-01-20','collected',?,1)`).run(ffDoc.total_ttc, ffId)
    db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(r.lastInsertRowid, ffId, ffDoc.total_ttc)

    const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(ffId) as any).t
    expect(paid).toBeCloseTo(ffDoc.total_ttc, 2)
  })

  it('BC multi-produits → BR couvrant tous les produits → received', () => {
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [
        { product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 },
        { product_id: 2, quantity: 50, unit_price: 30, tva_rate: 20 },
      ], created_by: 1,
    })
    confirmDocument(bcId, 1)

    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [
        { product_id: 1, quantity: 100, unit_price: 40, tva_rate: 20 },
        { product_id: 2, quantity: 50, unit_price: 30, tva_rate: 20 },
      ], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, brId, 'po_to_reception')
    confirmDocument(brId, 1)
    expect(getStatus(db, bcId)).toBe('received')
  })
})
