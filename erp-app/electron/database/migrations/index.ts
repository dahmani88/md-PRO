import Database from 'better-sqlite3'
import { migration_001_initial } from './001_initial'
import { migration_002_accounting } from './002_accounting'
import { migration_003_production } from './003_production'
import { migration_004_settings } from './004_settings'
import { migration_005_fix_document_status } from './005_fix_document_status'
import { migration_006_user_permissions } from './006_user_permissions'
import { migration_007_user_sessions } from './007_user_sessions'
import { migration_007_sessions } from './007_sessions'
import { migration_008_constraints } from './008_constraints'
import { migration_009_network_sync } from './009_network_sync'
import { migration_010_change_tracking } from './010_change_tracking'

const MIGRATIONS = [
  { version: 1,  name: 'initial',             run: migration_001_initial },
  { version: 2,  name: 'accounting',          run: migration_002_accounting },
  { version: 3,  name: 'production',          run: migration_003_production },
  { version: 4,  name: 'settings',            run: migration_004_settings },
  { version: 5,  name: 'fix_document_status', run: migration_005_fix_document_status },
  { version: 6,  name: 'user_permissions',    run: migration_006_user_permissions },
  { version: 7,  name: 'user_sessions',       run: migration_007_user_sessions },
  { version: 71, name: 'sessions',            run: migration_007_sessions },
  { version: 8,  name: 'constraints',         run: migration_008_constraints },
  { version: 9,  name: 'network_sync',        run: migration_009_network_sync },
  { version: 10, name: 'change_tracking',     run: migration_010_change_tracking },
]

export function runMigrations(db: Database.Database): void {
  // جدول تتبع الإصدارات
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version   INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const applied = db
    .prepare('SELECT version FROM _migrations')
    .all()
    .map((r: any) => r.version as number)

  for (const migration of MIGRATIONS) {
    if (!applied.includes(migration.version)) {
      console.log(`[Migration] Applying v${migration.version}: ${migration.name}`)
      const tx = db.transaction(() => {
        migration.run(db)
        db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(
          migration.version,
          migration.name
        )
      })
      tx()
      console.log(`[Migration] v${migration.version} applied ✓`)
    }
  }
}
