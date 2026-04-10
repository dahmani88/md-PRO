"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAllHandlers = registerAllHandlers;
exports.handle = handle;
const electron_1 = require("electron");
const config_handler_1 = require("./config.handler");
const auth_handler_1 = require("./auth.handler");
const clients_handler_1 = require("./clients.handler");
const suppliers_handler_1 = require("./suppliers.handler");
const products_handler_1 = require("./products.handler");
const stock_handler_1 = require("./stock.handler");
const documents_handler_1 = require("./documents.handler");
const payments_handler_1 = require("./payments.handler");
const accounting_handler_1 = require("./accounting.handler");
const reports_handler_1 = require("./reports.handler");
const backup_handler_1 = require("./backup.handler");
const production_handler_1 = require("./production.handler");
const notifications_handler_1 = require("./notifications.handler");
const pdf_handler_1 = require("./pdf.handler");
const excel_handler_1 = require("./excel.handler");
const settings_handler_1 = require("./settings.handler");
const import_handler_1 = require("./import.handler");
const attachments_handler_1 = require("./attachments.handler");
const audit_handler_1 = require("./audit.handler");
function registerAllHandlers() {
    (0, config_handler_1.registerConfigHandlers)();
    (0, auth_handler_1.registerAuthHandlers)();
    (0, clients_handler_1.registerClientHandlers)();
    (0, suppliers_handler_1.registerSupplierHandlers)();
    (0, products_handler_1.registerProductHandlers)();
    (0, stock_handler_1.registerStockHandlers)();
    (0, documents_handler_1.registerDocumentHandlers)();
    (0, payments_handler_1.registerPaymentHandlers)();
    (0, accounting_handler_1.registerAccountingHandlers)();
    (0, reports_handler_1.registerReportHandlers)();
    (0, backup_handler_1.registerBackupHandlers)();
    (0, production_handler_1.registerProductionHandlers)();
    (0, notifications_handler_1.registerNotificationsHandlers)();
    (0, pdf_handler_1.registerPdfHandlers)();
    (0, excel_handler_1.registerExcelHandlers)();
    (0, settings_handler_1.registerSettingsHandlers)();
    (0, import_handler_1.registerImportHandlers)();
    (0, attachments_handler_1.registerAttachmentsHandlers)();
    (0, audit_handler_1.registerAuditHandlers)();
}
// Helper: wrapper موحد لكل handler
function handle(channel, fn) {
    electron_1.ipcMain.handle(channel, async (_event, ...args) => {
        try {
            const result = await fn(...args);
            return { success: true, data: result };
        }
        catch (err) {
            console.error(`[IPC Error] ${channel}:`, err.message);
            return { success: false, error: cleanError(err.message) };
        }
    });
}
function cleanError(msg) {
    if (!msg)
        return 'Une erreur est survenue';
    // رسائل SQLite التقنية
    if (msg.includes('UNIQUE constraint failed'))
        return 'Cette valeur existe déjà (doublon)';
    if (msg.includes('FOREIGN KEY constraint failed'))
        return 'Référence invalide — vérifiez les données liées';
    if (msg.includes('NOT NULL constraint failed'))
        return 'Un champ obligatoire est manquant';
    if (msg.includes('no such table'))
        return 'Erreur de base de données — contactez le support';
    if (msg.includes('database is locked'))
        return 'Base de données occupée — réessayez dans un instant';
    if (msg.includes('SQLITE_'))
        return 'Erreur de base de données';
    return msg;
}
