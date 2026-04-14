import { contextBridge, ipcRenderer } from 'electron'

// الـ API الآمن المكشوف للـ Renderer
const api = {
  // --- Config & License ---
  getDeviceConfig:    ()       => ipcRenderer.invoke('config:get'),
  saveDeviceConfig:   (data: unknown) => ipcRenderer.invoke('config:save', data),
  activateLicense:    (data: unknown) => ipcRenderer.invoke('license:activate', data),
  getLicenseInfo:     ()       => ipcRenderer.invoke('license:info'),

  // --- Auth ---
  login:              (data: unknown) => ipcRenderer.invoke('auth:login', data),
  logout:             (data?: unknown) => ipcRenderer.invoke('auth:logout', data),
  getUsers:           ()       => ipcRenderer.invoke('users:getAll'),
  createUser:         (data: unknown) => ipcRenderer.invoke('users:create', data),
  updateUser:         (data: unknown) => ipcRenderer.invoke('users:update', data),
  deleteUser:         (id: number)    => ipcRenderer.invoke('users:delete', id),

  // --- Clients ---
  getClients:         (filters?: unknown) => ipcRenderer.invoke('clients:getAll', filters),
  getClient:          (id: number)        => ipcRenderer.invoke('clients:getOne', id),
  createClient:       (data: unknown)     => ipcRenderer.invoke('clients:create', data),
  updateClient:       (data: unknown)     => ipcRenderer.invoke('clients:update', data),
  deleteClient:       (id: number)        => ipcRenderer.invoke('clients:delete', id),

  // --- Suppliers ---
  getSuppliers:       (filters?: unknown) => ipcRenderer.invoke('suppliers:getAll', filters),
  getSupplier:        (id: number)        => ipcRenderer.invoke('suppliers:getOne', id),
  createSupplier:     (data: unknown)     => ipcRenderer.invoke('suppliers:create', data),
  updateSupplier:     (data: unknown)     => ipcRenderer.invoke('suppliers:update', data),
  deleteSupplier:     (id: number)        => ipcRenderer.invoke('suppliers:delete', id),

  // --- Products ---
  getProducts:        (filters?: unknown) => ipcRenderer.invoke('products:getAll', filters),
  getProduct:         (id: number)        => ipcRenderer.invoke('products:getOne', id),
  createProduct:      (data: unknown)     => ipcRenderer.invoke('products:create', data),
  updateProduct:      (data: unknown)     => ipcRenderer.invoke('products:update', data),
  deleteProduct:      (id: number)        => ipcRenderer.invoke('products:delete', id),

  // --- Stock ---
  getStockMovements:  (filters?: unknown) => ipcRenderer.invoke('stock:getMovements', filters),
  applyStockMovement: (id: number)        => ipcRenderer.invoke('stock:applyMovement', id),
  deleteStockMovement:(id: number)        => ipcRenderer.invoke('stock:deleteMovement', id),
  createManualMovement: (data: unknown)   => ipcRenderer.invoke('stock:createManual', data),
  getProductStats:      (id: number)      => ipcRenderer.invoke('stock:getProductStats', id),

  // --- Documents ---
  getDocuments:       (filters?: unknown) => ipcRenderer.invoke('documents:getAll', filters),
  getDocument:        (id: number)        => ipcRenderer.invoke('documents:getOne', id),
  createDocument:     (data: unknown)     => ipcRenderer.invoke('documents:create', data),
  updateDocument:     (data: unknown)     => ipcRenderer.invoke('documents:update', data),
  confirmDocument:    (id: number)        => ipcRenderer.invoke('documents:confirm', id),
  cancelDocument:     (id: number)        => ipcRenderer.invoke('documents:cancel', id),
  convertDocument:    (data: unknown)     => ipcRenderer.invoke('documents:convert', data),
  linkDocuments:      (data: unknown)     => ipcRenderer.invoke('documents:link', data),
  getPOReceiptStatus:   (id: number)        => ipcRenderer.invoke('documents:getPOReceiptStatus', id),
  getBLDeliveryStatus:  (id: number)        => ipcRenderer.invoke('documents:getBLDeliveryStatus', id),
  getDocumentTimeline:  (id: number)        => ipcRenderer.invoke('documents:getTimeline', id),
  getCancelImpact:      (id: number)        => ipcRenderer.invoke('documents:getCancelImpact', id),
  cancelWithOptions:    (data: unknown)     => ipcRenderer.invoke('documents:cancelWithOptions', data),

  // --- Payments ---
  getPayments:        (filters?: unknown) => ipcRenderer.invoke('payments:getAll', filters),
  createPayment:      (data: unknown)     => ipcRenderer.invoke('payments:create', data),
  updatePayment:      (data: unknown)     => ipcRenderer.invoke('payments:update', data),
  getPaymentPaidAmount: (docId: number)   => ipcRenderer.invoke('payments:getPaidAmount', docId),

  // --- Purchases (يستخدم نفس documents handler) ---
  getPurchaseOrders:  (filters?: unknown) => ipcRenderer.invoke('documents:getAll', { ...filters as any, type: 'purchase_order' }),
  createPurchaseOrder:(data: unknown)     => ipcRenderer.invoke('documents:create', data),
  confirmReception:   (id: unknown)       => ipcRenderer.invoke('documents:confirm', id),
  createImportInvoice:(data: unknown)     => ipcRenderer.invoke('documents:create', data),

  // --- Production ---
  getProductionOrders: (filters?: unknown)          => ipcRenderer.invoke('production:getAll', filters),
  createProduction:    (data: unknown)               => ipcRenderer.invoke('production:create', data),
  confirmProduction:   (id: number, userId: number)  => ipcRenderer.invoke('production:confirm', id, userId),
  cancelProduction:    (id: number, userId: number)  => ipcRenderer.invoke('production:cancel', id, userId),
  getBomTemplates:     (productId: number)           => ipcRenderer.invoke('production:getBoms', productId),
  getAllBoms:          ()                             => ipcRenderer.invoke('production:getAllBoms'),
  createBomTemplate:   (data: unknown)               => ipcRenderer.invoke('production:createBom', data),
  updateBomTemplate:   (data: unknown)               => ipcRenderer.invoke('production:updateBom', data),
  deleteBomTemplate:   (id: number)                  => ipcRenderer.invoke('production:deleteBom', id),

  // --- Transformations ---
  getTransformations:  (filters?: unknown) => ipcRenderer.invoke('transformations:getAll', filters),
  createTransformation:(data: unknown)     => ipcRenderer.invoke('transformations:create', data),

  // --- Accounting ---
  getAccounts:        (filters?: unknown) => ipcRenderer.invoke('accounting:getAccounts', filters),
  getJournalEntries:  (filters?: unknown) => ipcRenderer.invoke('accounting:getEntries', filters),
  createManualEntry:  (data: unknown)     => ipcRenderer.invoke('accounting:createEntry', data),
  getGrandLivre:      (filters?: unknown) => ipcRenderer.invoke('accounting:getGrandLivre', filters),
  getBalance:         (filters?: unknown) => ipcRenderer.invoke('accounting:getBalance', filters),
  getTvaDeclaration:  (filters?: unknown) => ipcRenderer.invoke('accounting:getTva', filters),
  getPeriods:         ()                  => ipcRenderer.invoke('accounting:getPeriods'),
  closePeriod:        (id: number)        => ipcRenderer.invoke('accounting:closePeriod', id),

  // --- Reports ---
  getReport:          (data: unknown)     => ipcRenderer.invoke('reports:get', data),

  // --- Notifications ---
  getNotifications:   ()       => ipcRenderer.invoke('notifications:getAll'),
  markNotificationRead:(id: number) => ipcRenderer.invoke('notifications:markRead', id),

  // --- Backup ---
  createBackup:       ()       => ipcRenderer.invoke('backup:create'),
  restoreBackup:      (path: string) => ipcRenderer.invoke('backup:restore', path),
  listBackups:        ()       => ipcRenderer.invoke('backup:list'),
  exportFull:         ()       => ipcRenderer.invoke('backup:exportFull'),
  importFull:         ()       => ipcRenderer.invoke('backup:importFull'),

  // --- PDF ---
  pdfGetHtml:         (id: number)  => ipcRenderer.invoke('pdf:getHtml', id),
  printDocument:      (id: number)  => ipcRenderer.invoke('pdf:print', id),
  generatePdf:        (data: unknown) => ipcRenderer.invoke('pdf:generate', data),
  generatePdfFromHtml:(data: unknown) => ipcRenderer.invoke('pdf:generateFromHtml', data),

  // --- Excel ---
  excelExportDocuments: (f: unknown) => ipcRenderer.invoke('excel:exportDocuments', f),
  excelExportParties:   (t: unknown) => ipcRenderer.invoke('excel:exportParties', t),
  excelExportStock:     ()           => ipcRenderer.invoke('excel:exportStock'),
  excelExportBalance:   (f: unknown) => ipcRenderer.invoke('excel:exportBalance', f),
  excelExportReport:    (d: unknown) => ipcRenderer.invoke('excel:exportReport', d),
  excelExportMultiple:  (d: unknown) => ipcRenderer.invoke('excel:exportMultiple', d),

  // --- Settings ---
  settingsGet:    (key?: unknown)  => ipcRenderer.invoke('settings:get', key),
  settingsSet:    (data: unknown)  => ipcRenderer.invoke('settings:set', data),
  settingsSetMany:(data: unknown)  => ipcRenderer.invoke('settings:setMany', data),

  // --- Import ---
  importSelectFile:      ()           => ipcRenderer.invoke('import:selectFile'),
  importClients:         (d: unknown) => ipcRenderer.invoke('import:clients', d),
  importSuppliers:       (d: unknown) => ipcRenderer.invoke('import:suppliers', d),
  importProducts:        (d: unknown) => ipcRenderer.invoke('import:products', d),
  importDownloadTemplate:(t: unknown) => ipcRenderer.invoke('import:downloadTemplate', t),

  // --- Attachments ---
  attachmentsAdd:    (d: unknown) => ipcRenderer.invoke('attachments:add', d),
  attachmentsList:   (d: unknown) => ipcRenderer.invoke('attachments:list', d),
  attachmentsOpen:   (p: string)  => ipcRenderer.invoke('attachments:open', p),
  attachmentsDelete: (p: string)  => ipcRenderer.invoke('attachments:delete', p),

  // --- Audit ---
  getUserStats:    (id: number) => ipcRenderer.invoke('users:getStats', id),
  auditGetLog:  (f?: unknown) => ipcRenderer.invoke('audit:getLog', f),
  auditGetUsers:()            => ipcRenderer.invoke('audit:getUsers'),

  // --- Accounting extra ---
  createAccount: (d: unknown) => ipcRenderer.invoke('accounting:createAccount', d),
  getTvaRates:   ()           => ipcRenderer.invoke('accounting:getTvaRates'),
  createTvaRate: (d: unknown) => ipcRenderer.invoke('accounting:createTvaRate', d),

  // --- Sync & Network ---
  syncDeviceInfo:       ()           => ipcRenderer.invoke('sync:deviceInfo'),
  syncGetDevices:       ()           => ipcRenderer.invoke('sync:getDevices'),
  syncPull:             ()           => ipcRenderer.invoke('sync:pull'),
  syncPush:             ()           => ipcRenderer.invoke('sync:push'),
  syncInitialSnapshot:  ()           => ipcRenderer.invoke('sync:initialSnapshot'),
  syncTestConnection:   (d?: unknown)=> ipcRenderer.invoke('sync:testConnection', d),
  syncStartServer:      (p?: number) => ipcRenderer.invoke('sync:startServer', p),
  syncStopServer:       ()           => ipcRenderer.invoke('sync:stopServer'),
  syncGetApiKey:        ()           => ipcRenderer.invoke('sync:getApiKey'),

  // --- Updates ---
  updateCheck:    ()           => ipcRenderer.invoke('update:check'),
  updateDownload: (v: string)  => ipcRenderer.invoke('update:download', v),
  updateVerify:   (d: unknown) => ipcRenderer.invoke('update:verify', d),
  updateInstall:  (p: string)  => ipcRenderer.invoke('update:install', p),
  updatePublish:  (d: unknown) => ipcRenderer.invoke('update:publish', d),
  updateList:     ()           => ipcRenderer.invoke('update:list'),

  // --- Push Notifications from Main ─────────────────────────
  onSyncUpdated:  (cb: (data: unknown) => void) => {
    ipcRenderer.on('sync:updated', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('sync:updated')
  },
  onSyncOffline:  (cb: (data: unknown) => void) => {
    ipcRenderer.on('sync:offline', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('sync:offline')
  },
  onUpdateAvailable: (cb: (data: unknown) => void) => {
    ipcRenderer.on('update:available', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('update:available')
  },
  onUpdateProgress: (cb: (data: unknown) => void) => {
    ipcRenderer.on('update:progress', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('update:progress')
  },
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
