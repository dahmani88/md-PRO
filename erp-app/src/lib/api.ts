// Bridge آمن للتواصل مع Electron IPC
// في وضع التطوير بدون Electron يستخدم mock تلقائياً

import { mockApi } from './mock-api'

const IS_ELECTRON = typeof window !== 'undefined' && !!window.api

async function call<T>(
  electronFn: () => Promise<{ success: boolean; data?: T; error?: string }>,
  mockFn: () => Promise<{ success: boolean; data?: T; error?: string }>
): Promise<T> {
  const fn = IS_ELECTRON ? electronFn : mockFn
  const result = await fn()
  if (!result.success) throw new Error((result as any).error ?? 'Erreur inconnue')
  return result.data as T
}

export const api = {
  // Config & License
  getConfig:       () => call(() => window.api.getDeviceConfig(),    () => mockApi.getDeviceConfig()),
  saveConfig:      (d: unknown) => call(() => window.api.saveDeviceConfig(d),  () => mockApi.saveDeviceConfig()),
  activateLicense: (d: unknown) => call(() => window.api.activateLicense(d), () => mockApi.activateLicense(d)),
  getLicense:      () => call(() => window.api.getLicenseInfo(),     () => mockApi.getLicenseInfo()),

  // Auth
  login:           (d: unknown) => call(() => window.api.login(d),        () => mockApi.login()),
  logout:          (d?: unknown) => call(() => window.api.logout(d),        () => Promise.resolve({ success: true, data: null })),
  getUsers:        () => call(() => window.api.getUsers(),           () => mockApi.getUsers()),
  createUser:      (d: unknown) => call(() => window.api.createUser(d),   () => mockApi.createUser()),
  updateUser:      (d: unknown) => call(() => window.api.updateUser(d),   () => mockApi.updateUser()),
  deleteUser:      (id: number) => call(() => window.api.deleteUser(id),  () => mockApi.deleteUser()),

  // Clients
  getClients:      (f?: unknown) => call(() => window.api.getClients(f),    () => mockApi.getClients()),
  getClient:       (id: number)  => call(() => window.api.getClient(id),    () => mockApi.getClient()),
  createClient:    (d: unknown)  => call(() => window.api.createClient(d),  () => mockApi.createClient()),
  updateClient:    (d: unknown)  => call(() => window.api.updateClient(d),  () => mockApi.updateClient()),
  deleteClient:    (id: number)  => call(() => window.api.deleteClient(id), () => mockApi.deleteClient()),

  // Suppliers
  getSuppliers:    (f?: unknown) => call(() => window.api.getSuppliers(f),    () => mockApi.getSuppliers()),
  getSupplier:     (id: number)  => call(() => window.api.getSupplier(id),    () => mockApi.getSupplier()),
  createSupplier:  (d: unknown)  => call(() => window.api.createSupplier(d),  () => mockApi.createSupplier()),
  updateSupplier:  (d: unknown)  => call(() => window.api.updateSupplier(d),  () => mockApi.updateSupplier()),
  deleteSupplier:  (id: number)  => call(() => window.api.deleteSupplier(id), () => mockApi.deleteSupplier()),

  // Products
  getProducts:     (f?: unknown) => call(() => window.api.getProducts(f),    () => mockApi.getProducts()),
  getProduct:      (id: number)  => call(() => window.api.getProduct(id),    () => mockApi.getProduct()),
  createProduct:   (d: unknown)  => call(() => window.api.createProduct(d),  () => mockApi.createProduct()),
  updateProduct:   (d: unknown)  => call(() => window.api.updateProduct(d),  () => mockApi.updateProduct()),
  deleteProduct:   (id: number)  => call(() => window.api.deleteProduct(id), () => mockApi.deleteProduct()),

  // Stock
  getStockMovements:    (f?: unknown) => call(() => window.api.getStockMovements(f),    () => mockApi.getStockMovements()),
  applyStockMovement:   (id: number)  => call(() => window.api.applyStockMovement(id),  () => mockApi.applyStockMovement()),
  deleteStockMovement:  (id: number)  => call(() => window.api.deleteStockMovement(id), () => Promise.resolve({ success: true })),
  createManualMovement: (d: unknown)  => call(() => window.api.createManualMovement(d), () => mockApi.createManualMovement()),
  getProductStats:      (id: number)  => call(() => window.api.getProductStats(id),      () => Promise.resolve({ success: true, data: null })),

  // Documents
  getDocuments:    (f?: unknown) => call(() => window.api.getDocuments(f),    () => mockApi.getDocuments()),
  getDocument:     (id: number)  => call(() => window.api.getDocument(id),    () => mockApi.getDocument()),
  createDocument:  (d: unknown)  => call(() => window.api.createDocument(d),  () => mockApi.createDocument()),
  updateDocument:  (d: unknown)  => call(() => window.api.updateDocument(d),  () => mockApi.updateDocument()),
  confirmDocument: (id: number)  => call(() => window.api.confirmDocument(id),() => mockApi.confirmDocument()),
  cancelDocument:  (id: number)  => call(() => window.api.cancelDocument(id), () => mockApi.cancelDocument()),
  convertDocument: (d: unknown)  => call(() => window.api.convertDocument(d), () => mockApi.convertDocument()),
  linkDocuments:   (d: unknown)  => call(() => window.api.linkDocuments(d),   () => Promise.resolve({ success: true, data: null })),
  getPOReceiptStatus:  (id: number)  => call(() => window.api.getPOReceiptStatus(id),  () => Promise.resolve({ success: true, data: { summary: [], fullyReceived: false, brCount: 0 } })),
  getBLDeliveryStatus: (id: number)  => call(
    () => typeof window.api.getBLDeliveryStatus === 'function'
      ? window.api.getBLDeliveryStatus(id)
      : Promise.resolve({ success: true, data: { summary: [], fullyDelivered: false, blCount: 0 } }),
    () => Promise.resolve({ success: true, data: { summary: [], fullyDelivered: false, blCount: 0 } })
  ),
  getDocumentTimeline: (id: number)  => call(
    () => typeof window.api.getDocumentTimeline === 'function'
      ? window.api.getDocumentTimeline(id)
      : Promise.resolve({ success: true, data: [] }),
    () => Promise.resolve({ success: true, data: [] })
  ),
  getCancelImpact:     (id: number)  => call(() => window.api.getCancelImpact(id),     () => Promise.resolve({ impacts: [], docType: '', docStatus: '' })),
  cancelWithOptions:   (d: unknown)  => call(() => window.api.cancelWithOptions(d),    () => Promise.resolve({ success: true })),

  // Payments
  getPayments:     (f?: unknown) => call(() => window.api.getPayments(f),    () => mockApi.getPayments()),
  createPayment:   (d: unknown)  => call(() => window.api.createPayment(d),  () => mockApi.createPayment()),
  updatePayment:   (d: unknown)  => call(() => window.api.updatePayment(d),  () => mockApi.updatePayment()),
  getPaymentPaidAmount: (id: number) => call(() => window.api.getPaymentPaidAmount(id), () => Promise.resolve({ success: true, data: { total: 0 } })),

  // Accounting
  getAccounts:       (f?: unknown) => call(() => window.api.getAccounts(f),       () => mockApi.getAccounts()),
  getJournalEntries: (f?: unknown) => call(() => window.api.getJournalEntries(f), () => mockApi.getJournalEntries()),
  createManualEntry: (d: unknown)  => call(() => window.api.createManualEntry(d), () => mockApi.createManualEntry()),
  getGrandLivre:     (f: unknown)  => call(() => window.api.getGrandLivre(f),     () => mockApi.getGrandLivre()),
  getBalance:        (f?: unknown) => call(() => window.api.getBalance(f),        () => mockApi.getBalance()),
  getTvaDeclaration: (f: unknown)  => call(() => window.api.getTvaDeclaration(f), () => mockApi.getTvaDeclaration()),
  getPeriods:        () => call(() => window.api.getPeriods(),    () => mockApi.getPeriods()),
  closePeriod:       (id: number) => call(() => window.api.closePeriod(id), () => mockApi.closePeriod()),

  // Purchases (يستخدم documents handler)
  getPurchaseOrders:   (f?: unknown) => call(() => window.api.getPurchaseOrders(f),   () => mockApi.getDocuments()),
  createPurchaseOrder: (d: unknown)  => call(() => window.api.createPurchaseOrder(d), () => mockApi.createDocument()),
  confirmReception:    (id: unknown) => call(() => window.api.confirmReception(id),   () => mockApi.confirmDocument()),
  createImportInvoice: (d: unknown)  => call(() => window.api.createImportInvoice(d), () => mockApi.createDocument()),

  // Reports
  getReport:       (d: unknown) => call(() => window.api.getReport(d), () => mockApi.getReport()),
  // Production
  getProductionOrders:  (f?: unknown) => call(() => window.api.getProductionOrders(f),  () => mockApi.getProductionOrders()),
  createProduction:     (d: unknown)  => call(() => window.api.createProduction(d),      () => mockApi.createProduction()),
  confirmProduction:    (id: number, userId: number) => call(() => window.api.confirmProduction(id, userId), () => mockApi.confirmProduction()),
  cancelProduction:     (id: number, userId: number) => call(() => window.api.cancelProduction(id, userId),  () => Promise.resolve({ success: true, data: null })),
  getBomTemplates:      (pid: number) => call(() => window.api.getBomTemplates(pid),     () => mockApi.getBomTemplates()),
  getAllBoms:            ()            => call(() => window.api.getAllBoms(),              () => Promise.resolve({ success: true, data: [] })),
  createBomTemplate:    (d: unknown)  => call(() => window.api.createBomTemplate(d),     () => mockApi.createBomTemplate()),
  updateBomTemplate:    (d: unknown)  => call(() => window.api.updateBomTemplate(d),     () => Promise.resolve({ success: true, data: null })),
  deleteBomTemplate:    (id: number)  => call(() => window.api.deleteBomTemplate(id),    () => Promise.resolve({ success: true, data: null })),
  getTransformations:   (f?: unknown) => call(() => window.api.getTransformations(f),    () => mockApi.getTransformations()),
  createTransformation: (d: unknown)  => call(() => window.api.createTransformation(d),  () => mockApi.createTransformation()),

  // Backup
  createBackup:    () => call(() => window.api.createBackup(),         () => mockApi.createBackup()),
  listBackups:     () => call(() => window.api.listBackups(),          () => mockApi.listBackups()),
  restoreBackup:   (p: string) => call(() => window.api.restoreBackup(p), () => mockApi.restoreBackup()),
  exportFull:      () => call(() => (window.api as any).exportFull(),  () => Promise.resolve({ success: true, data: null })),
  importFull:      () => call(() => (window.api as any).importFull(),  () => Promise.resolve({ success: true, data: null })),

  // Notifications
  getNotifications:    () => call(() => window.api.getNotifications(),       () => mockApi.getNotifications()),
  markNotificationRead:(id: number) => call(() => window.api.markNotificationRead(id), () => mockApi.markNotificationRead()),

  // PDF
  pdfGetHtml:      (id: number)  => call(() => window.api.pdfGetHtml(id),    () => Promise.resolve({ success: true, data: { html: '', number: 'preview' } })),
  printDocument:   (id: number)  => call(() => window.api.printDocument(id), () => Promise.resolve({ success: true })),
  generatePdf:         (d: unknown) => call(() => window.api.generatePdf(d),         () => mockApi.generatePdf()),
  generatePdfFromHtml: (d: unknown) => call(() => window.api.generatePdfFromHtml(d), () => Promise.resolve({ success: true, data: null })),

  // Excel
  excelExportDocuments: (f: unknown) => call(() => window.api.excelExportDocuments(f), () => mockApi.generatePdf()),
  excelExportParties:   (t: unknown) => call(() => window.api.excelExportParties(t),   () => mockApi.generatePdf()),
  excelExportStock:     ()           => call(() => window.api.excelExportStock(),       () => mockApi.generatePdf()),
  excelExportBalance:   (f: unknown) => call(() => window.api.excelExportBalance(f),   () => mockApi.generatePdf()),
  excelExportReport:    (d: unknown) => call(() => window.api.excelExportReport(d),    () => mockApi.generatePdf()),
  excelExportMultiple:  (d: unknown) => call(() => window.api.excelExportMultiple(d),  () => mockApi.generatePdf()),

  // Settings
  settingsGet:     (key?: unknown) => call(() => window.api.settingsGet(key),     () => Promise.resolve({ success: true, data: null })),
  settingsSet:     (d: unknown)    => call(() => window.api.settingsSet(d),       () => Promise.resolve({ success: true, data: null })),
  settingsSetMany: (d: unknown)    => call(() => window.api.settingsSetMany(d),   () => Promise.resolve({ success: true, data: null })),

  // Import
  importSelectFile:       () => call(() => window.api.importSelectFile(),          () => Promise.resolve({ success: true, data: null })),
  importClients:          (d: unknown) => call(() => window.api.importClients(d),          () => Promise.resolve({ success: true, data: { success: 0, errors: [], total: 0 } })),
  importSuppliers:        (d: unknown) => call(() => window.api.importSuppliers(d),        () => Promise.resolve({ success: true, data: { success: 0, errors: [], total: 0 } })),
  importProducts:         (d: unknown) => call(() => window.api.importProducts(d),         () => Promise.resolve({ success: true, data: { success: 0, errors: [], total: 0 } })),
  importDownloadTemplate: (t: unknown) => call(() => window.api.importDownloadTemplate(t), () => Promise.resolve({ success: true, data: null })),

  // Attachments
  attachmentsAdd:    (d: unknown) => call(() => window.api.attachmentsAdd(d),    () => Promise.resolve({ success: true, data: [] })),
  attachmentsList:   (d: unknown) => call(() => window.api.attachmentsList(d),   () => Promise.resolve({ success: true, data: [] })),
  attachmentsOpen:   (p: string)  => call(() => window.api.attachmentsOpen(p),   () => Promise.resolve({ success: true, data: null })),
  attachmentsDelete: (p: string)  => call(() => window.api.attachmentsDelete(p), () => Promise.resolve({ success: true, data: null })),

  // Audit
  getUserStats: (id: number) => call(
    () => typeof (window.api as any).getUserStats === 'function'
      ? (window.api as any).getUserStats(id)
      : Promise.resolve({ success: true, data: null }),
    () => Promise.resolve({ success: true, data: null })
  ),
  getAuditLog:  (f?: unknown) => call(() => window.api.auditGetLog(f),   () => Promise.resolve({ success: true, data: { rows: [], total: 0, page: 1, limit: 100 } })),
  getAuditUsers:()            => call(() => window.api.auditGetUsers(),  () => Promise.resolve({ success: true, data: [] })),

  // Accounting extra
  createAccount: (d: unknown) => call(() => window.api.createAccount(d), () => Promise.resolve({ success: true, data: { id: 1 } })),
  getTvaRates:   ()           => call(() => window.api.getTvaRates(),     () => Promise.resolve({ success: true, data: [
    { id: 1, rate: 0,  label: 'Exonéré (0%)', is_active: true },
    { id: 2, rate: 7,  label: 'TVA 7%',        is_active: true },
    { id: 3, rate: 10, label: 'TVA 10%',       is_active: true },
    { id: 4, rate: 14, label: 'TVA 14%',       is_active: true },
    { id: 5, rate: 20, label: 'TVA 20%',       is_active: true },
  ]})),
  createTvaRate: (d: unknown) => call(() => (window.api as any).createTvaRate(d), () => Promise.resolve({ success: true, data: { id: 0 } })),

  // Sync & Network
  syncDeviceInfo:      () => call(() => (window.api as any).syncDeviceInfo(),       () => Promise.resolve({ success: true, data: null })),
  syncGetDevices:      () => call(() => (window.api as any).syncGetDevices(),       () => Promise.resolve({ success: true, data: [] })),
  syncPull:            () => call(() => (window.api as any).syncPull(),             () => Promise.resolve({ success: true, data: { applied: 0 } })),
  syncPush:            () => call(() => (window.api as any).syncPush(),             () => Promise.resolve({ success: true, data: { applied: 0 } })),
  syncInitialSnapshot: () => call(() => (window.api as any).syncInitialSnapshot(),  () => Promise.resolve({ success: true, data: { applied: 0 } })),
  syncTestConnection:  (d?: unknown) => call(() => (window.api as any).syncTestConnection(d), () => Promise.resolve({ success: true, data: { ok: false } })),
  syncGetApiKey:       () => call(() => (window.api as any).syncGetApiKey(),        () => Promise.resolve({ success: true, data: { apiKey: '' } })),

  // Updates
  updateCheck:    () => call(() => (window.api as any).updateCheck(),              () => Promise.resolve({ success: true, data: null })),
  updateDownload: (v: string) => call(() => (window.api as any).updateDownload(v), () => Promise.resolve({ success: true, data: null })),
  updateVerify:   (d: unknown) => call(() => (window.api as any).updateVerify(d),  () => Promise.resolve({ success: true, data: { valid: false } })),
  updateInstall:  (p: string) => call(() => (window.api as any).updateInstall(p),  () => Promise.resolve({ success: true, data: null })),
  updatePublish:  (d: unknown) => call(() => (window.api as any).updatePublish(d), () => Promise.resolve({ success: true, data: null })),
  updateList:     () => call(() => (window.api as any).updateList(),               () => Promise.resolve({ success: true, data: [] })),
}
