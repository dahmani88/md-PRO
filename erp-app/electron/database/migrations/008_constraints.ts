/**
 * Migration 008 — Database Constraints & Security Hardening
 * يضيف قيود CHECK لمنع البيانات غير الصالحة على مستوى قاعدة البيانات
 */
import Database from 'better-sqlite3'

export function migration_008_constraints(db: Database.Database): void {
  // SQLite لا يدعم إضافة CHECK constraints على جداول موجودة مباشرة
  // نستخدم TRIGGER بدلاً من ذلك لضمان التوافق مع البيانات الموجودة

  db.exec(`
    -- ==========================================
    -- TRIGGER: منع المبالغ السالبة في payments
    -- ==========================================
    CREATE TRIGGER IF NOT EXISTS trg_payments_amount_check
    BEFORE INSERT ON payments
    BEGIN
      SELECT CASE
        WHEN NEW.amount <= 0
        THEN RAISE(ABORT, 'Le montant du paiement doit être supérieur à 0')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_payments_amount_update_check
    BEFORE UPDATE ON payments
    BEGIN
      SELECT CASE
        WHEN NEW.amount <= 0
        THEN RAISE(ABORT, 'Le montant du paiement doit être supérieur à 0')
      END;
    END;

    -- ==========================================
    -- TRIGGER: منع الكميات الصفرية أو السالبة في document_lines
    -- ==========================================
    CREATE TRIGGER IF NOT EXISTS trg_doc_lines_quantity_check
    BEFORE INSERT ON document_lines
    BEGIN
      SELECT CASE
        WHEN NEW.quantity <= 0
        THEN RAISE(ABORT, 'La quantité doit être supérieure à 0')
        WHEN NEW.unit_price < 0
        THEN RAISE(ABORT, 'Le prix unitaire ne peut pas être négatif')
        WHEN NEW.discount < 0 OR NEW.discount > 100
        THEN RAISE(ABORT, 'La remise doit être entre 0 et 100%')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_doc_lines_quantity_update_check
    BEFORE UPDATE ON document_lines
    BEGIN
      SELECT CASE
        WHEN NEW.quantity <= 0
        THEN RAISE(ABORT, 'La quantité doit être supérieure à 0')
        WHEN NEW.unit_price < 0
        THEN RAISE(ABORT, 'Le prix unitaire ne peut pas être négatif')
        WHEN NEW.discount < 0 OR NEW.discount > 100
        THEN RAISE(ABORT, 'La remise doit être entre 0 et 100%')
      END;
    END;

    -- ==========================================
    -- TRIGGER: التحقق من حالة المستند
    -- ==========================================
    CREATE TRIGGER IF NOT EXISTS trg_documents_status_check
    BEFORE INSERT ON documents
    BEGIN
      SELECT CASE
        WHEN NEW.status NOT IN ('draft','confirmed','partial','delivered','paid','cancelled','received')
        THEN RAISE(ABORT, 'Statut de document invalide')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_documents_status_update_check
    BEFORE UPDATE ON documents
    BEGIN
      SELECT CASE
        WHEN NEW.status NOT IN ('draft','confirmed','partial','delivered','paid','cancelled','received')
        THEN RAISE(ABORT, 'Statut de document invalide')
      END;
    END;

    -- ==========================================
    -- TRIGGER: منع الدفع الزائد (overpayment)
    -- ==========================================
    CREATE TRIGGER IF NOT EXISTS trg_payment_allocations_overpayment
    BEFORE INSERT ON payment_allocations
    BEGIN
      SELECT CASE
        WHEN NEW.amount <= 0
        THEN RAISE(ABORT, 'Le montant de l''allocation doit être supérieur à 0')
        WHEN (
          SELECT COALESCE(SUM(pa.amount), 0) + NEW.amount
          FROM payment_allocations pa
          WHERE pa.document_id = NEW.document_id
        ) > (
          SELECT total_ttc * 1.001
          FROM documents
          WHERE id = NEW.document_id
        )
        THEN RAISE(ABORT, 'Le montant total des paiements dépasse le montant de la facture')
      END;
    END;

    -- ==========================================
    -- TRIGGER: التحقق من كميات المخزون
    -- ==========================================
    CREATE TRIGGER IF NOT EXISTS trg_stock_movements_quantity_check
    BEFORE INSERT ON stock_movements
    BEGIN
      SELECT CASE
        WHEN NEW.quantity <= 0
        THEN RAISE(ABORT, 'La quantité du mouvement doit être supérieure à 0')
      END;
    END;
  `)
}
