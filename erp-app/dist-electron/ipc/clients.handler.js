"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClientHandlers = registerClientHandlers;
const index_1 = require("./index");
const connection_1 = require("../database/connection");
function registerClientHandlers() {
    (0, index_1.handle)('clients:getAll', (filters) => {
        const db = (0, connection_1.getDb)();
        const page = filters?.page ?? 1;
        const limit = filters?.limit ?? 50;
        const offset = (page - 1) * limit;
        let query = 'SELECT * FROM clients WHERE is_deleted = 0';
        const params = [];
        if (filters?.search) {
            query += ' AND (name LIKE ? OR ice LIKE ? OR phone LIKE ?)';
            const s = `%${filters.search}%`;
            params.push(s, s, s);
        }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const rows = db.prepare(query).all(...params);
        const countQuery = filters?.search
            ? `SELECT COUNT(*) as c FROM clients WHERE is_deleted = 0 AND (name LIKE ? OR ice LIKE ? OR phone LIKE ?)`
            : `SELECT COUNT(*) as c FROM clients WHERE is_deleted = 0`;
        const countParams = filters?.search ? [`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`] : [];
        const total = db.prepare(countQuery).get(...countParams).c;
        // إضافة balance لكل عميل
        const rowsWithBalance = rows.map(client => {
            const invRow = db.prepare(`
        SELECT COALESCE(SUM(total_ttc), 0) as t FROM documents
        WHERE party_id=? AND party_type='client' AND type='invoice'
          AND is_deleted=0 AND status IN ('confirmed','partial','paid','delivered')
      `).get(client.id);
            const payRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as t FROM payments
        WHERE party_id=? AND party_type='client'
          AND NOT (method IN ('cheque','lcn') AND status='pending')
          AND status != 'bounced'
      `).get(client.id);
            const balance = (invRow.t ?? 0) - (payRow.t ?? 0);
            return { ...client, balance };
        });
        return { rows: rowsWithBalance, total, page, limit };
    });
    (0, index_1.handle)('clients:getOne', (id) => {
        const db = (0, connection_1.getDb)();
        const client = db.prepare('SELECT * FROM clients WHERE id = ? AND is_deleted = 0').get(id);
        if (!client)
            throw new Error('Client introuvable');
        // Solde: somme des TTC non payées (fac confirmées uniquement)
        const invRow2 = db.prepare(`
      SELECT COALESCE(SUM(total_ttc), 0) as t FROM documents
      WHERE party_id=? AND party_type='client' AND type='invoice'
        AND is_deleted=0 AND status IN ('confirmed','partial','paid','delivered')
    `).get(id);
        const payRow2 = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as t FROM payments
      WHERE party_id=? AND party_type='client'
        AND NOT (method IN ('cheque','lcn') AND status='pending')
        AND status != 'bounced'
    `).get(id);
        const balance = (invRow2.t ?? 0) - (payRow2.t ?? 0);
        return { ...client, balance };
    });
    (0, index_1.handle)('clients:create', (data) => {
        const db = (0, connection_1.getDb)();
        const result = db.prepare(`
      INSERT INTO clients (name, address, email, phone, ice, if_number, rc, credit_limit, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.name, data.address ?? null, data.email ?? null, data.phone ?? null, data.ice ?? null, data.if_number ?? null, data.rc ?? null, data.credit_limit ?? 0, data.notes ?? null, data.created_by ?? 1);
        return { id: result.lastInsertRowid };
    });
    (0, index_1.handle)('clients:update', (data) => {
        const db = (0, connection_1.getDb)();
        db.prepare(`
      UPDATE clients SET name=?, address=?, email=?, phone=?, ice=?, if_number=?, rc=?,
        credit_limit=?, notes=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(data.name, data.address, data.email, data.phone, data.ice, data.if_number, data.rc, data.credit_limit, data.notes, data.id);
        return { success: true };
    });
    (0, index_1.handle)('clients:delete', (id) => {
        const db = (0, connection_1.getDb)();
        db.prepare('UPDATE clients SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
        return { success: true };
    });
}
