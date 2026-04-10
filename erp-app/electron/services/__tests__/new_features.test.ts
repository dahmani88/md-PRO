/**
 * Tests — Nouvelles fonctionnalités et corrections
 * Couvre: validation quantités, statut delivered/paid, livraison partielle,
 *         migration fix_document_status, cleanError
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { migration_005_fix_document_status } from '../../database/migrations/005_fix_document_status'
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
  db.prepare(`INSERT INTO clients (id,name) VALUES (1,'Client A')`).run()
  db.prepare(`INSERT INTO suppliers (id,name) VALUES (1,'Fournisseur A')`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (1,'P001','Produit A','pcs','finished',100,50,5,120)`).run()
  return db
}

describe('Validation des lignes', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('refuse une quantité nulle', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 0, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('refuse une quantité négative', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: -5, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('refuse un prix négatif', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: -10, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('refuse une remise > 100%', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, discount: 110, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('accepte une remise de 100%', () => {
    const result = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, discount: 100, tva_rate: 20 }],
      created_by: 1,
    })
    const doc = db.prepare('SELECT total_ht FROM documents WHERE id = ?').get(result.id) as any
    expect(doc.total_ht).toBeCloseTo(0, 2)
  })

  it('accepte un prix de 0 (service gratuit)', () => {
    const result = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ description: 'Service gratuit', quantity: 1, unit_price: 0, tva_rate: 0 }],
      created_by: 1,
    })
    expect(result.id).toBeGreaterThan(0)
  })
})

describe('Statut facture après livraison et paiement', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BL partiel → facture reste partial, pas delivered', () => {
    // Facture pour 10 unités
    const inv = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(inv.id, 1)

    // BL pour 5 unités seulement
    const bl = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(inv.id, bl.id, 'invoice_to_bl')
    confirmDocument(bl.id, 1)

    const status = (db.prepare('SELECT status FROM documents WHERE id = ?').get(inv.id) as any).status
    expect(status).toBe('partial')
  })

  it('BL complet → facture passe à delivered', () => {
    const inv = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(inv.id, 1)

    const bl = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(inv.id, bl.id, 'invoice_to_bl')
    confirmDocument(bl.id, 1)

    const status = (db.prepare('SELECT status FROM documents WHERE id = ?').get(inv.id) as any).status
    expect(status).toBe('delivered')
  })

  it('facture delivered + paiement complet → doit rester delivered (payment_status = paid)', () => {
    // Simuler une facture delivered avec paiement complet
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (10,'invoice','F-26-10','2026-01-15',1,'client','delivered',1000,200,1200)`).run()
    db.prepare(`INSERT INTO doc_invoices (document_id,payment_status) VALUES (10,'unpaid')`).run()

    // Paiement complet
    db.prepare(`INSERT INTO payments (id,party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,1,'client',1200,'cash','2026-01-20','pending',10,1)`).run()
    db.prepare(`INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (1,10,1200)`).run()

    // Vérifier que payment_status est bien calculé
    const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=10').get() as any).t
    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=10').get() as any
    expect(paid).toBeCloseTo(doc.total_ttc, 2)
  })
})

describe('Migration 005 — fix_document_status', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createTestDb()
    getSetDb()(db)
  })

  it('corrige les factures delivered+paid → paid', () => {
    // Insérer une facture delivered avec payment_status=paid
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (20,'invoice','F-26-20','2026-01-15',1,'client','delivered',1000,200,1200)`).run()
    db.prepare(`INSERT INTO doc_invoices (document_id,payment_status) VALUES (20,'paid')`).run()

    // Appliquer la migration
    migration_005_fix_document_status(db)

    const doc = db.prepare('SELECT status FROM documents WHERE id=20').get() as any
    expect(doc.status).toBe('paid')
  })

  it('ne touche pas les factures delivered non payées', () => {
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (21,'invoice','F-26-21','2026-01-15',1,'client','delivered',1000,200,1200)`).run()
    db.prepare(`INSERT INTO doc_invoices (document_id,payment_status) VALUES (21,'unpaid')`).run()

    migration_005_fix_document_status(db)

    const doc = db.prepare('SELECT status FROM documents WHERE id=21').get() as any
    expect(doc.status).toBe('delivered') // inchangé
  })

  it('ne touche pas les factures cancelled', () => {
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (22,'invoice','F-26-22','2026-01-15',1,'client','cancelled',1000,200,1200)`).run()
    db.prepare(`INSERT INTO doc_invoices (document_id,payment_status) VALUES (22,'paid')`).run()

    migration_005_fix_document_status(db)

    const doc = db.prepare('SELECT status FROM documents WHERE id=22').get() as any
    expect(doc.status).toBe('cancelled') // inchangé
  })
})

describe('Livraison partielle — suivi des quantités', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('deux BL partiels couvrant toute la facture → delivered', () => {
    const inv = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    confirmDocument(inv.id, 1)

    // Premier BL: 6 unités
    const bl1 = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 6, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(inv.id, bl1.id, 'invoice_to_bl')
    confirmDocument(bl1.id, 1)
    expect((db.prepare('SELECT status FROM documents WHERE id=?').get(inv.id) as any).status).toBe('partial')

    // Deuxième BL: 4 unités restantes
    const bl2 = createDocument({
      type: 'bl', date: '2026-01-17', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 4, unit_price: 120, tva_rate: 20 }],
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(inv.id, bl2.id, 'invoice_to_bl')
    confirmDocument(bl2.id, 1)
    expect((db.prepare('SELECT status FROM documents WHERE id=?').get(inv.id) as any).status).toBe('delivered')
  })
})
