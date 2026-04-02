"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// الـ API الآمن المكشوف للـ Renderer
const api = {
    // --- Config & License ---
    getDeviceConfig: () => electron_1.ipcRenderer.invoke('config:get'),
    saveDeviceConfig: (data) => electron_1.ipcRenderer.invoke('config:save', data),
    activateLicense: (data) => electron_1.ipcRenderer.invoke('license:activate', data),
    getLicenseInfo: () => electron_1.ipcRenderer.invoke('license:info'),
    // --- Auth ---
    login: (data) => electron_1.ipcRenderer.invoke('auth:login', data),
    logout: () => electron_1.ipcRenderer.invoke('auth:logout'),
    getUsers: () => electron_1.ipcRenderer.invoke('users:getAll'),
    createUser: (data) => electron_1.ipcRenderer.invoke('users:create', data),
    updateUser: (data) => electron_1.ipcRenderer.invoke('users:update', data),
    deleteUser: (id) => electron_1.ipcRenderer.invoke('users:delete', id),
    // --- Clients ---
    getClients: (filters) => electron_1.ipcRenderer.invoke('clients:getAll', filters),
    getClient: (id) => electron_1.ipcRenderer.invoke('clients:getOne', id),
    createClient: (data) => electron_1.ipcRenderer.invoke('clients:create', data),
    updateClient: (data) => electron_1.ipcRenderer.invoke('clients:update', data),
    deleteClient: (id) => electron_1.ipcRenderer.invoke('clients:delete', id),
    // --- Suppliers ---
    getSuppliers: (filters) => electron_1.ipcRenderer.invoke('suppliers:getAll', filters),
    getSupplier: (id) => electron_1.ipcRenderer.invoke('suppliers:getOne', id),
    createSupplier: (data) => electron_1.ipcRenderer.invoke('suppliers:create', data),
    updateSupplier: (data) => electron_1.ipcRenderer.invoke('suppliers:update', data),
    deleteSupplier: (id) => electron_1.ipcRenderer.invoke('suppliers:delete', id),
    // --- Products ---
    getProducts: (filters) => electron_1.ipcRenderer.invoke('products:getAll', filters),
    getProduct: (id) => electron_1.ipcRenderer.invoke('products:getOne', id),
    createProduct: (data) => electron_1.ipcRenderer.invoke('products:create', data),
    updateProduct: (data) => electron_1.ipcRenderer.invoke('products:update', data),
    deleteProduct: (id) => electron_1.ipcRenderer.invoke('products:delete', id),
    // --- Stock ---
    getStockMovements: (filters) => electron_1.ipcRenderer.invoke('stock:getMovements', filters),
    applyStockMovement: (id) => electron_1.ipcRenderer.invoke('stock:applyMovement', id),
    createManualMovement: (data) => electron_1.ipcRenderer.invoke('stock:createManual', data),
    getProductStats:      (id)   => electron_1.ipcRenderer.invoke('stock:getProductStats', id),
    // --- Documents ---
    getDocuments: (filters) => electron_1.ipcRenderer.invoke('documents:getAll', filters),
    getDocument: (id) => electron_1.ipcRenderer.invoke('documents:getOne', id),
    createDocument: (data) => electron_1.ipcRenderer.invoke('documents:create', data),
    updateDocument: (data) => electron_1.ipcRenderer.invoke('documents:update', data),
    confirmDocument: (id) => electron_1.ipcRenderer.invoke('documents:confirm', id),
    cancelDocument: (id) => electron_1.ipcRenderer.invoke('documents:cancel', id),
    convertDocument: (data) => electron_1.ipcRenderer.invoke('documents:convert', data),
    linkDocuments:   (data) => electron_1.ipcRenderer.invoke('documents:link', data),
    // --- Payments ---
    getPayments: (filters) => electron_1.ipcRenderer.invoke('payments:getAll', filters),
    createPayment: (data) => electron_1.ipcRenderer.invoke('payments:create', data),
    updatePayment: (data) => electron_1.ipcRenderer.invoke('payments:update', data),
    // --- Purchases (يستخدم نفس documents handler) ---
    getPurchaseOrders: (filters) => electron_1.ipcRenderer.invoke('documents:getAll', { ...filters, type: 'purchase_order' }),
    createPurchaseOrder: (data) => electron_1.ipcRenderer.invoke('documents:create', data),
    confirmReception: (id) => electron_1.ipcRenderer.invoke('documents:confirm', id),
    createImportInvoice: (data) => electron_1.ipcRenderer.invoke('documents:create', data),
    // --- Production ---
    getProductionOrders: (filters) => electron_1.ipcRenderer.invoke('production:getAll', filters),
    createProduction: (data) => electron_1.ipcRenderer.invoke('production:create', data),
    confirmProduction: (id) => electron_1.ipcRenderer.invoke('production:confirm', id),
    getBomTemplates: (productId) => electron_1.ipcRenderer.invoke('production:getBoms', productId),
    createBomTemplate: (data) => electron_1.ipcRenderer.invoke('production:createBom', data),
    // --- Transformations ---
    getTransformations: (filters) => electron_1.ipcRenderer.invoke('transformations:getAll', filters),
    createTransformation: (data) => electron_1.ipcRenderer.invoke('transformations:create', data),
    // --- Accounting ---
    getAccounts: (filters) => electron_1.ipcRenderer.invoke('accounting:getAccounts', filters),
    getJournalEntries: (filters) => electron_1.ipcRenderer.invoke('accounting:getEntries', filters),
    createManualEntry: (data) => electron_1.ipcRenderer.invoke('accounting:createEntry', data),
    getGrandLivre: (filters) => electron_1.ipcRenderer.invoke('accounting:getGrandLivre', filters),
    getBalance: (filters) => electron_1.ipcRenderer.invoke('accounting:getBalance', filters),
    getTvaDeclaration: (filters) => electron_1.ipcRenderer.invoke('accounting:getTva', filters),
    getPeriods: () => electron_1.ipcRenderer.invoke('accounting:getPeriods'),
    closePeriod: (id) => electron_1.ipcRenderer.invoke('accounting:closePeriod', id),
    // --- Reports ---
    getReport: (data) => electron_1.ipcRenderer.invoke('reports:get', data),
    // --- Notifications ---
    getNotifications: () => electron_1.ipcRenderer.invoke('notifications:getAll'),
    markNotificationRead: (id) => electron_1.ipcRenderer.invoke('notifications:markRead', id),
    // --- Backup ---
    createBackup: () => electron_1.ipcRenderer.invoke('backup:create'),
    restoreBackup: (path) => electron_1.ipcRenderer.invoke('backup:restore', path),
    listBackups: () => electron_1.ipcRenderer.invoke('backup:list'),
    // --- PDF ---
    pdfGetHtml: (id) => electron_1.ipcRenderer.invoke('pdf:getHtml', id),
    generatePdf: (data) => electron_1.ipcRenderer.invoke('pdf:generate', data),
    // --- Excel ---
    excelExportDocuments: (f) => electron_1.ipcRenderer.invoke('excel:exportDocuments', f),
    excelExportParties: (t) => electron_1.ipcRenderer.invoke('excel:exportParties', t),
    excelExportStock: () => electron_1.ipcRenderer.invoke('excel:exportStock'),
    excelExportBalance: (f) => electron_1.ipcRenderer.invoke('excel:exportBalance', f),
    excelExportReport: (d) => electron_1.ipcRenderer.invoke('excel:exportReport', d),
    excelExportMultiple: (d) => electron_1.ipcRenderer.invoke('excel:exportMultiple', d),
    // --- Settings ---
    settingsGet: (key) => electron_1.ipcRenderer.invoke('settings:get', key),
    settingsSet: (data) => electron_1.ipcRenderer.invoke('settings:set', data),
    settingsSetMany: (data) => electron_1.ipcRenderer.invoke('settings:setMany', data),
    // --- Import ---
    importSelectFile: () => electron_1.ipcRenderer.invoke('import:selectFile'),
    importClients: (d) => electron_1.ipcRenderer.invoke('import:clients', d),
    importSuppliers: (d) => electron_1.ipcRenderer.invoke('import:suppliers', d),
    importProducts: (d) => electron_1.ipcRenderer.invoke('import:products', d),
    importDownloadTemplate: (t) => electron_1.ipcRenderer.invoke('import:downloadTemplate', t),
    // --- Attachments ---
    attachmentsAdd: (d) => electron_1.ipcRenderer.invoke('attachments:add', d),
    attachmentsList: (d) => electron_1.ipcRenderer.invoke('attachments:list', d),
    attachmentsOpen: (p) => electron_1.ipcRenderer.invoke('attachments:open', p),
    attachmentsDelete: (p) => electron_1.ipcRenderer.invoke('attachments:delete', p),
};
electron_1.contextBridge.exposeInMainWorld('api', api);
