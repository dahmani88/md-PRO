import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { migration_006_user_permissions } from '../../database/migrations/006_user_permissions'
import { migration_007_user_sessions } from '../../database/migrations/007_user_sessions'
import { existsSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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

/** Write an in-memory DB to a temp file and return the path */
async function dbToFile(db: Database.Database, filePath: string): Promise<void> {
  await db.backup(filePath)
}

/** Create a temp directory for backup tests */
function makeTempDir(): string {
  const dir = join(tmpdir(), `erp-backup-test-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Generate a backup filename with timestamp */
function makeBackupName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `erp-backup-${timestamp}.db`
}

describe('Settings – Backup Handler Logic', () => {
  let db: Database.Database
  let tempDir: string
  const createdFiles: string[] = []

  beforeEach(() => {
    db = createTestDb()
    getSetDb()(db)
    tempDir = makeTempDir()
  })

  afterEach(() => {
    // Clean up temp files
    for (const f of createdFiles) {
      try { if (existsSync(f)) unlinkSync(f) } catch { /* ignore */ }
    }
    createdFiles.length = 0
  })

  // ── Backup creates file ────────────────────────────────────────────────────
  describe('Backup creates file', () => {
    it('backup creates a file on disk', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      expect(existsSync(backupPath)).toBe(true)
    })

    it('backup file has non-zero size', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const size = statSync(backupPath).size
      expect(size).toBeGreaterThan(0)
    })

    it('backup filename contains timestamp pattern', () => {
      const name = makeBackupName()
      expect(name).toMatch(/^erp-backup-\d{4}-\d{2}-\d{2}/)
    })

    it('backup filename ends with .db', () => {
      const name = makeBackupName()
      expect(name).toMatch(/\.db$/)
    })

    it('backup filename starts with erp-backup-', () => {
      const name = makeBackupName()
      expect(name.startsWith('erp-backup-')).toBe(true)
    })

    it('two backups at different times have different names', async () => {
      const name1 = makeBackupName()
      await new Promise(r => setTimeout(r, 10))
      const name2 = makeBackupName()
      expect(name1).not.toBe(name2)
    })
  })

  // ── Backup file contains valid SQLite data ─────────────────────────────────
  describe('Backup file contains valid SQLite data', () => {
    it('backup file can be opened as SQLite database', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const restored = new Database(backupPath)
      expect(restored).toBeDefined()
      restored.close()
    })

    it('backup contains users table', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const restored = new Database(backupPath)
      const tbl = restored.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`).get()
      expect(tbl).toBeDefined()
      restored.close()
    })

    it('backup contains app_settings table', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const restored = new Database(backupPath)
      const tbl = restored.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'`).get()
      expect(tbl).toBeDefined()
      restored.close()
    })

    it('backup preserves user data', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const restored = new Database(backupPath)
      const user = restored.prepare('SELECT * FROM users WHERE id=1').get() as any
      expect(user.name).toBe('Admin')
      restored.close()
    })

    it('backup preserves settings data', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const restored = new Database(backupPath)
      const setting = restored.prepare('SELECT value FROM app_settings WHERE key=?').get('currency') as any
      expect(setting.value).toBe('MAD')
      restored.close()
    })

    it('backup preserves data inserted after migration', async () => {
      db.prepare(`INSERT INTO clients (name) VALUES ('Test Client')`).run()
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const restored = new Database(backupPath)
      const client = restored.prepare(`SELECT * FROM clients WHERE name='Test Client'`).get() as any
      expect(client).toBeDefined()
      restored.close()
    })
  })

  // ── List backups ───────────────────────────────────────────────────────────
  describe('List backups returns array', () => {
    it('returns empty array when no backups exist', () => {
      const emptyDir = join(tempDir, 'empty')
      mkdirSync(emptyDir, { recursive: true })
      let files: string[] = []
      try {
        files = readdirSync(emptyDir).filter(f => f.endsWith('.db'))
      } catch { files = [] }
      expect(files).toEqual([])
    })

    it('returns array with one backup after creating one', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const files = readdirSync(tempDir).filter(f => f.endsWith('.db'))
      expect(files).toHaveLength(1)
    })

    it('returns array with multiple backups', async () => {
      for (let i = 0; i < 3; i++) {
        const backupPath = join(tempDir, `erp-backup-2025-01-0${i + 1}.db`)
        createdFiles.push(backupPath)
        await dbToFile(db, backupPath)
      }
      const files = readdirSync(tempDir).filter(f => f.endsWith('.db'))
      expect(files).toHaveLength(3)
    })

    it('backup list includes file size', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const files = readdirSync(tempDir).filter(f => f.endsWith('.db'))
      const size = statSync(join(tempDir, files[0])).size
      expect(size).toBeGreaterThan(0)
    })

    it('backup list includes file date', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const files = readdirSync(tempDir).filter(f => f.endsWith('.db'))
      const mtime = statSync(join(tempDir, files[0])).mtime
      expect(mtime.getTime()).toBeGreaterThan(0)
    })

    it('only .db files are listed', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const txtPath = join(tempDir, 'readme.txt')
      require('fs').writeFileSync(txtPath, 'test')
      createdFiles.push(txtPath)
      const files = readdirSync(tempDir).filter(f => f.endsWith('.db'))
      expect(files.every(f => f.endsWith('.db'))).toBe(true)
    })
  })

  // ── Restore from backup ────────────────────────────────────────────────────
  describe('Restore from backup restores data', () => {
    it('restored DB has same tables as original', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const restored = new Database(backupPath)
      const tables = (restored.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as any[]).map(r => r.name)
      const origTables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as any[]).map(r => r.name)
      expect(tables).toEqual(origTables)
      restored.close()
    })

    it('restored DB has same row count in users', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const restored = new Database(backupPath)
      const origCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c
      const restCount = (restored.prepare('SELECT COUNT(*) as c FROM users').get() as any).c
      expect(restCount).toBe(origCount)
      restored.close()
    })

    it('restored DB has same settings', async () => {
      db.prepare(`INSERT INTO app_settings (key,value) VALUES ('test_key','test_val') ON CONFLICT(key) DO UPDATE SET value='test_val'`).run()
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const restored = new Database(backupPath)
      const row = restored.prepare('SELECT value FROM app_settings WHERE key=?').get('test_key') as any
      expect(row.value).toBe('test_val')
      restored.close()
    })

    it('restore does not affect original DB', async () => {
      const backupPath = join(tempDir, makeBackupName())
      createdFiles.push(backupPath)
      await dbToFile(db, backupPath)
      const restored = new Database(backupPath)
      restored.prepare(`INSERT INTO clients (name) VALUES ('Restored Client')`).run()
      const origCount = (db.prepare('SELECT COUNT(*) as c FROM clients').get() as any).c
      expect(origCount).toBe(0)
      restored.close()
    })
  })

  // ── Backup naming convention ───────────────────────────────────────────────
  describe('Backup naming convention', () => {
    it('name follows erp-backup-{timestamp}.db pattern', () => {
      const name = makeBackupName()
      expect(name).toMatch(/^erp-backup-.+\.db$/)
    })

    it('timestamp in name uses ISO format with dashes', () => {
      const name = makeBackupName()
      // ISO date part: YYYY-MM-DD
      expect(name).toMatch(/erp-backup-\d{4}-\d{2}-\d{2}/)
    })

    it('colons in timestamp are replaced with dashes', () => {
      const name = makeBackupName()
      expect(name).not.toContain(':')
    })

    it('dots in timestamp are replaced with dashes', () => {
      const name = makeBackupName()
      // Only the final .db extension should have a dot
      const withoutExt = name.replace(/\.db$/, '')
      expect(withoutExt).not.toContain('.')
    })
  })
})
