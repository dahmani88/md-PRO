"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerStockHandlers = registerStockHandlers;
const index_1 = require("./index");
const connection_1 = require("../database/connection");
const stock_service_1 = require("../services/stock.service");
function registerStockHandlers() {
    (0, index_1.handle)('stock:getMovements', (filters) => {
        const db = (0, connection_1.getDb)();
        const page = filters?.page ?? 1;
        const limit = filters?.limit ?? 50;
        const offset = (page - 1) * limit;
        const params = [];
        let query = `
      SELECT sm.*, p.name as product_name, p.unit, p.code as product_code
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      WHERE 1=1
    `;
        if (filters?.product_id !== undefined) {
            query += ' AND sm.product_id = ?';
            params.push(filters.product_id);
        }
        if (filters?.applied !== undefined) {
            query += ' AND sm.applied = ?';
            params.push(filters.applied ? 1 : 0);
        }
        query += ' ORDER BY sm.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        return db.prepare(query).all(...params);
    });
    (0, index_1.handle)('stock:applyMovement', (id, userId = 1) => {
        const db = (0, connection_1.getDb)();
        (0, stock_service_1.applyMovement)(db, id, userId);
        return { success: true };
    });
    (0, index_1.handle)('stock:createManual', (data) => {
        const db = (0, connection_1.getDb)();
        const id = (0, stock_service_1.createStockMovement)(db, {
            ...data,
            manual_ref: data.reference ?? `MANUAL-${Date.now()}`,
            applied: true,
        });
        return { id };
    });
    (0, index_1.handle)('stock:getProductStats', (productId) => {
        const db = (0, connection_1.getDb)();
        const sales = db.prepare(`SELECT COALESCE(SUM(dl.quantity),0) as qty, COALESCE(SUM(dl.total_ttc),0) as revenue, COUNT(DISTINCT d.id) as doc_count FROM document_lines dl JOIN documents d ON d.id=dl.document_id WHERE dl.product_id=? AND d.type='invoice' AND d.status IN ('confirmed','partial','paid') AND d.is_deleted=0`).get(productId);
        const purchases = db.prepare(`SELECT COALESCE(SUM(dl.quantity),0) as qty, COALESCE(SUM(dl.total_ttc),0) as cost, COUNT(DISTINCT d.id) as doc_count FROM document_lines dl JOIN documents d ON d.id=dl.document_id WHERE dl.product_id=? AND d.type IN ('purchase_invoice','import_invoice','bl_reception') AND d.status IN ('confirmed','partial','paid') AND d.is_deleted=0`).get(productId);
        const pending = db.prepare(`SELECT COALESCE(SUM(dl.quantity),0) as qty, COUNT(DISTINCT d.id) as doc_count FROM document_lines dl JOIN documents d ON d.id=dl.document_id WHERE dl.product_id=? AND d.type IN ('quote','bl') AND d.status='confirmed' AND d.is_deleted=0`).get(productId);
        const pendingPurchase = db.prepare(`SELECT COALESCE(SUM(dl.quantity),0) as qty, COUNT(DISTINCT d.id) as doc_count FROM document_lines dl JOIN documents d ON d.id=dl.document_id WHERE dl.product_id=? AND d.type='purchase_order' AND d.status='confirmed' AND d.is_deleted=0`).get(productId);
        const recentDocs = db.prepare(`SELECT d.id, d.number, d.type, d.date, d.status, dl.quantity, CASE d.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name FROM document_lines dl JOIN documents d ON d.id=dl.document_id LEFT JOIN clients c ON c.id=d.party_id AND d.party_type='client' LEFT JOIN suppliers s ON s.id=d.party_id AND d.party_type='supplier' WHERE dl.product_id=? AND d.is_deleted=0 ORDER BY d.date DESC LIMIT 8`).all(productId);
        return { sales, purchases, pending, pendingPurchase, recentDocs };
    });
}
