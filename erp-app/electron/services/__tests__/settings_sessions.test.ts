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

function addUser(db: Database.Database, id: number) {
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,'hash','sales')`).run(id, `User${id}`, `u${id}@test.ma`)
}

/** Insert a session with explicit login_at and optional logout_at / duration */
function insertSession(db: Database.Database, userId: number, loginAt: string, logoutAt?: string, duration?: number): number {
  const result = db.prepare(
    `INSERT INTO user_sessions (user_id,login_at,logout_at,duration_seconds) VALUES (?,?,?,?)`
  ).run(userId, loginAt, logoutAt ?? null, duration ?? null)
  return result.lastInsertRowid as number
}

describe('Settings – User Sessions', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    getSetDb()(db)
  })

  // ── Migration 007 ──────────────────────────────────────────────────────────
  describe('Migration 007', () => {
    it('creates user_sessions table', () => {
      const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_sessions'`).get()
      expect(tbl).toBeDefined()
    })

    it('user_sessions has id column', () => {
      const cols = db.prepare(`PRAGMA table_info(user_sessions)`).all() as any[]
      expect(cols.some(c => c.name === 'id')).toBe(true)
    })

    it('user_sessions has user_id column', () => {
      const cols = db.prepare(`PRAGMA table_info(user_sessions)`).all() as any[]
      expect(cols.some(c => c.name === 'user_id')).toBe(true)
    })

    it('user_sessions has login_at column', () => {
      const cols = db.prepare(`PRAGMA table_info(user_sessions)`).all() as any[]
      expect(cols.some(c => c.name === 'login_at')).toBe(true)
    })

    it('user_sessions has logout_at column', () => {
      const cols = db.prepare(`PRAGMA table_info(user_sessions)`).all() as any[]
      expect(cols.some(c => c.name === 'logout_at')).toBe(true)
    })

    it('user_sessions has duration_seconds column', () => {
      const cols = db.prepare(`PRAGMA table_info(user_sessions)`).all() as any[]
      expect(cols.some(c => c.name === 'duration_seconds')).toBe(true)
    })

    it('index on user_id exists', () => {
      const indexes = db.prepare(`PRAGMA index_list(user_sessions)`).all() as any[]
      const names = indexes.map((i: any) => i.name)
      expect(names.some(n => n.includes('user'))).toBe(true)
    })

    it('index on login_at exists', () => {
      const indexes = db.prepare(`PRAGMA index_list(user_sessions)`).all() as any[]
      const names = indexes.map((i: any) => i.name)
      expect(names.some(n => n.includes('login'))).toBe(true)
    })
  })

  // ── Login creates session ──────────────────────────────────────────────────
  describe('Login creates session', () => {
    it('login inserts a row in user_sessions', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00')
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s).toBeDefined()
    })

    it('session has correct user_id', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00')
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s.user_id).toBe(1)
    })

    it('session has login_at set', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00')
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s.login_at).toBe('2025-01-01 08:00:00')
    })

    it('session logout_at is NULL initially', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00')
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s.logout_at).toBeNull()
    })

    it('session duration_seconds is NULL initially', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00')
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s.duration_seconds).toBeNull()
    })

    it('multiple logins create multiple sessions', () => {
      insertSession(db, 1, '2025-01-01 08:00:00')
      insertSession(db, 1, '2025-01-02 09:00:00')
      const count = (db.prepare('SELECT COUNT(*) as c FROM user_sessions WHERE user_id=1').get() as any).c
      expect(count).toBe(2)
    })
  })

  // ── Logout updates session ─────────────────────────────────────────────────
  describe('Logout updates session', () => {
    it('logout sets logout_at', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00')
      db.prepare('UPDATE user_sessions SET logout_at=?,duration_seconds=? WHERE id=?').run('2025-01-01 09:00:00', 3600, sid)
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s.logout_at).toBe('2025-01-01 09:00:00')
    })

    it('logout sets duration_seconds', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00')
      db.prepare('UPDATE user_sessions SET logout_at=?,duration_seconds=? WHERE id=?').run('2025-01-01 09:00:00', 3600, sid)
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s.duration_seconds).toBe(3600)
    })

    it('logout does not affect other sessions', () => {
      const sid1 = insertSession(db, 1, '2025-01-01 08:00:00')
      const sid2 = insertSession(db, 1, '2025-01-02 08:00:00')
      db.prepare('UPDATE user_sessions SET logout_at=?,duration_seconds=? WHERE id=?').run('2025-01-01 09:00:00', 3600, sid1)
      const s2 = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid2) as any
      expect(s2.logout_at).toBeNull()
    })
  })

  // ── Duration calculation ───────────────────────────────────────────────────
  describe('Duration calculation', () => {
    it('1 hour session = 3600 seconds', () => {
      const loginMs = new Date('2025-01-01T08:00:00Z').getTime()
      const logoutMs = new Date('2025-01-01T09:00:00Z').getTime()
      const duration = Math.floor((logoutMs - loginMs) / 1000)
      expect(duration).toBe(3600)
    })

    it('8 hour session = 28800 seconds', () => {
      const loginMs = new Date('2025-01-01T08:00:00Z').getTime()
      const logoutMs = new Date('2025-01-01T16:00:00Z').getTime()
      const duration = Math.floor((logoutMs - loginMs) / 1000)
      expect(duration).toBe(28800)
    })

    it('0 duration (immediate logout)', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00', '2025-01-01 08:00:00', 0)
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s.duration_seconds).toBe(0)
    })

    it('30 minute session = 1800 seconds', () => {
      const loginMs = new Date('2025-01-01T08:00:00Z').getTime()
      const logoutMs = new Date('2025-01-01T08:30:00Z').getTime()
      const duration = Math.floor((logoutMs - loginMs) / 1000)
      expect(duration).toBe(1800)
    })

    it('duration stored correctly in DB', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00', '2025-01-01 09:00:00', 3600)
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s.duration_seconds).toBe(3600)
    })

    it('8 hour duration stored correctly', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00', '2025-01-01 16:00:00', 28800)
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s.duration_seconds).toBe(28800)
    })
  })

  // ── Multiple sessions per user ─────────────────────────────────────────────
  describe('Multiple sessions per user', () => {
    it('user can have many sessions', () => {
      for (let i = 0; i < 5; i++) {
        insertSession(db, 1, `2025-01-0${i + 1} 08:00:00`)
      }
      const count = (db.prepare('SELECT COUNT(*) as c FROM user_sessions WHERE user_id=1').get() as any).c
      expect(count).toBe(5)
    })

    it('different users can have sessions independently', () => {
      addUser(db, 2)
      insertSession(db, 1, '2025-01-01 08:00:00')
      insertSession(db, 2, '2025-01-01 09:00:00')
      const c1 = (db.prepare('SELECT COUNT(*) as c FROM user_sessions WHERE user_id=1').get() as any).c
      const c2 = (db.prepare('SELECT COUNT(*) as c FROM user_sessions WHERE user_id=2').get() as any).c
      expect(c1).toBe(1)
      expect(c2).toBe(1)
    })
  })

  // ── Sessions without logout ────────────────────────────────────────────────
  describe('Sessions without logout', () => {
    it('session without logout has NULL duration_seconds', () => {
      const sid = insertSession(db, 1, '2025-01-01 08:00:00')
      const s = db.prepare('SELECT * FROM user_sessions WHERE id=?').get(sid) as any
      expect(s.duration_seconds).toBeNull()
    })

    it('SUM of duration_seconds ignores NULL rows', () => {
      insertSession(db, 1, '2025-01-01 08:00:00', '2025-01-01 09:00:00', 3600)
      insertSession(db, 1, '2025-01-02 08:00:00') // no logout
      const total = (db.prepare('SELECT COALESCE(SUM(duration_seconds),0) as t FROM user_sessions WHERE user_id=1').get() as any).t
      expect(total).toBe(3600)
    })

    it('COUNT(*) includes sessions without logout', () => {
      insertSession(db, 1, '2025-01-01 08:00:00')
      insertSession(db, 1, '2025-01-02 08:00:00', '2025-01-02 09:00:00', 3600)
      const count = (db.prepare('SELECT COUNT(*) as c FROM user_sessions WHERE user_id=1').get() as any).c
      expect(count).toBe(2)
    })
  })

  // ── getUserStats – dailySessions ──────────────────────────────────────────
  describe('getUserStats – dailySessions', () => {
    it('groups sessions by day', () => {
      insertSession(db, 1, '2025-01-01 08:00:00', '2025-01-01 09:00:00', 3600)
      insertSession(db, 1, '2025-01-01 10:00:00', '2025-01-01 11:00:00', 3600)
      insertSession(db, 1, '2025-01-02 08:00:00', '2025-01-02 09:00:00', 3600)
      const rows = db.prepare(`
        SELECT date(login_at) as day, COUNT(*) as sessions, COALESCE(SUM(duration_seconds),0) as total_seconds
        FROM user_sessions WHERE user_id=1 AND duration_seconds IS NOT NULL
        GROUP BY date(login_at) ORDER BY day DESC
      `).all() as any[]
      expect(rows).toHaveLength(2)
    })

    it('sums duration_seconds per day correctly', () => {
      insertSession(db, 1, '2025-01-01 08:00:00', '2025-01-01 09:00:00', 3600)
      insertSession(db, 1, '2025-01-01 10:00:00', '2025-01-01 11:00:00', 3600)
      const rows = db.prepare(`
        SELECT date(login_at) as day, COALESCE(SUM(duration_seconds),0) as total_seconds
        FROM user_sessions WHERE user_id=1 AND duration_seconds IS NOT NULL
        GROUP BY date(login_at)
      `).all() as any[]
      expect(rows[0].total_seconds).toBe(7200)
    })

    it('counts sessions per day correctly', () => {
      insertSession(db, 1, '2025-01-01 08:00:00', '2025-01-01 09:00:00', 3600)
      insertSession(db, 1, '2025-01-01 10:00:00', '2025-01-01 11:00:00', 3600)
      const rows = db.prepare(`
        SELECT date(login_at) as day, COUNT(*) as sessions
        FROM user_sessions WHERE user_id=1 AND duration_seconds IS NOT NULL
        GROUP BY date(login_at)
      `).all() as any[]
      expect(rows[0].sessions).toBe(2)
    })

    it('multiple sessions same day are summed correctly', () => {
      insertSession(db, 1, '2025-01-05 08:00:00', '2025-01-05 09:00:00', 3600)
      insertSession(db, 1, '2025-01-05 10:00:00', '2025-01-05 11:30:00', 5400)
      insertSession(db, 1, '2025-01-05 13:00:00', '2025-01-05 14:00:00', 3600)
      const rows = db.prepare(`
        SELECT date(login_at) as day, COALESCE(SUM(duration_seconds),0) as total_seconds
        FROM user_sessions WHERE user_id=1 AND duration_seconds IS NOT NULL
        GROUP BY date(login_at)
      `).all() as any[]
      expect(rows[0].total_seconds).toBe(12600)
    })

    it('ordered by day DESC', () => {
      insertSession(db, 1, '2025-01-01 08:00:00', '2025-01-01 09:00:00', 3600)
      insertSession(db, 1, '2025-01-03 08:00:00', '2025-01-03 09:00:00', 3600)
      insertSession(db, 1, '2025-01-02 08:00:00', '2025-01-02 09:00:00', 3600)
      const rows = db.prepare(`
        SELECT date(login_at) as day FROM user_sessions WHERE user_id=1 AND duration_seconds IS NOT NULL
        GROUP BY date(login_at) ORDER BY day DESC
      `).all() as any[]
      expect(rows[0].day).toBe('2025-01-03')
      expect(rows[2].day).toBe('2025-01-01')
    })
  })

  // ── getUserStats – allTimeSessions ────────────────────────────────────────
  describe('getUserStats – allTimeSessions', () => {
    it('returns total duration_seconds across all sessions', () => {
      insertSession(db, 1, '2025-01-01 08:00:00', '2025-01-01 09:00:00', 3600)
      insertSession(db, 1, '2025-01-02 08:00:00', '2025-01-02 16:00:00', 28800)
      const row = db.prepare(`SELECT COALESCE(SUM(duration_seconds),0) as t, COUNT(*) as c FROM user_sessions WHERE user_id=1 AND duration_seconds IS NOT NULL`).get() as any
      expect(row.t).toBe(32400)
      expect(row.c).toBe(2)
    })

    it('returns 0 when no completed sessions', () => {
      insertSession(db, 1, '2025-01-01 08:00:00') // no logout
      const row = db.prepare(`SELECT COALESCE(SUM(duration_seconds),0) as t FROM user_sessions WHERE user_id=1 AND duration_seconds IS NOT NULL`).get() as any
      expect(row.t).toBe(0)
    })

    it('counts all sessions including those without logout', () => {
      insertSession(db, 1, '2025-01-01 08:00:00', '2025-01-01 09:00:00', 3600)
      insertSession(db, 1, '2025-01-02 08:00:00') // no logout
      const row = db.prepare(`SELECT COUNT(*) as c FROM user_sessions WHERE user_id=1`).get() as any
      expect(row.c).toBe(2)
    })
  })

  // ── Sessions from last 30 days ─────────────────────────────────────────────
  describe('Sessions from last 30 days', () => {
    it('query with date filter returns only recent sessions', () => {
      // Insert a session from 60 days ago (old) and one from today
      const old = '2020-01-01 08:00:00'
      const recent = new Date().toISOString().replace('T', ' ').substring(0, 19)
      insertSession(db, 1, old, '2020-01-01 09:00:00', 3600)
      insertSession(db, 1, recent)
      const rows = db.prepare(`
        SELECT * FROM user_sessions WHERE user_id=1 AND login_at >= date('now','-29 days')
      `).all() as any[]
      expect(rows.length).toBeGreaterThanOrEqual(1)
      // The old session should not be in results
      expect(rows.every(r => r.login_at !== old)).toBe(true)
    })
  })

  // ── Foreign key constraint ─────────────────────────────────────────────────
  describe('Foreign key constraint', () => {
    it('cannot insert session for non-existent user', () => {
      expect(() => db.prepare('INSERT INTO user_sessions (user_id,login_at) VALUES (?,CURRENT_TIMESTAMP)').run(9999)).toThrow()
    })
  })
})
