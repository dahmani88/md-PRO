// Type declarations for window.api (Electron IPC bridge)
// لا نستورد من electron/preload مباشرة لتجنب مشاكل Vite

declare global {
  interface Window {
    api: {
      // Config & License
      getDeviceConfig: () => Promise<any>
      saveDeviceConfig: (d: unknown) => Promise<any>
      activateLicense: (d: unknown) => Promise<any>
      getLicenseInfo: () => Promise<any>

      // Auth
      login: (d: unknown) => Promise<any>
      logout: (d?: unknown) => Promise<any>
      getUsers: () => Promise<any>
      createUser: (d: unknown) => Promise<any>
      updateUser: (d: unknown) => Promise<any>
      deleteUser: (id: number) => Promise<any>

      // Clients
      getClients: (f?: unknown) => Promise<any>
      getClient: (id: number) => Promise<any>
      createClient: (d: unknown) => Promise<any>
      updateClient: (d: unknown) => Promise<any>
      deleteClient: (id: number) => Promise<any>

      // Suppliers
      getSuppliers: (f?: unknown) => Promise<any>
      getSupplier: (id: number) => Promise<any>
      createSupplier: (d: unknown) => Promise<any>
      updateSupplier: (d: unknown) => Promise<any>
      deleteSupplier: (id: number) => Promise<any>

      // Products
      getProducts: (f?: unknown) => Promise<any>
      getProduct: (id: number) => Promise<any>
      createProduct: (d: unknown) => Promise<any>
      updateProduct: (d: unknown) => Promise<any>
      deleteProduct: (id: number) => Promise<any>

      // Stock
      getStockMovements: (f?: unknown) => Promise<any>
      applyStockMovement: (id: number) => Promise<any>
      deleteStockMovement: (id: number) => Promise<any>
      createManualMovement: (d: unknown) => Promise<any>
      getProductStats: (id: number) => Promise<any>

      // Documents
      getDocuments: (f?: unknown) => Promise<any>
      getDocument: (id: number) => Promise<any>
      createDocument: (d: unknown) => Promise<any>
      updateDocument: (d: unknown) => Promise<any>
      confirmDocument: (id: number) => Promise<any>
      cancelDocument: (id: number) => Promise<any>
      convertDocument: (d: unknown) => Promise<any>
      linkDocuments: (d: unknown) => Promise<any>
      getPOReceiptStatus: (id: number) => Promise<any>
      getBLDeliveryStatus?: (id: number) => Promise<any>
      getDocumentTimeline?: (id: number) => Promise<any>
      getCancelImpact: (id: number) => Promise<any>
      cancelWithOptions: (d: unknown) => Promise<any>

      // Payments
      getPayments: (f?: unknown) => Promise<any>
      createPayment: (d: unknown) => Promise<any>
      updatePayment: (d: unknown) => Promise<any>
      getPaymentPaidAmount: (id: number) => Promise<any>

      // Production
      getProductionOrders: (f?: unknown) => Promise<any>
      createProduction: (d: unknown) => Promise<any>
      confirmProduction: (id: number, userId: number) => Promise<any>
      cancelProduction: (id: number, userId: number) => Promise<any>
      getBomTemplates: (pid: number) => Promise<any>
      getAllBoms: () => Promise<any>
      createBomTemplate: (d: unknown) => Promise<any>
      updateBomTemplate: (d: unknown) => Promise<any>
      deleteBomTemplate: (id: number) => Promise<any>
      getTransformations: (f?: unknown) => Promise<any>
      createTransformation: (d: unknown) => Promise<any>

      // Accounting
      getAccounts: (f?: unknown) => Promise<any>
      getJournalEntries: (f?: unknown) => Promise<any>
      createManualEntry: (d: unknown) => Promise<any>
      getGrandLivre: (f?: unknown) => Promise<any>
      getBalance: (f?: unknown) => Promise<any>
      getTvaDeclaration: (f?: unknown) => Promise<any>
      getPeriods: () => Promise<any>
      closePeriod: (id: number) => Promise<any>
      createAccount: (d: unknown) => Promise<any>
      getTvaRates: () => Promise<any>
      createTvaRate: (d: unknown) => Promise<any>

      // Reports
      getReport: (d: unknown) => Promise<any>

      // Backup
      createBackup: () => Promise<any>
      listBackups: () => Promise<any>
      restoreBackup: (p: string) => Promise<any>

      // Notifications
      getNotifications: () => Promise<any>
      markNotificationRead: (id: number) => Promise<any>

      // PDF & Excel
      pdfGetHtml: (id: number) => Promise<any>
      generatePdf: (d: unknown) => Promise<any>
      excelExportDocuments: (f: unknown) => Promise<any>
      excelExportParties: (t: unknown) => Promise<any>
      excelExportStock: () => Promise<any>
      excelExportBalance: (f: unknown) => Promise<any>
      excelExportReport: (d: unknown) => Promise<any>
      excelExportMultiple: (d: unknown) => Promise<any>

      // Settings
      settingsGet: (key?: unknown) => Promise<any>
      settingsSet: (d: unknown) => Promise<any>
      settingsSetMany: (d: unknown) => Promise<any>

      // Import
      importSelectFile: () => Promise<any>
      importClients: (d: unknown) => Promise<any>
      importSuppliers: (d: unknown) => Promise<any>
      importProducts: (d: unknown) => Promise<any>
      importDownloadTemplate: (t: unknown) => Promise<any>

      // Attachments
      attachmentsAdd: (d: unknown) => Promise<any>
      attachmentsList: (d: unknown) => Promise<any>
      attachmentsOpen: (p: string) => Promise<any>
      attachmentsDelete: (p: string) => Promise<any>

      // Audit
      getUserStats: (id: number) => Promise<any>
      auditGetLog: (f?: unknown) => Promise<any>
      auditGetUsers: () => Promise<any>

      // Sync & Network
      syncDeviceInfo: () => Promise<any>
      syncGetDevices: () => Promise<any>
      syncPull: () => Promise<any>
      syncPush: () => Promise<any>
      syncInitialSnapshot: () => Promise<any>
      syncTestConnection: (d?: unknown) => Promise<any>
      syncStartServer: (p?: number) => Promise<any>
      syncStopServer: () => Promise<any>
      syncGetApiKey: () => Promise<any>

      // Updates
      updateCheck: () => Promise<any>
      updateDownload: (v: string) => Promise<any>
      updateVerify: (d: unknown) => Promise<any>
      updateInstall: (p: string) => Promise<any>
      updatePublish: (d: unknown) => Promise<any>
      updateList: () => Promise<any>

      // Push events from Main process
      onSyncUpdated: (cb: (data: unknown) => void) => (() => void)
      onSyncOffline: (cb: (data: unknown) => void) => (() => void)
      onUpdateAvailable: (cb: (data: unknown) => void) => (() => void)
      onUpdateProgress: (cb: (data: unknown) => void) => (() => void)
    }
  }
}

export {}
