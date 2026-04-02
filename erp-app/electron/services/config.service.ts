import { getDb } from '../database/connection'

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

export function getDeviceConfig(): DeviceConfig | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM device_config WHERE id = 1').get() as any
  if (!row) return null
  return { ...row, setup_done: row.setup_done === 1 }
}

function sanitize(v: any): any {
  if (v === undefined) return null
  if (v === true) return 1
  if (v === false) return 0
  return v
}

const ALLOWED_CONFIG_FIELDS = new Set([
  'company_name', 'company_ice', 'company_if', 'company_rc',
  'company_address', 'company_phone', 'company_logo',
  'mode', 'server_ip', 'server_port', 'currency', 'setup_done',
])

export function saveDeviceConfig(data: Partial<DeviceConfig>): void {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM device_config WHERE id = 1').get()

  if (existing) {
    const safeData = Object.fromEntries(
      Object.entries(data).filter(([k]) => ALLOWED_CONFIG_FIELDS.has(k))
    )
    if (Object.keys(safeData).length === 0) return
    const fields = Object.keys(safeData).map(k => `${k} = ?`).join(', ')
    const values = Object.values(safeData).map(sanitize)
    db.prepare(`UPDATE device_config SET ${fields} WHERE id = 1`).run(...values)
  } else {
    db.prepare(`
      INSERT INTO device_config (id, company_name, company_ice, company_if, company_rc,
        company_address, company_phone, company_logo, mode, server_ip, server_port,
        currency, setup_done)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.company_name ?? '',
      data.company_ice ?? '',
      data.company_if ?? '',
      data.company_rc ?? '',
      data.company_address ?? '',
      data.company_phone ?? '',
      data.company_logo ?? '',
      data.mode ?? 'standalone',
      data.server_ip ?? '',
      data.server_port ?? 3000,
      data.currency ?? 'MAD',
      data.setup_done ? 1 : 0
    )
  }
}
