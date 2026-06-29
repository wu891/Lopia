/**
 * generateApple11.ts
 *
 * 蘋果11 產生器：
 *   1. generateStoreShipmentExcel — 店鋪貨單（12 店各一頁 + 總表），來源＝計画書(品種/玉数/ケース/原価)，不帶品番。
 *   2. generateChukuExcel — 出庫總單（單頁），來源＝等級分配結果(AllocationLine[])，含品番。
 *
 * 格式對齊範例：S2026070301_第2回_店鋪貨單.xlsx、_日商夢多_出庫總單_20260703_りんご第2回.xlsx
 */

import ExcelJS from 'exceljs'
import { PlanRoundData, PlanRow, PlanStore } from './parsePlanShipment'
import { AllocationLine } from './allocateGrades'
import { APPLE11_STORES, Apple11Store, LPA_DEPT, resolveApple11Store } from './apple11Stores'

const COMPANY_NAME = '日商夢多貿易股份有限公司台灣分公司'
const COMPANY_INFO = 'TEL: 02-2720-0322　　台北市信義區信義路五段五號5D17'

const C_BLUE_LIGHT = 'FFEBF3FB'
const C_BLUE_DARK  = 'FF1F3864'
const C_GRAY       = 'FFD9D9D9'
const C_GRAY_LIGHT = 'FFF2F2F2'
const C_RED_STORE  = 'FFC0392B'
const C_ZERO_TEXT  = 'FFBBBBBB'

// ── style helpers ─────────────────────────────────────────────────────────────
function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}
function bdr(style: ExcelJS.BorderStyle = 'thin'): ExcelJS.Border {
  return { style, color: { argb: 'FF000000' } }
}
function allBorders(style: ExcelJS.BorderStyle = 'thin'): Partial<ExcelJS.Borders> {
  const b = bdr(style)
  return { top: b, bottom: b, left: b, right: b }
}
function applyRow(row: ExcelJS.Row, opts: {
  bg?: string; bold?: boolean; color?: string; size?: number
  align?: ExcelJS.Alignment['horizontal']; valign?: ExcelJS.Alignment['vertical']
  borders?: boolean; height?: number
}) {
  if (opts.height) row.height = opts.height
  row.eachCell({ includeEmpty: true }, cell => {
    if (opts.bg) cell.fill = fill(opts.bg)
    if (opts.bold !== undefined || opts.color || opts.size)
      cell.font = { bold: opts.bold ?? false, color: opts.color ? { argb: opts.color } : undefined, size: opts.size, name: 'Arial' }
    if (opts.align || opts.valign)
      cell.alignment = { horizontal: opts.align ?? 'left', vertical: opts.valign ?? 'middle' }
    if (opts.borders) cell.border = allBorders()
  })
}
function styleCell(ws: ExcelJS.Worksheet, ref: string, opts: {
  bg?: string; bold?: boolean; color?: string; size?: number; align?: ExcelJS.Alignment['horizontal']; numFmt?: string
}) {
  const c = ws.getCell(ref)
  if (opts.bg) c.fill = fill(opts.bg)
  if (opts.bold !== undefined || opts.color || opts.size)
    c.font = { bold: opts.bold, color: opts.color ? { argb: opts.color } : undefined, size: opts.size, name: 'Arial' }
  if (opts.align) c.alignment = { ...c.alignment, horizontal: opts.align }
  if (opts.numFmt) c.numFmt = opts.numFmt
}
function colLetter(n: number): string {
  let s = ''
  while (n > 0) { s = String.fromCharCode(64 + (n % 26 || 26)) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// ── 計画書 → 模板 / 每店箱數 ───────────────────────────────────────────────────
/** 跨店收集所有出現過的 (品種,玉數,原価) 列，依首次出現順序＝店鋪貨單列模板 */
function buildTemplate(stores: PlanStore[]): PlanRow[] {
  const seen = new Set<string>()
  const tmpl: PlanRow[] = []
  for (const st of stores) for (const r of st.rows) {
    const k = `${r.variety}|${r.tama}|${r.price}`
    if (!seen.has(k)) { seen.add(k); tmpl.push({ ...r, cases: 0 }) }
  }
  return tmpl
}
function casesOf(store: PlanStore | undefined, row: PlanRow): number {
  if (!store) return 0
  const hit = store.rows.find(r => r.variety === row.variety && r.tama === row.tama && r.price === row.price)
  return hit ? hit.cases : 0
}
/** LPA 店 → 計画書 store（用 code/alias 對應） */
function planStoreFor(plan: PlanRoundData, lpa: Apple11Store): PlanStore | undefined {
  return plan.stores.find(s => {
    const r = resolveApple11Store(s.code)
    return r?.lpaNo === lpa.lpaNo
  })
}

// ── 店鋪貨單：單店一頁 ────────────────────────────────────────────────────────
function addStoreSheet(wb: ExcelJS.Workbook, lpa: Apple11Store, shipmentNo: string, dateStr: string, template: PlanRow[], store: PlanStore | undefined, storeLines: AllocationLine[]) {
  const ws = wb.addWorksheet(lpa.fullName.slice(0, 31), { views: [{ showGridLines: false }] })
  ws.columns = [
    { width: 7 },   // A 商品類別
    { width: 28 },  // B 商品名稱
    { width: 7 },   // C 入數(玉数)
    { width: 8 },   // D 箱數
    { width: 14 },  // E 單價
    { width: 14 },  // F 小計
  ]

  ws.addRow([COMPANY_NAME]); ws.mergeCells('A1:F1')
  applyRow(ws.getRow(1), { bg: C_BLUE_LIGHT, bold: true, size: 12, align: 'center', height: 22 })
  ws.addRow([COMPANY_INFO]); ws.mergeCells('A2:F2')
  applyRow(ws.getRow(2), { bg: C_BLUE_LIGHT, size: 10, align: 'center', height: 16 })
  ws.addRow(['']); ws.getRow(3).height = 6
  ws.addRow(['出貨單 / 納品書']); ws.mergeCells('A4:F4')
  applyRow(ws.getRow(4), { bold: true, size: 16, color: C_BLUE_DARK, align: 'center', height: 28 })
  ws.addRow(['出貨單號：', shipmentNo]); applyRow(ws.getRow(5), { height: 18 })
  styleCell(ws, 'A5', { color: 'FF888888', size: 11 }); styleCell(ws, 'B5', { bold: true, size: 11 })
  ws.addRow(['配送日期：', dateStr]); applyRow(ws.getRow(6), { height: 18 })
  styleCell(ws, 'A6', { color: 'FF888888', size: 11 }); styleCell(ws, 'B6', { bold: true, size: 11 })
  ws.addRow(['收貨店鋪：', lpa.fullName]); applyRow(ws.getRow(7), { height: 20 })
  styleCell(ws, 'A7', { color: 'FF888888', size: 11 }); styleCell(ws, 'B7', { bold: true, size: 13, color: C_RED_STORE })
  ws.addRow(['']); ws.getRow(8).height = 4

  ws.addRow(['商品類別', '商品名稱', '入數', '箱數', '單價(TWD/箱)', '小計(TWD)'])
  ws.getRow(9).height = 20
  ws.getRow(9).eachCell({ includeEmpty: true }, cell => {
    cell.fill = fill(C_BLUE_DARK)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = allBorders()
  })

  // 特価判定：同(品種,玉數)有多個價格時，非最高價者為特価
  const maxPrice = new Map<string, number>()
  for (const row of template) {
    const k = `${row.variety}|${row.tama}`
    maxPrice.set(k, Math.max(maxPrice.get(k) ?? 0, row.price))
  }
  const tokkaTag = (row: PlanRow) => row.price < (maxPrice.get(`${row.variety}|${row.tama}`) ?? row.price) ? '【特価】' : ''

  // 本店各(品種,玉數)分配到的等級池（可被多個價格列依序領取）
  const pool = new Map<string, { grade: string; qty: number }[]>()
  for (const l of storeLines) {
    const k = `${l.variety}|${l.tama}`
    if (!pool.has(k)) pool.set(k, [])
    pool.get(k)!.push({ grade: l.grade, qty: l.qty })
  }
  function drawGrades(k: string, need: number): { grade: string; qty: number }[] {
    const arr = pool.get(k) ?? []
    const out: { grade: string; qty: number }[] = []
    let left = need
    for (const e of arr) {
      if (left <= 0) break
      if (e.qty <= 0) continue
      const take = Math.min(e.qty, left); e.qty -= take; left -= take
      out.push({ grade: e.grade, qty: take })
    }
    if (left > 0) out.push({ grade: '', qty: left })  // 理論上不會發生
    return out
  }

  // 寫一列（含樣式）
  function writeRow(rn: number, cat: string, name: string, tama: number, qty: number | '', price: number, amount: number | ExcelJS.CellFormulaValue | '', zero: boolean) {
    ws.addRow([cat, name, tama, qty, price, amount])
    const r = ws.getRow(rn); r.height = 17
    r.eachCell({ includeEmpty: true }, cell => {
      cell.fill = fill((rn % 2 === 0) ? 'FFFAFAFA' : 'FFFFFFFF')
      cell.font = { name: 'Arial', size: 10, ...(zero ? { color: { argb: C_ZERO_TEXT } } : {}) }
      cell.border = allBorders(); cell.alignment = { vertical: 'middle' }
    })
    styleCell(ws, `A${rn}`, { align: 'center' })
    styleCell(ws, `C${rn}`, { align: 'center', numFmt: '0' })
    styleCell(ws, `D${rn}`, { align: 'center', bold: !zero, numFmt: '0' })
    styleCell(ws, `E${rn}`, { align: 'right', numFmt: '#,##0' })
    styleCell(ws, `F${rn}`, { align: 'right', numFmt: '#,##0' })
  }

  let rn = 10
  const qtyRefs: string[] = [], amtRefs: string[] = []
  for (const row of template) {
    const cases = casesOf(store, row)
    const tag = tokkaTag(row)
    if (cases <= 0) {
      writeRow(rn, '', `${row.variety}${tag}`, row.tama, '', row.price, '', true)
      qtyRefs.push(`D${rn}`); amtRefs.push(`F${rn}`); rn++
    } else {
      // 依等級拆列（少拆行的分配結果；跨等級就多列）
      for (const c of drawGrades(`${row.variety}|${row.tama}`, cases)) {
        const name = c.grade
          ? `${row.variety}${tag}（${c.grade} ${row.tama}玉）`
          : `${row.variety}${tag} ${row.tama}玉`
        writeRow(rn, '水果', name, row.tama, c.qty, row.price, { formula: `D${rn}*E${rn}` }, false)
        qtyRefs.push(`D${rn}`); amtRefs.push(`F${rn}`); rn++
      }
    }
  }

  // 合計
  ws.addRow(['合　計', '', '', { formula: qtyRefs.join('+') }, '箱', { formula: amtRefs.join('+') }])
  const tr = ws.getRow(rn); tr.height = 18
  tr.eachCell({ includeEmpty: true }, cell => {
    cell.fill = fill(C_GRAY); cell.font = { bold: true, name: 'Arial', size: 11 }
    cell.border = allBorders(); cell.alignment = { vertical: 'middle' }
  })
  ws.mergeCells(`A${rn}:C${rn}`)
  styleCell(ws, `A${rn}`, { align: 'center' })
  styleCell(ws, `D${rn}`, { align: 'center', numFmt: '0' })
  styleCell(ws, `E${rn}`, { align: 'center' })
  styleCell(ws, `F${rn}`, { align: 'right', numFmt: '#,##0' })
  const sigRn = rn + 2
  ws.addRow(['']); ws.addRow(['收貨簽名：___________________________　　日期：___________'])
  ws.mergeCells(`A${sigRn}:F${sigRn}`); styleCell(ws, `A${sigRn}`, { size: 10 }); ws.getRow(sigRn).height = 18
}

// ── 店鋪貨單：總表 ────────────────────────────────────────────────────────────
function addSummarySheet(wb: ExcelJS.Workbook, shipmentNo: string, dateStr: string, template: PlanRow[], plan: PlanRoundData) {
  const ws = wb.addWorksheet('總表', { views: [{ showGridLines: false }] })
  const stores = APPLE11_STORES
  const sc = stores.length
  const totalCols = 3 + sc + 2

  ws.getColumn(1).width = 24; ws.getColumn(2).width = 7; ws.getColumn(3).width = 11
  for (let i = 0; i < sc; i++) ws.getColumn(4 + i).width = 9
  ws.getColumn(4 + sc).width = 9; ws.getColumn(5 + sc).width = 14

  // 每店箱數 map
  const storeData = stores.map(lpa => planStoreFor(plan, lpa))

  ws.addRow([`出貨總表　${dateStr}　${shipmentNo}`, ...Array(totalCols - 1).fill('')])
  ws.mergeCells(1, 1, 1, totalCols)
  applyRow(ws.getRow(1), { bg: C_BLUE_LIGHT, bold: true, size: 13, align: 'center', height: 22 })

  ws.addRow(['商品名稱', '規格', '單價(TWD)', ...stores.map(s => s.fullName.replace(/LaLaport/, 'LaLa')), '總箱數', '總金額(TWD)'])
  const hdr = ws.getRow(2); hdr.height = 36
  hdr.eachCell({ includeEmpty: true }, cell => {
    cell.fill = fill(C_BLUE_DARK); cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = allBorders()
  })

  let rn = 3
  for (const row of template) {
    const qtys = storeData.map(st => casesOf(st, row))
    const total = qtys.reduce((a, b) => a + b, 0)
    if (total === 0) continue   // 總表只列有出貨的列
    const totalCol = 3 + sc + 1, amtCol = 3 + sc + 2
    ws.addRow([`${row.variety} ${row.tama}玉`, `${row.tama}玉`, row.price, ...qtys,
      { formula: `SUM(D${rn}:${colLetter(3 + sc)}${rn})` },
      { formula: `${colLetter(totalCol)}${rn}*C${rn}` }])
    const r = ws.getRow(rn); r.height = 16
    r.eachCell({ includeEmpty: true }, cell => {
      cell.fill = fill((rn % 2 === 1) ? 'FFFAFAFA' : 'FFFFFFFF')
      cell.font = { name: 'Arial', size: 10 }; cell.border = allBorders(); cell.alignment = { vertical: 'middle' }
    })
    styleCell(ws, `B${rn}`, { align: 'center' })
    styleCell(ws, `C${rn}`, { align: 'right', numFmt: '#,##0' })
    for (let i = 0; i < sc; i++) styleCell(ws, `${colLetter(4 + i)}${rn}`, { align: 'center' })
    styleCell(ws, `${colLetter(totalCol)}${rn}`, { align: 'center', bg: C_GRAY_LIGHT, bold: true, numFmt: '0' })
    styleCell(ws, `${colLetter(amtCol)}${rn}`, { align: 'right', bg: C_GRAY_LIGHT, bold: true, numFmt: '#,##0' })
    rn++
  }
  // 合計
  ws.addRow(['合　計', '', '', ...stores.map((_, i) => ({ formula: `SUM(${colLetter(4 + i)}3:${colLetter(4 + i)}${rn - 1})` })),
    { formula: `SUM(${colLetter(3 + sc + 1)}3:${colLetter(3 + sc + 1)}${rn - 1})` },
    { formula: `SUM(${colLetter(3 + sc + 2)}3:${colLetter(3 + sc + 2)}${rn - 1})` }])
  ws.mergeCells(rn, 1, rn, 3)
  const tr = ws.getRow(rn); tr.height = 18
  tr.eachCell({ includeEmpty: true }, cell => {
    cell.fill = fill(C_GRAY); cell.font = { bold: true, name: 'Arial', size: 10 }
    cell.border = allBorders(); cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  styleCell(ws, `${colLetter(3 + sc + 2)}${rn}`, { numFmt: '#,##0' })
}

// ── 出庫總單（單頁） ──────────────────────────────────────────────────────────
function addChukuSheet(wb: ExcelJS.Workbook, shipmentNo: string, deliveryDate: string, lines: AllocationLine[], stockDate: string) {
  const ws = wb.addWorksheet('出庫總單')
  ws.columns = [
    { width: 12 }, { width: 34 }, { width: 14 }, { width: 18 }, { width: 12 },
    { width: 20 }, { width: 8 }, { width: 8 }, { width: 14 },
  ]
  ws.addRow(['出庫總單']); ws.mergeCells('A1:I1')
  const t = ws.getRow(1); t.height = 20
  t.getCell(1).fill = fill(C_BLUE_LIGHT); t.getCell(1).font = { bold: true, size: 13, name: 'Arial' }
  t.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }

  ws.addRow(['配送門市', '出貨門市名稱', '配送日期', '配送單號', '配送品號', '品名', '溫層', '數量', '單位名稱'])
  const hdr = ws.getRow(2); hdr.height = 18
  hdr.eachCell({ includeEmpty: true }, cell => {
    cell.fill = fill(C_BLUE_DARK); cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.border = allBorders()
  })

  // 依 LPA 順序分組，每有出貨的店一個 MDD 序號
  const dateCompact = deliveryDate.replace(/[-/]/g, '')
  let mddSeq = 0, totalQty = 0
  for (const lpa of APPLE11_STORES) {
    const storeLines = lines.filter(l => resolveApple11Store(l.store)?.lpaNo === lpa.lpaNo)
    if (storeLines.length === 0) continue
    mddSeq++
    const lpaCode = `LPA${String(lpa.lpaNo).padStart(2, '0')}-${LPA_DEPT}`
    const mddCode = `MDD${dateCompact}-${mddSeq}`
    for (const l of storeLines) {
      ws.addRow([lpaCode, lpa.yushuName, new Date(deliveryDate.replace(/\//g, '-')), mddCode,
        l.bango, l.rawName, '冷藏', l.qty, '箱'])
      totalQty += l.qty
      const r = ws.getRow(ws.rowCount); r.height = 16
      r.eachCell({ includeEmpty: true }, cell => {
        cell.font = { name: 'Arial', size: 10 }; cell.border = allBorders(); cell.alignment = { vertical: 'middle' }
      })
      r.getCell(3).numFmt = 'yyyy/mm/dd'; r.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' }
      r.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' }
    }
  }
  ws.addRow([null, null, null, null, null, null, '總計', totalQty, null])
  const tr = ws.getRow(ws.rowCount); tr.height = 16
  tr.eachCell({ includeEmpty: true }, cell => {
    cell.font = { bold: true, name: 'Arial', size: 10 }; cell.border = allBorders(); cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  ws.addRow([`※ 品番依倉庫庫存(${stockDate}) ＋ 出貨等級優先順序自動分配；出前仍請向倉庫確認實物等級。`])
  ws.mergeCells(`A${ws.rowCount}:I${ws.rowCount}`)
  styleCell(ws, `A${ws.rowCount}`, { size: 9, color: 'FF888888' })
}

// ── public ────────────────────────────────────────────────────────────────────
export interface Apple11GenOptions {
  shipmentNo: string
  deliveryDate: string   // 'YYYY-MM-DD'
  plan: PlanRoundData
  lines: AllocationLine[]
  stockDate: string      // 倉庫檔日期，標註在出庫總單
}

export async function generateApple11StoreExcel(opts: Apple11GenOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const dateStr = opts.deliveryDate.replace(/-/g, '/')
  const template = buildTemplate(opts.plan.stores)
  for (const lpa of APPLE11_STORES) {
    const storeLines = opts.lines.filter(l => resolveApple11Store(l.store)?.lpaNo === lpa.lpaNo)
    addStoreSheet(wb, lpa, opts.shipmentNo, dateStr, template, planStoreFor(opts.plan, lpa), storeLines)
  }
  addSummarySheet(wb, opts.shipmentNo, dateStr, template, opts.plan)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export async function generateApple11ChukuExcel(opts: Apple11GenOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const dateStr = opts.deliveryDate.replace(/-/g, '/')
  addChukuSheet(wb, opts.shipmentNo, dateStr, opts.lines, opts.stockDate)
  return Buffer.from(await wb.xlsx.writeBuffer())
}
