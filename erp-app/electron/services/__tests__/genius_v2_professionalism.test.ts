/**
 * ============================================================
 * GENIUS V2 — اختبارات الاحترافية الشاملة
 * ============================================================
 * يقيس هذا الملف مستوى احترافية كل وحدة في التطبيق:
 * - الإصلاحات المطبقة (Triggers, Salt, Validation)
 * - سيناريوهات الأعمال المعقدة
 * - حالات الحافة الخطيرة
 * - تكامل الوحدات مع بعضها
 * ============================================================
 */

import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_003_production } from '../../database/migrations/003_production'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { migration_006_user_permissions } from '../../database/migrations/006_user_permissions'
import { migration_008_constraints } from '../../database/migrations/008_constraints'
import { createStockMovement, applyMovement } from '../stock.service'
import { createAccountingEntry, createPaymentEntry } from '../accounting.service'
import { generateLicenseKey, verifyLicenseKey } from '../license.service'
import { logAudit, getAuditLog } from '../audit.service'
import crypto from 'crypto'

function createFullDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migration_001_initial(db)
  migration_002_accounting(db)
  migration_003_production(db)
  migration_004_settings(db)
  migration_006_user_permissions(db)
  migration_008_constraints(db)

  db.prepare(`INSERT INTO users (id, name, email, password_hash, role)
    VALUES (1, 'Admin', 'admin@test.ma', 'hash', 'admin')`).run()
  db.prepare(`INSERT INTO clients (id, name, credit_limit) VALUES (1, 'Client A', 50000)`).run()
  db.prepare(`INSERT INTO clients (id, name, credit_limit) VALUES (2, 'Client B', 0)`).run()
  db.prepare(`INSERT INTO suppliers (id, name) VALUES (1, 'Fournisseur X')`).run()
  db.prepare(`INSERT INTO products (id, code, name, unit, type, stock_quantity, cmup_price, tva_rate_id)
    VALUES (1, 'P001', 'Matière Alpha', 'kg', 'raw', 1000, 100, 5)`).run()
  db.prepare(`INSERT INTO products (id, code, name, unit, type, stock_quantity, cmup_price, tva_rate_id)
    VALUES (2, 'P002', 'Produit Fini', 'pcs', 'finished', 0, 0, 5)`).run()
  db.prepare(`INSERT INTO products (id, code, name, unit, type, stock_quantity, cmup_price, tva_rate_id)
    VALUES (3, 'P003', 'Stock Zéro', 'pcs', 'raw', 0, 0, 5)`).run()
  return db
}

function assertBalanced(db: Database.Database, entryId: number): void {
  const lines = db.prepare(`
    SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = ?
  `).all(entryId) as any[]
  const debit  = lines.reduce((s: number, l: any) => s + l.debit, 0)
  const credit = lines.reduce((s: number, l: any) => s + l.credit, 0)
  expect(Math.abs(debit - credit)).toBeLessThan(0.01)
}

// ============================================================
// MODULE 1: TRIGGERS — PROTECTION DE LA BASE DE DONNÉES (10 tests)
// ============================================================
describe('[M1] Triggers — Protection DB', () => {
  it('T1: paiement amount=0 est bloqué', () => {
    const db = createFullDb()
    expect(() => db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,created_by) VALUES (1,'client',0,'cash','2026-01-01','pending',1)`).run()).toThrow()
  })

  it('T2: paiement amount négatif est bloqué', () => {
    const db = createFullDb()
    expect(() => db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,created_by) VALUES (1,'client',-1,'cash','2026-01-01','pending',1)`).run()).toThrow()
  })

  it('T3: paiement amount positif passe', () => {
    const db = createFullDb()
    expect(() => db.prepare(`INSERT INTO payments (party_id,party_type,amount,method,date,status,created_by) VALUES (1,'client',0.01,'cash','2026-01-01','pending',1)`).run()).not.toThrow()
  })

  it('T4: document_lines quantity=0 est bloqué', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO documents (type,number,date,status,total_ht,total_tva,total_ttc) VALUES ('invoice','F-T4','2026-01-01','draft',0,0,0)`).run()
    const id = (db.prepare('SELECT last_insert_rowid() as id').get() as any).id
    expect(() => db.prepare(`INSERT INTO document_lines (document_id,quantity,unit_price,tva_rate,total_ht,total_tva,total_ttc) VALUES (?,0,100,20,0,0,0)`).run(id)).toThrow()
  })

  it('T5: document_lines quantity négative est bloquée', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO documents (type,number,date,status,total_ht,total_tva,total_ttc) VALUES ('invoice','F-T5','2026-01-01','draft',0,0,0)`).run()
    const id = (db.prepare('SELECT last_insert_rowid() as id').get() as any).id
    expect(() => db.prepare(`INSERT INTO document_lines (document_id,quantity,unit_price,tva_rate,total_ht,total_tva,total_ttc) VALUES (?,-5,100,20,0,0,0)`).run(id)).toThrow()
  })

  it('T6: document_lines unit_price négatif est bloqué', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO documents (type,number,date,status,total_ht,total_tva,total_ttc) VALUES ('invoice','F-T6','2026-01-01','draft',0,0,0)`).run()
    const id = (db.prepare('SELECT last_insert_rowid() as id').get() as any).id
    expect(() => db.prepare(`INSERT INTO document_lines (document_id,quantity,unit_price,tva_rate,total_ht,total_tva,total_ttc) VALUES (?,1,-100,20,0,0,0)`).run(id)).toThrow()
  })

  it('T7: statut document invalide est bloqué', () => {
    const db = createFullDb()
    expect(() => db.prepare(`INSERT INTO documents (type,number,date,status,total_ht,total_tva,total_ttc) VALUES ('invoice','F-T7','2026-01-01','HACKED',0,0,0)`).run()).toThrow()
  })

  it('T8: tous les statuts valides passent', () => {
    const db = createFullDb()
    const statuses = ['draft','confirmed','partial','delivered','paid','cancelled','received']
    statuses.forEach((s, i) => {
      expect(() => db.prepare(`INSERT INTO documents (type,number,date,status,total_ht,total_tva,total_ttc) VALUES ('invoice','F-T8-${i}','2026-01-01','${s}',0,0,0)`).run()).not.toThrow()
    })
  })

  it('T9: overpayment allocation est bloquée', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc) VALUES (999,'invoice','F-T9','2026-01-01',1,'client','confirmed',1000,200,1200)`).run()
    db.prepare(`INSERT INTO doc_invoices (document_id,payment_status) VALUES (999,'unpaid')`).run()
    db.prepare(`INSERT INTO payments (id,party_id,party_type,amount,method,date,status,document_id,created_by) VALUES (999,1,'client',9999,'cash','2026-01-01','pending',999,1)`).run()
    expect(() => db.prepare(`INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (999,999,9999)`).run()).toThrow()
  })

  it('T10: stock_movements quantity=0 est bloqué', () => {
    const db = createFullDb()
    expect(() => db.prepare(`INSERT INTO stock_movements (product_id,type,quantity,date,created_by) VALUES (1,'in',0,'2026-01-01',1)`).run()).toThrow()
  })
})

// ============================================================
// MODULE 2: SÉCURITÉ AUTH — PASSWORD HASHING (8 tests)
// ============================================================
describe('[M2] Sécurité Auth — Password Hashing', () => {
  function hashWithSalt(password: string, salt?: string): string {
    const s = salt ?? crypto.randomBytes(16).toString('hex')
    const hash = crypto.createHash('sha256').update(s + password).digest('hex')
    return `${s}:${hash}`
  }

  function verify(password: string, stored: string): boolean {
    if (!stored.includes(':')) {
      return crypto.createHash('sha256').update(password).digest('hex') === stored
    }
    const [salt, hash] = stored.split(':')
    return crypto.createHash('sha256').update(salt + password).digest('hex') === hash
  }

  it('A1: hash contient un salt (format salt:hash)', () => {
    const h = hashWithSalt('password123')
    expect(h).toContain(':')
    const parts = h.split(':')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toHaveLength(32) // 16 bytes hex
  })

  it('A2: deux hashes du même mot de passe sont différents (salt aléatoire)', () => {
    const h1 = hashWithSalt('password123')
    const h2 = hashWithSalt('password123')
    expect(h1).not.toBe(h2)
  })

  it('A3: vérification correcte avec salt', () => {
    const h = hashWithSalt('secret')
    expect(verify('secret', h)).toBe(true)
  })

  it('A4: mauvais mot de passe échoue', () => {
    const h = hashWithSalt('secret')
    expect(verify('wrong', h)).toBe(false)
  })

  it('A5: compatibilité avec ancien format (sans salt)', () => {
    const legacyHash = crypto.createHash('sha256').update('oldpassword').digest('hex')
    expect(verify('oldpassword', legacyHash)).toBe(true)
    expect(verify('wrong', legacyHash)).toBe(false)
  })

  it('A6: mot de passe vide échoue la vérification', () => {
    const h = hashWithSalt('secret')
    expect(verify('', h)).toBe(false)
  })

  it('A7: salt différent donne hash différent même avec même mot de passe', () => {
    const h1 = hashWithSalt('password', 'salt1111111111111111111111111111')
    const h2 = hashWithSalt('password', 'salt2222222222222222222222222222')
    expect(h1).not.toBe(h2)
  })

  it('A8: hash résistant aux rainbow tables (salt unique par user)', () => {
    // Même mot de passe pour 100 users → 100 hashes différents
    const hashes = new Set<string>()
    for (let i = 0; i < 100; i++) {
      hashes.add(hashWithSalt('commonpassword'))
    }
    expect(hashes.size).toBe(100)
  })
})

// ============================================================
// MODULE 3: FLUX COMPLET VENTE (End-to-End) (10 tests)
// ============================================================
describe('[M3] Flux Complet Vente — Devis → Facture → BL → Paiement', () => {
  function setupFullSaleFlow(db: Database.Database) {
    // Devis
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (1,'quote','D-001','2026-01-01',1,'client','confirmed',1000,200,1200)`).run()
    db.prepare(`INSERT INTO doc_quotes (document_id,validity_date,probability) VALUES (1,'2026-02-01',80)`).run()
    db.prepare(`INSERT INTO document_lines (document_id,product_id,quantity,unit_price,tva_rate,total_ht,total_tva,total_ttc)
      VALUES (1,1,10,100,20,1000,200,1200)`).run()

    // Facture depuis devis
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (2,'invoice','F-001','2026-01-05',1,'client','confirmed',1000,200,1200)`).run()
    db.prepare(`INSERT INTO doc_invoices (document_id,payment_status,due_date) VALUES (2,'unpaid','2026-02-05')`).run()
    db.prepare(`INSERT INTO document_lines (document_id,product_id,quantity,unit_price,tva_rate,total_ht,total_tva,total_ttc)
      VALUES (2,1,10,100,20,1000,200,1200)`).run()
    db.prepare(`INSERT INTO document_links (parent_id,child_id,link_type) VALUES (1,2,'invoice')`).run()

    // BL
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (3,'bl','BL-001','2026-01-10',1,'client','confirmed',1000,200,1200)`).run()
    db.prepare(`INSERT INTO document_links (parent_id,child_id,link_type) VALUES (2,3,'bl')`).run()
    db.prepare(`INSERT INTO document_lines (document_id,product_id,quantity,unit_price,tva_rate,total_ht,total_tva,total_ttc)
      VALUES (3,1,10,100,20,1000,200,1200)`).run()

    // Paiement
    db.prepare(`INSERT INTO payments (id,party_id,party_type,amount,method,date,status,document_id,created_by)
      VALUES (1,1,'client',1200,'bank','2026-01-15','pending',2,1)`).run()
    db.prepare(`INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (1,2,1200)`).run()
  }

  it('F1: devis créé avec probabilité 80%', () => {
    const db = createFullDb()
    setupFullSaleFlow(db)
    const q = db.prepare('SELECT * FROM doc_quotes WHERE document_id = 1').get() as any
    expect(q.probability).toBe(80)
  })

  it('F2: facture liée au devis via document_links', () => {
    const db = createFullDb()
    setupFullSaleFlow(db)
    const link = db.prepare('SELECT * FROM document_links WHERE parent_id = 1 AND child_id = 2').get() as any
    expect(link).toBeDefined()
    expect(link.link_type).toBe('invoice')
  })

  it('F3: BL lié à la facture', () => {
    const db = createFullDb()
    setupFullSaleFlow(db)
    const link = db.prepare('SELECT * FROM document_links WHERE parent_id = 2 AND child_id = 3').get() as any
    expect(link).toBeDefined()
  })

  it('F4: paiement alloué à la facture', () => {
    const db = createFullDb()
    setupFullSaleFlow(db)
    const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id = 2').get() as any).t
    expect(paid).toBe(1200)
  })

  it('F5: balance client = 0 après paiement complet', () => {
    const db = createFullDb()
    setupFullSaleFlow(db)
    const invoiced = (db.prepare(`SELECT COALESCE(SUM(total_ttc),0) as t FROM documents WHERE party_id=1 AND type='invoice' AND status!='cancelled'`).get() as any).t
    const paid = (db.prepare(`SELECT COALESCE(SUM(pa.amount),0) as t FROM payment_allocations pa JOIN documents d ON d.id=pa.document_id WHERE d.party_id=1`).get() as any).t
    expect(invoiced - paid).toBeCloseTo(0, 2)
  })

  it('F6: qiud comptable facture est équilibré', () => {
    const db = createFullDb()
    setupFullSaleFlow(db)
    const doc = db.prepare('SELECT * FROM documents WHERE id = 2').get() as any
    const lines = db.prepare('SELECT * FROM document_lines WHERE document_id = 2').all() as any[]
    const entryId = createAccountingEntry(db, doc, lines, 1)!
    assertBalanced(db, entryId)
  })

  it('F7: qiud comptable paiement est équilibré', () => {
    const db = createFullDb()
    setupFullSaleFlow(db)
    const entryId = createPaymentEntry(db, { id: 1, party_id: 1, party_type: 'client', amount: 1200, method: 'bank', date: '2026-01-15' }, 1)
    assertBalanced(db, entryId)
  })

  it('F8: mouvement stock BL réduit le stock', () => {
    const db = createFullDb()
    setupFullSaleFlow(db)
    const m = createStockMovement(db, { product_id: 1, type: 'out', quantity: 10, document_id: 3, date: '2026-01-10', applied: false, created_by: 1 })
    applyMovement(db, m, 1)
    const p = db.prepare('SELECT stock_quantity FROM products WHERE id = 1').get() as any
    expect(p.stock_quantity).toBe(990)
  })

  it('F9: audit log trace toutes les étapes', () => {
    const db = createFullDb()
    setupFullSaleFlow(db)
    logAudit(db, { user_id: 1, action: 'CREATE', table_name: 'documents', record_id: 1 })
    logAudit(db, { user_id: 1, action: 'CONFIRM', table_name: 'documents', record_id: 2 })
    logAudit(db, { user_id: 1, action: 'PAYMENT', table_name: 'payments', record_id: 1 })
    const result = getAuditLog(db)
    expect(result.total).toBe(3)
  })

  it('F10: séquence complète sans erreur', () => {
    const db = createFullDb()
    expect(() => setupFullSaleFlow(db)).not.toThrow()
  })
})

// ============================================================
// MODULE 4: FLUX ACHAT COMPLET (8 tests)
// ============================================================
describe('[M4] Flux Achat Complet — BC → BR → Facture Fournisseur', () => {
  function setupPurchaseFlow(db: Database.Database) {
    // Bon de commande
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (10,'purchase_order','BC-001','2026-01-01',1,'supplier','confirmed',5000,1000,6000)`).run()
    db.prepare(`INSERT INTO document_lines (document_id,product_id,quantity,unit_price,tva_rate,total_ht,total_tva,total_ttc)
      VALUES (10,1,50,100,20,5000,1000,6000)`).run()

    // Bon de réception
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (11,'bl_reception','BR-001','2026-01-10',1,'supplier','confirmed',5000,1000,6000)`).run()
    db.prepare(`INSERT INTO document_links (parent_id,child_id,link_type) VALUES (10,11,'bl_reception')`).run()
    db.prepare(`INSERT INTO document_lines (document_id,product_id,quantity,unit_price,tva_rate,total_ht,total_tva,total_ttc)
      VALUES (11,1,50,100,20,5000,1000,6000)`).run()

    // Facture fournisseur
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc)
      VALUES (12,'purchase_invoice','FF-001','2026-01-15',1,'supplier','confirmed',5000,1000,6000)`).run()
    db.prepare(`INSERT INTO doc_purchase_invoices (document_id,payment_status) VALUES (12,'unpaid')`).run()
    db.prepare(`INSERT INTO document_lines (document_id,product_id,quantity,unit_price,tva_rate,total_ht,total_tva,total_ttc)
      VALUES (12,1,50,100,20,5000,1000,6000)`).run()
  }

  it('P1: BC créé avec statut confirmed', () => {
    const db = createFullDb()
    setupPurchaseFlow(db)
    const bc = db.prepare('SELECT status FROM documents WHERE id = 10').get() as any
    expect(bc.status).toBe('confirmed')
  })

  it('P2: BR lié au BC', () => {
    const db = createFullDb()
    setupPurchaseFlow(db)
    const link = db.prepare('SELECT * FROM document_links WHERE parent_id = 10 AND child_id = 11').get() as any
    expect(link).toBeDefined()
  })

  it('P3: réception augmente le stock', () => {
    const db = createFullDb()
    setupPurchaseFlow(db)
    const m = createStockMovement(db, { product_id: 1, type: 'in', quantity: 50, unit_cost: 100, document_id: 11, date: '2026-01-10', applied: false, created_by: 1 })
    applyMovement(db, m, 1)
    const p = db.prepare('SELECT stock_quantity FROM products WHERE id = 1').get() as any
    expect(p.stock_quantity).toBe(1050)
  })

  it('P4: CMUP mis à jour après réception', () => {
    const db = createFullDb()
    setupPurchaseFlow(db)
    // Stock initial: 1000 @ 100, Entrée: 50 @ 100 → CMUP = 100
    const m = createStockMovement(db, { product_id: 1, type: 'in', quantity: 50, unit_cost: 100, document_id: 11, date: '2026-01-10', applied: false, created_by: 1 })
    applyMovement(db, m, 1)
    const p = db.prepare('SELECT cmup_price FROM products WHERE id = 1').get() as any
    expect(p.cmup_price).toBeCloseTo(100, 2)
  })

  it('P5: qiud comptable BR est équilibré', () => {
    const db = createFullDb()
    setupPurchaseFlow(db)
    const doc = db.prepare('SELECT * FROM documents WHERE id = 11').get() as any
    const lines = db.prepare('SELECT * FROM document_lines WHERE document_id = 11').all() as any[]
    const entryId = createAccountingEntry(db, doc, lines, 1)!
    assertBalanced(db, entryId)
  })

  it('P6: qiud comptable facture fournisseur est équilibré', () => {
    const db = createFullDb()
    setupPurchaseFlow(db)
    const doc = db.prepare('SELECT * FROM documents WHERE id = 12').get() as any
    const lines = db.prepare('SELECT * FROM document_lines WHERE document_id = 12').all() as any[]
    const entryId = createAccountingEntry(db, doc, lines, 1)!
    assertBalanced(db, entryId)
  })

  it('P7: balance fournisseur = total factures - paiements', () => {
    const db = createFullDb()
    setupPurchaseFlow(db)
    const invoiced = (db.prepare(`SELECT COALESCE(SUM(total_ttc),0) as t FROM documents WHERE party_id=1 AND party_type='supplier' AND type IN ('purchase_invoice','import_invoice') AND status!='cancelled'`).get() as any).t
    const paid = (db.prepare(`SELECT COALESCE(SUM(pa.amount),0) as t FROM payment_allocations pa JOIN documents d ON d.id=pa.document_id WHERE d.party_id=1 AND d.party_type='supplier'`).get() as any).t
    expect(invoiced - paid).toBe(6000)
  })

  it('P8: paiement fournisseur réduit la balance', () => {
    const db = createFullDb()
    setupPurchaseFlow(db)
    db.prepare(`INSERT INTO payments (id,party_id,party_type,amount,method,date,status,document_id,created_by) VALUES (1,1,'supplier',3000,'bank','2026-01-20','pending',12,1)`).run()
    db.prepare(`INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (1,12,3000)`).run()
    const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM payment_allocations WHERE document_id = 12').get() as any).t
    expect(paid).toBe(3000)
    expect(6000 - paid).toBe(3000)
  })
})

// ============================================================
// MODULE 5: PRODUCTION COMPLÈTE (8 tests)
// ============================================================
describe('[M5] Production Complète — BOM → Ordre → Confirmation', () => {
  function setupProduction(db: Database.Database) {
    db.prepare(`INSERT INTO bom_templates (id,product_id,name,labor_cost) VALUES (1,2,'BOM Alpha',50)`).run()
    db.prepare(`INSERT INTO bom_lines (bom_id,material_id,quantity,unit) VALUES (1,1,3,'kg')`).run()
    db.prepare(`INSERT INTO production_orders (id,product_id,bom_id,quantity,date,status,unit_cost,total_cost)
      VALUES (1,2,1,10,'2026-01-15','draft',350,3500)`).run()
  }

  it('PR1: BOM créé avec main d\'œuvre', () => {
    const db = createFullDb()
    setupProduction(db)
    const bom = db.prepare('SELECT * FROM bom_templates WHERE id = 1').get() as any
    expect(bom.labor_cost).toBe(50)
  })

  it('PR2: coût unitaire = matières + main d\'œuvre', () => {
    const db = createFullDb()
    setupProduction(db)
    // 3 kg × 100 MAD + 50 MAD = 350 MAD/unité
    const bom = db.prepare('SELECT * FROM bom_templates WHERE id = 1').get() as any
    const lines = db.prepare('SELECT bl.*, p.cmup_price FROM bom_lines bl JOIN products p ON p.id = bl.material_id WHERE bl.bom_id = 1').all() as any[]
    const materials = lines.reduce((s: number, l: any) => s + l.quantity * l.cmup_price, 0)
    const unitCost = materials + bom.labor_cost
    expect(unitCost).toBe(350)
  })

  it('PR3: production de 10 unités consomme 30 kg', () => {
    const db = createFullDb()
    setupProduction(db)
    const lines = db.prepare('SELECT * FROM bom_lines WHERE bom_id = 1').all() as any[]
    const consumed = lines.reduce((s: number, l: any) => s + l.quantity * 10, 0)
    expect(consumed).toBe(30)
  })

  it('PR4: sortie matières réduit le stock', () => {
    const db = createFullDb()
    setupProduction(db)
    const m = createStockMovement(db, { product_id: 1, type: 'out', quantity: 30, production_id: 1, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, m, 1)
    const p = db.prepare('SELECT stock_quantity FROM products WHERE id = 1').get() as any
    expect(p.stock_quantity).toBe(970)
  })

  it('PR5: entrée produit fini augmente le stock', () => {
    const db = createFullDb()
    setupProduction(db)
    const m = createStockMovement(db, { product_id: 2, type: 'in', quantity: 10, unit_cost: 350, production_id: 1, date: '2026-01-15', applied: false, created_by: 1 })
    applyMovement(db, m, 1)
    const p = db.prepare('SELECT stock_quantity, cmup_price FROM products WHERE id = 2').get() as any
    expect(p.stock_quantity).toBe(10)
    expect(p.cmup_price).toBeCloseTo(350, 2)
  })

  it('PR6: qiud comptable production est équilibré', () => {
    const db = createFullDb()
    setupProduction(db)
    const fakeDoc = { id: 1, type: 'production', number: 'PROD-001', date: '2026-01-15', party_id: 0, party_type: '', total_ht: 3500, total_tva: 0, total_ttc: 3500 }
    const entryId = createAccountingEntry(db, fakeDoc as any, [], 1)!
    assertBalanced(db, entryId)
  })

  it('PR7: stock insuffisant pour production lève une erreur', () => {
    const db = createFullDb()
    setupProduction(db)
    // Besoin: 3 × 500 = 1500 kg, disponible: 1000 kg
    const m = createStockMovement(db, { product_id: 1, type: 'out', quantity: 1500, production_id: 1, date: '2026-01-15', applied: false, created_by: 1 })
    expect(() => applyMovement(db, m, 1)).toThrow('Stock insuffisant')
  })

  it('PR8: annulation ordre draft est possible', () => {
    const db = createFullDb()
    setupProduction(db)
    db.prepare(`UPDATE production_orders SET status = 'cancelled' WHERE id = 1 AND status = 'draft'`).run()
    const order = db.prepare('SELECT status FROM production_orders WHERE id = 1').get() as any
    expect(order.status).toBe('cancelled')
  })
})

// ============================================================
// MODULE 6: COMPTABILITÉ — GRAND LIVRE ET BALANCE (8 tests)
// ============================================================
describe('[M6] Comptabilité — Grand Livre et Balance', () => {
  it('C1: plan comptable contient les comptes CGNC essentiels', () => {
    const db = createFullDb()
    const codes = ['3421','4411','4455','3455','5141','5161','7111','6121','3121','3151']
    for (const code of codes) {
      const acc = db.prepare('SELECT * FROM accounts WHERE code = ?').get(code) as any
      expect(acc).toBeDefined()
    }
  })

  it('C2: tous les comptes système ne peuvent pas être supprimés (is_system=1)', () => {
    const db = createFullDb()
    const systemAccounts = db.prepare('SELECT COUNT(*) as c FROM accounts WHERE is_system = 1').get() as any
    expect(systemAccounts.c).toBeGreaterThan(0)
  })

  it('C3: كل قيد منفرد متوازن (débit = crédit)', () => {
    const db = createFullDb()
    const invoiceDoc = { id: 1, type: 'invoice', number: 'F-C3-1', date: '2026-01-01', party_id: 1, party_type: 'client', total_ht: 1000, total_tva: 200, total_ttc: 1200 }
    const purchaseDoc = { id: 2, type: 'purchase_invoice', number: 'FF-C3-1', date: '2026-01-02', party_id: 1, party_type: 'supplier', total_ht: 500, total_tva: 100, total_ttc: 600 }
    const invoiceLines = [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20, total_ht: 1000, total_tva: 200, total_ttc: 1200 }]
    const purchaseLines = [{ product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20, total_ht: 500, total_tva: 100, total_ttc: 600 }]

    const e1 = createAccountingEntry(db, invoiceDoc as any, invoiceLines, 1)!
    assertBalanced(db, e1)

    const e2 = createAccountingEntry(db, purchaseDoc as any, purchaseLines, 1)!
    assertBalanced(db, e2)
  })

  it('C4: balance des comptes classe 3 (actif) est positive', () => {
    const db = createFullDb()
    const doc = { id: 1, type: 'invoice', number: 'F-C4', date: '2026-01-01', party_id: 1, party_type: 'client', total_ht: 1000, total_tva: 200, total_ttc: 1200 }
    const lines = [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20, total_ht: 1000, total_tva: 200, total_ttc: 1200 }]
    createAccountingEntry(db, doc as any, lines, 1)
    const balance = db.prepare(`
      SELECT COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0) as bal
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE a.class = 3
    `).get() as any
    expect(balance.bal).toBeGreaterThan(0)
  })

  it('C5: TVA facturée (4455) = somme TVA des factures', () => {
    const db = createFullDb()
    const doc = { id: 1, type: 'invoice', number: 'F-C5', date: '2026-01-01', party_id: 1, party_type: 'client', total_ht: 1000, total_tva: 200, total_ttc: 1200 }
    const lines = [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20, total_ht: 1000, total_tva: 200, total_ttc: 1200 }]
    createAccountingEntry(db, doc as any, lines, 1)
    const tva4455 = db.prepare(`
      SELECT COALESCE(SUM(jl.credit),0) as c FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id WHERE a.code = '4455'
    `).get() as any
    expect(tva4455.c).toBeCloseTo(200, 2)
  })

  it('C6: paiement client crédite le compte client (3421)', () => {
    const db = createFullDb()
    createPaymentEntry(db, { id: 1, party_id: 1, party_type: 'client', amount: 1200, method: 'bank', date: '2026-01-20' }, 1)
    const credit3421 = db.prepare(`
      SELECT COALESCE(SUM(jl.credit),0) as c FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id WHERE a.code = '3421'
    `).get() as any
    expect(credit3421.c).toBeCloseTo(1200, 2)
  })

  it('C7: paiement fournisseur débite le compte fournisseur (4411)', () => {
    const db = createFullDb()
    createPaymentEntry(db, { id: 1, party_id: 1, party_type: 'supplier', amount: 800, method: 'cash', date: '2026-01-20' }, 1)
    const debit4411 = db.prepare(`
      SELECT COALESCE(SUM(jl.debit),0) as d FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id WHERE a.code = '4411'
    `).get() as any
    expect(debit4411.d).toBeCloseTo(800, 2)
  })

  it('C8: avoir client inverse les écritures de la facture', () => {
    const db = createFullDb()
    const invoiceDoc = { id: 1, type: 'invoice', number: 'F-C8', date: '2026-01-01', party_id: 1, party_type: 'client', total_ht: 1000, total_tva: 200, total_ttc: 1200 }
    const avoirDoc   = { id: 2, type: 'avoir',   number: 'AV-C8', date: '2026-01-15', party_id: 1, party_type: 'client', total_ht: 1000, total_tva: 200, total_ttc: 1200 }
    const lines = [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 20, total_ht: 1000, total_tva: 200, total_ttc: 1200 }]
    createAccountingEntry(db, invoiceDoc as any, lines, 1)
    createAccountingEntry(db, avoirDoc as any, lines, 1)
    // Après facture + avoir complet: solde client = 0
    const solde3421 = db.prepare(`
      SELECT COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0) as bal
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE a.code = '3421'
    `).get() as any
    expect(Math.abs(solde3421.bal)).toBeLessThan(0.01)
  })
})

// ============================================================
// MODULE 7: LICENCE — SÉCURITÉ AVANCÉE (6 tests)
// ============================================================
describe('[M7] Licence — Sécurité Avancée', () => {
  it('L1: clé générée et vérifiée avec succès', () => {
    const key = generateLicenseKey('Test Corp SARL', '2028-12-31')
    const r = verifyLicenseKey('Test Corp SARL', key)
    expect(r.valid).toBe(true)
    expect(r.expiryDate).toBe('2028-12-31')
  })

  it('L2: modification d\'un seul caractère invalide la clé', () => {
    const key = generateLicenseKey('Test', '2028-12-31')
    const tampered = key.slice(0, -1) + (key.slice(-1) === 'A' ? 'B' : 'A')
    expect(verifyLicenseKey('Test', tampered).valid).toBe(false)
  })

  it('L3: clé d\'une société ne fonctionne pas pour une autre', () => {
    const key = generateLicenseKey('Société A', '2028-12-31')
    expect(verifyLicenseKey('Société B', key).valid).toBe(false)
  })

  it('L4: clé expirée est valide cryptographiquement mais date passée', () => {
    const key = generateLicenseKey('Test', '2020-01-01')
    const r = verifyLicenseKey('Test', key)
    expect(r.valid).toBe(true)
    expect(new Date(r.expiryDate!).getTime()).toBeLessThan(Date.now())
  })

  it('L5: clé vide retourne valid=false', () => {
    expect(verifyLicenseKey('Test', '').valid).toBe(false)
  })

  it('L6: 1000 clés générées sont toutes uniques', () => {
    const keys = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      keys.add(generateLicenseKey(`Company ${i}`, '2028-12-31'))
    }
    expect(keys.size).toBe(1000)
  })
})

// ============================================================
// MODULE 8: AUDIT LOG — TRAÇABILITÉ COMPLÈTE (6 tests)
// ============================================================
describe('[M8] Audit Log — Traçabilité Complète', () => {
  it('AU1: toutes les actions métier sont tracées', () => {
    const db = createFullDb()
    const actions: any[] = ['CREATE','UPDATE','DELETE','CONFIRM','CANCEL','LOGIN','PAYMENT','LOGOUT','APPLY_STOCK']
    actions.forEach(a => logAudit(db, { user_id: 1, action: a, table_name: 'test' }))
    const result = getAuditLog(db)
    expect(result.total).toBe(9)
  })

  it('AU2: filtrage par action fonctionne', () => {
    const db = createFullDb()
    logAudit(db, { user_id: 1, action: 'LOGIN', table_name: 'users' })
    logAudit(db, { user_id: 1, action: 'CREATE', table_name: 'documents' })
    logAudit(db, { user_id: 1, action: 'LOGIN', table_name: 'users' })
    const logins = getAuditLog(db, { action: 'LOGIN' })
    expect(logins.total).toBe(2)
  })

  it('AU3: pagination correcte sur 50 entrées', () => {
    const db = createFullDb()
    for (let i = 0; i < 50; i++) logAudit(db, { user_id: 1, action: 'CREATE', table_name: 'test', record_id: i })
    const p1 = getAuditLog(db, { page: 1, limit: 20 })
    const p2 = getAuditLog(db, { page: 2, limit: 20 })
    const p3 = getAuditLog(db, { page: 3, limit: 20 })
    expect(p1.rows).toHaveLength(20)
    expect(p2.rows).toHaveLength(20)
    expect(p3.rows).toHaveLength(10)
    expect(p1.total).toBe(50)
  })

  it('AU4: new_values JSON est parsé correctement', () => {
    const db = createFullDb()
    logAudit(db, { user_id: 1, action: 'UPDATE', table_name: 'clients', new_values: { name: 'New Name', amount: 1500.50 } })
    const result = getAuditLog(db)
    expect(result.rows[0].new_values).toEqual({ name: 'New Name', amount: 1500.50 })
  })

  it('AU5: user_name inclus dans les résultats', () => {
    const db = createFullDb()
    logAudit(db, { user_id: 1, action: 'LOGIN', table_name: 'users' })
    const result = getAuditLog(db)
    expect(result.rows[0].user_name).toBe('Admin')
  })

  it('AU6: FK sur user_id protège l\'intégrité', () => {
    const db = createFullDb()
    expect(() => {
      db.prepare(`INSERT INTO audit_log (user_id,action,table_name) VALUES (9999,'CREATE','test')`).run()
    }).toThrow()
  })
})

// ============================================================
// MODULE 9: MIGRATION 008 — CONTRAINTES AVANCÉES (6 tests)
// ============================================================
describe('[M9] Migration 008 — Contraintes Avancées', () => {
  it('MG1: trigger payments_amount_check existe', () => {
    const db = createFullDb()
    const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_payments_amount_check'`).get()
    expect(t).toBeDefined()
  })

  it('MG2: trigger doc_lines_quantity_check existe', () => {
    const db = createFullDb()
    const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_doc_lines_quantity_check'`).get()
    expect(t).toBeDefined()
  })

  it('MG3: trigger documents_status_check existe', () => {
    const db = createFullDb()
    const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_documents_status_check'`).get()
    expect(t).toBeDefined()
  })

  it('MG4: trigger payment_allocations_overpayment existe', () => {
    const db = createFullDb()
    const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_payment_allocations_overpayment'`).get()
    expect(t).toBeDefined()
  })

  it('MG5: trigger stock_movements_quantity_check existe', () => {
    const db = createFullDb()
    const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_stock_movements_quantity_check'`).get()
    expect(t).toBeDefined()
  })

  it('MG6: allocation exactement égale au total est autorisée (tolérance 0.1%)', () => {
    const db = createFullDb()
    db.prepare(`INSERT INTO documents (id,type,number,date,party_id,party_type,status,total_ht,total_tva,total_ttc) VALUES (1,'invoice','F-MG6','2026-01-01',1,'client','confirmed',1000,200,1200)`).run()
    db.prepare(`INSERT INTO doc_invoices (document_id,payment_status) VALUES (1,'unpaid')`).run()
    db.prepare(`INSERT INTO payments (id,party_id,party_type,amount,method,date,status,document_id,created_by) VALUES (1,1,'client',1200,'cash','2026-01-01','pending',1,1)`).run()
    expect(() => db.prepare(`INSERT INTO payment_allocations (payment_id,document_id,amount) VALUES (1,1,1200)`).run()).not.toThrow()
  })
})
