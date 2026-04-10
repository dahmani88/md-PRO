/**
 * Tests — Validations des lignes de documents
 * Couvre: quantité négative/nulle, prix négatif, remise >100,
 *         cas limites valides, multi-lignes
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { createDocument } from '../document.service'

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
    VALUES (1,'P001','Produit A','pcs','finished',100,50,5,120)`).run()
  return db
}

describe('Validation — Quantité', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('refuse une quantité nulle (0)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 0, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('refuse une quantité négative (-1)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: -1, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('refuse une quantité très négative (-999)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: -999, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('accepte une quantité de 1', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })).not.toThrow()
  })

  it('accepte une quantité décimale (0.5)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 0.5, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })).not.toThrow()
  })

  it('accepte une grande quantité (10000)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10000, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })).not.toThrow()
  })

  it('refuse si une ligne a quantité nulle parmi plusieurs lignes valides', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [
        { product_id: 1, quantity: 5, unit_price: 100, tva_rate: 20 },
        { product_id: 1, quantity: 0, unit_price: 100, tva_rate: 20 },
      ],
      created_by: 1,
    })).toThrow()
  })
})

describe('Validation — Prix unitaire', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('refuse un prix négatif (-10)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: -10, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('refuse un prix très négatif (-9999)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: -9999, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('accepte un prix de 0 (service gratuit)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ description: 'Service gratuit', quantity: 1, unit_price: 0, tva_rate: 0 }],
      created_by: 1,
    })).not.toThrow()
  })

  it('accepte un prix décimal (99.99)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 99.99, tva_rate: 20 }],
      created_by: 1,
    })).not.toThrow()
  })

  it('accepte un prix élevé (1000000)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 1000000, tva_rate: 20 }],
      created_by: 1,
    })).not.toThrow()
  })
})

describe('Validation — Remise (discount)', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('refuse une remise > 100% (110)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, discount: 110, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('refuse une remise négative (-5)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, discount: -5, tva_rate: 20 }],
      created_by: 1,
    })).toThrow()
  })

  it('accepte une remise de 0%', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, discount: 0, tva_rate: 20 }],
      created_by: 1,
    })
    const doc = db.prepare('SELECT total_ht FROM documents WHERE id=?').get(id) as any
    expect(doc.total_ht).toBeCloseTo(100, 2)
  })

  it('accepte une remise de 100% → total_ht = 0', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, discount: 100, tva_rate: 20 }],
      created_by: 1,
    })
    const doc = db.prepare('SELECT total_ht FROM documents WHERE id=?').get(id) as any
    expect(doc.total_ht).toBeCloseTo(0, 2)
  })

  it('accepte une remise de 50% → total_ht = 50', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, discount: 50, tva_rate: 20 }],
      created_by: 1,
    })
    const doc = db.prepare('SELECT total_ht FROM documents WHERE id=?').get(id) as any
    expect(doc.total_ht).toBeCloseTo(50, 2)
  })

  it('accepte une remise de 10.5% (décimale)', () => {
    expect(() => createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, discount: 10.5, tva_rate: 20 }],
      created_by: 1,
    })).not.toThrow()
  })
})

describe('Validation — Calculs corrects', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('HT = quantité × prix × (1 - remise/100)', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 5, unit_price: 200, discount: 10, tva_rate: 20 }],
      created_by: 1,
    })
    const doc = db.prepare('SELECT total_ht FROM documents WHERE id=?').get(id) as any
    // 5 × 200 × 0.9 = 900
    expect(doc.total_ht).toBeCloseTo(900, 2)
  })

  it('TVA = HT × taux_tva / 100', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 10, unit_price: 100, tva_rate: 14 }],
      created_by: 1,
    })
    const doc = db.prepare('SELECT total_ht, total_tva FROM documents WHERE id=?').get(id) as any
    expect(doc.total_tva).toBeCloseTo(doc.total_ht * 0.14, 2)
  })

  it('TTC = HT + TVA', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 3, unit_price: 150, discount: 5, tva_rate: 20 }],
      created_by: 1,
    })
    const doc = db.prepare('SELECT total_ht, total_tva, total_ttc FROM documents WHERE id=?').get(id) as any
    expect(doc.total_ttc).toBeCloseTo(doc.total_ht + doc.total_tva, 2)
  })

  it('TVA par défaut = 20% si non spécifiée', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100 }],
      created_by: 1,
    })
    const doc = db.prepare('SELECT total_tva FROM documents WHERE id=?').get(id) as any
    expect(doc.total_tva).toBeCloseTo(20, 2)
  })

  it('multi-lignes: totaux sont la somme des lignes', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [
        { product_id: 1, quantity: 2, unit_price: 100, tva_rate: 20 },
        { product_id: 1, quantity: 3, unit_price: 50, tva_rate: 20 },
      ],
      created_by: 1,
    })
    const doc = db.prepare('SELECT total_ht FROM documents WHERE id=?').get(id) as any
    // 2×100 + 3×50 = 200 + 150 = 350
    expect(doc.total_ht).toBeCloseTo(350, 2)
  })

  it('remise 0 par défaut si non spécifiée', () => {
    const { id } = createDocument({
      type: 'invoice', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
      created_by: 1,
    })
    const line = db.prepare('SELECT discount FROM document_lines WHERE document_id=?').get(id) as any
    expect(line.discount).toBe(0)
  })
})

describe('Validation — Types de documents', () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb(); getSetDb()(db) })

  it('valide les lignes pour tous les types de documents', () => {
    const types = ['invoice', 'quote', 'bl', 'proforma', 'purchase_order', 'purchase_invoice']
    for (const type of types) {
      expect(() => createDocument({
        type, date: '2026-01-15', party_id: 1, party_type: type.includes('purchase') ? 'supplier' : 'client',
        lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
        created_by: 1,
      })).not.toThrow()
    }
  })

  it('valide les lignes pour avoir', () => {
    expect(() => createDocument({
      type: 'avoir', date: '2026-01-15', party_id: 1, party_type: 'client',
      lines: [{ product_id: 1, quantity: 1, unit_price: 100, tva_rate: 20 }],
      extra: { avoir_type: 'commercial', affects_stock: false },
      created_by: 1,
    })).not.toThrow()
  })
})
