/**
 * generateShipmentOrder
 *
 * Generates a LOPIA 出貨單 Excel workbook using exceljs for full styling support.
 * Layout matches the reference file S2026041201_草莓37_店鋪貨單.xlsx
 * One sheet per store + a 總表 summary sheet.
 */

import ExcelJS from 'exceljs'
import { ParsedProduct } from './parseDeliveryExcel'

// ── Company info ───────────────────────────────────────────────────────────────
const COMPANY_NAME = '日商夢多貿易股份有限公司台灣分公司'
const COMPANY_INFO = 'TEL: 02-2720-0322　　台北市信義區信義路五段五號5D17'

// ── Colours ────────────────────────────────────────────────────────────────────
const C_BLUE_LIGHT = 'FFEBF3FB'  // header bg
const C_BLUE_DARK  = 'FF1F3864'  // table header bg
const C_GRAY       = 'FFD9D9D9'  // total row bg
const C_GRAY_LIGHT = 'FFF2F2F2'  // summary total columns
const C_WHITE      = 'FFFFFFFF'
const C_RED_STORE  = 'FFC0392B'  // store name accent

// 出貨單與總表一律使用完整店鋪名稱，與 lopia-status 門市列表一致。
// Excel 工作表名稱上限 31 字，所有店名均在範圍內，直接用 storeName 即可。

export interface StoreOrder {
  storeName: string      // Full store name
  products: ParsedProduct[]
  deliveryDate: string   // YYYY-MM-DD
}

function fmtDate(dateStr: string): string {
  return dateStr.replace(/-/g, '/')
}

// ── Style helpers ──────────────────────────────────────────────────────────────

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function border(style: ExcelJS.BorderStyle = 'thin'): Partial<ExcelJS.Borders> {
  const s = { style } as ExcelJS.Border
  return { top: s, bottom: s, left: s, right: s }
}

function applyRow(
  row: ExcelJS.Row,
  opts: {
    bg?: string
    bold?: boolean
    color?: string
    size?: number
    align?: ExcelJS.Alignment['horizontal']
    valign?: ExcelJS.Alignment['vertical']
    wrapText?: boolean
    borders?: boolean
    height?: number
  }
) {
  if (opts.height) row.height = opts.height
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (opts.bg)    cell.fill = fill(opts.bg)
    if (opts.bold !== undefined || opts.color || opts.size) {
      cell.font = {
        ...(cell.font ?? {}),
        bold: opts.bold ?? false,
        color: opts.color ? { argb: opts.color } : undefined,
        size: opts.size,
        name: 'Arial',
      }
    }
    if (opts.align || opts.valign || opts.wrapText) {
      cell.alignment = {
        horizontal: opts.align ?? 'left',
        vertical: opts.valign ?? 'middle',
        wrapText: opts.wrapText ?? false,
      }
    }
    if (opts.borders) cell.border = border()
  })
}

function styleCell(
  ws: ExcelJS.Worksheet,
  ref: string,
  opts: {
    bg?: string; bold?: boolean; color?: string; size?: number
    align?: ExcelJS.Alignment['horizontal']
    valign?: ExcelJS.Alignment['vertical']
    numFmt?: string; border?: boolean
  }
) {
  const cell = ws.getCell(ref)
  if (opts.bg)    cell.fill = fill(opts.bg)
  if (opts.bold !== undefined || opts.color || opts.size) {
    cell.font = { bold: opts.bold, color: opts.color ? { argb: opts.color } : undefined, size: opts.size, name: 'Arial' }
  }
  if (opts.align || opts.valign) cell.alignment = { horizontal: opts.align, vertical: opts.valign ?? 'middle' }
  if (opts.numFmt) cell.numFmt = opts.numFmt
  if (opts.border) cell.border = border()
}

// ── Per-store sheet ────────────────────────────────────────────────────────────

function addStoreSheet(wb: ExcelJS.Workbook, order: StoreOrder, shipmentNo: string, processedProductNames?: string[]) {
  const sheetName = order.storeName.slice(0, 31)
  const shortName = order.storeName
  const dateStr   = fmtDate(order.deliveryDate)

  const ws = wb.addWorksheet(sheetName, { views: [{ showGridLines: false }] })

  ws.columns = [
    { key: 'name',    width: 36 },
    { key: 'spec',    width: 10 },
    { key: 'qty',     width: 8  },
    { key: 'price',   width: 14 },
    { key: 'amount',  width: 14 },
  ]

  // R1 — company name
  ws.addRow([COMPANY_NAME, '', '', '', ''])
  ws.mergeCells('A1:E1')
  applyRow(ws.getRow(1), { bg: C_BLUE_LIGHT, bold: true, size: 13, align: 'center', valign: 'middle', height: 22 })

  // R2 — tel + address
  ws.addRow([COMPANY_INFO, '', '', '', ''])
  ws.mergeCells('A2:E2')
  applyRow(ws.getRow(2), { bg: C_BLUE_LIGHT, size: 10, align: 'center', valign: 'middle', height: 16 })

  // R3 — spacer
  ws.addRow([''])
  ws.getRow(3).height = 8

  // R4 — title
  ws.addRow(['出貨單 / 納品書', '', '', '', ''])
  ws.mergeCells('A4:E4')
  applyRow(ws.getRow(4), { bold: true, size: 16, color: C_BLUE_DARK, align: 'center', valign: 'middle', height: 28 })
  ws.getCell('A4').border = { bottom: { style: 'medium', color: { argb: C_BLUE_DARK } } }

  // R5 — shipment no
  ws.addRow(['出貨單號：', shipmentNo, '', '', ''])
  applyRow(ws.getRow(5), { valign: 'middle', height: 18 })
  styleCell(ws, 'A5', { color: 'FF888888', size: 11 })
  styleCell(ws, 'B5', { bold: true, size: 11 })

  // R6 — date
  ws.addRow(['配送日期：', dateStr, '', '', ''])
  applyRow(ws.getRow(6), { valign: 'middle', height: 18 })
  styleCell(ws, 'A6', { color: 'FF888888', size: 11 })
  styleCell(ws, 'B6', { bold: true, size: 11 })

  // R7 — store name
  ws.addRow(['收貨店鋪：', shortName, '', '', ''])
  applyRow(ws.getRow(7), { valign: 'middle', height: 20 })
  styleCell(ws, 'A7', { color: 'FF888888', size: 11 })
  styleCell(ws, 'B7', { bold: true, size: 13, color: C_RED_STORE })

  // R8 — spacer
  ws.addRow([''])
  ws.getRow(8).height = 6

  // R9 — table header
  ws.addRow(['商品名稱', '入數', '箱數', '單價(TWD/箱)', '小計(TWD)'])
  applyRow(ws.getRow(9), {
    bg: C_BLUE_DARK, bold: true, color: C_WHITE, size: 11,
    align: 'center', valign: 'middle', borders: true, height: 20
  })
  ws.getCell('A9').alignment = { horizontal: 'left', vertical: 'middle' }

  // R10+ products — 小計使用 Excel 公式 =C{n}*D{n}
  const prodRowStart = 10
  const prodRowEnd = prodRowStart + order.products.length - 1

  for (let i = 0; i < order.products.length; i++) {
    const p = order.products[i]
    const rowNum = prodRowStart + i

    const row = ws.addRow([
      p.name,
      p.boxSpec || '—',
      p.quantity || 0,
      p.unitPrice || 0,
      { formula: `C${rowNum}*D${rowNum}` },
    ])
    row.height = 18

    const isAlt = i % 2 === 1
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (isAlt) cell.fill = fill('FFFAFAFA')
      cell.border = border()
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center' }
      cell.font = { name: 'Arial', size: 11 }
    })

    // Dim zero-box rows (skill: 0 箱仍需列出)
    if (p.quantity === 0) {
      ;['A','B','C','D','E'].forEach(c => {
        const cell = ws.getCell(`${c}${rowNum}`)
        cell.font = { ...cell.font, color: { argb: 'FFBBBBBB' } }
      })
    }

    // Number formats
    ws.getCell(`D${rowNum}`).numFmt = '#,##0'
    ws.getCell(`E${rowNum}`).numFmt = '#,##0'
  }

  // Total row — 使用 SUM 公式
  const sumQtyFormula = order.products.length > 0
    ? `SUM(C${prodRowStart}:C${prodRowEnd})`
    : '0'
  const sumAmtFormula = order.products.length > 0
    ? `SUM(E${prodRowStart}:E${prodRowEnd})`
    : '0'
  const totalRow = ws.addRow([
    '合　計',
    '',
    { formula: sumQtyFormula },
    '箱',
    { formula: sumAmtFormula },
  ])
  totalRow.height = 20
  applyRow(totalRow, { bg: C_GRAY, bold: true, borders: true, valign: 'middle' })
  totalRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
  totalRow.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' }
  totalRow.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' }
  totalRow.getCell(5).numFmt = '#,##0'
  totalRow.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' }

  // Merge 合計 A+B
  const totalRowNum = 9 + order.products.length + 1
  ws.mergeCells(`A${totalRowNum}:B${totalRowNum}`)

      // Tax row — 5% for processed products
      if (processedProductNames && processedProductNames.length > 0) {
              const processedProducts = order.products.filter(p =>
                        processedProductNames.includes(p.name)
                      )
              const taxBase = processedProducts.reduce((sum, p) => sum + (p.unitPrice || 0) * (p.quantity || 0), 0)
              const taxAmount = Math.round(taxBase * 0.05)
              const taxRowNum = totalRowNum + 1
              const taxRow = ws.addRow(['營業稅（5%）', '', '', '', taxAmount])
              taxRow.height = 18
              ws.mergeCells(`A${taxRowNum}:D${taxRowNum}`)
              taxRow.eachCell({ includeEmpty: true }, (cell, col) => {
                        cell.border = border()
                        cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'right' : 'left' }
                        cell.font = { name: 'Arial', size: 11, bold: true }
                        cell.fill = fill('FFF3CD')
              })
              taxRow.getCell(5).numFmt = '#,##0'
      }
  // Spacer
  ws.addRow([''])

  // Sign row
  const signRow = ws.addRow(['收貨簽名：___________________________　　日期：___________'])
  ws.mergeCells(`A${totalRowNum + 2}:E${totalRowNum + 2}`)
  signRow.height = 22
  signRow.getCell(1).font = { name: 'Arial', size: 11 }
  signRow.getCell(1).alignment = { vertical: 'middle' }
  signRow.getCell(1).border = { top: { style: 'thin', color: { argb: 'FFEEEEEE' } } }
}

// ── Summary sheet (總表) ───────────────────────────────────────────────────────

function addSummarySheet(wb: ExcelJS.Workbook, storeOrders: StoreOrder[], shipmentNo: string) {
  const ws = wb.addWorksheet('總表', { views: [{ showGridLines: false }] })
  const dateStr = storeOrders.length > 0 ? fmtDate(storeOrders[0].deliveryDate) : ''
  const shortNames = storeOrders.map(o => o.storeName)
  const totalCols = 3 + shortNames.length + 2  // 商品名+入數+單價 + stores + 總箱+總金額

  // Collect products — key = "name||boxSpec||unitPrice"
  // Same product at different prices (e.g. discount for 北蛋) → separate rows, each with its own price.
  // Same product at same price across multiple stores → merged into one row as before.
  const productKeys: string[] = []
  const productMap = new Map<string, { name: string; boxSpec: string; unitPrice: number }>()
  for (const order of storeOrders) {
    for (const p of order.products) {
      const key = `${p.name}||${p.boxSpec}||${p.unitPrice}`
      if (!productMap.has(key)) {
        productMap.set(key, { name: p.name, boxSpec: p.boxSpec, unitPrice: p.unitPrice })
        productKeys.push(key)
      }
    }
  }

  // Set column widths
  ws.columns = [
    { key: 'name',  width: 36 },
    { key: 'spec',  width: 10 },
    { key: 'price', width: 12 },
    ...shortNames.map(() => ({ width: 8 })),
    { key: 'total', width: 10 },
    { key: 'amt',   width: 14 },
  ]

  // R1 — title
  ws.addRow([`出貨總表　${dateStr}　${shipmentNo}`, ...Array(totalCols - 1).fill('')])
  ws.mergeCells(1, 1, 1, totalCols)
  applyRow(ws.getRow(1), { bg: C_BLUE_LIGHT, bold: true, size: 13, align: 'center', valign: 'middle', height: 22 })

  // R2 — header
  ws.addRow(['商品名稱', '入數', '單價(TWD)', ...shortNames, '總箱數', '總金額(TWD)'])
  const hRow = ws.getRow(2)
  hRow.height = 20
  hRow.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.fill   = fill(C_BLUE_DARK)
    cell.font   = { bold: true, color: { argb: C_WHITE }, size: 11, name: 'Arial' }
    cell.border = border()
    cell.alignment = { horizontal: col === 1 ? 'left' : 'center', vertical: 'middle' }
  })

  // Column indices (1-based for Excel refs)
  const firstStoreCol = 4                                  // D
  const lastStoreCol  = 3 + shortNames.length              // D+N-1
  const totalCol      = lastStoreCol + 1                   // 總箱數欄
  const amountCol     = totalCol + 1                       // 總金額欄
  const firstStoreLetter = colLetter(firstStoreCol)
  const lastStoreLetter  = colLetter(lastStoreCol)
  const totalLetter      = colLetter(totalCol)
  const priceLetter      = 'C'                             // 單價 = C 欄
  const productRowStart  = 3
  const productRowEnd    = 2 + productKeys.length

  // R3+ product rows — each pKey is name||boxSpec||price, so different prices → separate rows.
  // Skip rows where every store has 0 boxes (e.g. zero-only ghost entries from multi-section sheets).
  const visibleKeys = productKeys.filter(pKey => {
    return storeOrders.some(order =>
      order.products
        .filter(p => `${p.name}||${p.boxSpec}||${p.unitPrice}` === pKey)
        .reduce((sum, p) => sum + p.quantity, 0) > 0
    )
  })

  // Recalculate row bounds based on visible rows only
  const visibleRowEnd = productRowStart + visibleKeys.length - 1

  for (let i = 0; i < visibleKeys.length; i++) {
    const pKey = visibleKeys[i]
    const info = productMap.get(pKey)!

    // Per-store quantities — filter by exact name+boxSpec+price key.
    // filter+reduce handles multi-section sheets where same product at same price
    // may appear in multiple sections of one store's sheet.
    const storeCounts = storeOrders.map(order =>
      order.products
        .filter(p => `${p.name}||${p.boxSpec}||${p.unitPrice}` === pKey)
        .reduce((sum, p) => sum + p.quantity, 0)
    )

    const rowNum = productRowStart + i

    const row = ws.addRow([
      info.name,
      info.boxSpec || '—',
      info.unitPrice,          // always a single price per row now
      ...storeCounts,
      { formula: `SUM(${firstStoreLetter}${rowNum}:${lastStoreLetter}${rowNum})` },
      { formula: `${totalLetter}${rowNum}*${priceLetter}${rowNum}` }, // totalBoxes × price
    ])
    row.height = 18
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (i % 2 === 1) cell.fill = fill('FFFAFAFA')
      cell.border = border()
      cell.font = { name: 'Arial', size: 11 }
      cell.alignment = { horizontal: col === 1 ? 'left' : 'center', vertical: 'middle' }
    })
    // Highlight total + amount columns
    ws.getCell(rowNum, totalCol).fill  = fill(C_GRAY_LIGHT)
    ws.getCell(rowNum, totalCol).font  = { bold: true, name: 'Arial', size: 11 }
    ws.getCell(rowNum, amountCol).fill = fill(C_GRAY_LIGHT)
    ws.getCell(rowNum, amountCol).font = { bold: true, name: 'Arial', size: 11 }
    ws.getCell(rowNum, 3).numFmt = '#,##0'
    ws.getCell(rowNum, amountCol).numFmt = '#,##0'
  }

  // Total row — 各店小計 SUM、總箱數 SUM、總金額 SUM 皆用公式
  const totalRowNum = visibleRowEnd + 1
  const storeSumFormulas = shortNames.map((_, idx) => {
    const col = colLetter(firstStoreCol + idx)
    return { formula: `SUM(${col}${productRowStart}:${col}${visibleRowEnd})` }
  })
  const grandTotalFormula = { formula: `SUM(${totalLetter}${productRowStart}:${totalLetter}${visibleRowEnd})` }
  const amountColLetter = colLetter(amountCol)
  const grandAmtFormula = { formula: `SUM(${amountColLetter}${productRowStart}:${amountColLetter}${visibleRowEnd})` }

  const totalRow = ws.addRow([
    '合　計', '', '',
    ...storeSumFormulas,
    grandTotalFormula,
    grandAmtFormula,
  ])
  totalRow.height = 20
  totalRow.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.fill   = fill(C_GRAY)
    cell.font   = { bold: true, name: 'Arial', size: 11 }
    cell.border = border()
    cell.alignment = { horizontal: col <= 3 ? 'left' : 'center', vertical: 'middle' }
  })
  ws.getCell(totalRowNum, amountCol).numFmt = '#,##0'

  // Merge 合計 A-C
  ws.mergeCells(totalRowNum, 1, totalRowNum, 3)
}

// 1-based column index → letters (supports A..ZZ)
function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function generateShipmentOrder(
  storeOrders: StoreOrder[],
  shipmentNo: string,
  _batchName: string,
    processedProductNames?: string[],
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'LOPIA'

  for (const order of storeOrders) {
    addStoreSheet(wb, order, shipmentNo, processedProductNames)
  }
  addSummarySheet(wb, storeOrders, shipmentNo)

  const buf = await wb.xlsx.writeBuffer()
  return buf as ArrayBuffer
}

/**
 * Generate the S+date shipment number.
 * Format: S{YYYYMMDD}{NN}
 */
export function generateShipmentNo(dateStr: string, seq: number = 1): string {
  const d = dateStr.replace(/-/g, '')
  return `S${d}${String(seq).padStart(2, '0')}`
}
