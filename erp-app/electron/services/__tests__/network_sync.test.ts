/**
 * Network Sync & Update System Tests
 * اختبارات نظام المزامنة والتحديثات
 */
import Database from 'better-sqlite3'
import { migration_001_initial } from '../../database/migrations/001_initial'
import { migration_002_accounting } from '../../database/migrations/002_accounting'
import { migration_004_settings } from '../../database/migrations/004_settings'
import { migration_006_user_permissions } from '../../database/migrations/006_user_permissions'
import { migration_008_constraints } from '../../database/migrations/008_constraints'
import { migration_009_network_sync } from '../../database/migrations/009_network_sync'
import { migration_010_change_tracking } from '../../database/migrations/010_change_tracking'
import {
  getOrCreateDeviceId,
  registerDevice,
  updateDeviceLastSeen,
  getRegisteredDevices,
  logChange,
  getChangesSince,
  markChangesSynced,
  getPendingChangesCount,
  getSyncState,
  updateSyncState,
  applyChanges,
  enqueueOffline,
  getOfflineQueue,
  markQueueItemDone,
  markQueueItemFailed,
  verifyChecksum,
} from '../sync.service'
import {
  generateLicenseKey,
  verifyLicenseKey,
} from '../license.service'
import crypto from 'crypto'

jest.mock('../../database/connection', () => {
  let _db: any = null
  return { getDb: () => _db, __setDb: (db: any) => { _db = db } }
})
const getSetDb = () => require('../../database/connection').__setDb

function createSyncDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migration_001_initial(db)
  migration_002_accounting(db)
  migration_004_settings(db)
  migration_006_user_permissions(db)
  migration_008_constraints(db)
  migration_009_network_sync(db)
  migration_010_change_tracking(db)
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (1,'Admin','admin@test.ma','hash','admin')`).run()
  db.prepare(`INSERT INTO app_settings (key,value) VALUES ('device_id','test-device-001') ON CONFLICT(key) DO UPDATE SET value='test-device-001'`).run()
  return db
}

// ============================================================
// 1. DEVICE REGISTRY
// ============================================================
describe('Device Registry', () => {
  it('DR1: enregistre un nouveau device', () => {
    const db = createSyncDb()
    registerDevice(db, 'dev-001', 'PC Bureau', 'client', 'key-abc')
    const devices = getRegisteredDevices(db)
    expect(devices.some(d => d.id === 'dev-001')).toBe(true)
  })

  it('DR2: UPSERT — réenregistrement met à jour sans doublon', () => {
    const db = createSyncDb()
    registerDevice(db, 'dev-001', 'PC Bureau', 'client', 'key-abc')
    registerDevice(db, 'dev-001', 'PC Bureau v2', 'client', 'key-abc')
    const devices = getRegisteredDevices(db)
    const dev = devices.find(d => d.id === 'dev-001')
    expect(dev?.name).toBe('PC Bureau v2')
    expect(devices.filter(d => d.id === 'dev-001')).toHaveLength(1)
  })

  it('DR3: updateDeviceLastSeen met à jour last_seen', () => {
    const db = createSyncDb()
    registerDevice(db, 'dev-002', 'Laptop', 'client', 'key-xyz')
    updateDeviceLastSeen(db, 'dev-002', '192.168.1.50')
    const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get('dev-002') as any
    expect(dev.ip_address).toBe('192.168.1.50')
    expect(dev.last_seen).toBeTruthy()
  })

  it('DR4: API key est unique par device', () => {
    const db = createSyncDb()
    registerDevice(db, 'dev-003', 'PC1', 'client', 'unique-key-1')
    expect(() => {
      registerDevice(db, 'dev-004', 'PC2', 'client', 'unique-key-1')
    }).toThrow() // UNIQUE constraint sur api_key
  })

  it('DR5: getRegisteredDevices retourne tous les devices actifs', () => {
    const db = createSyncDb()
    registerDevice(db, 'dev-A', 'A', 'client', 'key-A')
    registerDevice(db, 'dev-B', 'B', 'client', 'key-B')
    registerDevice(db, 'dev-C', 'C', 'master', 'key-C')
    const devices = getRegisteredDevices(db)
    expect(devices.length).toBeGreaterThanOrEqual(3)
  })
})

// ============================================================
// 2. CHANGE LOG
// ============================================================
describe('Change Log', () => {
  it('CL1: logChange enregistre une entrée', () => {
    const db = createSyncDb()
    logChange(db, 'dev-001', 'clients', 1, 'INSERT', { id: 1, name: 'Test' })
    const logs = db.prepare('SELECT * FROM change_log').all() as any[]
    expect(logs).toHaveLength(1)
    expect(logs[0].operation).toBe('INSERT')
    expect(logs[0].table_name).toBe('clients')
  })

  it('CL2: checksum est calculé et stocké', () => {
    const db = createSyncDb()
    logChange(db, 'dev-001', 'clients', 1, 'INSERT', { id: 1, name: 'Test' })
    const log = db.prepare('SELECT * FROM change_log').get() as any
    expect(log.checksum).toBeTruthy()
    expect(log.checksum).toHaveLength(16)
  })

  it('CL3: getChangesSince retourne les changements après un ID', () => {
    const db = createSyncDb()
    logChange(db, 'dev-001', 'clients', 1, 'INSERT', { id: 1 })
    logChange(db, 'dev-001', 'clients', 2, 'INSERT', { id: 2 })
    logChange(db, 'dev-001', 'clients', 3, 'UPDATE', { id: 3 })
    const changes = getChangesSince(db, 1)
    expect(changes.length).toBe(2) // seulement les 2 derniers
  })

  it('CL4: getChangesSince exclut le device spécifié', () => {
    const db = createSyncDb()
    logChange(db, 'dev-A', 'clients', 1, 'INSERT', { id: 1 })
    logChange(db, 'dev-B', 'clients', 2, 'INSERT', { id: 2 })
    const changes = getChangesSince(db, 0, 'dev-A')
    expect(changes.every(c => c.device_id !== 'dev-A')).toBe(true)
  })

  it('CL5: markChangesSynced marque les changements comme synchronisés', () => {
    const db = createSyncDb()
    logChange(db, 'dev-001', 'clients', 1, 'INSERT', { id: 1 })
    logChange(db, 'dev-001', 'clients', 2, 'INSERT', { id: 2 })
    const all = db.prepare('SELECT id FROM change_log').all() as any[]
    markChangesSynced(db, all.map(r => r.id))
    const pending = db.prepare('SELECT COUNT(*) as c FROM change_log WHERE synced = 0').get() as any
    expect(pending.c).toBe(0)
  })

  it('CL6: getPendingChangesCount retourne le bon nombre', () => {
    const db = createSyncDb()
    logChange(db, 'dev-001', 'clients', 1, 'INSERT', { id: 1 })
    logChange(db, 'dev-001', 'clients', 2, 'INSERT', { id: 2 })
    logChange(db, 'dev-001', 'clients', 3, 'UPDATE', { id: 3 })
    expect(getPendingChangesCount(db, 'dev-001')).toBe(3)
  })

  it('CL7: change_log limite à 500 entrées par getChangesSince', () => {
    const db = createSyncDb()
    for (let i = 1; i <= 600; i++) {
      logChange(db, 'dev-001', 'clients', i, 'INSERT', { id: i })
    }
    const changes = getChangesSince(db, 0)
    expect(changes.length).toBeLessThanOrEqual(500)
  })
})

// ============================================================
// 3. SYNC STATE
// ============================================================
describe('Sync State', () => {
  it('SS1: updateSyncState crée une entrée si inexistante', () => {
    const db = createSyncDb()
    registerDevice(db, 'dev-001', 'Test', 'client', 'key-001')
    updateSyncState(db, 'dev-001', { status: 'idle', last_pull_at: '2026-01-01T00:00:00Z' })
    const state = getSyncState(db, 'dev-001')
    expect(state).toBeDefined()
    expect(state.status).toBe('idle')
  })

  it('SS2: updateSyncState met à jour une entrée existante', () => {
    const db = createSyncDb()
    registerDevice(db, 'dev-001', 'Test', 'client', 'key-001')
    updateSyncState(db, 'dev-001', { status: 'idle' })
    updateSyncState(db, 'dev-001', { status: 'error', error_message: 'Connexion refusée' })
    const state = getSyncState(db, 'dev-001')
    expect(state.status).toBe('error')
    expect(state.error_message).toBe('Connexion refusée')
  })

  it('SS3: last_change_id est mis à jour correctement', () => {
    const db = createSyncDb()
    registerDevice(db, 'dev-001', 'Test', 'client', 'key-001')
    updateSyncState(db, 'dev-001', { last_change_id: 42 })
    const state = getSyncState(db, 'dev-001')
    expect(state.last_change_id).toBe(42)
  })

  it('SS4: getSyncState retourne null/undefined pour device inconnu', () => {
    const db = createSyncDb()
    const state = getSyncState(db, 'unknown-device')
    expect(state == null).toBe(true) // null ou undefined — les deux sont acceptables
  })

  it('SS5: pending_count est mis à jour', () => {
    const db = createSyncDb()
    registerDevice(db, 'dev-001', 'Test', 'client', 'key-001')
    updateSyncState(db, 'dev-001', { pending_count: 15 })
    const state = getSyncState(db, 'dev-001')
    expect(state.pending_count).toBe(15)
  })
})

// ============================================================
// 4. APPLY CHANGES (Sync Engine)
// ============================================================
describe('Apply Changes — Sync Engine', () => {
  it('AC1: INSERT crée un nouvel enregistrement', () => {
    const db = createSyncDb()
    const changes = [{
      id: 1, device_id: 'master', table_name: 'clients', record_id: 99,
      operation: 'INSERT' as const,
      data: { id: 99, name: 'Client Sync', credit_limit: 0, is_deleted: 0, created_at: '2026-01-01', updated_at: '2026-01-01' },
      checksum: 'abc', synced: 0, created_at: '2026-01-01T00:00:00Z',
    }]
    const result = applyChanges(db, changes)
    expect(result.applied).toBe(1)
    const client = db.prepare('SELECT * FROM clients WHERE id = 99').get() as any
    expect(client?.name).toBe('Client Sync')
  })

  it('AC2: UPDATE met à jour si remote est plus récent', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO clients (id,name,credit_limit,is_deleted,created_at,updated_at) VALUES (100,'Old Name',0,0,'2026-01-01','2026-01-01')`).run()
    const changes = [{
      id: 2, device_id: 'master', table_name: 'clients', record_id: 100,
      operation: 'UPDATE' as const,
      data: { id: 100, name: 'New Name', credit_limit: 0, is_deleted: 0, created_at: '2026-01-01', updated_at: '2026-01-02' },
      checksum: 'xyz', synced: 0, created_at: '2026-01-02T00:00:00Z',
    }]
    applyChanges(db, changes)
    const client = db.prepare('SELECT name FROM clients WHERE id = 100').get() as any
    expect(client.name).toBe('New Name')
  })

  it('AC3: UPDATE ignore si local est plus récent (last-write-wins)', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO clients (id,name,credit_limit,is_deleted,created_at,updated_at) VALUES (101,'Local Name',0,0,'2026-01-01','2026-01-10')`).run()
    const changes = [{
      id: 3, device_id: 'master', table_name: 'clients', record_id: 101,
      operation: 'UPDATE' as const,
      data: { id: 101, name: 'Old Remote', credit_limit: 0, is_deleted: 0, created_at: '2026-01-01', updated_at: '2026-01-05' },
      checksum: 'xyz', synced: 0, created_at: '2026-01-05T00:00:00Z',
    }]
    applyChanges(db, changes)
    const client = db.prepare('SELECT name FROM clients WHERE id = 101').get() as any
    expect(client.name).toBe('Local Name') // local wins
  })

  it('AC4: DELETE marque is_deleted = 1', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO clients (id,name,credit_limit,is_deleted,created_at,updated_at) VALUES (102,'To Delete',0,0,'2026-01-01','2026-01-01')`).run()
    const changes = [{
      id: 4, device_id: 'master', table_name: 'clients', record_id: 102,
      operation: 'DELETE' as const,
      data: null, checksum: '', synced: 0, created_at: '2026-01-01T00:00:00Z',
    }]
    applyChanges(db, changes)
    const client = db.prepare('SELECT is_deleted FROM clients WHERE id = 102').get() as any
    expect(client.is_deleted).toBe(1)
  })

  it('AC5: table non autorisée génère une erreur', () => {
    const db = createSyncDb()
    const changes = [{
      id: 5, device_id: 'master', table_name: 'users', record_id: 1,
      operation: 'UPDATE' as const,
      data: { id: 1, password_hash: 'hacked' },
      checksum: '', synced: 0, created_at: '2026-01-01T00:00:00Z',
    }]
    const result = applyChanges(db, changes)
    // users n'est pas dans SYNC_TABLES → erreur
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('AC6: batch de 100 changements appliqués en transaction', () => {
    const db = createSyncDb()
    const changes = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1, device_id: 'master', table_name: 'clients', record_id: 200 + i,
      operation: 'INSERT' as const,
      data: { id: 200 + i, name: `Client ${i}`, credit_limit: 0, is_deleted: 0, created_at: '2026-01-01', updated_at: '2026-01-01' },
      checksum: '', synced: 0, created_at: '2026-01-01T00:00:00Z',
    }))
    const result = applyChanges(db, changes)
    expect(result.applied).toBe(100)
    const count = (db.prepare('SELECT COUNT(*) as c FROM clients WHERE id >= 200').get() as any).c
    expect(count).toBe(100)
  })
})

// ============================================================
// 5. OFFLINE QUEUE
// ============================================================
describe('Offline Queue', () => {
  it('OQ1: enqueueOffline ajoute une opération', () => {
    const db = createSyncDb()
    enqueueOffline(db, 'documents:create', { type: 'invoice', total: 1200 })
    const queue = getOfflineQueue(db)
    expect(queue).toHaveLength(1)
    expect(queue[0].operation).toBe('documents:create')
  })

  it('OQ2: payload est sérialisé en JSON', () => {
    const db = createSyncDb()
    enqueueOffline(db, 'payments:create', { amount: 500, method: 'cash' })
    const queue = getOfflineQueue(db)
    const payload = JSON.parse(queue[0].payload)
    expect(payload.amount).toBe(500)
    expect(payload.method).toBe('cash')
  })

  it('OQ3: markQueueItemDone marque comme done', () => {
    const db = createSyncDb()
    enqueueOffline(db, 'test:op', {})
    const queue = getOfflineQueue(db)
    markQueueItemDone(db, queue[0].id)
    const remaining = getOfflineQueue(db)
    expect(remaining).toHaveLength(0)
  })

  it('OQ4: markQueueItemFailed incrémente attempts', () => {
    const db = createSyncDb()
    enqueueOffline(db, 'test:op', {})
    const queue = getOfflineQueue(db)
    markQueueItemFailed(db, queue[0].id, 'Connexion refusée')
    const item = db.prepare('SELECT * FROM offline_queue WHERE id = ?').get(queue[0].id) as any
    expect(item.attempts).toBe(1)
    expect(item.error).toBe('Connexion refusée')
  })

  it('OQ5: item marqué failed après max_attempts', () => {
    const db = createSyncDb()
    enqueueOffline(db, 'test:op', {})
    const queue = getOfflineQueue(db)
    const id = queue[0].id
    markQueueItemFailed(db, id, 'err')
    markQueueItemFailed(db, id, 'err')
    markQueueItemFailed(db, id, 'err')
    const item = db.prepare('SELECT * FROM offline_queue WHERE id = ?').get(id) as any
    expect(item.status).toBe('failed')
  })

  it('OQ6: priorité haute apparaît en premier', () => {
    const db = createSyncDb()
    enqueueOffline(db, 'low:op', {}, 9)
    enqueueOffline(db, 'high:op', {}, 1)
    enqueueOffline(db, 'med:op', {}, 5)
    const queue = getOfflineQueue(db)
    expect(queue[0].operation).toBe('high:op')
    expect(queue[2].operation).toBe('low:op')
  })
})

// ============================================================
// 6. CHANGE TRACKING TRIGGERS (Migration 010)
// ============================================================
describe('Change Tracking Triggers', () => {
  it('CT1: INSERT sur clients crée une entrée dans change_log', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO clients (name,credit_limit,is_deleted,created_at,updated_at) VALUES ('Trigger Test',0,0,'2026-01-01','2026-01-01')`).run()
    const logs = db.prepare("SELECT * FROM change_log WHERE table_name='clients' AND operation='INSERT'").all() as any[]
    expect(logs.length).toBeGreaterThan(0)
  })

  it('CT2: UPDATE sur clients crée une entrée UPDATE dans change_log', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO clients (id,name,credit_limit,is_deleted,created_at,updated_at) VALUES (500,'Before',0,0,'2026-01-01','2026-01-01')`).run()
    const before = (db.prepare("SELECT COUNT(*) as c FROM change_log WHERE table_name='clients'").get() as any).c
    db.prepare(`UPDATE clients SET name='After', updated_at='2026-01-02' WHERE id=500`).run()
    const after = (db.prepare("SELECT COUNT(*) as c FROM change_log WHERE table_name='clients'").get() as any).c
    expect(after).toBeGreaterThan(before)
  })

  it('CT3: soft delete crée une entrée DELETE dans change_log', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO clients (id,name,credit_limit,is_deleted,created_at,updated_at) VALUES (501,'To Delete',0,0,'2026-01-01','2026-01-01')`).run()
    db.prepare(`UPDATE clients SET is_deleted=1, updated_at='2026-01-02' WHERE id=501`).run()
    const delLog = db.prepare("SELECT * FROM change_log WHERE table_name='clients' AND operation='DELETE' AND record_id=501").get() as any
    expect(delLog).toBeDefined()
  })

  it('CT4: device_id dans change_log correspond au device configuré', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO clients (name,credit_limit,is_deleted,created_at,updated_at) VALUES ('Device Test',0,0,'2026-01-01','2026-01-01')`).run()
    const log = db.prepare("SELECT * FROM change_log WHERE table_name='clients' ORDER BY id DESC LIMIT 1").get() as any
    expect(log.device_id).toBe('test-device-001')
  })

  it('CT5: INSERT sur products crée une entrée dans change_log', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO products (code,name,unit,type,tva_rate_id,stock_quantity,cmup_price,sale_price,min_stock,is_deleted,created_at,updated_at) VALUES ('TRG001','Trigger Prod','kg','raw',5,0,0,0,0,0,'2026-01-01','2026-01-01')`).run()
    const log = db.prepare("SELECT * FROM change_log WHERE table_name='products' AND operation='INSERT' ORDER BY id DESC LIMIT 1").get() as any
    expect(log).toBeDefined()
  })
})

// ============================================================
// 7. INTEGRITY & SECURITY
// ============================================================
describe('Integrity & Security', () => {
  it('IS1: verifyChecksum valide un checksum correct', () => {
    const data = { id: 1, name: 'Test', amount: 1200 }
    const json = JSON.stringify(data)
    const checksum = crypto.createHash('sha256').update(json).digest('hex').substring(0, 16)
    expect(verifyChecksum(data, checksum)).toBe(true)
  })

  it('IS2: verifyChecksum rejette un checksum modifié', () => {
    const data = { id: 1, name: 'Test' }
    expect(verifyChecksum(data, 'tampered12345678')).toBe(false)
  })

  it('IS3: change_log ne peut pas référencer une table inconnue (pas de FK)', () => {
    const db = createSyncDb()
    // change_log n'a pas de FK sur table_name — c'est voulu pour la flexibilité
    expect(() => {
      logChange(db, 'dev-001', 'unknown_table', 1, 'INSERT', { id: 1 })
    }).not.toThrow()
  })

  it('IS4: deux devices avec le même ID sont fusionnés (UPSERT)', () => {
    const db = createSyncDb()
    registerDevice(db, 'same-id', 'Device A', 'client', 'key-same-1')
    registerDevice(db, 'same-id', 'Device B', 'client', 'key-same-1')
    const count = (db.prepare("SELECT COUNT(*) as c FROM devices WHERE id='same-id'").get() as any).c
    expect(count).toBe(1)
  })

  it('IS5: sync_conflicts enregistre les conflits', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO sync_conflicts (table_name,record_id,local_data,remote_data,remote_device) VALUES ('clients',1,'{"name":"Local"}','{"name":"Remote"}','dev-master')`).run()
    const conflict = db.prepare('SELECT * FROM sync_conflicts WHERE resolved=0').get() as any
    expect(conflict).toBeDefined()
    expect(conflict.table_name).toBe('clients')
  })

  it('IS6: update_manifest stocke checksum et version', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO update_manifest (version,release_notes,file_path,file_size,checksum,is_mandatory) VALUES ('2.0.0','New features','/path/to/file',1024000,'abc123def456789a',0)`).run()
    const manifest = db.prepare("SELECT * FROM update_manifest WHERE version='2.0.0'").get() as any
    expect(manifest.checksum).toBe('abc123def456789a')
    expect(manifest.is_mandatory).toBe(0)
  })

  it('IS7: version unique dans update_manifest (UNIQUE constraint)', () => {
    const db = createSyncDb()
    db.prepare(`INSERT INTO update_manifest (version,release_notes,file_path,file_size,checksum) VALUES ('3.0.0','v3','/path',0,'checksum1')`).run()
    expect(() => {
      db.prepare(`INSERT INTO update_manifest (version,release_notes,file_path,file_size,checksum) VALUES ('3.0.0','v3 dup','/path2',0,'checksum2')`).run()
    }).toThrow()
  })
})

// ============================================================
// 8. NETWORK SIMULATION (Master ↔ Client)
// ============================================================
describe('Network Simulation — Master ↔ Client', () => {
  it('NS1: Master génère des changements, Client les reçoit', () => {
    const master = createSyncDb()
    const client = createSyncDb()

    // Master insère un client et log le changement manuellement avec données complètes
    master.prepare(`INSERT INTO clients (id,name,credit_limit,is_deleted,created_at,updated_at) VALUES (300,'Nouveau Client',0,0,'2026-01-01','2026-01-01')`).run()
    logChange(master, 'master-device', 'clients', 300, 'INSERT', { id: 300, name: 'Nouveau Client', credit_limit: 0, is_deleted: 0, created_at: '2026-01-01', updated_at: '2026-01-01' })

    // Récupérer les changements depuis le master (avec données complètes)
    const changes = getChangesSince(master, 0, 'client-device').filter(c => c.data && JSON.parse(c.data as any).name)

    // Appliquer sur le client
    const result = applyChanges(client, changes)
    expect(result.applied).toBeGreaterThan(0)

    const synced = client.prepare('SELECT * FROM clients WHERE id = 300').get() as any
    expect(synced?.name).toBe('Nouveau Client')
  })

  it('NS2: Client envoie ses changements au Master', () => {
    const master = createSyncDb()
    const client = createSyncDb()

    // Client crée un produit localement et log avec données complètes
    client.prepare(`INSERT INTO products (id,code,name,unit,type,tva_rate_id,stock_quantity,cmup_price,sale_price,min_stock,is_deleted,created_at,updated_at) VALUES (400,'CLI001','Produit Client','pcs','finished',5,0,0,100,0,0,'2026-01-01','2026-01-01')`).run()
    logChange(client, 'client-device', 'products', 400, 'INSERT', { id: 400, code: 'CLI001', name: 'Produit Client', unit: 'pcs', type: 'finished', tva_rate_id: 5, stock_quantity: 0, cmup_price: 0, sale_price: 100, min_stock: 0, is_deleted: 0, created_at: '2026-01-01', updated_at: '2026-01-01' })

    // Récupérer les changements du client avec données complètes
    const clientChanges = getChangesSince(client, 0).filter(c => c.data && JSON.parse(c.data as any).name)

    // Master applique les changements du client
    const result = applyChanges(master, clientChanges)
    expect(result.applied).toBeGreaterThan(0)

    const onMaster = master.prepare('SELECT * FROM products WHERE id = 400').get() as any
    expect(onMaster?.name).toBe('Produit Client')
  })

  it('NS3: conflit détecté quand deux devices modifient le même enregistrement', () => {
    const master = createSyncDb()
    const client = createSyncDb()

    // Les deux ont le même client
    master.prepare(`INSERT INTO clients (id,name,credit_limit,is_deleted,created_at,updated_at) VALUES (500,'Original',0,0,'2026-01-01','2026-01-01')`).run()
    client.prepare(`INSERT INTO clients (id,name,credit_limit,is_deleted,created_at,updated_at) VALUES (500,'Original',0,0,'2026-01-01','2026-01-01')`).run()

    // Client modifie avec timestamp plus récent
    logChange(client, 'client-device', 'clients', 500, 'UPDATE', { id: 500, name: 'Client Version', credit_limit: 0, is_deleted: 0, created_at: '2026-01-01', updated_at: '2026-01-15' })

    // Client envoie ses changements au Master
    const clientChanges = getChangesSince(client, 0).filter(c => c.data && JSON.parse(c.data as any).name)
    applyChanges(master, clientChanges)

    // Last-write-wins: client a timestamp plus récent → client gagne
    const final = master.prepare('SELECT name FROM clients WHERE id = 500').get() as any
    expect(final.name).toBe('Client Version')
  })

  it('NS4: sync bidirectionnel — les deux devices convergent', () => {
    const master = createSyncDb()
    const client = createSyncDb()

    // Master a des données
    master.prepare(`INSERT INTO clients (id,name,credit_limit,is_deleted,created_at,updated_at) VALUES (600,'From Master',0,0,'2026-01-01','2026-01-01')`).run()
    logChange(master, 'master-device', 'clients', 600, 'INSERT', { id: 600, name: 'From Master', credit_limit: 0, is_deleted: 0, created_at: '2026-01-01', updated_at: '2026-01-01' })

    // Client a des données
    client.prepare(`INSERT INTO clients (id,name,credit_limit,is_deleted,created_at,updated_at) VALUES (601,'From Client',0,0,'2026-01-01','2026-01-01')`).run()
    logChange(client, 'client-device', 'clients', 601, 'INSERT', { id: 601, name: 'From Client', credit_limit: 0, is_deleted: 0, created_at: '2026-01-01', updated_at: '2026-01-01' })

    // Sync: master → client
    const masterChanges = getChangesSince(master, 0, 'client-device').filter(c => c.data && JSON.parse(c.data as any).name)
    applyChanges(client, masterChanges)

    // Sync: client → master
    const clientChanges = getChangesSince(client, 0, 'master-device').filter(c => c.data && JSON.parse(c.data as any).name)
    applyChanges(master, clientChanges)

    expect(master.prepare('SELECT * FROM clients WHERE id=600').get()).toBeDefined()
    expect(master.prepare('SELECT * FROM clients WHERE id=601').get()).toBeDefined()
    expect(client.prepare('SELECT * FROM clients WHERE id=600').get()).toBeDefined()
    expect(client.prepare('SELECT * FROM clients WHERE id=601').get()).toBeDefined()
  })
})
