import Database from 'better-sqlite3'

export function migration_007_user_sessions(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      login_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      logout_at  DATETIME,
      duration_seconds INTEGER -- محسوب عند الخروج
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_login ON user_sessions(login_at);
  `)
}
