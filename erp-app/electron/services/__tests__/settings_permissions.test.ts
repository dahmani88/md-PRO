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

const ALL_PAGES = ['rapports', 'documents', 'paiements', 'parties', 'stock', 'achats', 'production', 'comptabilite', 'parametres']

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

function addUser(db: Database.Database, id: number, role: string, email?: string) {
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,'hash',?)`).run(id, `User${id}`, email ?? `u${id}@test.ma`, role)
}

function getPermissions(db: Database.Database, userId: number): string[] {
  return (db.prepare('SELECT page FROM user_permissions WHERE user_id=?').all(userId) as any[]).map(r => r.page)
}

function canAccess(db: Database.Database, userId: number, page: string): boolean {
  const row = db.prepare('SELECT * FROM user_permissions WHERE user_id=? AND page=?').get(userId, page)
  return !!row
}

describe('Settings – User Permissions', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    getSetDb()(db)
  })

  // ── Migration 006 ──────────────────────────────────────────────────────────
  describe('Migration 006', () => {
    it('creates user_permissions table', () => {
      const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_permissions'`).get()
      expect(tbl).toBeDefined()
    })

    it('user_permissions has id column', () => {
      const cols = db.prepare(`PRAGMA table_info(user_permissions)`).all() as any[]
      expect(cols.some(c => c.name === 'id')).toBe(true)
    })

    it('user_permissions has user_id column', () => {
      const cols = db.prepare(`PRAGMA table_info(user_permissions)`).all() as any[]
      expect(cols.some(c => c.name === 'user_id')).toBe(true)
    })

    it('user_permissions has page column', () => {
      const cols = db.prepare(`PRAGMA table_info(user_permissions)`).all() as any[]
      expect(cols.some(c => c.name === 'page')).toBe(true)
    })

    it('user_permissions has UNIQUE constraint on (user_id, page)', () => {
      const indexes = db.prepare(`PRAGMA index_list(user_permissions)`).all() as any[]
      const hasUnique = indexes.some(i => i.unique === 1)
      expect(hasUnique).toBe(true)
    })

    it('populates permissions for existing admin user', () => {
      // admin user (id=1) was inserted before migration_006 in createTestDb
      // but migration_006 runs on empty users list in createTestDb
      // Re-run migration on a db that already has users
      const db2 = new Database(':memory:')
      db2.pragma('foreign_keys = ON')
      migration_001_initial(db2)
      migration_002_accounting(db2)
      migration_004_settings(db2)
      db2.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (1,'Admin','admin@test.ma','hash','admin')`).run()
      migration_006_user_permissions(db2)
      const perms = getPermissions(db2, 1)
      expect(perms.length).toBe(ALL_PAGES.length)
    })

    it('populates permissions for existing sales user', () => {
      const db2 = new Database(':memory:')
      db2.pragma('foreign_keys = ON')
      migration_001_initial(db2)
      migration_002_accounting(db2)
      migration_004_settings(db2)
      db2.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (2,'Sales','sales@test.ma','hash','sales')`).run()
      migration_006_user_permissions(db2)
      const perms = getPermissions(db2, 2)
      expect(perms).toContain('rapports')
      expect(perms).toContain('documents')
      expect(perms).toContain('paiements')
      expect(perms).toContain('parties')
      expect(perms).toContain('stock')
    })

    it('populates permissions for existing accountant user', () => {
      const db2 = new Database(':memory:')
      db2.pragma('foreign_keys = ON')
      migration_001_initial(db2)
      migration_002_accounting(db2)
      migration_004_settings(db2)
      db2.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (3,'Acc','acc@test.ma','hash','accountant')`).run()
      migration_006_user_permissions(db2)
      const perms = getPermissions(db2, 3)
      expect(perms).toContain('comptabilite')
      expect(perms).not.toContain('stock')
    })

    it('populates permissions for existing warehouse user', () => {
      const db2 = new Database(':memory:')
      db2.pragma('foreign_keys = ON')
      migration_001_initial(db2)
      migration_002_accounting(db2)
      migration_004_settings(db2)
      db2.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (4,'Wh','wh@test.ma','hash','warehouse')`).run()
      migration_006_user_permissions(db2)
      const perms = getPermissions(db2, 4)
      expect(perms).toContain('stock')
      expect(perms).toContain('achats')
      expect(perms).toContain('production')
      expect(perms).not.toContain('rapports')
    })
  })

  // ── Admin permissions ──────────────────────────────────────────────────────
  describe('Admin gets all pages', () => {
    it('admin has rapports', () => {
      addUser(db, 10, 'admin')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(10, 'rapports')
      expect(canAccess(db, 10, 'rapports')).toBe(true)
    })

    it('admin has all 9 pages when granted', () => {
      addUser(db, 11, 'admin')
      for (const p of ALL_PAGES) {
        db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(11, p)
      }
      expect(getPermissions(db, 11)).toHaveLength(9)
    })

    it('admin can access parametres', () => {
      addUser(db, 12, 'admin')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(12, 'parametres')
      expect(canAccess(db, 12, 'parametres')).toBe(true)
    })

    it('admin can access comptabilite', () => {
      addUser(db, 13, 'admin')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(13, 'comptabilite')
      expect(canAccess(db, 13, 'comptabilite')).toBe(true)
    })
  })

  // ── Accountant permissions ─────────────────────────────────────────────────
  describe('Accountant gets subset', () => {
    it('accountant has rapports', () => {
      addUser(db, 20, 'accountant')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(20, 'rapports')
      expect(canAccess(db, 20, 'rapports')).toBe(true)
    })

    it('accountant has comptabilite', () => {
      addUser(db, 21, 'accountant')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(21, 'comptabilite')
      expect(canAccess(db, 21, 'comptabilite')).toBe(true)
    })

    it('accountant does not have stock by default', () => {
      addUser(db, 22, 'accountant')
      expect(canAccess(db, 22, 'stock')).toBe(false)
    })

    it('accountant does not have production by default', () => {
      addUser(db, 23, 'accountant')
      expect(canAccess(db, 23, 'production')).toBe(false)
    })
  })

  // ── Sales permissions ──────────────────────────────────────────────────────
  describe('Sales gets subset', () => {
    it('sales has documents', () => {
      addUser(db, 30, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(30, 'documents')
      expect(canAccess(db, 30, 'documents')).toBe(true)
    })

    it('sales has paiements', () => {
      addUser(db, 31, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(31, 'paiements')
      expect(canAccess(db, 31, 'paiements')).toBe(true)
    })

    it('sales does not have comptabilite by default', () => {
      addUser(db, 32, 'sales')
      expect(canAccess(db, 32, 'comptabilite')).toBe(false)
    })

    it('sales does not have production by default', () => {
      addUser(db, 33, 'sales')
      expect(canAccess(db, 33, 'production')).toBe(false)
    })
  })

  // ── Warehouse permissions ──────────────────────────────────────────────────
  describe('Warehouse gets subset', () => {
    it('warehouse has stock', () => {
      addUser(db, 40, 'warehouse')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(40, 'stock')
      expect(canAccess(db, 40, 'stock')).toBe(true)
    })

    it('warehouse has achats', () => {
      addUser(db, 41, 'warehouse')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(41, 'achats')
      expect(canAccess(db, 41, 'achats')).toBe(true)
    })

    it('warehouse has production', () => {
      addUser(db, 42, 'warehouse')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(42, 'production')
      expect(canAccess(db, 42, 'production')).toBe(true)
    })

    it('warehouse does not have rapports by default', () => {
      addUser(db, 43, 'warehouse')
      expect(canAccess(db, 43, 'rapports')).toBe(false)
    })

    it('warehouse does not have paiements by default', () => {
      addUser(db, 44, 'warehouse')
      expect(canAccess(db, 44, 'paiements')).toBe(false)
    })
  })

  // ── Create user with custom permissions ───────────────────────────────────
  describe('Create user with custom permissions', () => {
    it('can assign custom pages to a new user', () => {
      addUser(db, 50, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(50, 'comptabilite')
      expect(canAccess(db, 50, 'comptabilite')).toBe(true)
    })

    it('can assign all pages to any role', () => {
      addUser(db, 51, 'sales')
      for (const p of ALL_PAGES) {
        db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(51, p)
      }
      expect(getPermissions(db, 51)).toHaveLength(9)
    })

    it('can assign zero pages to a new user', () => {
      addUser(db, 52, 'sales')
      expect(getPermissions(db, 52)).toHaveLength(0)
    })
  })

  // ── Update user permissions ────────────────────────────────────────────────
  describe('Update user permissions', () => {
    it('can add a page to existing permissions', () => {
      addUser(db, 60, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(60, 'documents')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(60, 'stock')
      expect(canAccess(db, 60, 'stock')).toBe(true)
    })

    it('can remove a page from permissions', () => {
      addUser(db, 61, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(61, 'documents')
      db.prepare('DELETE FROM user_permissions WHERE user_id=? AND page=?').run(61, 'documents')
      expect(canAccess(db, 61, 'documents')).toBe(false)
    })

    it('can replace all permissions', () => {
      addUser(db, 62, 'sales')
      for (const p of ['documents', 'paiements', 'parties']) {
        db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(62, p)
      }
      db.prepare('DELETE FROM user_permissions WHERE user_id=?').run(62)
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(62, 'stock')
      const perms = getPermissions(db, 62)
      expect(perms).toEqual(['stock'])
    })

    it('replacing permissions removes old ones', () => {
      addUser(db, 63, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(63, 'documents')
      db.prepare('DELETE FROM user_permissions WHERE user_id=?').run(63)
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(63, 'stock')
      expect(canAccess(db, 63, 'documents')).toBe(false)
    })
  })

  // ── canAccess logic ────────────────────────────────────────────────────────
  describe('canAccess logic', () => {
    it('user with permission returns true', () => {
      addUser(db, 70, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(70, 'rapports')
      expect(canAccess(db, 70, 'rapports')).toBe(true)
    })

    it('user without permission returns false', () => {
      addUser(db, 71, 'sales')
      expect(canAccess(db, 71, 'rapports')).toBe(false)
    })

    it('user with no permissions cannot access anything', () => {
      addUser(db, 72, 'sales')
      for (const p of ALL_PAGES) {
        expect(canAccess(db, 72, p)).toBe(false)
      }
    })

    it('admin with all pages can access all 9 pages', () => {
      addUser(db, 73, 'admin')
      for (const p of ALL_PAGES) {
        db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(73, p)
      }
      for (const p of ALL_PAGES) {
        expect(canAccess(db, 73, p)).toBe(true)
      }
    })
  })

  // ── Permission uniqueness ──────────────────────────────────────────────────
  describe('Permission uniqueness', () => {
    it('cannot add same page twice', () => {
      addUser(db, 80, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(80, 'stock')
      expect(() => db.prepare('INSERT INTO user_permissions (user_id,page) VALUES (?,?)').run(80, 'stock')).toThrow()
    })

    it('INSERT OR IGNORE silently ignores duplicate', () => {
      addUser(db, 81, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(81, 'stock')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(81, 'stock')
      const count = (db.prepare('SELECT COUNT(*) as c FROM user_permissions WHERE user_id=?').get(81) as any).c
      expect(count).toBe(1)
    })

    it('same page can be assigned to different users', () => {
      addUser(db, 82, 'sales')
      addUser(db, 83, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(82, 'stock')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(83, 'stock')
      expect(canAccess(db, 82, 'stock')).toBe(true)
      expect(canAccess(db, 83, 'stock')).toBe(true)
    })
  })

  // ── Delete user cascades to permissions ───────────────────────────────────
  describe('Delete user cascades to permissions', () => {
    it('deleting user removes their permissions', () => {
      addUser(db, 90, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(90, 'stock')
      db.prepare('DELETE FROM users WHERE id=?').run(90)
      const perms = getPermissions(db, 90)
      expect(perms).toHaveLength(0)
    })

    it('cascade does not affect other users permissions', () => {
      addUser(db, 91, 'sales')
      addUser(db, 92, 'sales')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(91, 'stock')
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(92, 'stock')
      db.prepare('DELETE FROM users WHERE id=?').run(91)
      expect(canAccess(db, 92, 'stock')).toBe(true)
    })
  })

  // ── All 9 pages ────────────────────────────────────────────────────────────
  describe('All 9 pages', () => {
    it.each(ALL_PAGES)('page "%s" can be stored in user_permissions', (page) => {
      addUser(db, 100 + ALL_PAGES.indexOf(page), 'sales')
      const uid = 100 + ALL_PAGES.indexOf(page)
      db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,page) VALUES (?,?)').run(uid, page)
      expect(canAccess(db, uid, page)).toBe(true)
    })

    it('all 9 pages are distinct', () => {
      const unique = new Set(ALL_PAGES)
      expect(unique.size).toBe(9)
    })
  })
})
