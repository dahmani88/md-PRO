// ==========================================
// CORE TYPES
// ==========================================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface PaginatedResponse<T> {
  rows: T[]
  total: number
  page: number
  limit: number
}

// ==========================================
// USER
// ==========================================
export interface User {
  id: number
  name: string
  email: string
  role: 'admin' | 'accountant' | 'sales' | 'warehouse'
  is_active: boolean
  last_login?: string
  created_at: string
  permissions?: string[]
}

// ==========================================
// CLIENT / SUPPLIER
// ==========================================
export interface Client {
  id: number
  name: string
  address?: string
  email?: string
  phone?: string
  ice?: string
  if_number?: string
  rc?: string
  credit_limit: number
  notes?: string
  balance?: number
  created_at: string
}

export interface Supplier {
  id: number
  name: string
  address?: string
  email?: string
  phone?: string
  ice?: string
  if_number?: string
  rc?: string
  notes?: string
  created_at: string
}

// ==========================================
// PRODUCT
// ==========================================
export type ProductType = 'raw' | 'finished' | 'semi_finished'

export interface Product {
  id: number
  code: string
  name: string
  unit: string
  type: ProductType
  min_stock: number
  sale_price: number
  tva_rate_id: number
  tva_rate_value?: number
  cmup_price: number
  stock_quantity: number
  supplier_id?: number
  notes?: string
  is_deleted: boolean
}

// ==========================================
// STOCK
// ==========================================
export interface StockMovement {
  id: number
  product_id: number
  product_name?: string
  product_code?: string
  unit?: string
  type: 'in' | 'out'
  quantity: number
  unit_cost: number
  cmup_before: number
  cmup_after: number
  applied: boolean
  applied_at?: string
  applied_by?: number
  document_id?: number
  document_number?: string
  document_type?: string
  production_id?: number
  transformation_id?: number
  manual_ref?: string
  date: string
  notes?: string
  created_at: string
}

// ==========================================
// DOCUMENT
// ==========================================
export type DocumentType =
  | 'invoice' | 'quote' | 'bl' | 'proforma' | 'avoir'
  | 'purchase_order' | 'bl_reception' | 'purchase_invoice' | 'import_invoice'

export type DocumentStatus =
  | 'draft' | 'confirmed' | 'paid' | 'partial' | 'cancelled' | 'delivered'

export interface DocumentLine {
  id?: number
  product_id?: number
  product_name?: string
  product_code?: string
  unit?: string
  description?: string
  quantity: number
  unit_price: number
  discount: number
  tva_rate: number
  total_ht: number
  total_tva: number
  total_ttc: number
}

export interface Document {
  id: number
  type: DocumentType
  number: string
  date: string
  party_id?: number
  party_type?: 'client' | 'supplier'
  party_name?: string
  status: DocumentStatus
  total_ht: number
  total_tva: number
  total_ttc: number
  notes?: string
  lines?: DocumentLine[]
  links?: DocumentLink[]
  pendingMovements?: StockMovement[]
  created_at: string
  updated_at: string
}

export interface DocumentLink {
  id: number
  parent_id: number
  child_id: number
  link_type: string
  related_number?: string
  related_type?: string
  related_status?: string
}

// ==========================================
// PAYMENT
// ==========================================
export type PaymentMethod = 'cash' | 'bank' | 'cheque' | 'lcn'
export type PaymentStatus = 'pending' | 'collected' | 'rejected'

export interface Payment {
  id: number
  party_id: number
  party_type: 'client' | 'supplier'
  amount: number
  method: PaymentMethod
  date: string
  due_date?: string
  cheque_number?: string
  bank?: string
  status: PaymentStatus
  document_id?: number
  notes?: string
  created_at: string
}

// ==========================================
// ACCOUNTING
// ==========================================
export interface Account {
  id: number
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  class: number
  parent_id?: number
  is_active: boolean
  is_system: boolean
}

export interface JournalEntry {
  id: number
  date: string
  reference?: string
  description: string
  is_auto: boolean
  source_type?: string
  source_id?: number
  created_by?: number
  created_by_name?: string
  lines?: JournalLine[]
  created_at: string
}

export interface JournalLine {
  id: number
  entry_id: number
  account_id: number
  account_code?: string
  account_name?: string
  debit: number
  credit: number
  notes?: string
}

// ==========================================
// LICENSE
// ==========================================
export interface LicenseInfo {
  companyName: string
  expiryDate: string
  daysRemaining: number
  isValid: boolean
  isExpired: boolean
  isExpiringSoon: boolean
}

// ==========================================
// CONFIG
// ==========================================
export interface DeviceConfig {
  id: number
  company_name: string
  company_ice: string
  company_if: string
  company_rc: string
  company_address: string
  company_phone: string
  company_logo: string
  mode: 'standalone' | 'master' | 'client'
  server_ip: string
  server_port: number
  currency: string
  setup_done: boolean
}
