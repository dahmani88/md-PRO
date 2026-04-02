"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerNotificationsHandlers = registerNotificationsHandlers;
const index_1 = require("./index");
const connection_1 = require("../database/connection");
function registerNotificationsHandlers() {
    (0, index_1.handle)('notifications:getAll', () => {
        const db = (0, connection_1.getDb)();
        const today = new Date().toISOString().split('T')[0];
        const in7days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const notifications = [];
        // 1. Chèques/LCN en retard OU qui arrivent à échéance dans 7 jours
        const cheques = db.prepare(`
      SELECT p.id, p.amount, p.due_date, p.method, p.cheque_number, p.bank,
        CASE p.party_type
          WHEN 'client'   THEN c.name
          WHEN 'supplier' THEN s.name
        END as party_name,
        p.party_type
      FROM payments p
      LEFT JOIN clients   c ON c.id = p.party_id AND p.party_type = 'client'
      LEFT JOIN suppliers s ON s.id = p.party_id AND p.party_type = 'supplier'
      WHERE p.method IN ('cheque', 'lcn')
        AND p.status = 'pending'
        AND p.due_date IS NOT NULL
        AND p.due_date <= ?
      ORDER BY p.due_date ASC
    `).all(in7days);
        for (const ch of cheques) {
            const daysLeft = Math.ceil((new Date(ch.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            notifications.push({
                id: `cheque-${ch.id}`,
                type: 'cheque',
                severity: daysLeft <= 2 ? 'error' : 'warning',
                title: `${ch.method === 'lcn' ? 'LCN' : 'Chèque'} à encaisser`,
                message: `${ch.party_name} — ${new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(ch.amount)} MAD — Échéance: ${new Date(ch.due_date).toLocaleDateString('fr-FR')} (${daysLeft}j)`,
                date: ch.due_date,
                ref_id: ch.id,
            });
        }
        // 2. Produits sous le stock minimum
        const lowStock = db.prepare(`
      SELECT id, code, name, unit, stock_quantity, min_stock
      FROM products
      WHERE is_deleted = 0 AND min_stock > 0 AND stock_quantity <= min_stock
      ORDER BY (stock_quantity / min_stock) ASC
    `).all();
        for (const p of lowStock) {
            notifications.push({
                id: `stock-${p.id}`,
                type: 'stock',
                severity: p.stock_quantity <= 0 ? 'error' : 'warning',
                title: 'Stock insuffisant',
                message: `${p.name} (${p.code}) — Stock: ${p.stock_quantity} ${p.unit} / Min: ${p.min_stock} ${p.unit}`,
                date: today,
                ref_id: p.id,
            });
        }
        // 3. Factures clients impayées depuis plus de 30 jours
        const overdueDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const overdue = db.prepare(`
      SELECT d.id, d.number, d.date, d.total_ttc, c.name as client_name
      FROM documents d
      JOIN clients c ON c.id = d.party_id
      LEFT JOIN doc_invoices di ON di.document_id = d.id
      WHERE d.type = 'invoice'
        AND d.is_deleted = 0
        AND d.status IN ('confirmed', 'partial')
        AND d.date <= ?
      ORDER BY d.date ASC
      LIMIT 10
    `).all(overdueDate);
        for (const inv of overdue) {
            const days = Math.ceil((Date.now() - new Date(inv.date).getTime()) / (1000 * 60 * 60 * 24));
            notifications.push({
                id: `overdue-${inv.id}`,
                type: 'invoice',
                severity: days > 60 ? 'error' : 'warning',
                title: 'Facture en retard',
                message: `${inv.client_name} — ${inv.number} — ${new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(inv.total_ttc)} MAD — ${days} jours`,
                date: inv.date,
                ref_id: inv.id,
            });
        }
        // Trier par sévérité puis date
        return notifications.sort((a, b) => {
            const sev = { error: 0, warning: 1, info: 2 };
            return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2);
        });
    });
    (0, index_1.handle)('notifications:markRead', (_id) => ({ success: true }));
}
