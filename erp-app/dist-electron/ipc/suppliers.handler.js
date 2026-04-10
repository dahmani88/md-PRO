"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSupplierHandlers = registerSupplierHandlers;
const index_1 = require("./index");
const connection_1 = require("../database/connection");
function registerSupplierHandlers() {
    (0, index_1.handle)('suppliers:getAll', (filters) => {
        const db = (0, connection_1.getDb)();
        const page = filters?.page ?? 1;
        const limit = filters?.limit ?? 50;
        const offset = (page - 1) * limit;
        let query = 'SELECT * FROM suppliers WHERE is_deleted = 0';
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
            ? `SELECT COUNT(*) as c FROM suppliers WHERE is_deleted = 0 AND (name LIKE ? OR ice LIKE ? OR phone LIKE ?)`
            : `SELECT COUNT(*) as c FROM suppliers WHERE is_deleted = 0`;
        const countParams = filters?.search ? [`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`] : [];
        const total = db.prepare(countQuery).get(...countParams).c;
        // إضافة balance لكل مورد
        const rowsWithBalance = rows.map(supplier => {
            const invRow = db.prepare(`
        SELECT COALESCE(SUM(total_ttc), 0) as t FROM documents
        WHERE party_id=? AND party_type='supplier'
          AND type IN ('purchase_invoice','import_invoice')
          AND is_deleted=0 AND status IN ('confirmed','partial','paid','delivered')
      `).get(supplier.id);
            const payRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as t FROM payments
        WHERE party_id=? AND party_type='supplier'
          AND NOT (method IN ('cheque','lcn') AND status='pending')
          AND status != 'bounced'
      `).get(supplier.id);
            const balance = (invRow.t ?? 0) - (payRow.t ?? 0);
            return { ...supplier, balance };
        });
        return { rows: rowsWithBalance, total, page, limit };
    });
    (0, index_1.handle)('suppliers:getOne', (id) => {
        const db = (0, connection_1.getDb)();
        const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND is_deleted = 0').get(id);
        if (!supplier)
            throw new Error('Fournisseur introuvable');
        // Solde: somme des TTC non payées (fac confirmées uniquement)
        const invRow2 = db.prepare(`
      SELECT COALESCE(SUM(total_ttc), 0) as t FROM documents
      WHERE party_id=? AND party_type='supplier'
        AND type IN ('purchase_invoice','import_invoice')
        AND is_deleted=0 AND status IN ('confirmed','partial','paid','delivered')
    `).get(id);
        const payRow2 = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as t FROM payments
      WHERE party_id=? AND party_type='supplier'
        AND NOT (method IN ('cheque','lcn') AND status='pending')
        AND status != 'bounced'
    `).get(id);
        const balance = (invRow2.t ?? 0) - (payRow2.t ?? 0);
        return { ...supplier, balance };
    });
    (0, index_1.handle)('suppliers:create', (data) => {
        const db = (0, connection_1.getDb)();
        const result = db.prepare(`
      INSERT INTO suppliers (name, address, email, phone, ice, if_number, rc, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.name, data.address ?? null, data.email ?? null, data.phone ?? null, data.ice ?? null, data.if_number ?? null, data.rc ?? null, data.notes ?? null, data.created_by ?? 1);
        return { id: result.lastInsertRowid };
    });
    (0, index_1.handle)('suppliers:update', (data) => {
        const db = (0, connection_1.getDb)();
        db.prepare(`
      UPDATE suppliers SET name=?, address=?, email=?, phone=?, ice=?, if_number=?, rc=?,
        notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(data.name, data.address, data.email, data.phone, data.ice, data.if_number, data.rc, data.notes, data.id);
        return { success: true };
    });
    (0, index_1.handle)('suppliers:delete', (id) => {
        const db = (0, connection_1.getDb)();
        db.prepare('UPDATE suppliers SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
        return { success: true };
    });
}
