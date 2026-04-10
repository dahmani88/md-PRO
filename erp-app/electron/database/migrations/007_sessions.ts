import Database from 'better-sqlite3'

export function migration_007_sessions(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      login_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      logout_at  DATETIME,
      duration_seconds INTEGER,
      date       TEXT NOT NULL DEFAULT (date('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_date ON user_sessions(date);
  `)
}
