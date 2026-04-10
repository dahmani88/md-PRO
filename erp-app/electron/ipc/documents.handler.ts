import { handle } from './index'
import { getDb } from '../database/connection'
import { createDocument, confirmDocument } from '../services/document.service'
import { logAudit } from '../services/audit.service'

export function registerDocumentHandlers(): void {
  handle('documents:getAll', (filters?: {
    type?: string; status?: string; party_id?: number;
    search?: string; page?: number; limit?: number
  }) => {
    const db = getDb()
    const page  = filters?.page  ?? 1
    const limit = filters?.limit ?? 50
    const offset = (page - 1) * limit
    const params: any[] = []

    let query = `
      SELECT d.*,
        CASE d.party_type
          WHEN 'client'   THEN c.name
          WHEN 'supplier' THEN s.name
        END as party_name,
        (SELECT COUNT(*) FROM stock_movements sm WHERE sm.document_id = d.id AND sm.applied = 0) as pending_stock_count,
        di.due_date,
        di.payment_status
      FROM documents d
      LEFT JOIN clients   c ON c.id = d.party_id AND d.party_type = 'client'
      LEFT JOIN suppliers s ON s.id = d.party_id AND d.party_type = 'supplier'
      LEFT JOIN doc_invoices di ON di.document_id = d.id
      WHERE d.is_deleted = 0
    `

    if (filters?.type) { query += ' AND d.type = ?'; params.push(filters.type) }
    if (filters?.status) { query += ' AND d.status = ?'; params.push(filters.status) }
    if (filters?.party_id) { query += ' AND d.party_id = ?'; params.push(filters.party_id) }
    if (filters?.search) {
      query += ' AND (d.number LIKE ? OR c.name LIKE ? OR s.name LIKE ?)'
      const s = `%${filters.search}%`
      params.push(s, s, s)
    }

    query += ' ORDER BY d.date DESC, d.id DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(query).all(...params)
    // COUNT مع نفس الفلاتر
    let countQuery = `SELECT COUNT(*) as c FROM documents d WHERE d.is_deleted = 0`
    const countParams: any[] = []
    if (filters?.type)    { countQuery += ' AND d.type = ?';    countParams.push(filters.type) }
    if (filters?.status)  { countQuery += ' AND d.status = ?';  countParams.push(filters.status) }
    if (filters?.party_id){ countQuery += ' AND d.party_id = ?';countParams.push(filters.party_id) }
    const total = (db.prepare(countQuery).get(...countParams) as any).c
    return { rows, total, page, limit }
  })

  handle('documents:getOne', (id: number) => {
    const db = getDb()
    const doc = db.prepare(`
      SELECT d.*,
        CASE d.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name,
        di.due_date,
        di.payment_status,
        di.payment_method,
        di.currency,
        di.exchange_rate,
        imp.currency        as imp_currency,
        imp.exchange_rate   as imp_exchange_rate,
        imp.invoice_amount,
        imp.customs,
        imp.transitaire,
        imp.tva_import,
        imp.other_costs,
        imp.total_cost
      FROM documents d
      LEFT JOIN clients   c   ON c.id = d.party_id AND d.party_type = 'client'
      LEFT JOIN suppliers s   ON s.id = d.party_id AND d.party_type = 'supplier'
      LEFT JOIN doc_invoices di ON di.document_id = d.id
      LEFT JOIN doc_import_invoices imp ON imp.document_id = d.id
      WHERE d.id = ? AND d.is_deleted = 0
    `).get(id) as any
    if (!doc) throw new Error('Document introuvable')

    // Normalize import invoice extra fields
    if (doc.type === 'import_invoice') {
      doc.currency       = doc.imp_currency       ?? doc.currency       ?? 'EUR'
      doc.exchange_rate  = doc.imp_exchange_rate  ?? doc.exchange_rate  ?? 1
    }
    delete doc.imp_currency
    delete doc.imp_exchange_rate

    const lines = db.prepare(`
      SELECT dl.*, p.name as product_name, p.code as product_code, p.unit
      FROM document_lines dl
      LEFT JOIN products p ON p.id = dl.product_id
      WHERE dl.document_id = ?
    `).all(id)

    const links = db.prepare(`
      SELECT dl.*, d.number as related_number, d.type as related_type, d.status as related_status
      FROM document_links dl
      JOIN documents d ON d.id = CASE WHEN dl.parent_id = ? THEN dl.child_id ELSE dl.parent_id END
      WHERE dl.parent_id = ? OR dl.child_id = ?
    `).all(id, id, id)

    const pendingMovements = db.prepare(`
      SELECT sm.*, p.name as product_name, p.unit, p.stock_quantity
      FROM stock_movements sm JOIN products p ON p.id = sm.product_id
      WHERE sm.document_id = ? AND sm.applied = 0
    `).all(id)

    return { ...doc, lines, links, pendingMovements }
  })

  handle('documents:create', (data) => {
    const result = createDocument(data)
    const db = getDb()
    logAudit(db, { user_id: data.created_by ?? 1, action: 'CREATE', table_name: 'documents', record_id: result.id, new_values: { type: data.type, number: result.number } })
    return result
  })

  handle('documents:confirm', (data: number | { id: number; userId?: number }) => {
    const id     = typeof data === 'number' ? data : data.id
    const userId = typeof data === 'number' ? 1    : (data.userId ?? 1)
    confirmDocument(id, userId)
    const db = getDb()
    logAudit(db, { user_id: userId, action: 'CONFIRM', table_name: 'documents', record_id: id })

    // Si c'est un BR, vérifier si le BC parent est entièrement reçu
    const confirmed = db.prepare('SELECT type FROM documents WHERE id = ?').get(id) as any
    if (confirmed?.type === 'bl_reception') {
      const poLink = db.prepare(`
        SELECT parent_id FROM document_links WHERE child_id = ? AND link_type LIKE '%reception%'
      `).get(id) as any
      if (poLink) {
        const poId = poLink.parent_id
        const poLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(poId) as any[]
        const brIds = (db.prepare(`
          SELECT dl.child_id as id FROM document_links dl
          JOIN documents d ON d.id = dl.child_id
          WHERE dl.parent_id = ? AND d.type = 'bl_reception' AND d.status != 'cancelled'
        `).all(poId) as any[]).map((r: any) => r.id)

        const received: Record<string, number> = {}
        for (const brId of brIds) {
          const brLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(brId) as any[]
          for (const l of brLines) {
            const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
            received[key] = (received[key] ?? 0) + Number(l.quantity)
          }
        }
        const fullyReceived = poLines.every((l: any) => {
          const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
          return (received[key] ?? 0) >= Number(l.quantity)
        })
        if (fullyReceived) {
          db.prepare(`UPDATE documents SET status = 'received', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('confirmed','partial')`).run(poId)
        } else if (brIds.length > 0) {
          db.prepare(`UPDATE documents SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed'`).run(poId)
        }
      }
    }

    return { success: true }
  })

  handle('documents:cancel', (id: number) => {
    const db = getDb()
    const doc = db.prepare('SELECT status, type FROM documents WHERE id = ?').get(id) as any
    if (!doc) throw new Error('Document introuvable')
    if (doc.status === 'cancelled') throw new Error('Document déjà annulé')
    if (doc.status === 'paid') throw new Error('Impossible d\'annuler un document payé')

    // Bloquer si mouvements de stock déjà appliqués
    const appliedMov = db.prepare(`SELECT COUNT(*) as c FROM stock_movements WHERE document_id = ? AND applied = 1`).get(id) as any
    if (appliedMov?.c > 0)
      throw new Error('Ce document a des mouvements de stock appliqués. Créez un document de retour pour annuler son effet.')

    // Bloquer si paiements liés confirmés
    const linkedPay = db.prepare(`SELECT COUNT(*) as c FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.document_id = ? AND p.status = 'cleared'`).get(id) as any
    if (linkedPay?.c > 0)
      throw new Error('Ce document a des paiements enregistrés. Créez un avoir pour annuler son effet.')

    // Annuler les mouvements de stock en attente liés à ce document
    db.prepare(`UPDATE stock_movements SET applied = -1 WHERE document_id = ? AND applied = 0`).run(id)

    db.prepare(`UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
    logAudit(db, { user_id: 1, action: 'CANCEL', table_name: 'documents', record_id: id, old_values: { status: doc?.status } })

    // Si c'est un BR, recalculer la statut du BC parent
    if (doc.type === 'bl_reception') {
      const poLink = db.prepare(`SELECT parent_id FROM document_links WHERE child_id = ? AND link_type LIKE '%reception%'`).get(id) as any
      if (poLink) {
        const poId = poLink.parent_id
        const poDoc = db.prepare(`SELECT status FROM documents WHERE id = ?`).get(poId) as any
        if (poDoc && poDoc.status !== 'cancelled') {
          const poLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(poId) as any[]
          const brIds = (db.prepare(`
            SELECT dl.child_id as id FROM document_links dl
            JOIN documents d ON d.id = dl.child_id
            WHERE dl.parent_id = ? AND d.type = 'bl_reception' AND d.status != 'cancelled'
          `).all(poId) as any[]).map((r: any) => r.id)

          if (brIds.length === 0) {
            db.prepare(`UPDATE documents SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(poId)
          } else {
            const received: Record<string, number> = {}
            for (const brId of brIds) {
              const brLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(brId) as any[]
              for (const l of brLines) {
                const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
                received[key] = (received[key] ?? 0) + Number(l.quantity)
              }
            }
            const fullyReceived = poLines.every((l: any) => {
              const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
              return (received[key] ?? 0) >= Number(l.quantity)
            })
            db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
              fullyReceived ? 'received' : 'partial', poId
            )
          }
        }
      }
    }
    return { success: true }
  })


  // ── Analyse l'impact d'une annulation ───────────────────────────────────
  handle('documents:getCancelImpact', (id: number) => {
    const db = getDb()
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any
    if (!doc) throw new Error('Document introuvable')

    const impacts: { type: string; description: string; reversible: boolean; key: string }[] = []

    // 1. Mouvements de stock appliqués
    const appliedMovements = db.prepare(`
      SELECT sm.*, p.name as product_name, p.unit
      FROM stock_movements sm JOIN products p ON p.id = sm.product_id
      WHERE sm.document_id = ? AND sm.applied = 1
    `).all(id) as any[]
    if (appliedMovements.length > 0) {
      const details = appliedMovements.map((m: any) =>
        `${m.type === 'in' ? '+' : '-'}${m.quantity} ${m.unit} ${m.product_name}`
      ).join(', ')
      impacts.push({
        type: 'stock',
        description: `Mouvements de stock appliqués: ${details}`,
        reversible: true,
        key: 'reverse_stock',
      })
    }

    // 2. Écriture comptable
    try {
      const accounting = db.prepare(`SELECT id FROM accounting_entries WHERE document_id = ?`).get(id) as any
      if (accounting) {
        impacts.push({
          type: 'accounting',
          description: 'Écriture comptable générée — une contre-passation sera créée',
          reversible: true,
          key: 'reverse_accounting',
        })
      }
    } catch (_) { /* table may not exist */ }

    // 3. Paiements liés
    const payments = db.prepare(`
      SELECT p.id, p.amount, p.method, p.status FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id
      WHERE pa.document_id = ? AND p.status != 'cancelled'
    `).all(id) as any[]
    if (payments.length > 0) {
      const total = payments.reduce((s: number, p: any) => s + p.amount, 0)
      impacts.push({
        type: 'payments',
        description: `${payments.length} paiement(s) lié(s) — total: ${total.toFixed(2)} MAD`,
        reversible: true,
        key: 'cancel_payments',
      })
    }

    // 4. Documents liés (BR, BL, etc.)
    const linkedDocs = db.prepare(`
      SELECT d.id, d.number, d.type, d.status FROM document_links dl
      JOIN documents d ON d.id = CASE WHEN dl.parent_id = ? THEN dl.child_id ELSE dl.parent_id END
      WHERE (dl.parent_id = ? OR dl.child_id = ?) AND d.status != 'cancelled'
    `).all(id, id, id) as any[]
    if (linkedDocs.length > 0) {
      const nums = linkedDocs.map((d: any) => d.number).join(', ')
      impacts.push({
        type: 'linked_docs',
        description: `Documents liés actifs: ${nums}`,
        reversible: false,
        key: 'info_linked',
      })
    }

    return { impacts, docType: doc.type, docStatus: doc.status }
  })

  // ── Annulation avec options de reversement ───────────────────────────────
  handle('documents:cancelWithOptions', ({ id, options }: {
    id: number
    options: {
      reverse_stock?: boolean
      reverse_accounting?: boolean
      cancel_payments?: boolean
    }
  }) => {
    const db = getDb()
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any
    if (!doc) throw new Error('Document introuvable')
    if (doc.status === 'cancelled') throw new Error('Document déjà annulé')
    if (doc.status === 'paid') throw new Error("Impossible d'annuler un document payé")

    const tx = db.transaction(() => {
      // 1. Annuler mouvements en attente
      db.prepare(`UPDATE stock_movements SET applied = -1 WHERE document_id = ? AND applied = 0`).run(id)

      // 2. Reverser mouvements de stock appliqués
      if (options.reverse_stock) {
        const appliedMovements = db.prepare(`
          SELECT sm.*, p.cmup_price FROM stock_movements sm
          JOIN products p ON p.id = sm.product_id
          WHERE sm.document_id = ? AND sm.applied = 1
        `).all(id) as any[]
        for (const m of appliedMovements) {
          const reverseType = m.type === 'in' ? 'out' : 'in'
          // Vérifier stock suffisant pour sortie
          if (reverseType === 'out') {
            const product = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(m.product_id) as any
            if (product && product.stock_quantity < m.quantity) {
              throw new Error(`Stock insuffisant pour annuler le mouvement de ${m.product_id}: disponible ${product.stock_quantity}, requis ${m.quantity}`)
            }
          }
          // Créer mouvement inverse et l'appliquer immédiatement
          const cmup = (db.prepare('SELECT cmup_price FROM products WHERE id = ?').get(m.product_id) as any)?.cmup_price ?? m.unit_cost
          const insertResult = db.prepare(`
            INSERT INTO stock_movements (product_id, type, quantity, unit_cost, document_id, date, applied, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1)
          `).run(m.product_id, reverseType, m.quantity, cmup, id, new Date().toISOString().split('T')[0], `Annulation ${doc.number ?? ''}`)
          const movId = insertResult.lastInsertRowid as number

          // Appliquer immédiatement
          const product = db.prepare('SELECT * FROM products WHERE id = ?').get(m.product_id) as any
          const cmupBefore = product.cmup_price ?? 0
          let newQty: number, newCmup: number
          if (reverseType === 'in') {
            const totalVal = (product.stock_quantity * cmupBefore) + (m.quantity * cmup)
            newQty  = product.stock_quantity + m.quantity
            newCmup = newQty > 0 ? totalVal / newQty : cmup
          } else {
            newQty  = product.stock_quantity - m.quantity
            newCmup = cmupBefore
          }
          db.prepare(`UPDATE products SET stock_quantity = ?, cmup_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newQty, newCmup, m.product_id)
          db.prepare(`UPDATE stock_movements SET applied = 1, cmup_before = ?, cmup_after = ? WHERE id = ?`).run(cmupBefore, newCmup, movId)
          // Marquer l'original comme annulé
          db.prepare(`UPDATE stock_movements SET applied = -1 WHERE id = ?`).run(m.id)
        }
      }

      // 3. Contre-passation comptable
      if (options.reverse_accounting) {
        const entry = db.prepare(`SELECT * FROM accounting_entries WHERE document_id = ?`).get(id) as any
        if (entry) {
          const lines = db.prepare(`SELECT * FROM accounting_entry_lines WHERE entry_id = ?`).all(entry.id) as any[]
          const reverseEntry = db.prepare(`
            INSERT INTO accounting_entries (document_id, date, description, created_by)
            VALUES (?, ?, ?, 1)
          `).run(id, new Date().toISOString().split('T')[0], `Contre-passation: ${entry.description ?? doc.number}`)
          const newEntryId = reverseEntry.lastInsertRowid as number
          for (const l of lines) {
            db.prepare(`
              INSERT INTO accounting_entry_lines (entry_id, account_id, debit, credit, description)
              VALUES (?, ?, ?, ?, ?)
            `).run(newEntryId, l.account_id, l.credit, l.debit, l.description)
          }
        }
      }

      // 4. Annuler paiements liés
      if (options.cancel_payments) {
        const payIds = (db.prepare(`SELECT payment_id FROM payment_allocations WHERE document_id = ?`).all(id) as any[]).map((r: any) => r.payment_id)
        for (const payId of payIds) {
          db.prepare(`UPDATE payments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'cancelled'`).run(payId)
        }
        // Recalculer statut du document lié (facture)
        db.prepare(`UPDATE payment_allocations SET amount = 0 WHERE document_id = ?`).run(id)
      }

      // 5. Annuler le document
      db.prepare(`UPDATE documents SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
      logAudit(db, { user_id: 1, action: 'CANCEL', table_name: 'documents', record_id: id, old_values: { status: doc.status } })

      // 6. Recalculer statut BC parent si BR
      if (doc.type === 'bl_reception') {
        const poLink = db.prepare(`SELECT parent_id FROM document_links WHERE child_id = ? AND link_type LIKE '%reception%'`).get(id) as any
        if (poLink) {
          const poId = poLink.parent_id
          const poLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(poId) as any[]
          const brIds = (db.prepare(`
            SELECT dl.child_id as id FROM document_links dl
            JOIN documents d ON d.id = dl.child_id
            WHERE dl.parent_id = ? AND d.type = 'bl_reception' AND d.status != 'cancelled'
          `).all(poId) as any[]).map((r: any) => r.id)
          if (brIds.length === 0) {
            db.prepare(`UPDATE documents SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(poId)
          } else {
            const received: Record<string, number> = {}
            for (const brId of brIds) {
              for (const l of db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(brId) as any[]) {
                const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
                received[key] = (received[key] ?? 0) + Number(l.quantity)
              }
            }
            const full = poLines.every((l: any) => (received[l.product_id ? `p_${l.product_id}` : `d_${l.description}`] ?? 0) >= Number(l.quantity))
            db.prepare(`UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(full ? 'received' : 'partial', poId)
          }
        }
      }
    })

    tx()
    return { success: true }
  })

  handle('documents:convert', ({ sourceId, targetType, extra }) => {
    const db = getDb()
    const source = db.prepare('SELECT * FROM documents WHERE id = ?').get(sourceId) as any
    if (!source) throw new Error('Document source introuvable')

    // منع تحويل Devis لفاتورة أكثر من مرة
    if (source.type === 'quote' && targetType === 'invoice') {
      const existing = db.prepare(`
        SELECT d.id FROM document_links dl
        JOIN documents d ON d.id = dl.child_id
        WHERE dl.parent_id = ? AND d.type = 'invoice' AND d.status != 'cancelled'
      `).get(sourceId)
      if (existing) throw new Error('Ce devis a déjà été converti en facture')
    }

    // منع تحويل Proforma لفاتورة أكثر من مرة
    if (source.type === 'proforma' && targetType === 'invoice') {
      const existing = db.prepare(`
        SELECT d.id FROM document_links dl
        JOIN documents d ON d.id = dl.child_id
        WHERE dl.parent_id = ? AND d.type = 'invoice' AND d.status != 'cancelled'
      `).get(sourceId)
      if (existing) throw new Error('Cette proforma a déjà été convertie en facture')
    }

    const sourceLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(sourceId) as any[]

    // Réception partielle: si extra.lines fourni, utiliser ces quantités
    const linesToUse = (extra?.lines && Array.isArray(extra.lines) && extra.lines.length > 0)
      ? sourceLines.map((l: any) => {
          const override = extra.lines.find((el: any) => el.id === l.id)
          return { ...l, quantity: override ? Number(override.quantity) : l.quantity }
        }).filter((l: any) => l.quantity > 0)
      : sourceLines

    const newDoc = createDocument({
      type: targetType,
      date: new Date().toISOString().split('T')[0],
      party_id: source.party_id,
      party_type: source.party_type,
      lines: linesToUse.map((l: any) => ({
        product_id: l.product_id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount: l.discount,
        tva_rate: l.tva_rate,
      })),
      notes: source.notes,
      extra: extra ?? {},
      created_by: 1,
    })

    // ربط المستندين
    db.prepare('INSERT INTO document_links (parent_id, child_id, link_type) VALUES (?, ?, ?)').run(
      sourceId, newDoc.id, `${source.type}_to_${targetType}`
    )

    return newDoc
  })

  handle('documents:update', (data) => {
    const db = getDb()
    db.prepare(`UPDATE documents SET notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'`).run(data.notes, data.id)
    return { success: true }
  })

  handle('documents:link', ({ parentId, childId, linkType }) => {
    const db = getDb()
    db.prepare('INSERT OR IGNORE INTO document_links (parent_id, child_id, link_type) VALUES (?, ?, ?)').run(parentId, childId, linkType)
    return { success: true }
  })

  // ── Timeline d'un document ───────────────────────────────────────────────
  handle('documents:getTimeline', (docId: number) => {
    const db = getDb()
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId) as any
    if (!doc) throw new Error('Document introuvable')

    const events: { date: string; type: string; label: string; detail?: string; icon: string }[] = []

    // 1. Création
    events.push({
      date: doc.created_at,
      type: 'created',
      label: 'Document créé',
      detail: `N° ${doc.number}`,
      icon: '📝',
    })

    // 2. Confirmation (via audit_log)
    const confirmLog = db.prepare(`
      SELECT created_at, user_id FROM audit_log
      WHERE table_name = 'documents' AND record_id = ? AND action = 'CONFIRM'
      ORDER BY created_at ASC LIMIT 1
    `).get(docId) as any
    if (confirmLog) {
      events.push({
        date: confirmLog.created_at,
        type: 'confirmed',
        label: 'Document confirmé',
        icon: '✅',
      })
    }

    // 3. Paiements
    const payments = db.prepare(`
      SELECT p.date, p.amount, p.method, p.status, p.created_at
      FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id
      WHERE pa.document_id = ?
      ORDER BY p.created_at ASC
    `).all(docId) as any[]
    const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n)
    const methodLabel: Record<string, string> = { cash: 'Espèces', bank: 'Virement', cheque: 'Chèque', lcn: 'LCN', avoir: 'Avoir' }
    for (const p of payments) {
      events.push({
        date: p.created_at,
        type: 'payment',
        label: `Paiement — ${fmt(p.amount)} MAD`,
        detail: methodLabel[p.method] ?? p.method,
        icon: '💰',
      })
    }

    // 4. BL liés (livraisons)
    const bls = db.prepare(`
      SELECT d.number, d.date, d.created_at, d.status FROM document_links dl
      JOIN documents d ON d.id = dl.child_id
      WHERE dl.parent_id = ? AND d.type = 'bl' AND d.status != 'cancelled'
      ORDER BY d.created_at ASC
    `).all(docId) as any[]
    for (const bl of bls) {
      events.push({
        date: bl.created_at,
        type: 'delivery',
        label: `Bon de livraison — ${bl.number}`,
        detail: bl.status === 'delivered' ? 'Stock appliqué' : 'En attente',
        icon: '🚚',
      })
    }

    // 5. Avoirs liés
    const avoirs = db.prepare(`
      SELECT d.number, d.date, d.created_at, d.total_ttc FROM document_links dl
      JOIN documents d ON d.id = dl.child_id
      WHERE dl.parent_id = ? AND d.type = 'avoir' AND d.status != 'cancelled'
      ORDER BY d.created_at ASC
    `).all(docId) as any[]
    for (const av of avoirs) {
      events.push({
        date: av.created_at,
        type: 'avoir',
        label: `Avoir — ${av.number}`,
        detail: `${fmt(av.total_ttc)} MAD`,
        icon: '↩️',
      })
    }

    // 6. Annulation
    const cancelLog = db.prepare(`
      SELECT created_at FROM audit_log
      WHERE table_name = 'documents' AND record_id = ? AND action = 'CANCEL'
      ORDER BY created_at ASC LIMIT 1
    `).get(docId) as any
    if (cancelLog) {
      events.push({
        date: cancelLog.created_at,
        type: 'cancelled',
        label: 'Document annulé',
        icon: '🚫',
      })
    }

    // ترتيب زمني
    return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  })

  // ── Résumé réception partielle pour un BC ────────────────────────────────
  handle('documents:getPOReceiptStatus', (poId: number) => {
    const db = getDb()
    const poLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(poId) as any[]
    const brIds = (db.prepare(`
      SELECT dl.child_id as id FROM document_links dl
      JOIN documents d ON d.id = dl.child_id
      WHERE dl.parent_id = ? AND d.type = 'bl_reception' AND d.status != 'cancelled'
    `).all(poId) as any[]).map((r: any) => r.id)
    const received: Record<string, number> = {}
    for (const brId of brIds) {
      const brLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(brId) as any[]
      for (const l of brLines) {
        const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
        received[key] = (received[key] ?? 0) + Number(l.quantity)
      }
    }
    const summary = poLines.map((l: any) => {
      const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
      const qtyOrdered  = Number(l.quantity)
      const qtyReceived = received[key] ?? 0
      return { id: l.id, product_id: l.product_id, description: l.description, unit_price: l.unit_price, discount: l.discount, tva_rate: l.tva_rate, qty_ordered: qtyOrdered, qty_received: qtyReceived, qty_remaining: Math.max(0, qtyOrdered - qtyReceived) }
    })
    const fullyReceived = summary.every((l: any) => l.qty_remaining <= 0)
    return { summary, fullyReceived, brCount: brIds.length }
  })

  // ── Résumé livraison partielle pour une Facture ─────────────────────────
  handle('documents:getBLDeliveryStatus', (invoiceId: number) => {
    const db = getDb()
    const invLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(invoiceId) as any[]

    // Tous les BL liés à cette facture (non annulés)
    const blIds = (db.prepare(`
      SELECT dl.child_id as id FROM document_links dl
      JOIN documents d ON d.id = dl.child_id
      WHERE dl.parent_id = ? AND d.type = 'bl' AND d.status != 'cancelled'
    `).all(invoiceId) as any[]).map((r: any) => r.id)

    // Quantités déjà livrées
    const delivered: Record<string, number> = {}
    for (const blId of blIds) {
      const blLines = db.prepare('SELECT * FROM document_lines WHERE document_id = ?').all(blId) as any[]
      for (const l of blLines) {
        const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
        delivered[key] = (delivered[key] ?? 0) + Number(l.quantity)
      }
    }

    const summary = invLines.map((l: any) => {
      const key = l.product_id ? `p_${l.product_id}` : `d_${l.description}`
      const qtyOrdered   = Number(l.quantity)
      const qtyDelivered = delivered[key] ?? 0
      const qtyRemaining = Math.max(0, qtyOrdered - qtyDelivered)
      return {
        id:            l.id,
        product_id:    l.product_id,
        description:   l.description,
        unit_price:    l.unit_price,
        discount:      l.discount,
        tva_rate:      l.tva_rate,
        qty_ordered:   qtyOrdered,
        qty_delivered: qtyDelivered,
        qty_remaining: qtyRemaining,
      }
    })

    const fullyDelivered = summary.every((l: any) => l.qty_remaining <= 0)
    return { summary, fullyDelivered, blCount: blIds.length }
  })
}
