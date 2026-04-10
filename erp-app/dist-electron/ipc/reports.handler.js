"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerReportHandlers = registerReportHandlers;
const index_1 = require("./index");
const connection_1 = require("../database/connection");
function registerReportHandlers() {
    (0, index_1.handle)('reports:get', (data) => {
        const db = (0, connection_1.getDb)();
        const { type, filters } = data;
        switch (type) {
            case 'sales':
                return getSalesReport(db, filters);
            case 'purchases':
                return getPurchasesReport(db, filters);
            case 'stock':
                return getStockReport(db, filters);
            case 'receivables':
                return getReceivablesReport(db, filters);
            case 'cheques':
                return getChequesReport(db, filters);
            case 'profit_loss':
                return getProfitLossReport(db, filters);
            case 'tva_detail':
                return getTvaDetailReport(db, filters);
            case 'stock_movements':
                return getStockMovementsReport(db, filters);
            case 'payments':
                return getPaymentsReport(db, filters);
            case 'payables':
                return getPayablesReport(db, filters);
            case 'overdue':
                return getOverdueReport(db, filters);
            case 'production':
                return getProductionReport(db, filters);
            default:
                throw new Error(`Type de rapport inconnu: ${type}`);
        }
    });
}
function getSalesReport(db, filters) {
    const params = [];
    let where = "WHERE d.type = 'invoice' AND d.is_deleted = 0 AND d.status != 'cancelled'";
    if (filters.start_date) {
        where += ' AND d.date >= ?';
        params.push(filters.start_date);
    }
    if (filters.end_date) {
        where += ' AND d.date <= ?';
        params.push(filters.end_date);
    }
    if (filters.client_id) {
        where += ' AND d.party_id = ?';
        params.push(filters.client_id);
    }
    return db.prepare(`
    SELECT d.number, d.date, c.name as client_name,
      d.total_ht, d.total_tva, d.total_ttc, di.payment_status
    FROM documents d
    LEFT JOIN clients c ON c.id = d.party_id
    LEFT JOIN doc_invoices di ON di.document_id = d.id
    ${where}
    ORDER BY d.date DESC
  `).all(...params);
}
function getPurchasesReport(db, filters) {
    const params = [];
    let where = "WHERE d.type IN ('purchase_invoice','import_invoice') AND d.is_deleted = 0";
    if (filters.start_date) {
        where += ' AND d.date >= ?';
        params.push(filters.start_date);
    }
    if (filters.end_date) {
        where += ' AND d.date <= ?';
        params.push(filters.end_date);
    }
    return db.prepare(`
    SELECT d.number, d.date, s.name as supplier_name,
      d.total_ht, d.total_tva, d.total_ttc
    FROM documents d
    LEFT JOIN suppliers s ON s.id = d.party_id
    ${where}
    ORDER BY d.date DESC
  `).all(...params);
}
function getStockReport(db, _filters) {
    return db.prepare(`
    SELECT p.code, p.name, p.unit, p.type,
      p.stock_quantity, p.cmup_price,
      p.stock_quantity * p.cmup_price as stock_value,
      p.min_stock,
      CASE WHEN p.stock_quantity <= p.min_stock THEN 1 ELSE 0 END as is_low
    FROM products p
    WHERE p.is_deleted = 0
    ORDER BY p.name ASC
  `).all();
}
function getReceivablesReport(db, _filters) {
    return db.prepare(`
    SELECT c.name as client_name, c.phone, c.ice,
      COALESCE(SUM(d.total_ttc), 0) as total_invoiced,
      COALESCE(SUM(pa.amount), 0) as total_paid,
      COALESCE(SUM(d.total_ttc), 0) - COALESCE(SUM(pa.amount), 0) as balance
    FROM clients c
    LEFT JOIN documents d ON d.party_id = c.id AND d.party_type = 'client'
      AND d.type = 'invoice' AND d.is_deleted = 0 AND d.status != 'cancelled'
    LEFT JOIN payment_allocations pa ON pa.document_id = d.id
    GROUP BY c.id
    HAVING balance > 0
    ORDER BY balance DESC
  `).all();
}
function getChequesReport(db, _filters) {
    // نُرجع كل الشيكات/LCN المعلقة بدون فلتر تاريخ
    // الفلترة على 7 أيام تتم في الـ frontend
    return db.prepare(`
    SELECT p.id, p.amount, p.method, p.date, p.due_date,
      p.cheque_number, p.bank, p.status, p.party_type,
      CASE p.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name
    FROM payments p
    LEFT JOIN clients   c ON c.id = p.party_id AND p.party_type = 'client'
    LEFT JOIN suppliers s ON s.id = p.party_id AND p.party_type = 'supplier'
    WHERE p.method IN ('cheque', 'lcn') AND p.status = 'pending'
    ORDER BY p.due_date ASC
  `).all();
}
function getProfitLossReport(db, filters) {
    const params = [];
    let dateFilter = '';
    if (filters.start_date) {
        dateFilter += ' AND je.date >= ?';
        params.push(filters.start_date);
    }
    if (filters.end_date) {
        dateFilter += ' AND je.date <= ?';
        params.push(filters.end_date);
    }
    const revenues = db.prepare(`
    SELECT a.code, a.name,
      COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0) as amount
    FROM accounts a
    JOIN journal_lines jl ON jl.account_id = a.id
    JOIN journal_entries je ON je.id = jl.entry_id
    WHERE a.class = 7 ${dateFilter}
    GROUP BY a.id
  `).all(...params);
    const expenses = db.prepare(`
    SELECT a.code, a.name,
      COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as amount
    FROM accounts a
    JOIN journal_lines jl ON jl.account_id = a.id
    JOIN journal_entries je ON je.id = jl.entry_id
    WHERE a.class = 6 ${dateFilter}
    GROUP BY a.id
  `).all(...params);
    const totalRevenue = revenues.reduce((s, r) => s + r.amount, 0);
    const totalExpense = expenses.reduce((s, r) => s + r.amount, 0);
    return { revenues, expenses, totalRevenue, totalExpense, result: totalRevenue - totalExpense };
}
function getTvaDetailReport(db, filters) {
    const params = [];
    let where = "WHERE d.is_deleted = 0 AND d.status != 'cancelled'";
    if (filters.start_date) {
        where += ' AND d.date >= ?';
        params.push(filters.start_date);
    }
    if (filters.end_date) {
        where += ' AND d.date <= ?';
        params.push(filters.end_date);
    }
    // TVA facturée par taux
    return db.prepare(`
    SELECT d.number, d.date, d.type,
      CASE d.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name,
      dl.tva_rate, SUM(dl.total_ht) as base_ht, SUM(dl.total_tva) as tva_amount
    FROM documents d
    JOIN document_lines dl ON dl.document_id = d.id
    LEFT JOIN clients   c ON c.id = d.party_id AND d.party_type = 'client'
    LEFT JOIN suppliers s ON s.id = d.party_id AND d.party_type = 'supplier'
    ${where}
    GROUP BY d.id, dl.tva_rate
    ORDER BY d.date DESC
  `).all(...params);
}
function getStockMovementsReport(db, filters) {
    const params = [];
    let where = 'WHERE sm.applied = 1';
    if (filters.product_id) {
        where += ' AND sm.product_id = ?';
        params.push(filters.product_id);
    }
    if (filters.start_date) {
        where += ' AND sm.date >= ?';
        params.push(filters.start_date);
    }
    if (filters.end_date) {
        where += ' AND sm.date <= ?';
        params.push(filters.end_date);
    }
    return db.prepare(`
    SELECT sm.date, sm.type, sm.quantity, sm.unit_cost,
      sm.cmup_before, sm.cmup_after,
      p.code as product_code, p.name as product_name, p.unit
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    ${where}
    ORDER BY sm.date DESC, sm.id DESC
  `).all(...params);
}
function getPaymentsReport(db, filters) {
    const params = [];
    let where = 'WHERE 1=1';
    if (filters.start_date) {
        where += ' AND p.date >= ?';
        params.push(filters.start_date);
    }
    if (filters.end_date) {
        where += ' AND p.date <= ?';
        params.push(filters.end_date);
    }
    if (filters.party_type) {
        where += ' AND p.party_type = ?';
        params.push(filters.party_type);
    }
    return db.prepare(`
    SELECT p.date, p.method, p.amount, p.status, p.cheque_number, p.bank, p.due_date,
      CASE p.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name,
      p.party_type,
      d.number as document_number
    FROM payments p
    LEFT JOIN clients   c ON c.id = p.party_id AND p.party_type = 'client'
    LEFT JOIN suppliers s ON s.id = p.party_id AND p.party_type = 'supplier'
    LEFT JOIN documents d ON d.id = p.document_id
    ${where}
    ORDER BY p.date DESC
  `).all(...params);
}
function getPayablesReport(db, _filters) {
    // تقرير الذمم الدائنة — ديون الموردين
    return db.prepare(`
    SELECT s.name as supplier_name, s.phone, s.ice,
      COALESCE(SUM(d.total_ttc), 0) as total_invoiced,
      COALESCE(SUM(pa.amount), 0)   as total_paid,
      COALESCE(SUM(d.total_ttc), 0) - COALESCE(SUM(pa.amount), 0) as balance
    FROM suppliers s
    LEFT JOIN documents d ON d.party_id = s.id AND d.party_type = 'supplier'
      AND d.type IN ('purchase_invoice','import_invoice')
      AND d.is_deleted = 0 AND d.status != 'cancelled'
    LEFT JOIN payment_allocations pa ON pa.document_id = d.id
    GROUP BY s.id
    HAVING balance > 0
    ORDER BY balance DESC
  `).all();
}
function getOverdueReport(db, filters) {
    const today = new Date().toISOString().split('T')[0];
    const extraParams = [today, today];
    let extra = '';
    if (filters.client_id) {
        extra += ' AND d.party_id = ?';
        extraParams.push(filters.client_id);
    }
    return db.prepare(`
    SELECT
      d.number,
      d.date,
      di.due_date,
      c.name as client_name,
      c.phone,
      d.total_ttc,
      COALESCE(SUM(pa.amount), 0) as total_paid,
      d.total_ttc - COALESCE(SUM(pa.amount), 0) as remaining,
      CAST(julianday(?) - julianday(di.due_date) AS INTEGER) as days_overdue,
      d.status
    FROM documents d
    JOIN doc_invoices di ON di.document_id = d.id
    LEFT JOIN clients c ON c.id = d.party_id
    LEFT JOIN payment_allocations pa ON pa.document_id = d.id
    WHERE d.type = 'invoice'
      AND d.is_deleted = 0
      AND d.status NOT IN ('paid', 'cancelled', 'draft')
      AND di.due_date IS NOT NULL
      AND di.due_date != ''
      AND di.due_date < ?
      ${extra}
    GROUP BY d.id
    HAVING remaining > 0.01
    ORDER BY days_overdue DESC
  `).all(...extraParams);
}
function getProductionReport(db, filters) {
    const params = [];
    let where = "WHERE po.is_deleted = 0 AND po.status = 'confirmed'";
    if (filters.start_date) {
        where += ' AND po.date >= ?';
        params.push(filters.start_date);
    }
    if (filters.end_date) {
        where += ' AND po.date <= ?';
        params.push(filters.end_date);
    }
    const orders = db.prepare(`
    SELECT po.id, po.date, po.quantity, po.unit_cost, po.total_cost, po.status,
      p.name as product_name, p.code as product_code, p.unit,
      bt.name as bom_name
    FROM production_orders po
    JOIN products p ON p.id = po.product_id
    LEFT JOIN bom_templates bt ON bt.id = po.bom_id
    ${where}
    ORDER BY po.date DESC
  `).all(...params);
    const totalOrders = orders.length;
    const totalQty = orders.reduce((s, o) => s + o.quantity, 0);
    const totalCost = orders.reduce((s, o) => s + o.total_cost, 0);
    const avgUnitCost = totalQty > 0 ? totalCost / totalQty : 0;
    // par produit
    const byProduct = {};
    for (const o of orders) {
        const key = o.product_code;
        if (!byProduct[key]) {
            byProduct[key] = { product_name: o.product_name, product_code: o.product_code, unit: o.unit, qty: 0, cost: 0, orders: 0 };
        }
        byProduct[key].qty += o.quantity;
        byProduct[key].cost += o.total_cost;
        byProduct[key].orders += 1;
    }
    return {
        orders,
        summary: { totalOrders, totalQty, totalCost, avgUnitCost },
        byProduct: Object.values(byProduct).sort((a, b) => b.cost - a.cost),
    };
}
