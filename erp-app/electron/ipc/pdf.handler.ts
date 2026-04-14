import { handle } from './index'
import { BrowserWindow, dialog, shell } from 'electron'
import { getInvoiceDataForPdf, generateInvoiceHtml } from '../services/pdf.service'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export function registerPdfHandlers(): void {

  handle('pdf:getHtml', (documentId: number) => {
    const pdfData = getInvoiceDataForPdf(documentId)
    return { html: generateInvoiceHtml(pdfData), number: pdfData.document?.number ?? 'document' }
  })

  handle('pdf:print', async (documentId: number) => {
    const pdfData = getInvoiceDataForPdf(documentId)
    const html = generateInvoiceHtml(pdfData)

    const printHtml = html
      .replace('</head>', `<style media="print">@page{size:A4;margin:10mm;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style></head>`)
      .replace('</body>', `<script>window.onload=function(){window.print();};</script></body>`)

    const tmpDir = join(app.getPath('temp'), 'erp-print')
    mkdirSync(tmpDir, { recursive: true })
    const tmpPath = join(tmpDir, `print-${pdfData.document?.number ?? 'doc'}.html`)
    writeFileSync(tmpPath, printHtml, 'utf-8')
    await shell.openPath(tmpPath)
    return { success: true }
  })

  handle('pdf:generate', async (data: { documentId: number }) => {
    const pdfData = getInvoiceDataForPdf(data.documentId)
    const html = generateInvoiceHtml(pdfData)

    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const defaultName = `${pdfData.document?.number ?? 'document'}.pdf`
    const result = await dialog.showSaveDialog(win, {
      title: 'Enregistrer le PDF',
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    win?.focus()
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    const pdfWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })

    const tmpDir = join(app.getPath('temp'), 'erp-pdf-gen')
    mkdirSync(tmpDir, { recursive: true })
    const tmpPath = join(tmpDir, `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}.html`)

    try {
      writeFileSync(tmpPath, html, 'utf-8')
      await pdfWin.loadFile(tmpPath)
      const pdfBuffer = await pdfWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      writeFileSync(result.filePath, pdfBuffer)
      return { success: true, path: result.filePath }
    } finally {
      if (!pdfWin.isDestroyed()) pdfWin.close()
    }
  })

  handle('pdf:generateFromHtml', async (data: { html: string; filename: string }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const { shell } = require('electron')

    const pdfWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })

    const tmpDir = join(app.getPath('temp'), 'erp-pdf-gen')
    mkdirSync(tmpDir, { recursive: true })
    const tmpPath = join(tmpDir, `temp-${Date.now()}.html`)

    try {
      writeFileSync(tmpPath, data.html, 'utf-8')
      await pdfWin.loadFile(tmpPath)
      const pdfBuffer = await pdfWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      })

      let filePath: string

      if (process.platform === 'linux') {
        // على Linux: حفظ مباشر في Downloads بدون dialog
        filePath = join(app.getPath('downloads'), data.filename)
        writeFileSync(filePath, pdfBuffer)
        shell.showItemInFolder(filePath)
        win?.focus()
      } else {
        // على Windows/Mac: dialog اختيار المسار
        const result = await dialog.showSaveDialog(win, {
          title: 'Enregistrer le PDF',
          defaultPath: data.filename,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
        win?.focus()
        if (result.canceled || !result.filePath) return { success: false, canceled: true }
        filePath = result.filePath
        writeFileSync(filePath, pdfBuffer)
      }

      return { success: true, path: filePath }
    } finally {
      if (!pdfWin.isDestroyed()) pdfWin.close()
    }
  })
}
