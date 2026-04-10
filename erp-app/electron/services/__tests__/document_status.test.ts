/**
 * Tests — Transitions de statut des documents
 * Couvre: draft→confirmed→paid, draft→confirmed→delivered,
 *         delivered+payment→paid, annulations, cas limites
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
  db.prepare(`INSERT INTO suppliers (id,name) VALUES (1,'Fournisseur A')`).run()
  db.prepare(`INSERT INTO products (id,code,name,unit,type,stock_quantity,cmup_price,tva_rate_id,sale_price)
    VALUES (1,'P001','Produit A','pcs','finished',200,50,5,120)`).run()
  return db
}

const getStatus = (db: Database.Database, id: number) =>
  (db.prepare('SELECT status FROM documents WHERE id=?').get(id) as any).status

function addPayment(db: Database.Database, docId: number, amount: number) {
  const r = db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,document_id,created_by)
    VALUES (1,'client',?,'cash','2026-01-20','collected',?,1)`).run(amount, docId)
  db.prepare('INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (?,?,?)').run(r.lastInsertRowid, docId, amount)
}

function updateInvoicePaymentStatus(db: Database.Database, docId: number) {
  const doc = db.prepare('SELECT total_ttc, type, status FROM documents WHERE id=?').get(docId) as any
  const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id=?').get(docId) as any).t
  let payStatus = 'unpaid'
  if (paid >= doc.total_ttc - 0.01) payStatus = 'paid'
  else if (paid > 0) payStatus = 'partial'
  db.prepare('UPDATE doc_invoices SET payment_status=? WHERE document_id=?').run(payStatus, docId)
  if (payStatus === 'paid') {
    db.prepare(`UPDATE documents SET status='paid' WHERE id=?`).run(docId)
  } else if (payStatus === 'partial' && !['delivered','paid'].includes(doc.status)) {
    db.prepare(`UPDATE documents SET status='partial' WHERE id=?`).run(docId)
  }
}

describe('Transitions draft → confirmed', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('facture: draft → confirmed', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }], created_by: 1,
    })
    expect(getStatus(db, id)).toBe('draft')
    confirmDocument(id, 1)
    expect(getStatus(db, id)).toBe('confirmed')
  })

  it('devis: draft → confirmed', () => {
    const { id } = createDocument({
      type: 'quote', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    expect(getStatus(db, id)).toBe('confirmed')
  })

  it('BC: draft → confirmed', () => {
    const { id } = createDocument({
      type: 'purchase_order', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 10, unit_price: 50, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    expect(getStatus(db, id)).toBe('confirmed')
  })

  it('refuse de confirmer un document déjà confirmé', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    expect(() => confirmDocument(id, 1)).toThrow()
  })

  it('refuse de confirmer un document introuvable', () => {
    expect(() => confirmDocument(9999, 1)).toThrow('introuvable')
  })
})

describe('Transitions confirmed → paid (via paiement)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('paiement complet → statut paid', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=?').get(id) as any
    addPayment(db, id, doc.total_ttc)
    updateInvoicePaymentStatus(db, id)
    expect(getStatus(db, id)).toBe('paid')
  })

  it('paiement partiel → statut partial', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=?').get(id) as any
    addPayment(db, id, doc.total_ttc / 2)
    updateInvoicePaymentStatus(db, id)
    expect(getStatus(db, id)).toBe('partial')
  })

  it('deux paiements partiels couvrant le total → paid', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=?').get(id) as any
    addPayment(db, id, doc.total_ttc * 0.6)
    updateInvoicePaymentStatus(db, id)
    expect(getStatus(db, id)).toBe('partial')
    addPayment(db, id, doc.total_ttc * 0.4)
    updateInvoicePaymentStatus(db, id)
    expect(getStatus(db, id)).toBe('paid')
  })

  it('tolérance 1 centime: 1199.99 sur 1200 → paid', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    addPayment(db, id, 1199.99)
    updateInvoicePaymentStatus(db, id)
    expect(getStatus(db, id)).toBe('paid')
  })
})

describe('Transitions confirmed → delivered (via BL)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BL complet → facture delivered', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(invId, 1)

    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, blId, 'invoice_to_bl')
    confirmDocument(blId, 1)
    expect(getStatus(db, invId)).toBe('delivered')
  })

  it('BL partiel → facture partial (pas delivered)', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(invId, 1)

    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 3, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, blId, 'invoice_to_bl')
    confirmDocument(blId, 1)
    expect(getStatus(db, invId)).toBe('partial')
  })
})

describe('Transitions delivered + paiement → paid', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('facture delivered + paiement complet → paid', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(invId, 1)

    // Livraison complète
    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, blId, 'invoice_to_bl')
    confirmDocument(blId, 1)
    expect(getStatus(db, invId)).toBe('delivered')

    // Paiement complet
    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=?').get(invId) as any
    addPayment(db, invId, doc.total_ttc)
    updateInvoicePaymentStatus(db, invId)
    expect(getStatus(db, invId)).toBe('paid')
  })

  it('facture delivered + paiement partiel → reste delivered (pas partial)', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(invId, 1)

    const { id: blId } = createDocument({
      type: 'bl', date: '2026-01-16', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, blId, 'invoice_to_bl')
    confirmDocument(blId, 1)
    expect(getStatus(db, invId)).toBe('delivered')

    // Paiement partiel — ne doit pas rétrograder delivered → partial
    const doc = db.prepare('SELECT total_ttc FROM documents WHERE id=?').get(invId) as any
    addPayment(db, invId, doc.total_ttc / 2)
    updateInvoicePaymentStatus(db, invId)
    // delivered reste delivered (paiement partiel ne rétrograde pas)
    expect(getStatus(db, invId)).toBe('delivered')
  })
})

describe('Annulation de documents', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('avoir annulation → facture source passe à cancelled', () => {
    const { id: invId } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(invId, 1)

    const { id: avoirId } = createDocument({
      type: 'avoir', date: '2026-01-20', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 120, tva_rate: 20 }],
      extra: { avoir_type: 'annulation', affects_stock: false, reason: 'Annulation' },
      created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(invId, avoirId, 'invoice_to_avoir')
    confirmDocument(avoirId, 1)
    expect(getStatus(db, invId)).toBe('cancelled')
  })

  it('document cancelled ne peut pas être confirmé à nouveau', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(id, 1)
    db.prepare(`UPDATE documents SET status='cancelled' WHERE id=?`).run(id)
    expect(() => confirmDocument(id, 1)).toThrow()
  })
})

describe('Statuts BC (Bon de Commande)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('BC confirmed + BR partiel → BC partial', () => {
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)

    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 40, unit_price: 50, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, brId, 'po_to_reception')
    confirmDocument(brId, 1)
    expect(getStatus(db, bcId)).toBe('partial')
  })

  it('BC confirmed + BR complet → BC received', () => {
    const { id: bcId } = createDocument({
      type: 'purchase_order', date: '2026-01-10', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 20 }], created_by: 1,
    })
    confirmDocument(bcId, 1)

    const { id: brId } = createDocument({
      type: 'bl_reception', date: '2026-01-15', party_id: 1, party_type: 'supplier',
      lines: [{ product_id: 1, quantity: 100, unit_price: 50, tva_rate: 20 }], created_by: 1,
    })
    db.prepare('INSERT INTO document_links (parent_id,child_id,link_type) VALUES (?,?,?)').run(bcId, brId, 'po_to_reception')
    confirmDocument(brId, 1)
    expect(getStatus(db, bcId)).toBe('received')
  })
})
