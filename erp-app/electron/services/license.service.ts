import crypto from 'crypto'
import { machineIdSync } from 'node-machine-id'
import { getDb } from '../database/connection'

// SECRET_KEY من متغير البيئة — يجب تعيينه في الإنتاج
const SECRET_KEY = process.env.LICENSE_SECRET
if (!SECRET_KEY || SECRET_KEY === 'ERP_PRO_SECRET_2026_CHANGE_IN_PROD') {
  if (process.env.NODE_ENV === 'production') {
    console.error('[LICENSE] CRITICAL: LICENSE_SECRET environment variable is not set or uses default value!')
  }
}
const EFFECTIVE_SECRET = SECRET_KEY ?? 'ERP_PRO_SECRET_2026_CHANGE_IN_PROD'

export interface LicenseInfo {
  companyName: string
  expiryDate: string
  daysRemaining: number
  isValid: boolean
  isExpired: boolean
  isExpiringSoon: boolean // أقل من 7 أيام
}

export function generateLicenseKey(companyName: string, expiryDate: string): string {
  const payload = Buffer.from(`${companyName}|${expiryDate}`).toString('base64')
  const signature = crypto
    .createHmac('sha256', EFFECTIVE_SECRET)
    .update(payload)
    .digest('hex')
    .substring(0, 16)
    .toUpperCase()
  return `${payload}.${signature}`
}

export function verifyLicenseKey(
  companyName: string,
  licenseKey: string
): { valid: boolean; expiryDate?: string; error?: string } {
  try {
    const parts = licenseKey.split('.')
    if (parts.length !== 2) return { valid: false, error: 'Format invalide' }

    const [payload, signature] = parts

    // التحقق من الـ signature
    const expectedSig = crypto
      .createHmac('sha256', EFFECTIVE_SECRET)
      .update(payload)
      .digest('hex')
      .substring(0, 16)
      .toUpperCase()

    if (signature !== expectedSig) return { valid: false, error: 'Clé de licence invalide' }

    // فك الـ payload
    const decoded = Buffer.from(payload, 'base64').toString('utf8')
    const separatorIndex = decoded.lastIndexOf('|')
    if (separatorIndex === -1) return { valid: false, error: 'Format corrompu' }

    const encodedCompany = decoded.substring(0, separatorIndex)
    const expiryDate = decoded.substring(separatorIndex + 1)

    // التحقق من اسم الشركة (case-insensitive + trim)
    if (encodedCompany.trim().toLowerCase() !== companyName.trim().toLowerCase()) {
      return { valid: false, error: "Nom d'entreprise incorrect" }
    }

    return { valid: true, expiryDate }
  } catch {
    return { valid: false, error: 'Clé corrompue' }
  }
}

export function activateLicense(companyName: string, licenseKey: string): {
  success: boolean
  error?: string
} {
  const result = verifyLicenseKey(companyName, licenseKey)
  if (!result.valid) return { success: false, error: result.error }

  const machineId = getMachineId()
  const db = getDb()

  // حذف أي ترخيص سابق
  db.prepare('DELETE FROM license').run()

  db.prepare(`
    INSERT INTO license (company_name, license_key, expiry_date, machine_id)
    VALUES (?, ?, ?, ?)
  `).run(companyName.trim(), licenseKey, result.expiryDate!, machineId)

  return { success: true }
}

export function getLicenseInfo(): LicenseInfo | null {
  const db = getDb()
  const license = db.prepare('SELECT * FROM license WHERE is_active = 1').get() as any
  if (!license) return null

  const machineId = getMachineId()
  if (license.machine_id !== machineId) return null

  const today = new Date()
  const expiry = new Date(license.expiry_date)
  const daysRemaining = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  return {
    companyName: license.company_name,
    expiryDate: license.expiry_date,
    daysRemaining,
    isValid: daysRemaining > 0,
    isExpired: daysRemaining <= 0,
    isExpiringSoon: daysRemaining > 0 && daysRemaining <= 7,
  }
}

function getMachineId(): string {
  try {
    return machineIdSync(true)
  } catch {
    return 'unknown-machine'
  }
}
