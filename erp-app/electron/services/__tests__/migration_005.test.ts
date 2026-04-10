/**
 * Tests — Migration 005: fix_document_status
 * Couvre: correction delivered+paid → paid, non-régression,
 *         factures fournisseur, import, cas limites
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { migration_005_fix_document_status } from '../../database/migrations/005_fix_document_status'

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
  return db
}

function insertInvoice(db: Database.Database, id: number, status: string, paymentStatus: string) {
  db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
    VALUES (?,'invoice','F-26-${id}','2026-01-15',1,'client',?,1000,200,1200)`).run(id, status)
  db.prepare(`INSERT INTO doc_invoices (document_id,payment_status) VALUES (?,?)`).run(id, paymentStatus)
}

function insertPurchaseInvoice(db: Database.Database, id: number, status: string, paymentStatus: string) {
  db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
    VALUES (?,'purchase_invoice','FF-26-${id}','2026-01-15',1,'supplier',?,1000,200,1200)`).run(id, status)
  db.prepare(`INSERT INTO doc_purchase_invoices (document_id,payment_status) VALUES (?,?)`).run(id, paymentStatus)
}

function insertImportInvoice(db: Database.Database, id: number, status: string, paymentStatus: string) {
  db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
    VALUES (?,'import_invoice','IMP-26-${id}','2026-01-15',1,'supplier',?,5000,0,5000)`).run(id, status)
  db.prepare(`INSERT INTO doc_import_invoices (document_id,currency,exchange_rate,invoice_amount,customs,transitaire,tva_import,other_costs,total_cost,payment_status)
    VALUES (?,'EUR',10.8,400,0,0,0,0,4320,?)`).run(id, paymentStatus)
}

const getStatus = (db: Database.Database, id: number) =>
  (db.prepare('SELECT status FROM documents WHERE id=?').get(id) as any).status

describe('Migration 005 — Factures client (invoice)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('corrige delivered + payment_status=paid → paid', () => {
    insertInvoice(db, 1, 'delivered', 'paid')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 1)).toBe('paid')
  })

  it('ne touche pas delivered + payment_status=unpaid', () => {
    insertInvoice(db, 2, 'delivered', 'unpaid')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 2)).toBe('delivered')
  })

  it('ne touche pas delivered + payment_status=partial', () => {
    insertInvoice(db, 3, 'delivered', 'partial')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 3)).toBe('delivered')
  })

  it('ne touche pas confirmed + payment_status=paid', () => {
    insertInvoice(db, 4, 'confirmed', 'paid')
    migration_005_fix_document_status(db)
    // confirmed ne doit pas être changé (la migration cible seulement delivered)
    expect(getStatus(db, 4)).toBe('confirmed')
  })

  it('ne touche pas cancelled + payment_status=paid', () => {
    insertInvoice(db, 5, 'cancelled', 'paid')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 5)).toBe('cancelled')
  })

  it('ne touche pas paid + payment_status=paid (déjà correct)', () => {
    insertInvoice(db, 6, 'paid', 'paid')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 6)).toBe('paid')
  })

  it('corrige plusieurs factures en une seule migration', () => {
    insertInvoice(db, 10, 'delivered', 'paid')
    insertInvoice(db, 11, 'delivered', 'paid')
    insertInvoice(db, 12, 'delivered', 'unpaid')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 10)).toBe('paid')
    expect(getStatus(db, 11)).toBe('paid')
    expect(getStatus(db, 12)).toBe('delivered') // inchangé
  })
})

describe('Migration 005 — Factures fournisseur (purchase_invoice)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('corrige delivered + payment_status=paid → paid', () => {
    insertPurchaseInvoice(db, 20, 'delivered', 'paid')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 20)).toBe('paid')
  })

  it('ne touche pas delivered + payment_status=unpaid', () => {
    insertPurchaseInvoice(db, 21, 'delivered', 'unpaid')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 21)).toBe('delivered')
  })

  it('ne touche pas cancelled + payment_status=paid', () => {
    insertPurchaseInvoice(db, 22, 'cancelled', 'paid')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 22)).toBe('cancelled')
  })
})

describe('Migration 005 — Factures import (import_invoice)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('corrige delivered + payment_status=paid → paid', () => {
    insertImportInvoice(db, 30, 'delivered', 'paid')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 30)).toBe('paid')
  })

  it('ne touche pas delivered + payment_status=unpaid', () => {
    insertImportInvoice(db, 31, 'delivered', 'unpaid')
    migration_005_fix_document_status(db)
    expect(getStatus(db, 31)).toBe('delivered')
  })
})

describe('Migration 005 — Correction payment_status doc_invoices', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('met à jour payment_status=paid si allocations >= total_ttc et status=delivered', () => {
    // Facture delivered avec allocations complètes mais payment_status non mis à jour
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (40,'invoice','F-26-40','2026-01-15',1,'client','delivered',1000,200,1200)`).run()
    db.prepare(`INSERT INTO doc_invoices (document_id,payment_status) VALUES (40,'unpaid')`).run()

    // Ajouter des allocations couvrant le total
    db.prepare(`INSERT INTO payments (id,party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,1,'client',1200,'bank','2026-01-20','collected',40,1)`).run()
    db.prepare(`INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (1,40,1200)`).run()

    migration_005_fix_document_status(db)

    const sub = db.prepare('SELECT payment_status FROM doc_invoices WHERE document_id=40').get() as any
    expect(sub.payment_status).toBe('paid')
  })

  it('ne met pas à jour payment_status si allocations < total_ttc', () => {
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (41,'invoice','F-26-41','2026-01-15',1,'client','delivered',1000,200,1200)`).run()
    db.prepare(`INSERT INTO doc_invoices (document_id,payment_status) VALUES (41,'partial')`).run()

    db.prepare(`INSERT INTO payments (id,party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (2,1,'client',600,'bank','2026-01-20','collected',41,1)`).run()
    db.prepare(`INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (2,41,600)`).run()

    migration_005_fix_document_status(db)

    const sub = db.prepare('SELECT payment_status FROM doc_invoices WHERE document_id=41').get() as any
    expect(sub.payment_status).toBe('partial') // inchangé
  })
})

describe('Migration 005 — Idempotence', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('appliquer la migration deux fois donne le même résultat', () => {
    insertInvoice(db, 50, 'delivered', 'paid')
    migration_005_fix_document_status(db)
    migration_005_fix_document_status(db) // deuxième application
    expect(getStatus(db, 50)).toBe('paid')
  })

  it('migration sur base vide ne lève pas d\'erreur', () => {
    expect(() => migration_005_fix_document_status(db)).not.toThrow()
  })
})
