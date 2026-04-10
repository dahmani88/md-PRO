import Database from 'better-sqlite3'

export function migration_005_fix_document_status(db: Database.Database): void {
  // تصحيح الفواتير التي حالتها 'delivered' لكنها مدفوعة بالكامل
  // يجب أن تكون 'paid'
  db.exec(`
    UPDATE documents
    SET status = 'paid', updated_at = CURRENT_TIMESTAMP
    WHERE type IN ('invoice', 'purchase_invoice', 'import_invoice')
      AND status = 'delivered'
      AND id IN (
        SELECT di.document_id
        FROM doc_invoices di
        WHERE di.payment_status = 'paid'
        UNION
        SELECT dpi.document_id
        FROM doc_purchase_invoices dpi
        WHERE dpi.payment_status = 'paid'
        UNION
        SELECT dii.document_id
        FROM doc_import_invoices dii
        WHERE dii.payment_status = 'paid'
      )
  `)

  // تصحيح payment_status للفواتير التي لديها دفعات لكن payment_status لم يُحدَّث
  db.exec(`
    UPDATE doc_invoices
    SET payment_status = 'paid'
    WHERE document_id IN (
      SELECT d.id FROM documents d
      WHERE d.type = 'invoice' AND d.status IN ('delivered', 'paid')
      AND (
        SELECT COALESCE(SUM(pa.amount), 0)
        FROM payment_allocations pa
        WHERE pa.document_id = d.id
      ) >= d.total_ttc - 0.01
    )
    AND payment_status != 'paid'
  `)
}
