import type { User } from '../types'

// صلاحيات افتراضية حسب الدور — fallback إذا لم تكن permissions مخصصة
const ROLE_DEFAULTS: Record<string, string[]> = {
  admin:      ['rapports', 'documents', 'paiements', 'parties', 'stock', 'achats', 'production', 'comptabilite', 'parametres'],
  accountant: ['rapports', 'documents', 'paiements', 'parties', 'comptabilite'],
  sales:      ['rapports', 'documents', 'paiements', 'parties', 'stock'],
  warehouse:  ['stock', 'achats', 'production'],
}

export function canAccess(user: User | null, page: string): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  // استخدام الصلاحيات المخصصة إذا وجدت وغير فارغة
  const perms = (user as any).permissions
  if (Array.isArray(perms) && perms.length > 0) {
    return perms.includes(page)
  }
  // fallback للأدوار الثابتة
  return ROLE_DEFAULTS[user.role]?.includes(page) ?? false
}

export function getAccessiblePages(user: User | null): string[] {
  if (!user) return []
  if (user.role === 'admin') return ROLE_DEFAULTS.admin
  const perms = (user as any).permissions
  if (Array.isArray(perms) && perms.length > 0) return perms
  return ROLE_DEFAULTS[user.role] ?? []
}
