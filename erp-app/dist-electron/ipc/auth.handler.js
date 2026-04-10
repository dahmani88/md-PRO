"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthHandlers = registerAuthHandlers;
const crypto_1 = __importDefault(require("crypto"));
const index_1 = require("./index");
const connection_1 = require("../database/connection");
const audit_service_1 = require("../services/audit.service");
function hashPassword(password) {
    return crypto_1.default.createHash('sha256').update(password).digest('hex');
}
function registerAuthHandlers() {
    (0, index_1.handle)('auth:login', ({ email, password }) => {
        const db = (0, connection_1.getDb)();
        if (!email?.trim() || !password?.trim()) {
            throw new Error('Email et mot de passe requis');
        }
        const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.trim().toLowerCase());
        if (!user)
            throw new Error('Aucun compte trouvé avec cet email');
        if (user.password_hash !== hashPassword(password))
            throw new Error('Mot de passe incorrect');
        db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
        (0, audit_service_1.logAudit)(db, { user_id: user.id, action: 'LOGIN', table_name: 'users', record_id: user.id });
        // جلب الصلاحيات
        const permissions = db.prepare('SELECT page FROM user_permissions WHERE user_id = ?').all(user.id).map(r => r.page);
        const { password_hash, ...safeUser } = user;
        // إنشاء جلسة جديدة
        const sessionResult = db.prepare('INSERT INTO user_sessions (user_id, login_at) VALUES (?, CURRENT_TIMESTAMP)').run(user.id);
        const sessionId = sessionResult.lastInsertRowid;
        return { ...safeUser, permissions, sessionId };
    });
    (0, index_1.handle)('users:getAll', () => {
        const db = (0, connection_1.getDb)();
        const users = db.prepare('SELECT id, name, email, role, is_active, last_login, created_at FROM users').all();
        return users.map(u => {
            const permissions = db.prepare('SELECT page FROM user_permissions WHERE user_id = ?').all(u.id).map(r => r.page);
            return { ...u, permissions };
        });
    });
    (0, index_1.handle)('users:create', ({ name, email, password, role, permissions }) => {
        const db = (0, connection_1.getDb)();
        if (!name?.trim() || !email?.trim() || !password?.trim()) {
            throw new Error('Nom, email et mot de passe sont obligatoires');
        }
        if (password.length < 4) {
            throw new Error('Le mot de passe doit contenir au moins 4 caractères');
        }
        const tx = db.transaction(() => {
            const result = db.prepare(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES (?, ?, ?, ?)
      `).run(name.trim(), email.trim().toLowerCase(), hashPassword(password), role ?? 'sales');
            const userId = result.lastInsertRowid;
            // حفظ الصلاحيات
            if (Array.isArray(permissions)) {
                for (const page of permissions) {
                    db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, page) VALUES (?, ?)').run(userId, page);
                }
            }
            (0, audit_service_1.logAudit)(db, { user_id: 1, action: 'CREATE', table_name: 'users', record_id: userId, new_values: { name, email, role } });
            return { id: userId };
        });
        return tx();
    });
    (0, index_1.handle)('users:update', ({ id, name, email, role, is_active, password, permissions }) => {
        const db = (0, connection_1.getDb)();
        const tx = db.transaction(() => {
            if (password) {
                db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
                    .run(name, email, role, is_active, hashPassword(password), id);
            }
            else {
                db.prepare('UPDATE users SET name=?, email=?, role=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
                    .run(name, email, role, is_active, id);
            }
            // تحديث الصلاحيات
            if (Array.isArray(permissions)) {
                db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id);
                for (const page of permissions) {
                    db.prepare('INSERT INTO user_permissions (user_id, page) VALUES (?, ?)').run(id, page);
                }
            }
        });
        tx();
        return { success: true };
    });
    (0, index_1.handle)('users:delete', (id) => {
        const db = (0, connection_1.getDb)();
        db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id);
        (0, audit_service_1.logAudit)(db, { user_id: 1, action: 'DELETE', table_name: 'users', record_id: id });
        return { success: true };
    });
    (0, index_1.handle)('users:getStats', (userId) => {
        const db = (0, connection_1.getDb)();
        const user = db.prepare('SELECT id, name, email, role, is_active, last_login, created_at FROM users WHERE id = ?').get(userId);
        if (!user)
            throw new Error('Utilisateur introuvable');
        const permissions = db.prepare('SELECT page FROM user_permissions WHERE user_id = ?').all(userId).map(r => r.page);
        // إحصائيات من audit_log
        const totalActions = db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE user_id = ?').get(userId).c;
        const actionsBreakdown = db.prepare(`
      SELECT action, COUNT(*) as count FROM audit_log WHERE user_id = ? GROUP BY action ORDER BY count DESC
    `).all(userId);
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
    `).all(userId);
        // إحصائيات المستندات التي أنشأها
        const docsCreated = db.prepare('SELECT COUNT(*) as c FROM documents WHERE created_by = ? AND is_deleted = 0').get(userId).c;
        const paymentsCreated = db.prepare('SELECT COUNT(*) as c FROM payments WHERE created_by = ?').get(userId).c;
        // عدد تسجيلات الدخول
        const loginCount = db.prepare("SELECT COUNT(*) as c FROM audit_log WHERE user_id = ? AND action = 'LOGIN'").get(userId).c;
        // أيام النشاط في الـ 30 يوم الأخيرة
        const activeDaysLast30 = db.prepare(`
      SELECT COUNT(DISTINCT date(created_at)) as c FROM audit_log
      WHERE user_id = ? AND created_at >= date('now', '-30 days')
    `).get(userId).c;
        // ساعات النشاط هذا الشهر
        const activeHoursThisMonth = db.prepare(`
      SELECT COUNT(DISTINCT strftime('%Y-%m-%d %H', created_at)) as c FROM audit_log
      WHERE user_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
    `).get(userId).c;
        // نشاط آخر 7 أيام
        const last7Days = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count FROM audit_log
      WHERE user_id = ? AND created_at >= date('now', '-6 days')
      GROUP BY day ORDER BY day ASC
    `).all(userId);
        // أكثر يوم نشاطاً
        const busiestDay = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count FROM audit_log
      WHERE user_id = ? GROUP BY day ORDER BY count DESC LIMIT 1
    `).get(userId);
        // إحصائيات الجلسات من user_sessions
        const totalTimeSeconds = db.prepare('SELECT COALESCE(SUM(duration_seconds),0) as t FROM user_sessions WHERE user_id = ? AND duration_seconds IS NOT NULL').get(userId).t;
        const totalHours = Math.round(totalTimeSeconds / 3600 * 10) / 10;
        // جلسات هذا الشهر
        const monthSessions = db.prepare(`
      SELECT COALESCE(SUM(duration_seconds),0) as t FROM user_sessions
      WHERE user_id = ? AND strftime('%Y-%m', login_at) = strftime('%Y-%m', 'now') AND duration_seconds IS NOT NULL
    `).get(userId);
        const monthSeconds = monthSessions.t ?? 0;
        // fallback: si pas de sessions enregistrées, estimer depuis audit_log
        // (nombre d'heures uniques d'activité ce mois)
        const monthActiveHours = monthSeconds > 0
            ? monthSeconds / 3600
            : db.prepare(`
          SELECT COUNT(DISTINCT strftime('%Y-%m-%d %H', created_at)) as c FROM audit_log
          WHERE user_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get(userId).c;
        const monthHours = Math.round(monthActiveHours * 10) / 10;
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
    `).all(userId);
        // إجمالي الوقت الكلي
        const allTimeSessions = db.prepare(`
      SELECT COALESCE(SUM(duration_seconds), 0) as t, COUNT(*) as c
      FROM user_sessions WHERE user_id = ? AND duration_seconds IS NOT NULL
    `).get(userId);
        return {
            user: { ...user, permissions },
            stats: { totalActions, docsCreated, paymentsCreated, loginCount, activeDaysLast30, activeHoursThisMonth, totalHours, monthHours },
            busiestDay,
            last7Days,
            dailySessions,
            allTimeSessions,
            actionsBreakdown,
            recentActivity,
        };
    });
}
(0, index_1.handle)('auth:logout', (data) => {
    if (data?.sessionId && data?.userId) {
        const db = (0, connection_1.getDb)();
        const session = db.prepare('SELECT login_at FROM user_sessions WHERE id = ?').get(data.sessionId);
        if (session) {
            const duration = Math.floor((Date.now() - new Date(session.login_at).getTime()) / 1000);
            db.prepare('UPDATE user_sessions SET logout_at = CURRENT_TIMESTAMP, duration_seconds = ? WHERE id = ?')
                .run(duration, data.sessionId);
            (0, audit_service_1.logAudit)(db, { user_id: data.userId, action: 'LOGOUT', table_name: 'users', record_id: data.userId });
        }
    }
    return { success: true };
});
