import { handle } from './index'
import { getDb } from '../database/connection'
import { createAccountingEntry } from '../services/accounting.service'
import { createStockMovement, applyMovement } from '../services/stock.service'

export function registerProductionHandlers(): void {
  // BOM Templates
  handle('production:getBoms', (productId: number) => {
    const db = getDb()
    const boms = db.prepare(`
      SELECT bt.*,
        json_group_array(json_object(
          'id', bl.id, 'material_id', bl.material_id,
          'material_name', p.name, 'material_code', p.code,
          'quantity', bl.quantity, 'unit', bl.unit,
          'cmup_price', p.cmup_price, 'stock_quantity', p.stock_quantity
        )) as lines
      FROM bom_templates bt
      LEFT JOIN bom_lines bl ON bl.bom_id = bt.id
      LEFT JOIN products p ON p.id = bl.material_id
      WHERE bt.product_id = ? AND bt.is_deleted = 0
      GROUP BY bt.id
    `).all(productId) as any[]

    return boms.map(b => ({ ...b, lines: JSON.parse(b.lines ?? '[]').filter((l: any) => l.id) }))
  })

  handle('production:createBom', (data: any) => {
    const db = getDb()
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO bom_templates (product_id, name, is_default, labor_cost, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(data.product_id, data.name, data.is_default ? 1 : 0, data.labor_cost ?? 0, data.notes ?? null)

      const bomId = result.lastInsertRowid as number

      for (const line of (data.lines ?? [])) {
        db.prepare(`INSERT INTO bom_lines (bom_id, material_id, quantity, unit) VALUES (?, ?, ?, ?)`)
          .run(bomId, line.material_id, line.quantity, line.unit ?? 'unité')
      }
      return { id: bomId }
    })
    return tx()
  })

  // Production Orders
  handle('production:getAll', (filters?: any) => {
    const db = getDb()
    return db.prepare(`
      SELECT po.*, p.name as product_name, p.code as product_code, p.unit
      FROM production_orders po
      JOIN products p ON p.id = po.product_id
      WHERE po.is_deleted = 0
      ORDER BY po.date DESC
    `).all()
  })

  handle('production:create', (data: any) => {
    const db = getDb()
    const tx = db.transaction(() => {
      // حساب التكلفة من BOM
      let unit_cost = 0
      let bom_snapshot = null

      if (data.bom_id) {
        const bom = db.prepare('SELECT * FROM bom_templates WHERE id = ?').get(data.bom_id) as any
        const lines = db.prepare('SELECT bl.*, p.cmup_price FROM bom_lines bl JOIN products p ON p.id = bl.material_id WHERE bl.bom_id = ?').all(data.bom_id) as any[]

        const materials_cost = lines.reduce((sum: number, l: any) => sum + l.quantity * l.cmup_price, 0)
        unit_cost = materials_cost + (bom?.labor_cost ?? 0)
        bom_snapshot = JSON.stringify({ bom, lines })
      }

      const result = db.prepare(`
        INSERT INTO production_orders (product_id, bom_id, bom_snapshot, quantity, date, status, unit_cost, total_cost, notes, created_by)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
      `).run(
        data.product_id, data.bom_id ?? null, bom_snapshot,
        data.quantity, data.date, unit_cost, unit_cost * data.quantity,
        data.notes ?? null, data.created_by ?? 1
      )
      return { id: result.lastInsertRowid, unit_cost, total_cost: unit_cost * data.quantity }
    })
    return tx()
  })

  handle('production:confirm', (id: number, userId: number = 1) => {
    const db = getDb()
    const order = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(id) as any
    if (!order) throw new Error('Ordre de production introuvable')
    if (order.status !== 'draft') throw new Error('Déjà confirmé')

    const bom_lines = order.bom_snapshot
      ? JSON.parse(order.bom_snapshot).lines
      : db.prepare('SELECT * FROM bom_lines WHERE bom_id = ?').all(order.bom_id) as any[]

    // التحقق من الكميات المتاحة قبل البدء
    for (const line of bom_lines) {
      const product = db.prepare('SELECT name, stock_quantity FROM products WHERE id = ?').get(line.material_id) as any
      const needed = line.quantity * order.quantity
      if (!product || product.stock_quantity < needed) {
        throw new Error(
          `Stock insuffisant pour "${product?.name ?? line.material_id}": disponible ${product?.stock_quantity ?? 0}, requis ${needed}`
        )
      }
    }

    const tx = db.transaction(() => {
      // إعادة حساب التكلفة بـ CMUP الحالي (أكثر دقة)
      let actual_materials_cost = 0
      for (const line of bom_lines) {
        const product = db.prepare('SELECT cmup_price FROM products WHERE id = ?').get(line.material_id) as any
        actual_materials_cost += (line.quantity * order.quantity) * (product?.cmup_price ?? 0)
      }
      const bom = order.bom_id ? db.prepare('SELECT labor_cost FROM bom_templates WHERE id = ?').get(order.bom_id) as any : null
      const actual_unit_cost = order.quantity > 0
        ? (actual_materials_cost + (bom?.labor_cost ?? 0)) / order.quantity
        : order.unit_cost
      // 1. Sortie des matières premières
      for (const line of bom_lines) {
        const movId = createStockMovement(db, {
          product_id: line.material_id,
          type: 'out',
          quantity: line.quantity * order.quantity,
          date: order.date,
          production_id: id,
          applied: false,
          created_by: userId,
        })
        applyMovement(db, movId, userId)
      }

      // 2. Entrée du produit fini avec coût réel
      const movId = createStockMovement(db, {
        product_id: order.product_id,
        type: 'in',
        unit_cost: actual_unit_cost,
        quantity: order.quantity,
        date: order.date,
        production_id: id,
        applied: false,
        created_by: userId,
      })
      applyMovement(db, movId, userId)

      // 3. Écriture comptable avec coût réel
      const actual_total = actual_unit_cost * order.quantity
      const fakeDoc = {
        id, type: 'production', number: `PROD-${id}`,
        date: order.date, party_id: 0, party_type: '',
        total_ht: actual_total, total_tva: 0, total_ttc: actual_total,
      }
      createAccountingEntry(db, fakeDoc as any, [], userId)

      // 4. Mise à jour statut + coût réel
      db.prepare(`UPDATE production_orders SET status = 'confirmed', unit_cost = ?, total_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(actual_unit_cost, actual_total, id)
    })

    tx()
    return { success: true }
  })

  handle('production:cancel', (id: number, userId: number = 1) => {
    const db = getDb()
    const order = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(id) as any
    if (!order) throw new Error('Ordre de production introuvable')
    if (order.status === 'cancelled') throw new Error('Déjà annulé')
    if (order.status === 'confirmed') throw new Error('Impossible d\'annuler un ordre confirmé (stock déjà mis à jour)')

    db.prepare(`UPDATE production_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
    return { success: true }
  })

  // BOM management
  handle('production:updateBom', (data: any) => {
    const db = getDb()
    const tx = db.transaction(() => {
      db.prepare(`UPDATE bom_templates SET name=?, is_default=?, labor_cost=?, notes=? WHERE id=?`)
        .run(data.name, data.is_default ? 1 : 0, data.labor_cost ?? 0, data.notes ?? null, data.id)
      db.prepare('DELETE FROM bom_lines WHERE bom_id = ?').run(data.id)
      for (const line of (data.lines ?? [])) {
        db.prepare(`INSERT INTO bom_lines (bom_id, material_id, quantity, unit) VALUES (?, ?, ?, ?)`)
          .run(data.id, line.material_id, line.quantity, line.unit ?? 'unité')
      }
      return { success: true }
    })
    return tx()
  })

  handle('production:deleteBom', (id: number) => {
    const db = getDb()
    const used = db.prepare(`SELECT COUNT(*) as c FROM production_orders WHERE bom_id = ? AND status != 'cancelled'`).get(id) as any
    if (used.c > 0) throw new Error('Cette nomenclature est utilisée par des ordres de production')
    db.prepare('UPDATE bom_templates SET is_deleted = 1 WHERE id = ?').run(id)
    return { success: true }
  })

  handle('production:getAllBoms', () => {
    const db = getDb()
    const boms = db.prepare(`
      SELECT bt.*, pr.name as product_name, pr.code as product_code,
        pr.stock_quantity as product_stock, pr.unit as product_unit,
        json_group_array(json_object(
          'id', bl.id, 'material_id', bl.material_id,
          'material_name', p.name, 'material_code', p.code,
          'quantity', bl.quantity, 'unit', bl.unit,
          'cmup_price', p.cmup_price, 'stock_quantity', p.stock_quantity
        )) as lines
      FROM bom_templates bt
      JOIN products pr ON pr.id = bt.product_id
      LEFT JOIN bom_lines bl ON bl.bom_id = bt.id
      LEFT JOIN products p ON p.id = bl.material_id
      WHERE bt.is_deleted = 0
      GROUP BY bt.id
      ORDER BY bt.created_at DESC
    `).all() as any[]
    return boms.map(b => ({ ...b, lines: JSON.parse(b.lines ?? '[]').filter((l: any) => l.id) }))
  })

  // Transformations
  handle('transformations:getAll', () => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT t.*, p.name as material_name, p.code as material_code
      FROM transformations t
      JOIN products p ON p.id = t.raw_material_id
      ORDER BY t.date DESC
    `).all() as any[]

    return rows.map(r => {
      const outputs = db.prepare(`
        SELECT to2.*, pr.name as product_name, pr.code as product_code, pr.unit
        FROM transformation_outputs to2
        JOIN products pr ON pr.id = to2.product_id
        WHERE to2.transformation_id = ?
      `).all(r.id)
      return { ...r, outputs }
    })
  })

  handle('transformations:create', (data: any) => {
    const db = getDb()
    const tx = db.transaction(() => {
      // حساب التكلفة الإجمالية
      const material = db.prepare('SELECT * FROM products WHERE id = ?').get(data.raw_material_id) as any
      const material_cost = material.cmup_price * data.input_quantity
      const transform_cost = data.cost_per_unit * data.input_quantity
      const total_cost = material_cost + transform_cost

      const result = db.prepare(`
        INSERT INTO transformations (raw_material_id, input_quantity, cost_per_unit, total_cost, date, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.raw_material_id, data.input_quantity, data.cost_per_unit ?? 0,
        total_cost, data.date, data.notes ?? null, data.created_by ?? 1
      )

      const transId = result.lastInsertRowid as number

      // توزيع التكلفة على المنتجات الناتجة
      const outputs = data.outputs ?? []
      const totalQty = outputs.reduce((s: number, o: any) => s + o.quantity, 0)

      for (const output of outputs) {
        const allocated = totalQty > 0 ? (output.quantity / totalQty) * total_cost : 0
        db.prepare(`INSERT INTO transformation_outputs (transformation_id, product_id, quantity, allocated_cost) VALUES (?, ?, ?, ?)`)
          .run(transId, output.product_id, output.quantity, allocated)

        // حركة مخزون للمنتج الناتج
        const movId = createStockMovement(db, {
          product_id: output.product_id,
          type: 'in',
          quantity: output.quantity,
          unit_cost: totalQty > 0 ? allocated / output.quantity : 0,
          transformation_id: transId,
          date: data.date,
          applied: false,
          created_by: data.created_by ?? 1,
        })
        applyMovement(db, movId, data.created_by ?? 1)
      }

      // حركة مخزون للمادة الأولية (خروج)
      const outMovId = createStockMovement(db, {
        product_id: data.raw_material_id,
        type: 'out',
        quantity: data.input_quantity,
        transformation_id: transId,
        date: data.date,
        applied: false,
        created_by: data.created_by ?? 1,
      })
      applyMovement(db, outMovId, data.created_by ?? 1)

      return { id: transId, total_cost }
    })
    return tx()
  })
}
