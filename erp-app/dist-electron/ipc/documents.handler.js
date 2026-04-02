"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDocumentHandlers = registerDocumentHandlers;
const index_1 = require("./index");
const connection_1 = require("../database/connection");
const document_service_1 = require("../services/document.service");
function registerDocumentHandlers() {
    (0, index_1.handle)('documents:getAll', (filters) => {
        const db = (0, connection_1.getDb)();
        const page = filters?.page ?? 1;
        const limit = filters?.limit ?? 50;
        const offset = (page - 1) * limit;
        const params = [];
        let query = `
      SELECT d.*,
        CASE d.party_type
          WHEN 'client'   THEN c.name
          WHEN 'supplier' THEN s.name
        END as party_name,
        (SELECT COUNT(*) FROM stock_movements sm WHERE sm.document_id = d.id AND sm.applied = 0) as pending_stock_count
      FROM documents d
      LEFT JOIN clients   c ON c.id = d.party_id AND d.party_type = 'client'
      LEFT JOIN suppliers s ON s.id = d.party_id AND d.party_type = 'supplier'
      WHERE d.is_deleted = 0
    `;
        if (filters?.type) {
            query += ' AND d.type = ?';
            params.push(filters.type);
        }
        if (filters?.status) {
            query += ' AND d.status = ?';
            params.push(filters.status);
        }
        if (filters?.party_id) {
            query += ' AND d.party_id = ?';
            params.push(filters.party_id);
        }
        if (filters?.search) {
            query += ' AND (d.number LIKE ? OR c.name LIKE ? OR s.name LIKE ?)';
            const s = `%${filters.search}%`;
            params.push(s, s, s);
        }
        query += ' ORDER BY d.date DESC, d.id DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const rows = db.prepare(query).all(...params);
        // COUNT مع نفس الفلاتر
        let countQuery = `SELECT COUNT(*) as c FROM documents d WHERE d.is_deleted = 0`;
        const countParams = [];
        if (filters?.type) {
            countQuery += ' AND d.type = ?';
            countParams.push(filters.type);
        }
        if (filters?.status) {
            countQuery += ' AND d.status = ?';
            countParams.push(filters.status);
        }
        if (filters?.party_id) {
            countQuery += ' AND d.party_id = ?';
            countParams.push(filters.party_id);
        }
        const total = db.prepare(countQuery).get(...countParams).c;
        return { rows, total, page, limit };
    });
    (0, index_1.handle)('documents:getOne', (id) => {
        const db = (0, connection_1.getDb)();
        const doc = db.prepare(`
      SELECT d.*,
        CASE d.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name
      FROM documents d
      LEFT JOIN clients   c ON c.id = d.party_id AND d.party_type = 'client'
      LEFT JOIN suppliers s ON s.id = d.party_id AND d.party_type = 'supplier'
      WHERE d.id = ? AND d.is_deleted = 0
    `).get(id);
        if (!doc)
            throw new Error('Document introuvable');
        const lines = db.prepare(`
      SELECT dl.*, p.name as product_name, p.code as product_code, p.unit
      FROM document_lines dl
      LEFT JOIN products p ON p.id = dl.product_id
      WHERE dl.document_id = ?
    `).all(id);
        const links = db.prepare(`
      SELECT dl.*, d.number as related_number, d.type as related_type, d.status as related_status
      FROM document_links dl
      JOIN documents d ON d.id = CASE WHEN dl.parent_id = ? THEN dl.child_id ELSE dl.parent_id END
      WHERE dl.parent_id = ? OR dl.child_id = ?
    `).all(id, id, id);
        const pendingMovements = db.prepare(`
      SELECT sm.*, p.name as product_name, p.unit, p.stock_quantity
      FROM stock_movements sm JOIN products p ON p.id = sm.product_id
      WHERE sm.document_id = ? AND sm.applied = 0
    `).all(id);
        return { ...doc, lines, links, pendingMovements };
    });
    (0, index_1.handle)('documents:create', (data) => (0, document_service_1.createDocument)(data));
    (0, index_1.handle)('documents:confirm', (data) => {
        const id = typeof data === 'number' ? data : data.id;
        const userId = typeof data === 'number' ? 1 : (data.userId ?? 1);
        (0, document_service_1.confirmDocument)(id, userId);
        return { success: true };
    });
    (0, index_1.handle)('documents:cancel', (id) => {
        const db = (0, connection_1.getDb)();
        db.prepare(`UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
        return { success: true };
    });
    (0, index_1.handle)('documents:convert', ({ sourceId, targetType, extra }) => {
        const db = (0, connection_1.getDb)();
        const source = db.prepare('SELECT * FROM documents WHERE id = ?').get(sourceId);
        if (!source)
            throw new Error('Document source introuvable');
        if (source.type === 'quote' && targetType === 'invoice') {
            const existing = db.prepare(`
                SELECT d.id FROM document_links dl
                JOIN documents d ON d.id = dl.child_id
                WHERE dl.parent_id = ? AND d.type = 'invoice' AND d.status != 'cancelled'
            `).get(sourceId);
            if (existing) throw new Error('Ce devis a déjà été converti en facture');
        }
        const sourceLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(sourceId);
        const newDoc = (0, document_service_1.createDocument)({
            type: targetType,
            date: new Date().toISOString().split('T')[0],
            party_id: source.party_id,
            party_type: source.party_type,
            lines: sourceLines.map(l => ({
                product_id: l.product_id,
                description: l.description,
                quantity: l.quantity,
                unit_price: l.unit_price,
                discount: l.discount,
                tva_rate: l.tva_rate,
            })),
            notes: source.notes,
            extra: extra ?? {},
            created_by: 1,
        });
        // ربط المستندين
        db.prepare('INSERT INTO document_links (parent_id, child_id, link_type) VALUES (?, ?, ?)').run(sourceId, newDoc.id, `${source.type}_to_${targetType}`);
        return newDoc;
    });
    (0, index_1.handle)('documents:update', (data) => {
        const db = (0, connection_1.getDb)();
        db.prepare(`UPDATE documents SET notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'`).run(data.notes, data.id);
        return { success: true };
    });
    (0, index_1.handle)('documents:link', ({ parentId, childId, linkType }) => {
        const db = (0, connection_1.getDb)();
        db.prepare('INSERT OR IGNORE INTO document_links (parent_id, child_id, link_type) VALUES (?, ?, ?)').run(parentId, childId, linkType);
        return { success: true };
    });
}
