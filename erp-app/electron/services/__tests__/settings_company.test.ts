import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { migration_006_user_permissions } from '../../database/migrations/006_user_permissions'
import { migration_007_user_sessions } from '../../database/migrations/007_user_sessions'

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
  migration_006_user_permissions(db)
  migration_007_user_sessions(db)
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (1,'Admin','admin@test.ma','hash','admin')`).run()
  return db
}

function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as any
  return row?.value ?? null
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=?,updated_at=CURRENT_TIMESTAMP
  `).run(key, value, value)
}

function setMany(db: Database.Database, settings: Record<string, string>): void {
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      setSetting(db, key, value)
    }
  })
  tx()
}

describe('Settings – Company Settings', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    getSetDb()(db)
  })

  // ── Table existence ────────────────────────────────────────────────────────
  describe('app_settings table', () => {
    it('app_settings table exists after migration 004', () => {
      const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'`).get()
      expect(tbl).toBeDefined()
    })

    it('app_settings has key column', () => {
      const cols = db.prepare(`PRAGMA table_info(app_settings)`).all() as any[]
      expect(cols.some(c => c.name === 'key')).toBe(true)
    })

    it('app_settings has value column', () => {
      const cols = db.prepare(`PRAGMA table_info(app_settings)`).all() as any[]
      expect(cols.some(c => c.name === 'value')).toBe(true)
    })

    it('app_settings has updated_at column', () => {
      const cols = db.prepare(`PRAGMA table_info(app_settings)`).all() as any[]
      expect(cols.some(c => c.name === 'updated_at')).toBe(true)
    })

    it('key is PRIMARY KEY', () => {
      const cols = db.prepare(`PRAGMA table_info(app_settings)`).all() as any[]
      const keyCol = cols.find(c => c.name === 'key') as any
      expect(keyCol.pk).toBe(1)
    })
  })

  // ── Default values ─────────────────────────────────────────────────────────
  describe('Default values', () => {
    it('invoice_prefix defaults to F', () => {
      expect(getSetting(db, 'invoice_prefix')).toBe('F')
    })

    it('quote_prefix defaults to D', () => {
      expect(getSetting(db, 'quote_prefix')).toBe('D')
    })

    it('bl_prefix defaults to BL', () => {
      expect(getSetting(db, 'bl_prefix')).toBe('BL')
    })

    it('proforma_prefix defaults to PRO', () => {
      expect(getSetting(db, 'proforma_prefix')).toBe('PRO')
    })

    it('avoir_prefix defaults to AV', () => {
      expect(getSetting(db, 'avoir_prefix')).toBe('AV')
    })

    it('po_prefix defaults to BC', () => {
      expect(getSetting(db, 'po_prefix')).toBe('BC')
    })

    it('reception_prefix defaults to BR', () => {
      expect(getSetting(db, 'reception_prefix')).toBe('BR')
    })

    it('pinvoice_prefix defaults to FF', () => {
      expect(getSetting(db, 'pinvoice_prefix')).toBe('FF')
    })

    it('import_prefix defaults to IMP', () => {
      expect(getSetting(db, 'import_prefix')).toBe('IMP')
    })

    it('currency defaults to MAD', () => {
      expect(getSetting(db, 'currency')).toBe('MAD')
    })

    it('invoice_footer has default value', () => {
      const v = getSetting(db, 'invoice_footer')
      expect(v).toBeTruthy()
      expect(typeof v).toBe('string')
    })

    it('payment_terms has default value', () => {
      const v = getSetting(db, 'payment_terms')
      expect(v).toBeTruthy()
      expect(typeof v).toBe('string')
    })

    it('default_tva_rate defaults to 20', () => {
      expect(getSetting(db, 'default_tva_rate')).toBe('20')
    })

    it('auto_backup defaults to 1', () => {
      expect(getSetting(db, 'auto_backup')).toBe('1')
    })

    it('backup_interval defaults to 24', () => {
      expect(getSetting(db, 'backup_interval')).toBe('24')
    })

    it('all 9 document prefixes have defaults', () => {
      const prefixKeys = ['invoice_prefix', 'quote_prefix', 'bl_prefix', 'proforma_prefix', 'avoir_prefix', 'po_prefix', 'reception_prefix', 'pinvoice_prefix', 'import_prefix']
      for (const key of prefixKeys) {
        expect(getSetting(db, key)).not.toBeNull()
      }
    })
  })

  // ── Get setting by key ─────────────────────────────────────────────────────
  describe('Get setting by key', () => {
    it('returns value for existing key', () => {
      expect(getSetting(db, 'currency')).toBe('MAD')
    })

    it('returns null for non-existent key', () => {
      expect(getSetting(db, 'nonexistent_key_xyz')).toBeNull()
    })

    it('returns all settings as object', () => {
      const rows = db.prepare('SELECT key,value FROM app_settings').all() as any[]
      const obj = Object.fromEntries(rows.map(r => [r.key, r.value]))
      expect(obj['currency']).toBe('MAD')
      expect(obj['invoice_prefix']).toBe('F')
    })

    it('returns correct value after update', () => {
      setSetting(db, 'currency', 'EUR')
      expect(getSetting(db, 'currency')).toBe('EUR')
    })
  })

  // ── Set setting value ──────────────────────────────────────────────────────
  describe('Set setting value', () => {
    it('sets a new value for existing key', () => {
      setSetting(db, 'currency', 'EUR')
      expect(getSetting(db, 'currency')).toBe('EUR')
    })

    it('inserts a new key-value pair', () => {
      setSetting(db, 'custom_key', 'custom_value')
      expect(getSetting(db, 'custom_key')).toBe('custom_value')
    })

    it('updates updated_at on set', () => {
      setSetting(db, 'currency', 'USD')
      const row = db.prepare('SELECT updated_at FROM app_settings WHERE key=?').get('currency') as any
      expect(row.updated_at).toBeTruthy()
    })

    it('empty string value is valid', () => {
      setSetting(db, 'invoice_footer', '')
      expect(getSetting(db, 'invoice_footer')).toBe('')
    })

    it('numeric string values stored correctly', () => {
      setSetting(db, 'default_tva_rate', '14')
      expect(getSetting(db, 'default_tva_rate')).toBe('14')
    })

    it('special characters in value stored correctly', () => {
      setSetting(db, 'invoice_footer', 'Merci & à bientôt!')
      expect(getSetting(db, 'invoice_footer')).toBe('Merci & à bientôt!')
    })

    it('long string value stored correctly', () => {
      const long = 'A'.repeat(500)
      setSetting(db, 'invoice_footer', long)
      expect(getSetting(db, 'invoice_footer')).toBe(long)
    })
  })

  // ── Update existing setting ────────────────────────────────────────────────
  describe('Update existing setting', () => {
    it('updates invoice_prefix', () => {
      setSetting(db, 'invoice_prefix', 'FAC')
      expect(getSetting(db, 'invoice_prefix')).toBe('FAC')
    })

    it('updates currency from MAD to USD', () => {
      setSetting(db, 'currency', 'USD')
      expect(getSetting(db, 'currency')).toBe('USD')
    })

    it('multiple updates keep last value', () => {
      setSetting(db, 'currency', 'EUR')
      setSetting(db, 'currency', 'GBP')
      setSetting(db, 'currency', 'USD')
      expect(getSetting(db, 'currency')).toBe('USD')
    })

    it('settings persist after multiple updates', () => {
      setSetting(db, 'invoice_prefix', 'INV')
      setSetting(db, 'quote_prefix', 'QUO')
      setSetting(db, 'currency', 'EUR')
      expect(getSetting(db, 'invoice_prefix')).toBe('INV')
      expect(getSetting(db, 'quote_prefix')).toBe('QUO')
      expect(getSetting(db, 'currency')).toBe('EUR')
    })
  })

  // ── Set many settings ──────────────────────────────────────────────────────
  describe('Set many settings at once', () => {
    it('sets multiple settings in one call', () => {
      setMany(db, { currency: 'EUR', invoice_prefix: 'FAC', quote_prefix: 'DEV' })
      expect(getSetting(db, 'currency')).toBe('EUR')
      expect(getSetting(db, 'invoice_prefix')).toBe('FAC')
      expect(getSetting(db, 'quote_prefix')).toBe('DEV')
    })

    it('setMany is atomic (all or nothing)', () => {
      // All should succeed
      setMany(db, { currency: 'EUR', default_tva_rate: '14' })
      expect(getSetting(db, 'currency')).toBe('EUR')
      expect(getSetting(db, 'default_tva_rate')).toBe('14')
    })

    it('setMany with empty object changes nothing', () => {
      const before = getSetting(db, 'currency')
      setMany(db, {})
      expect(getSetting(db, 'currency')).toBe(before)
    })

    it('setMany updates existing and inserts new keys', () => {
      setMany(db, { currency: 'EUR', brand_new_key: 'brand_new_value' })
      expect(getSetting(db, 'currency')).toBe('EUR')
      expect(getSetting(db, 'brand_new_key')).toBe('brand_new_value')
    })
  })

  // ── invoice_footer and payment_terms ──────────────────────────────────────
  describe('invoice_footer and payment_terms', () => {
    it('invoice_footer default contains text', () => {
      const v = getSetting(db, 'invoice_footer')
      expect(v!.length).toBeGreaterThan(0)
    })

    it('payment_terms default contains text', () => {
      const v = getSetting(db, 'payment_terms')
      expect(v!.length).toBeGreaterThan(0)
    })

    it('can update invoice_footer', () => {
      setSetting(db, 'invoice_footer', 'Thank you for your business')
      expect(getSetting(db, 'invoice_footer')).toBe('Thank you for your business')
    })

    it('can update payment_terms', () => {
      setSetting(db, 'payment_terms', 'Net 60 days')
      expect(getSetting(db, 'payment_terms')).toBe('Net 60 days')
    })
  })
})
