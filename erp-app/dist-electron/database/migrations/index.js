"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const _001_initial_1 = require("./001_initial");
const _002_accounting_1 = require("./002_accounting");
const _003_production_1 = require("./003_production");
const _004_settings_1 = require("./004_settings");
const _005_fix_document_status_1 = require("./005_fix_document_status");
const _006_user_permissions_1 = require("./006_user_permissions");
const _007_user_sessions_1 = require("./007_user_sessions");
const _007_sessions_1 = require("./007_sessions");
const MIGRATIONS = [
    { version: 1, name: 'initial', run: _001_initial_1.migration_001_initial },
    { version: 2, name: 'accounting', run: _002_accounting_1.migration_002_accounting },
    { version: 3, name: 'production', run: _003_production_1.migration_003_production },
    { version: 4, name: 'settings', run: _004_settings_1.migration_004_settings },
    { version: 5, name: 'fix_document_status', run: _005_fix_document_status_1.migration_005_fix_document_status },
    { version: 6, name: 'user_permissions', run: _006_user_permissions_1.migration_006_user_permissions },
    { version: 7, name: 'user_sessions', run: _007_user_sessions_1.migration_007_user_sessions },
    { version: 7, name: 'sessions', run: _007_sessions_1.migration_007_sessions },
];
function runMigrations(db) {
    // جدول تتبع الإصدارات
    db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version   INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
    const applied = db
        .prepare('SELECT version FROM _migrations')
        .all()
        .map((r) => r.version);
    for (const migration of MIGRATIONS) {
        if (!applied.includes(migration.version)) {
            console.log(`[Migration] Applying v${migration.version}: ${migration.name}`);
            const tx = db.transaction(() => {
                migration.run(db);
                db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
            });
            tx();
            console.log(`[Migration] v${migration.version} applied ✓`);
        }
    }
}
