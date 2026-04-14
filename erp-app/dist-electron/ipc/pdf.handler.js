"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPdfHandlers = registerPdfHandlers;
const index_1 = require("./index");
const electron_1 = require("electron");
const pdf_service_1 = require("../services/pdf.service");
const fs_1 = require("fs");
const path_1 = require("path");
const electron_2 = require("electron");
function registerPdfHandlers() {
    (0, index_1.handle)('pdf:getHtml', (documentId) => {
        const pdfData = (0, pdf_service_1.getInvoiceDataForPdf)(documentId);
        return { html: (0, pdf_service_1.generateInvoiceHtml)(pdfData), number: pdfData.document?.number ?? 'document' };
    });
    (0, index_1.handle)('pdf:print', async (documentId) => {
        const pdfData = (0, pdf_service_1.getInvoiceDataForPdf)(documentId);
        const html = (0, pdf_service_1.generateInvoiceHtml)(pdfData);
        const printHtml = html
            .replace('</head>', `<style media="print">@page{size:A4;margin:10mm;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style></head>`)
            .replace('</body>', `<script>window.onload=function(){window.print();};</script></body>`);
        const tmpDir = (0, path_1.join)(electron_2.app.getPath('temp'), 'erp-print');
        (0, fs_1.mkdirSync)(tmpDir, { recursive: true });
        const tmpPath = (0, path_1.join)(tmpDir, `print-${pdfData.document?.number ?? 'doc'}.html`);
        (0, fs_1.writeFileSync)(tmpPath, printHtml, 'utf-8');
        await electron_1.shell.openPath(tmpPath);
        return { success: true };
    });
    (0, index_1.handle)('pdf:generate', async (data) => {
        const pdfData = (0, pdf_service_1.getInvoiceDataForPdf)(data.documentId);
        const html = (0, pdf_service_1.generateInvoiceHtml)(pdfData);
        const win = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0];
        const defaultName = `${pdfData.document?.number ?? 'document'}.pdf`;
        const result = await electron_1.dialog.showSaveDialog(win, {
            title: 'Enregistrer le PDF',
            defaultPath: defaultName,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        win?.focus();
        if (result.canceled || !result.filePath)
            return { success: false, canceled: true };
        const pdfWin = new electron_1.BrowserWindow({
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
        });
        const tmpDir = (0, path_1.join)(electron_2.app.getPath('temp'), 'erp-pdf-gen');
        (0, fs_1.mkdirSync)(tmpDir, { recursive: true });
        const tmpPath = (0, path_1.join)(tmpDir, `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}.html`);
        try {
            (0, fs_1.writeFileSync)(tmpPath, html, 'utf-8');
            await pdfWin.loadFile(tmpPath);
            const pdfBuffer = await pdfWin.webContents.printToPDF({
                printBackground: true,
                pageSize: 'A4',
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
            });
            (0, fs_1.writeFileSync)(result.filePath, pdfBuffer);
            return { success: true, path: result.filePath };
        }
        finally {
            if (!pdfWin.isDestroyed())
                pdfWin.close();
        }
    });
    (0, index_1.handle)('pdf:generateFromHtml', async (data) => {
        const win = electron_1.BrowserWindow.getAllWindows()[0];
        // حفظ مباشر في مجلد Downloads بدون dialog
        const downloadsDir = electron_2.app.getPath('downloads');
        const filePath = (0, path_1.join)(downloadsDir, data.filename);
        const pdfWin = new electron_1.BrowserWindow({
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
        });
        const tmpDir = (0, path_1.join)(electron_2.app.getPath('temp'), 'erp-pdf-gen');
        (0, fs_1.mkdirSync)(tmpDir, { recursive: true });
        const tmpPath = (0, path_1.join)(tmpDir, `temp-${Date.now()}.html`);
        try {
            (0, fs_1.writeFileSync)(tmpPath, data.html, 'utf-8');
            await pdfWin.loadFile(tmpPath);
            const pdfBuffer = await pdfWin.webContents.printToPDF({
                printBackground: true,
                pageSize: 'A4',
                margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
            });
            (0, fs_1.writeFileSync)(filePath, pdfBuffer);
            // فتح مجلد Downloads مع تحديد الملف
            const { shell } = require('electron');
            shell.showItemInFolder(filePath);
            win?.focus();
            return { success: true, path: filePath };
        }
        finally {
            if (!pdfWin.isDestroyed())
                pdfWin.close();
        }
    });
}
