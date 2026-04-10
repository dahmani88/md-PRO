import { handle } from './index'
import { getDb } from '../database/connection'
import { createPaymentEntry } from '../services/accounting.service'
import { logAudit } from '../services/audit.service'

export function registerPaymentHandlers(): void {
  handle('payments:getAll', (filters?: { party_id?: number; party_type?: string; status?: string; document_id?: number; limit?: number; offset?: number }) => {
    const db = getDb()
    let query = `
      SELECT p.*,
        CASE p.party_type WHEN 'client' THEN c.name WHEN 'supplier' THEN s.name END as party_name,
        d.number as document_number
      FROM payments p
      LEFT JOIN clients   c ON c.id = p.party_id AND p.party_type = 'client'
      LEFT JOIN suppliers s ON s.id = p.party_id AND p.party_type = 'supplier'
      LEFT JOIN documents d ON d.id = p.document_id
      WHERE 1=1
    `
    const params: any[] = []

    if (filters?.party_id)   { query += ' AND p.party_id = ?';   params.push(filters.party_id) }
    if (filters?.party_type) { query += ' AND p.party_type = ?'; params.push(filters.party_type) }
    if (filters?.status)     { query += ' AND p.status = ?';     params.push(filters.status) }
    if (filters?.document_id){ query += ' AND p.document_id = ?'; params.push(filters.document_id) }

    query += ' ORDER BY p.created_at DESC, p.id DESC'

    const limit  = filters?.limit  ?? 200
    const offset = filters?.offset ?? 0
    query += ' LIMIT ? OFFSET ?'
    params.push(limit, offset)

    return db.prepare(query).all(...params)
  })

  handle('payments:create', (data) => {
    const db = getDb()

    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO payments (party_id, party_type, amount, method, date, due_date,
          cheque_number, bank, status, document_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.party_id, data.party_type, data.amount, data.method,
        data.date, data.due_date ?? null, data.cheque_number ?? null,
        data.bank ?? null, data.status ?? 'pending',
        data.document_id ?? null, data.notes ?? null, data.created_by ?? 1
      )

      const paymentId = result.lastInsertRowid as number
      const isCheque = data.method === 'cheque' || data.method === 'lcn'
      const isPending = (data.status ?? 'pending') === 'pending'

      // الشيك/LCN بحالة pending لا يُحسب على الفاتورة حتى يُصرف
      if (data.document_id && !(isCheque && isPending)) {
        db.prepare('INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (?, ?, ?)').run(
          paymentId, data.document_id, data.amount
        )
        updateInvoicePaymentStatus(db, data.document_id)
      }

      // قيد محاسبي تلقائي فقط للمدفوعات الفعلية (ليس الشيكات المعلقة)
      if (!(isCheque && isPending)) {
        createPaymentEntry(db, {
          id: paymentId,
          party_id: data.party_id,
          party_type: data.party_type,
          amount: data.amount,
          method: data.method,
          date: data.date,
          reference: `PAY-${paymentId}`,
        }, data.created_by ?? 1)
      }

      logAudit(db, {
        user_id: data.created_by ?? 1,
        action: 'PAYMENT',
        table_name: 'payments',
        record_id: paymentId,
        new_values: { amount: data.amount, method: data.method, party_type: data.party_type },
      })

      return { id: paymentId }
    })

    return tx()
  })

  handle('payments:update', (data) => {
    const db = getDb()

    const tx = db.transaction(() => {
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(data.id) as any
      if (!payment) throw new Error('Paiement introuvable')

      db.prepare(`UPDATE payments SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(data.status, data.id)

      const isCheque = payment.method === 'cheque' || payment.method === 'lcn'

      // عند تحويل شيك من pending إلى cleared → تطبيق على الفاتورة + قيد محاسبي
      if (isCheque && payment.status === 'pending' && data.status === 'cleared') {
        if (payment.document_id) {
          const existing = db.prepare('SELECT id FROM payment_allocations WHERE payment_id = ?').get(data.id)
          if (!existing) {
            db.prepare('INSERT INTO payment_allocations (payment_id, document_id, amount) VALUES (?, ?, ?)').run(
              data.id, payment.document_id, payment.amount
            )
            updateInvoicePaymentStatus(db, payment.document_id)
          }
        }
        createPaymentEntry(db, {
          id: payment.id,
          party_id: payment.party_id,
          party_type: payment.party_type,
          amount: payment.amount,
          method: payment.method,
          date: new Date().toISOString().split('T')[0],
          reference: `PAY-${payment.id}`,
        }, 1)
      }

      // عند إلغاء شيك cleared → إلغاء التخصيص
      if (isCheque && payment.status === 'cleared' && data.status === 'bounced') {
        db.prepare('DELETE FROM payment_allocations WHERE payment_id = ?').run(data.id)
        if (payment.document_id) updateInvoicePaymentStatus(db, payment.document_id)
      }

      return { success: true }
    })

    return tx()
  })

  handle('payments:getPaidAmount', (documentId: number) => {
    const db = getDb()
    const row = db.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = ?'
    ).get(documentId) as any
    return { total: row?.total ?? 0 }
  })
}

function updateInvoicePaymentStatus(db: any, documentId: number): void {
  const doc = db.prepare('SELECT total_ttc, type, status FROM documents WHERE id = ?').get(documentId) as any
  if (!doc || doc.status === 'cancelled') return

  const paid = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE document_id = ?').get(documentId) as any).total

  let payStatus = 'unpaid'
  if (paid >= doc.total_ttc - 0.01) payStatus = 'paid'
  else if (paid > 0) payStatus = 'partial'

  // تحديث الجدول الفرعي المناسب
  if (doc.type === 'invoice') {
    db.prepare('UPDATE doc_invoices SET payment_status = ? WHERE document_id = ?').run(payStatus, documentId)
  } else if (doc.type === 'purchase_invoice') {
    db.prepare('UPDATE doc_purchase_invoices SET payment_status = ? WHERE document_id = ?').run(payStatus, documentId)
  } else if (doc.type === 'import_invoice') {
    db.prepare('UPDATE doc_import_invoices SET payment_status = ? WHERE document_id = ?').run(payStatus, documentId)
  }

  // تحديث حالة المستند الرئيسي
  if (payStatus === 'paid') {
    // مدفوع بالكامل — دائماً paid بغض النظر عن حالة التوصيل
    db.prepare(`UPDATE documents SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId)
  } else if (payStatus === 'partial') {
    // دفع جزئي — لا نغير delivered إلى partial
    if (!['delivered', 'paid'].includes(doc.status)) {
      db.prepare(`UPDATE documents SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId)
    }
  } else {
    // لا دفع — إعادة إلى confirmed عند إلغاء الدفعة (bounce شيك مثلاً)
    if (['paid', 'partial'].includes(doc.status)) {
      db.prepare(`UPDATE documents SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId)
    }
  }
}
