"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDocumentNumber = generateDocumentNumber;
exports.createDocument = createDocument;
exports.confirmDocument = confirmDocument;
const connection_1 = require("../database/connection");
const accounting_service_1 = require("./accounting.service");
const stock_service_1 = require("./stock.service");
// ==========================================
// DOCUMENT NUMBERING
// ==========================================
const DOC_PREFIXES = {
    invoice: 'F',
    quote: 'D',
    bl: 'BL',
    proforma: 'PRO',
    avoir: 'AV',
    purchase_order: 'BC',
    bl_reception: 'BR',
    purchase_invoice: 'FF',
    import_invoice: 'IMP',
};
function generateDocumentNumber(docType) {
    const db = (0, connection_1.getDb)();
    const year = new Date().getFullYear() % 100; // 2026 → 26
    const prefix = DOC_PREFIXES[docType] ?? 'DOC';
    const tx = db.transaction(() => {
        db.prepare(`
      INSERT INTO document_sequences (doc_type, year, last_seq)
      VALUES (?, ?, 1)
      ON CONFLICT(doc_type, year) DO UPDATE SET last_seq = last_seq + 1
    `).run(docType, year);
        const row = db.prepare('SELECT last_seq FROM document_sequences WHERE doc_type = ? AND year = ?').get(docType, year);
        return `${prefix}-${year}-${row.last_seq}`;
    });
    return tx();
}
// ==========================================
// CREATE DOCUMENT
// ==========================================
function createDocument(data) {
    const db = (0, connection_1.getDb)();
    const number = generateDocumentNumber(data.type);
    // حساب الإجماليات
    let total_ht = 0;
    let total_tva = 0;
    const computedLines = data.lines.map(line => {
        if (line.quantity <= 0)
            throw new Error(`La quantité doit être supérieure à 0`);
        if (line.unit_price < 0)
            throw new Error(`Le prix unitaire ne peut pas être négatif`);
        if ((line.discount ?? 0) < 0 || (line.discount ?? 0) > 100)
            throw new Error(`La remise doit être entre 0 et 100%`);
        const ht = line.quantity * line.unit_price * (1 - (line.discount ?? 0) / 100);
        const tva = ht * ((line.tva_rate ?? 20) / 100);
        total_ht += ht;
        total_tva += tva;
        return { ...line, total_ht: ht, total_tva: tva, total_ttc: ht + tva };
    });
    const total_ttc = total_ht + total_tva;
    const tx = db.transaction(() => {
        // إدراج المستند الرئيسي
        const docResult = db.prepare(`
      INSERT INTO documents (type, number, date, party_id, party_type, status,
        total_ht, total_tva, total_ttc, notes, created_by)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
    `).run(data.type, number, data.date, data.party_id ?? null, data.party_type ?? null, total_ht, total_tva, total_ttc, data.notes ?? null, data.created_by);
        const docId = docResult.lastInsertRowid;
        // إدراج السطور
        for (const line of computedLines) {
            db.prepare(`
        INSERT INTO document_lines
          (document_id, product_id, description, quantity, unit_price, discount,
           tva_rate, total_ht, total_tva, total_ttc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(docId, line.product_id ?? null, line.description ?? null, line.quantity, line.unit_price, line.discount ?? 0, line.tva_rate ?? 20, line.total_ht, line.total_tva, line.total_ttc);
        }
        // إدراج الجدول الفرعي حسب النوع
        insertSubTable(db, data.type, docId, data.extra ?? {});
        return { id: docId, number };
    });
    return tx();
}
// ==========================================
// CONFIRM DOCUMENT — القلب المحاسبي
// ==========================================
function confirmDocument(id, userId) {
    const db = (0, connection_1.getDb)();
    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND is_deleted = 0').get(id);
    if (!doc)
        throw new Error('Document introuvable');
    if (doc.status !== 'draft')
        throw new Error('Document déjà confirmé');
    const lines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(id);
    const tx = db.transaction(() => {
        // تحديث الحالة
        db.prepare(`UPDATE documents SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
        // إنشاء القيد المحاسبي التلقائي
        (0, accounting_service_1.createAccountingEntry)(db, doc, lines, userId);
        // إنشاء حركات المخزون المعلقة
        if (doc.type === 'bl') {
            // التحقق من المخزون الكافي قبل التأكيد
            for (const line of lines) {
                if (!line.product_id)
                    continue;
                const product = db.prepare('SELECT name, stock_quantity, unit FROM products WHERE id = ?').get(line.product_id);
                if (product && product.stock_quantity < line.quantity) {
                    throw new Error(`Stock insuffisant pour "${product.name}": disponible ${product.stock_quantity} ${product.unit}, demandé ${line.quantity} ${product.unit}`);
                }
            }
            // BL بيع → خروج مخزون
            for (const line of lines) {
                if (!line.product_id)
                    continue;
                (0, stock_service_1.createStockMovement)(db, {
                    product_id: line.product_id,
                    type: 'out',
                    quantity: line.quantity,
                    unit_cost: line.unit_price,
                    document_id: id,
                    date: doc.date,
                    applied: false,
                    created_by: userId,
                });
            }
            // تحديث حالة الفاتورة المرتبطة إذا وجدت
            const linkedInvoice = db.prepare(`
        SELECT d.id, d.total_ttc FROM document_links dl
        JOIN documents d ON d.id = dl.parent_id
        WHERE dl.child_id = ? AND d.type = 'invoice' AND d.status IN ('confirmed','partial')
      `).get(id);
            if (linkedInvoice) {
                // حساب الكميات المُسلَّمة مقابل المطلوبة
                const invLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(linkedInvoice.id);
                const blIds = db.prepare(`
          SELECT dl.child_id as id FROM document_links dl
          JOIN documents d ON d.id = dl.child_id
          WHERE dl.parent_id = ? AND d.type = 'bl' AND d.status != 'cancelled'
        `).all(linkedInvoice.id).map((r) => r.id);
                const delivered = {};
                for (const blId of blIds) {
                    for (const l of db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(blId)) {
                        const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`;
                        delivered[key] = (delivered[key] ?? 0) + Number(l.quantity);
                    }
                }
                const fullyDelivered = invLines.every((l) => {
                    const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`;
                    return (delivered[key] ?? 0) >= Number(l.quantity);
                });
                // نحافظ على حالة الدفع — إذا كانت paid تبقى paid
                const currentStatus = db.prepare('SELECT status FROM documents WHERE id = ?').get(linkedInvoice.id);
                if (currentStatus?.status === 'paid') {
                    // مدفوعة بالكامل — لا نغير الحالة
                }
                else if (!['cancelled'].includes(currentStatus?.status)) {
                    db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(fullyDelivered ? 'delivered' : 'partial', linkedInvoice.id);
                }
            }
        }
        else if (doc.type === 'bl_reception') {
            // Bon de réception → دخول مخزون
            for (const line of lines) {
                if (!line.product_id)
                    continue;
                (0, stock_service_1.createStockMovement)(db, {
                    product_id: line.product_id,
                    type: 'in',
                    quantity: line.quantity,
                    unit_cost: line.unit_price,
                    document_id: id,
                    date: doc.date,
                    applied: false,
                    created_by: userId,
                });
            }
            // Recalculer statut BC parent (partiel ou reçu)
            const linkedBC = db.prepare(`
        SELECT d.id FROM document_links dl
        JOIN documents d ON d.id = dl.parent_id
        WHERE dl.child_id = ? AND d.type = 'purchase_order' AND d.status IN ('confirmed','partial')
      `).get(id);
            if (linkedBC) {
                const poId = linkedBC.id;
                const poLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(poId);
                const brIds = db.prepare(`
          SELECT dl2.child_id as id FROM document_links dl2
          JOIN documents d2 ON d2.id = dl2.child_id
          WHERE dl2.parent_id = ? AND d2.type = 'bl_reception' AND d2.status != 'cancelled'
        `).all(poId).map((r) => r.id);
                const received = {};
                for (const brId of brIds) {
                    const brLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(brId);
                    for (const l of brLines) {
                        const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`;
                        received[key] = (received[key] ?? 0) + Number(l.quantity);
                    }
                }
                const fullyReceived = poLines.every((l) => {
                    const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`;
                    return (received[key] ?? 0) >= Number(l.quantity);
                });
                db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(fullyReceived ? 'received' : 'partial', poId);
            }
        }
        else if (doc.type === 'avoir') {
            // Avoir: فقط retour يؤثر على المخزون
            const avoir = db.prepare('SELECT * FROM doc_avoirs WHERE document_id = ?').get(id);
            if (avoir?.affects_stock || avoir?.avoir_type === 'retour') {
                for (const line of lines) {
                    if (!line.product_id)
                        continue;
                    (0, stock_service_1.createStockMovement)(db, {
                        product_id: line.product_id,
                        type: 'in', // إرجاع = دخول مخزون
                        quantity: line.quantity,
                        unit_cost: line.unit_price,
                        document_id: id,
                        date: doc.date,
                        applied: false,
                        created_by: userId,
                    });
                }
            }
            // ① Annulation → marquer la facture source comme annulée
            if (avoir?.avoir_type === 'annulation') {
                const link = db.prepare(`
          SELECT dl.parent_id FROM document_links dl
          JOIN documents d ON d.id = dl.parent_id
          WHERE dl.child_id = ? AND d.type = 'invoice'
        `).get(id);
                if (link?.parent_id) {
                    db.prepare(`UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(link.parent_id);
                }
            }
            // ② Commercial / Retour → imputer l'avoir sur la facture source
            if (avoir?.avoir_type === 'commercial' || avoir?.avoir_type === 'retour') {
                const link = db.prepare(`
          SELECT dl.parent_id FROM document_links dl
          JOIN documents d ON d.id = dl.parent_id
          WHERE dl.child_id = ? AND d.type = 'invoice'
        `).get(id);
                if (link?.parent_id) {
                    // نُنشئ payment record من نوع 'avoir' لتمثيل التخفيض
                    const payResult = db.prepare(`
            INSERT INTO payments (party_id, party_type, amount, method, date, status, document_id, notes, created_by)
            VALUES (?, ?, ?, 'avoir', ?, 'cleared', ?, ?, 1)
          `).run(doc.party_id, doc.party_type, doc.total_ttc, doc.date, link.parent_id, `Avoir ${doc.number}`);
                    const payId = payResult.lastInsertRowid;
                    db.prepare('INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (?, ?, ?)').run(payId, link.parent_id, doc.total_ttc);
                    const invDoc = db.prepare('SELECT total_ttc, type FROM documents WHERE id = ?').get(link.parent_id);
                    const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = ?').get(link.parent_id).total;
                    if (paid >= invDoc.total_ttc - 0.01) {
                        db.prepare(`UPDATE documents SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(link.parent_id);
                        db.prepare('UPDATE doc_invoices SET payment_status = ? WHERE document_id = ?').run('paid', link.parent_id);
                    }
                    else if (paid > 0) {
                        db.prepare(`UPDATE documents SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(link.parent_id);
                        db.prepare('UPDATE doc_invoices SET payment_status = ? WHERE document_id = ?').run('partial', link.parent_id);
                    }
                }
            }
        }
    });
    tx();
}
// ==========================================
// HELPERS
// ==========================================
function insertSubTable(db, type, docId, extra) {
    switch (type) {
        case 'invoice':
            db.prepare(`INSERT INTO doc_invoices (document_id, currency, exchange_rate, payment_method, due_date)
        VALUES (?, ?, ?, ?, ?)`).run(docId, extra.currency ?? 'MAD', extra.exchange_rate ?? 1, extra.payment_method ?? null, extra.due_date ?? null);
            break;
        case 'quote':
            db.prepare(`INSERT INTO doc_quotes (document_id, validity_date, probability) VALUES (?, ?, ?)`).run(docId, extra.validity_date ?? null, extra.probability ?? 50);
            break;
        case 'bl':
            db.prepare(`INSERT INTO doc_bons_livraison (document_id, delivery_address, delivery_date) VALUES (?, ?, ?)`).run(docId, extra.delivery_address ?? null, extra.delivery_date ?? null);
            break;
        case 'proforma':
            db.prepare(`INSERT INTO doc_proformas (document_id, validity_date, currency, exchange_rate) VALUES (?, ?, ?, ?)`).run(docId, extra.validity_date ?? null, extra.currency ?? 'MAD', extra.exchange_rate ?? 1);
            break;
        case 'avoir':
            db.prepare(`INSERT INTO doc_avoirs (document_id, avoir_type, affects_stock, reason) VALUES (?, ?, ?, ?)`).run(docId, extra.avoir_type ?? 'commercial', extra.affects_stock ? 1 : 0, extra.reason ?? null);
            break;
        case 'purchase_invoice':
            db.prepare(`INSERT INTO doc_purchase_invoices (document_id, payment_method, due_date) VALUES (?, ?, ?)`).run(docId, extra.payment_method ?? null, extra.due_date ?? null);
            break;
        case 'import_invoice':
            db.prepare(`
        INSERT INTO doc_import_invoices
          (document_id, currency, exchange_rate, invoice_amount, customs, transitaire, tva_import, other_costs, total_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(docId, extra.currency ?? 'EUR', extra.exchange_rate ?? 1, extra.invoice_amount ?? 0, extra.customs ?? 0, extra.transitaire ?? 0, extra.tva_import ?? 0, extra.other_costs ?? 0, extra.total_cost ?? 0);
            break;
    }
}
