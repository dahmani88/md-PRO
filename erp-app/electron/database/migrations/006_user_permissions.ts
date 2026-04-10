import Database from 'better-sqlite3'

const ALL_PAGES = ['rapports', 'documents', 'paiements', 'parties', 'stock', 'achats', 'production', 'comptabilite', 'parametres']

export function migration_006_user_permissions(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_permissions (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      page     TEXT NOT NULL,
      UNIQUE(user_id, page)
    );
  `)

  // نضيف صلاحيات للمستخدمين الموجودين بناءً على دورهم
  const users = db.prepare('SELECT id, role FROM users').all() as any[]
  const rolePages: Record<string, string[]> = {
    admin:      ALL_PAGES,
    accountant: ['rapports', 'documents', 'paiements', 'parties', 'comptabilite'],
    sales:      ['rapports', 'documents', 'paiements', 'parties', 'stock'],
    warehouse:  ['stock', 'achats', 'production'],
  }

  const insert = db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, page) VALUES (?, ?)')
  const tx = db.transaction(() => {
    for (const user of users) {
      const pages = rolePages[user.role] ?? rolePages.sales
      for (const page of pages) {
        insert.run(user.id, page)
      }
    }
  })
  tx()
}
