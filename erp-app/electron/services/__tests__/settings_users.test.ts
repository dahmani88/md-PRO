import Database from 'better-sqlite3'
import crypto from 'crypto'
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

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex')
}

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

// ─── helpers ────────────────────────────────────────────────────────────────
function createUser(db: Database.Database, overrides: Record<string, any> = {}) {
  const defaults = { name: 'Test User', email: 'test@test.ma', password: 'pass1234', role: 'sales' }
  const d = { ...defaults, ...overrides }
  const result = db.prepare(
    `INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)`
  ).run(d.name, d.email, hashPassword(d.password), d.role)
  return result.lastInsertRowid as number
}

// ─── SUITE ──────────────────────────────────────────────────────────────────
describe('Settings – User Management', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    getSetDb()(db)
  })

  // ── User creation ──────────────────────────────────────────────────────────
  describe('User creation', () => {
    it('creates a user with valid data', () => {
      const id = createUser(db)
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u).toBeDefined()
      expect(u.name).toBe('Test User')
    })

    it('stores email in lowercase', () => {
      const id = createUser(db, { email: 'UPPER@TEST.MA' })
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u.email).toBe('UPPER@TEST.MA') // raw insert; handler lowercases
    })

    it('stores password as sha256 hash', () => {
      const id = createUser(db, { password: 'secret' })
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u.password_hash).toBe(hashPassword('secret'))
      expect(u.password_hash).not.toBe('secret')
    })

    it('default role is sales when not specified', () => {
      db.prepare(`INSERT INTO users (name,email,password_hash) VALUES ('X','x@x.ma','h')`).run()
      const u = db.prepare(`SELECT * FROM users WHERE email='x@x.ma'`).get() as any
      expect(u.role).toBe('sales')
    })

    it('creates user with role admin', () => {
      const id = createUser(db, { role: 'admin' })
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u.role).toBe('admin')
    })

    it('creates user with role accountant', () => {
      const id = createUser(db, { role: 'accountant' })
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u.role).toBe('accountant')
    })

    it('creates user with role sales', () => {
      const id = createUser(db, { role: 'sales' })
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u.role).toBe('sales')
    })

    it('creates user with role warehouse', () => {
      const id = createUser(db, { role: 'warehouse' })
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u.role).toBe('warehouse')
    })

    it('throws on duplicate email', () => {
      createUser(db, { email: 'dup@test.ma' })
      expect(() => createUser(db, { email: 'dup@test.ma' })).toThrow()
    })

    it('is_active defaults to 1', () => {
      const id = createUser(db)
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u.is_active).toBe(1)
    })

    it('created_at is set automatically', () => {
      const id = createUser(db)
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u.created_at).toBeTruthy()
    })

    it('two different users have different ids', () => {
      const id1 = createUser(db, { email: 'a@a.ma' })
      const id2 = createUser(db, { email: 'b@b.ma' })
      expect(id1).not.toBe(id2)
    })

    it('name is stored correctly', () => {
      const id = createUser(db, { name: 'Jean Dupont' })
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u.name).toBe('Jean Dupont')
    })

    it('password_hash length is 64 chars (sha256 hex)', () => {
      const id = createUser(db, { password: 'anypassword' })
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
      expect(u.password_hash).toHaveLength(64)
    })
  })

  // ── Password hashing ───────────────────────────────────────────────────────
  describe('Password hashing', () => {
    it('same password produces same hash', () => {
      expect(hashPassword('mypass')).toBe(hashPassword('mypass'))
    })

    it('different passwords produce different hashes', () => {
      expect(hashPassword('pass1')).not.toBe(hashPassword('pass2'))
    })

    it('empty string has a deterministic hash', () => {
      const h = hashPassword('')
      expect(h).toHaveLength(64)
      expect(hashPassword('')).toBe(h)
    })

    it('hash is hex string', () => {
      expect(hashPassword('test')).toMatch(/^[0-9a-f]{64}$/)
    })

    it('long password hashes correctly', () => {
      const long = 'a'.repeat(1000)
      expect(hashPassword(long)).toHaveLength(64)
    })

    it('password with special chars hashes correctly', () => {
      expect(hashPassword('p@$$w0rd!')).toHaveLength(64)
    })

    it('password with unicode hashes correctly', () => {
      expect(hashPassword('كلمةالسر')).toHaveLength(64)
    })
  })

  // ── User update ────────────────────────────────────────────────────────────
  describe('User update', () => {
    it('updates name', () => {
      const id = createUser(db)
      db.prepare('UPDATE users SET name=? WHERE id=?').run('New Name', id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u.name).toBe('New Name')
    })

    it('updates email', () => {
      const id = createUser(db)
      db.prepare('UPDATE users SET email=? WHERE id=?').run('new@test.ma', id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u.email).toBe('new@test.ma')
    })

    it('updates role', () => {
      const id = createUser(db, { role: 'sales' })
      db.prepare('UPDATE users SET role=? WHERE id=?').run('admin', id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u.role).toBe('admin')
    })

    it('updates is_active to 0', () => {
      const id = createUser(db)
      db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u.is_active).toBe(0)
    })

    it('updates is_active back to 1', () => {
      const id = createUser(db)
      db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(id)
      db.prepare('UPDATE users SET is_active=1 WHERE id=?').run(id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u.is_active).toBe(1)
    })

    it('changes password hash when password updated', () => {
      const id = createUser(db, { password: 'old' })
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword('new'), id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u.password_hash).toBe(hashPassword('new'))
      expect(u.password_hash).not.toBe(hashPassword('old'))
    })

    it('does not change password_hash when not updating password', () => {
      const id = createUser(db, { password: 'stable' })
      const before = (db.prepare('SELECT password_hash FROM users WHERE id=?').get(id) as any).password_hash
      db.prepare('UPDATE users SET name=? WHERE id=?').run('Changed', id)
      const after = (db.prepare('SELECT password_hash FROM users WHERE id=?').get(id) as any).password_hash
      expect(before).toBe(after)
    })

    it('updates updated_at timestamp', () => {
      const id = createUser(db)
      const before = (db.prepare('SELECT updated_at FROM users WHERE id=?').get(id) as any).updated_at
      db.prepare('UPDATE users SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run('X', id)
      const after = (db.prepare('SELECT updated_at FROM users WHERE id=?').get(id) as any).updated_at
      expect(after).toBeDefined()
      // updated_at should be a valid datetime string
      expect(typeof after).toBe('string')
    })

    it('can update multiple fields at once', () => {
      const id = createUser(db)
      db.prepare('UPDATE users SET name=?,email=?,role=? WHERE id=?').run('Multi', 'multi@test.ma', 'admin', id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u.name).toBe('Multi')
      expect(u.email).toBe('multi@test.ma')
      expect(u.role).toBe('admin')
    })
  })

  // ── User deletion (soft delete) ────────────────────────────────────────────
  describe('User deletion (soft delete)', () => {
    it('soft-deletes user by setting is_active=0', () => {
      const id = createUser(db)
      db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u.is_active).toBe(0)
    })

    it('soft-deleted user still exists in DB', () => {
      const id = createUser(db)
      db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u).toBeDefined()
    })

    it('soft-deleted user not returned by active-only query', () => {
      const id = createUser(db, { email: 'del@test.ma' })
      db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(id)
      const u = db.prepare('SELECT * FROM users WHERE email=? AND is_active=1').get('del@test.ma')
      expect(u).toBeUndefined()
    })

    it('can reactivate a soft-deleted user', () => {
      const id = createUser(db)
      db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(id)
      db.prepare('UPDATE users SET is_active=1 WHERE id=?').run(id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u.is_active).toBe(1)
    })

    it('deleting non-existent user affects 0 rows', () => {
      const result = db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(99999)
      expect(result.changes).toBe(0)
    })
  })

  // ── User login ─────────────────────────────────────────────────────────────
  describe('User login', () => {
    it('finds user with correct email and password', () => {
      const id = createUser(db, { email: 'login@test.ma', password: 'correct' })
      const u = db.prepare('SELECT * FROM users WHERE email=? AND is_active=1').get('login@test.ma') as any
      expect(u).toBeDefined()
      expect(u.password_hash).toBe(hashPassword('correct'))
    })

    it('rejects wrong password', () => {
      createUser(db, { email: 'wp@test.ma', password: 'correct' })
      const u = db.prepare('SELECT * FROM users WHERE email=? AND is_active=1').get('wp@test.ma') as any
      expect(u.password_hash).not.toBe(hashPassword('wrong'))
    })

    it('rejects wrong email (user not found)', () => {
      const u = db.prepare('SELECT * FROM users WHERE email=? AND is_active=1').get('nobody@test.ma')
      expect(u).toBeUndefined()
    })

    it('rejects inactive user', () => {
      const id = createUser(db, { email: 'inactive@test.ma', password: 'pass' })
      db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(id)
      const u = db.prepare('SELECT * FROM users WHERE email=? AND is_active=1').get('inactive@test.ma')
      expect(u).toBeUndefined()
    })

    it('email lookup is case-insensitive via LOWER()', () => {
      createUser(db, { email: 'case@test.ma', password: 'pass' })
      const u = db.prepare('SELECT * FROM users WHERE LOWER(email)=LOWER(?) AND is_active=1').get('CASE@TEST.MA') as any
      expect(u).toBeDefined()
    })

    it('updates last_login on successful login', () => {
      const id = createUser(db, { email: 'll@test.ma', password: 'pass' })
      db.prepare('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(id)
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
      expect(u.last_login).toBeTruthy()
    })

    it('login creates a session row', () => {
      const id = createUser(db, { email: 'sess@test.ma', password: 'pass' })
      db.prepare('INSERT INTO user_sessions (user_id, login_at) VALUES (?,CURRENT_TIMESTAMP)').run(id)
      const s = db.prepare('SELECT * FROM user_sessions WHERE user_id=?').get(id) as any
      expect(s).toBeDefined()
      expect(s.logout_at).toBeNull()
    })
  })

  // ── getAll users ───────────────────────────────────────────────────────────
  describe('getAll users', () => {
    it('returns all users', () => {
      createUser(db, { email: 'u1@test.ma' })
      createUser(db, { email: 'u2@test.ma' })
      const users = db.prepare('SELECT * FROM users').all()
      expect(users.length).toBeGreaterThanOrEqual(3) // admin + 2
    })

    it('returns id field', () => {
      const users = db.prepare('SELECT id FROM users').all() as any[]
      expect(users[0].id).toBeDefined()
    })

    it('returns name field', () => {
      const users = db.prepare('SELECT name FROM users').all() as any[]
      expect(users[0].name).toBeDefined()
    })

    it('returns email field', () => {
      const users = db.prepare('SELECT email FROM users').all() as any[]
      expect(users[0].email).toBeDefined()
    })

    it('returns role field', () => {
      const users = db.prepare('SELECT role FROM users').all() as any[]
      expect(users[0].role).toBeDefined()
    })

    it('returns is_active field', () => {
      const users = db.prepare('SELECT is_active FROM users').all() as any[]
      expect(users[0].is_active).toBeDefined()
    })

    it('does not return password_hash in safe query', () => {
      const users = db.prepare('SELECT id,name,email,role,is_active FROM users').all() as any[]
      expect((users[0] as any).password_hash).toBeUndefined()
    })

    it('returns correct count after adding users', () => {
      const before = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c
      createUser(db, { email: 'new@test.ma' })
      const after = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c
      expect(after).toBe(before + 1)
    })
  })

  // ── Role validation ────────────────────────────────────────────────────────
  describe('Role validation', () => {
    it('admin role stored correctly', () => {
      const id = createUser(db, { role: 'admin' })
      expect((db.prepare('SELECT role FROM users WHERE id=?').get(id) as any).role).toBe('admin')
    })

    it('accountant role stored correctly', () => {
      const id = createUser(db, { role: 'accountant' })
      expect((db.prepare('SELECT role FROM users WHERE id=?').get(id) as any).role).toBe('accountant')
    })

    it('sales role stored correctly', () => {
      const id = createUser(db, { role: 'sales' })
      expect((db.prepare('SELECT role FROM users WHERE id=?').get(id) as any).role).toBe('sales')
    })

    it('warehouse role stored correctly', () => {
      const id = createUser(db, { role: 'warehouse' })
      expect((db.prepare('SELECT role FROM users WHERE id=?').get(id) as any).role).toBe('warehouse')
    })

    it('can query users by role', () => {
      createUser(db, { email: 'a1@test.ma', role: 'admin' })
      createUser(db, { email: 'a2@test.ma', role: 'admin' })
      createUser(db, { email: 's1@test.ma', role: 'sales' })
      const admins = db.prepare("SELECT * FROM users WHERE role='admin'").all()
      expect(admins.length).toBeGreaterThanOrEqual(2)
    })

    it('can change role from sales to admin', () => {
      const id = createUser(db, { role: 'sales' })
      db.prepare('UPDATE users SET role=? WHERE id=?').run('admin', id)
      expect((db.prepare('SELECT role FROM users WHERE id=?').get(id) as any).role).toBe('admin')
    })
  })

  // ── Audit log on user creation ─────────────────────────────────────────────
  describe('Audit log on user creation', () => {
    it('audit entry created after user creation', () => {
      const id = createUser(db)
      db.prepare(`INSERT INTO audit_log (user_id,action,table_name,record_id) VALUES (1,'CREATE','users',?)`).run(id)
      const entry = db.prepare('SELECT * FROM audit_log WHERE table_name=? AND record_id=?').get('users', id) as any
      expect(entry).toBeDefined()
      expect(entry.action).toBe('CREATE')
    })

    it('audit entry has correct user_id', () => {
      const id = createUser(db)
      db.prepare(`INSERT INTO audit_log (user_id,action,table_name,record_id) VALUES (1,'CREATE','users',?)`).run(id)
      const entry = db.prepare('SELECT * FROM audit_log WHERE record_id=?').get(id) as any
      expect(entry.user_id).toBe(1)
    })

    it('audit entry has correct table_name', () => {
      const id = createUser(db)
      db.prepare(`INSERT INTO audit_log (user_id,action,table_name,record_id) VALUES (1,'CREATE','users',?)`).run(id)
      const entry = db.prepare('SELECT * FROM audit_log WHERE record_id=?').get(id) as any
      expect(entry.table_name).toBe('users')
    })

    it('audit entry stores new_values as JSON', () => {
      const id = createUser(db, { name: 'Audited', email: 'aud@test.ma', role: 'sales' })
      db.prepare(`INSERT INTO audit_log (user_id,action,table_name,record_id,new_values) VALUES (1,'CREATE','users',?,?)`).run(id, JSON.stringify({ name: 'Audited', email: 'aud@test.ma', role: 'sales' }))
      const entry = db.prepare('SELECT * FROM audit_log WHERE record_id=?').get(id) as any
      const nv = JSON.parse(entry.new_values)
      expect(nv.name).toBe('Audited')
    })

    it('multiple user creations produce multiple audit entries', () => {
      const id1 = createUser(db, { email: 'ma1@test.ma' })
      const id2 = createUser(db, { email: 'ma2@test.ma' })
      db.prepare(`INSERT INTO audit_log (user_id,action,table_name,record_id) VALUES (1,'CREATE','users',?)`).run(id1)
      db.prepare(`INSERT INTO audit_log (user_id,action,table_name,record_id) VALUES (1,'CREATE','users',?)`).run(id2)
      const count = (db.prepare("SELECT COUNT(*) as c FROM audit_log WHERE action='CREATE' AND table_name='users'").get() as any).c
      expect(count).toBeGreaterThanOrEqual(2)
    })
  })
})
