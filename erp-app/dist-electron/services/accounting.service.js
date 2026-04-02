"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAccountingEntry = createAccountingEntry;
exports.createPaymentEntry = createPaymentEntry;
function createAccountingEntry(db, doc, lines, userId) {
    const handler = ENTRY_HANDLERS[doc.type];
    if (!handler)
        return null;
    return handler(db, doc, lines, userId);
}
// ==========================================
// ACCOUNT CODES (من CGNC الرسمي)
// ==========================================
const ACC = {
    CLIENTS: '3421',
    FOURNISSEURS: '4411',
    TVA_FACTUREE: '4455',
    TVA_RECUPERABLE: '3455',
    BANQUE: '5141',
    CAISSE: '5161',
    VENTES_MARCH: '7111',
    VENTES_PRODUITS: '7121',
    VARIATION_STOCKS: '7131',
    ACHATS_MARCH: '6111',
    ACHATS_MATIERES: '6121',
    STOCK_MATIERES: '3121',
    STOCK_PRODUITS: '3151',
    DETTES_DIVERS: '4481',
};
function getAccountId(db, code) {
    const row = db.prepare('SELECT id FROM accounts WHERE code = ?').get(code);
    if (!row)
        throw new Error(`Compte ${code} introuvable dans le plan comptable`);
    return row.id;
}
function insertEntry(db, doc, description, lines, userId) {
    const entry = db.prepare(`
    INSERT INTO journal_entries (date, reference, description, is_auto, source_type, source_id, created_by)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `).run(doc.date, doc.number, description, doc.type, doc.id, userId);
    const entryId = entry.lastInsertRowid;
    for (const line of lines) {
        if (line.debit === 0 && line.credit === 0)
            continue;
        db.prepare(`
      INSERT INTO journal_lines (entry_id, account_id, debit, credit, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(entryId, getAccountId(db, line.accountCode), line.debit, line.credit, line.notes ?? null);
    }
    return entryId;
}
// ==========================================
// HANDLERS PAR TYPE DE DOCUMENT
// ==========================================
const ENTRY_HANDLERS = {
    // ① Facture client confirmée
    invoice: (db, doc, lines, userId) => {
        // TVA groupée par taux
        const tvaByRate = groupTvaByRate(lines);
        const entryLines = [
            { accountCode: ACC.CLIENTS, debit: doc.total_ttc, credit: 0 },
            { accountCode: ACC.VENTES_MARCH, debit: 0, credit: doc.total_ht },
            ...tvaByRate.map(t => ({
                accountCode: ACC.TVA_FACTUREE,
                debit: 0,
                credit: t.amount,
                notes: `TVA ${t.rate}%`,
            })),
        ];
        return insertEntry(db, doc, `Facture client ${doc.number}`, entryLines, userId);
    },
    // ③ Facture fournisseur local
    purchase_invoice: (db, doc, lines, userId) => {
        const tvaByRate = groupTvaByRate(lines);
        const entryLines = [
            { accountCode: ACC.ACHATS_MATIERES, debit: doc.total_ht, credit: 0 },
            ...tvaByRate.map(t => ({
                accountCode: ACC.TVA_RECUPERABLE,
                debit: t.amount,
                credit: 0,
                notes: `TVA ${t.rate}%`,
            })),
            { accountCode: ACC.FOURNISSEURS, debit: 0, credit: doc.total_ttc },
        ];
        return insertEntry(db, doc, `Facture fournisseur ${doc.number}`, entryLines, userId);
    },
    // ④ Bon de Réception
    bl_reception: (db, doc, lines, userId) => {
        const tvaByRate = groupTvaByRate(lines);
        const entryLines = [
            { accountCode: ACC.STOCK_MATIERES, debit: doc.total_ht, credit: 0 },
            ...tvaByRate.map(t => ({
                accountCode: ACC.TVA_RECUPERABLE,
                debit: t.amount,
                credit: 0,
                notes: `TVA ${t.rate}%`,
            })),
            { accountCode: ACC.FOURNISSEURS, debit: 0, credit: doc.total_ttc },
        ];
        return insertEntry(db, doc, `Bon de réception ${doc.number}`, entryLines, userId);
    },
    // ⑤ Facture d'importation (Landed Cost)
    import_invoice: (db, doc, _lines, userId) => {
        const imp = db.prepare('SELECT * FROM doc_import_invoices WHERE document_id = ?').get(doc.id);
        if (!imp)
            return insertEntry(db, doc, `Import ${doc.number}`, [], userId);
        const invoiceMAD = (imp.invoice_amount ?? 0) * (imp.exchange_rate ?? 1);
        const totalCost = imp.total_cost ?? doc.total_ttc;
        const entryLines = [
            // Stock (Débit) = coût total sans TVA import
            { accountCode: ACC.STOCK_MATIERES, debit: totalCost - (imp.tva_import ?? 0), credit: 0 },
            // TVA import récupérable (Débit)
            ...(imp.tva_import > 0 ? [{ accountCode: ACC.TVA_RECUPERABLE, debit: imp.tva_import, credit: 0, notes: 'TVA import' }] : []),
            // Fournisseur étranger (Crédit)
            { accountCode: ACC.FOURNISSEURS, debit: 0, credit: invoiceMAD },
            // Douanes (Crédit)
            ...(imp.customs > 0 ? [{ accountCode: ACC.DETTES_DIVERS, debit: 0, credit: imp.customs, notes: 'Douanes' }] : []),
            // Transitaire (Crédit)
            ...(imp.transitaire > 0 ? [{ accountCode: ACC.DETTES_DIVERS, debit: 0, credit: imp.transitaire, notes: 'Transitaire' }] : []),
            // Autres frais (Crédit)
            ...(imp.other_costs > 0 ? [{ accountCode: ACC.DETTES_DIVERS, debit: 0, credit: imp.other_costs, notes: 'Autres frais' }] : []),
        ];
        return insertEntry(db, doc, `Importation ${doc.number}`, entryLines, userId);
    },
    // BL Bon de Livraison
    bl: (db, doc, lines, userId) => {
        const linkedInvoice = db.prepare(`SELECT d.id FROM document_links dl JOIN documents d ON d.id = dl.parent_id WHERE dl.child_id = ? AND d.type = 'invoice'`).get(doc.id);
        let totalCmup = 0;
        for (const line of lines) {
            if (!line.product_id) continue;
            const product = db.prepare('SELECT cmup_price FROM products WHERE id = ?').get(line.product_id);
            totalCmup += (product?.cmup_price ?? 0) * line.quantity;
        }
        if (linkedInvoice) {
            if (totalCmup === 0) return insertEntry(db, doc, `BL ${doc.number}`, [], userId);
            return insertEntry(db, doc, `Livraison ${doc.number}`, [
                { accountCode: ACC.VENTES_MARCH, debit: totalCmup, credit: 0, notes: 'Sortie stock au CMUP' },
                { accountCode: ACC.STOCK_PRODUITS, debit: 0, credit: totalCmup },
            ], userId);
        }
        const tvaByRate = groupTvaByRate(lines);
        const entryLines = [
            { accountCode: ACC.CLIENTS, debit: doc.total_ttc, credit: 0 },
            { accountCode: ACC.VENTES_MARCH, debit: 0, credit: doc.total_ht },
            ...tvaByRate.map(t => ({ accountCode: ACC.TVA_FACTUREE, debit: 0, credit: t.amount, notes: `TVA ${t.rate}%` })),
            ...(totalCmup > 0 ? [
                { accountCode: ACC.VENTES_MARCH, debit: totalCmup, credit: 0, notes: 'Sortie stock au CMUP' },
                { accountCode: ACC.STOCK_PRODUITS, debit: 0, credit: totalCmup },
            ] : []),
        ];
        return insertEntry(db, doc, `Bon de livraison ${doc.number}`, entryLines, userId);
    },
    // ⑧ Avoir retour client
    avoir: (db, doc, lines, userId) => {
        const tvaByRate = groupTvaByRate(lines);
        const entryLines = [
            { accountCode: ACC.VENTES_MARCH, debit: doc.total_ht, credit: 0 },
            ...tvaByRate.map(t => ({
                accountCode: ACC.TVA_FACTUREE,
                debit: t.amount,
                credit: 0,
                notes: `TVA ${t.rate}%`,
            })),
            { accountCode: ACC.CLIENTS, debit: 0, credit: doc.total_ttc },
        ];
        return insertEntry(db, doc, `Avoir ${doc.number}`, entryLines, userId);
    },
};
// ==========================================
// PAYMENT ENTRY (② تسجيل دفعة)
// ==========================================
function createPaymentEntry(db, payment, userId) {
    const bankAccount = payment.method === 'cash' ? ACC.CAISSE : ACC.BANQUE;
    const partyAccount = payment.party_type === 'client' ? ACC.CLIENTS : ACC.FOURNISSEURS;
    const isClientPayment = payment.party_type === 'client';
    const fakeDoc = {
        id: payment.id,
        type: 'payment',
        number: payment.reference ?? `PAY-${payment.id}`,
        date: payment.date,
        party_id: payment.party_id,
        party_type: payment.party_type,
        total_ht: payment.amount,
        total_tva: 0,
        total_ttc: payment.amount,
    };
    const entryLines = isClientPayment
        ? [
            { accountCode: bankAccount, debit: payment.amount, credit: 0 },
            { accountCode: partyAccount, debit: 0, credit: payment.amount },
        ]
        : [
            { accountCode: partyAccount, debit: payment.amount, credit: 0 },
            { accountCode: bankAccount, debit: 0, credit: payment.amount },
        ];
    return insertEntry(db, fakeDoc, `Règlement ${payment.party_type} — ${payment.reference ?? ''}`, entryLines, userId);
}
// ==========================================
// HELPERS
// ==========================================
function groupTvaByRate(lines) {
    const map = new Map();
    for (const line of lines) {
        const current = map.get(line.tva_rate) ?? 0;
        map.set(line.tva_rate, current + line.total_tva);
    }
    return Array.from(map.entries()).map(([rate, amount]) => ({ rate, amount }));
}
