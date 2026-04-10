import crypto from 'crypto'
import { handle } from './index'
import { getDb } from '../database/connection'
import { logAudit } from '../services/audit.service'

// SHA256 + salt per-user (salt مخزون مع الـ hash بصيغة salt:hash)
function hashPassword(password: string, salt?: string): string {
  const s = salt ?? crypto.randomBytes(16).toString('hex')
  const hash = crypto.createHash('sha256').update(s + password).digest('hex')
  return `${s}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  // دعم الصيغة القديمة (hash فقط بدون salt) للتوافق مع البيانات الموجودة
  if (!stored.includes(':')) {
    const legacyHash = crypto.createHash('sha256').update(password).digest('hex')
    return legacyHash === stored
  }
  const [salt, hash] = stored.split(':')
  const computed = crypto.createHash('sha256').update(salt + password).digest('hex')
  return computed === hash
}

export function registerAuthHandlers(): void {
  handle('auth:login', ({ email, password }) => {
    const db = getDb()
    if (!email?.trim() || !password?.trim()) {
      throw new Error('Email et mot de passe requis')
    }
    const user = db.prepare(
      'SELECT * FROM users WHERE email = ? AND is_active = 1'
    ).get(email.trim().toLowerCase()) as any

    if (!user) throw new Error('Aucun compte trouvé avec cet email')
    if (!verifyPassword(password, user.password_hash)) throw new Error('Mot de passe incorrect')

    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id)
    logAudit(db, { user_id: user.id, action: 'LOGIN', table_name: 'users', record_id: user.id })

    // جلب الصلاحيات
    const permissions = (db.prepare('SELECT page FROM user_permissions WHERE user_id = ?').all(user.id) as any[]).map(r => r.page)

    const { password_hash, ...safeUser } = user

    // إنشاء جلسة جديدة
    const sessionResult = db.prepare(
      'INSERT INTO user_sessions (user_id, login_at) VALUES (?, CURRENT_TIMESTAMP)'
    ).run(user.id)
    const sessionId = sessionResult.lastInsertRowid

    return { ...safeUser, permissions, sessionId }
  })

  handle('users:getAll', () => {
    const db = getDb()
    const users = db.prepare('SELECT id, name, email, role, is_active, last_login, created_at FROM users').all() as any[]
    return users.map(u => {
      const permissions = (db.prepare('SELECT page FROM user_permissions WHERE user_id = ?').all(u.id) as any[]).map(r => r.page)
      return { ...u, permissions }
    })
  })

  handle('users:create', ({ name, email, password, role, permissions }) => {
    const db = getDb()
    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      throw new Error('Nom, email et mot de passe sont obligatoires')
    }
    if (password.length < 6) {
      throw new Error('Le mot de passe doit contenir au moins 6 caractères')
    }
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES (?, ?, ?, ?)
      `).run(name.trim(), email.trim().toLowerCase(), hashPassword(password), role ?? 'sales')
      const userId = result.lastInsertRowid as number

      // حفظ الصلاحيات
      if (Array.isArray(permissions)) {
        for (const page of permissions) {
          db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, page) VALUES (?, ?)').run(userId, page)
        }
      }

      logAudit(db, { user_id: 1, action: 'CREATE', table_name: 'users', record_id: userId, new_values: { name, email, role } })
      return { id: userId }
    })
    return tx()
  })

  handle('users:update', ({ id, name, email, role, is_active, password, permissions }) => {
    const db = getDb()
    const tx = db.transaction(() => {
      if (password) {
        db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(name, email, role, is_active, hashPassword(password), id)
      } else {
        db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(name, email, role, is_active, id)
      }

      // تحديث الصلاحيات
      if (Array.isArray(permissions)) {
        db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id)
        for (const page of permissions) {
          db.prepare('INSERT INTO user_permissions (user_id, page) VALUES (?, ?)').run(id, page)
        }
      }
    })
    tx()
    return { success: true }
  })

  handle('users:delete', (id) => {
    const db = getDb()
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id)
    logAudit(db, { user_id: 1, action: 'DELETE', table_name: 'users', record_id: id })
    return { success: true }
  })

  handle('users:getStats', (userId: number) => {
    const db = getDb()
    const user = db.prepare('SELECT id, name, email, role, is_active, last_login, created_at FROM users WHERE id = ?').get(userId) as any
    if (!user) throw new Error('Utilisateur introuvable')

    const permissions = (db.prepare('SELECT page FROM user_permissions WHERE user_id = ?').all(userId) as any[]).map(r => r.page)

    // إحصائيات من audit_log
    const totalActions = (db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE user_id = ?').get(userId) as any).c
    const actionsBreakdown = db.prepare(`
      SELECT action, COUNT(*) as count FROM audit_log WHERE user_id = ? GROUP BY action ORDER BY count DESC
    `).all(userId) as any[]

    // آخر 10 أنشطة مع تفاصيل مفهومة
    const recentActivity = db.prepare(`
      SELECT al.action, al.table_name, al.record_id, al.created_at, al.new_values,
        CASE al.table_name
          WHEN 'documents' THEN (SELECT number FROM documents WHERE id = al.record_id)
          WHEN 'payments'  THEN (SELECT amount || ' MAD' FROM payments WHERE id = al.record_id)
          WHEN 'clients'   THEN (SELECT name FROM clients WHERE id = al.record_id)
          WHEN 'suppliers' THEN (SELECT name FROM suppliers WHERE id = al.record_id)
          WHEN 'products'  THEN (SELECT name FROM products WHERE id = al.record_id)
          ELSE NULL
        END as ref_label
      FROM audit_log al WHERE al.user_id = ? ORDER BY al.created_at DESC LIMIT 10
    `).all(userId) as any[]

    // إحصائيات المستندات التي أنشأها
    const docsCreated = (db.prepare('SELECT COUNT(*) as c FROM documents WHERE created_by = ? AND is_deleted = 0').get(userId) as any).c
    const paymentsCreated = (db.prepare('SELECT COUNT(*) as c FROM payments WHERE created_by = ?').get(userId) as any).c

    // عدد تسجيلات الدخول
    const loginCount = (db.prepare("SELECT COUNT(*) as c FROM audit_log WHERE user_id = ? AND action = 'LOGIN'").get(userId) as any).c

    // أيام النشاط في الـ 30 يوم الأخيرة
    const activeDaysLast30 = (db.prepare(`
      SELECT COUNT(DISTINCT date(created_at)) as c FROM audit_log
      WHERE user_id = ? AND created_at >= date('now', '-30 days')
    `).get(userId) as any).c

    // ساعات النشاط هذا الشهر
    const activeHoursThisMonth = (db.prepare(`
      SELECT COUNT(DISTINCT strftime('%Y-%m-%d %H', created_at)) as c FROM audit_log
      WHERE user_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
    `).get(userId) as any).c

    // نشاط آخر 7 أيام
    const last7Days = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count FROM audit_log
      WHERE user_id = ? AND created_at >= date('now', '-6 days')
      GROUP BY day ORDER BY day ASC
    `).all(userId) as any[]

    // أكثر يوم نشاطاً
    const busiestDay = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count FROM audit_log
      WHERE user_id = ? GROUP BY day ORDER BY count DESC LIMIT 1
    `).get(userId) as any

    // إحصائيات الجلسات من user_sessions
    const totalTimeSeconds = (db.prepare('SELECT COALESCE(SUM(duration_seconds),0) as t FROM user_sessions WHERE user_id = ? AND duration_seconds IS NOT NULL').get(userId) as any).t
    const totalHours = Math.round(totalTimeSeconds / 3600 * 10) / 10

    // جلسات هذا الشهر
    const monthSessions = db.prepare(`
      SELECT COALESCE(SUM(duration_seconds),0) as t FROM user_sessions
      WHERE user_id = ? AND strftime('%Y-%m', login_at) = strftime('%Y-%m', 'now') AND duration_seconds IS NOT NULL
    `).get(userId) as any
    const monthSeconds = monthSessions.t ?? 0

    // fallback: si pas de sessions enregistrées, estimer depuis audit_log
    // (nombre d'heures uniques d'activité ce mois)
    const monthActiveHours = monthSeconds > 0
      ? monthSeconds / 3600
      : (db.prepare(`
          SELECT COUNT(DISTINCT strftime('%Y-%m-%d %H', created_at)) as c FROM audit_log
          WHERE user_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get(userId) as any).c
    const monthHours = Math.round(monthActiveHours * 10) / 10

    // جلسات يومية — آخر 30 يوم
    const dailySessions = db.prepare(`
      SELECT
        date(login_at) as day,
        COUNT(*) as sessions,
        COALESCE(SUM(duration_seconds), 0) as total_seconds
      FROM user_sessions
      WHERE user_id = ?
        AND login_at >= date('now', '-29 days')
        AND duration_seconds IS NOT NULL
      GROUP BY date(login_at)
      ORDER BY day DESC
    `).all(userId) as any[]

    // إجمالي الوقت الكلي
    const allTimeSessions = db.prepare(`
      SELECT COALESCE(SUM(duration_seconds), 0) as t, COUNT(*) as c
      FROM user_sessions WHERE user_id = ? AND duration_seconds IS NOT NULL
    `).get(userId) as any

    return {
      user: { ...user, permissions },
      stats: { totalActions, docsCreated, paymentsCreated, loginCount, activeDaysLast30, activeHoursThisMonth, totalHours, monthHours },
      busiestDay,
      last7Days,
      dailySessions,
      allTimeSessions,
      actionsBreakdown,
      recentActivity,
    }
  })
}

  handle('auth:logout', (data?: { sessionId?: number; userId?: number }) => {
    if (data?.sessionId && data?.userId) {
      const db = getDb()
      const session = db.prepare('SELECT login_at FROM user_sessions WHERE id = ?').get(data.sessionId) as any
      if (session) {
        const duration = Math.floor((Date.now() - new Date(session.login_at).getTime()) / 1000)
        db.prepare('UPDATE user_sessions SET logout_at = CURRENT_TIMESTAMP, duration_seconds = ? WHERE id = ?')
          .run(duration, data.sessionId)
        logAudit(db, { user_id: data.userId, action: 'LOGOUT', table_name: 'users', record_id: data.userId })
      }
    }
    return { success: true }
  })
