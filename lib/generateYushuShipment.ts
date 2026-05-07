/**
 * generateYushuShipment.ts
 *
 * Generates two Excel workbooks for the 優儲出貨單 workflow:
 *   1. 店鋪貨單 (LOPIA format, per-store sheets + 總表)
 *   2. 優儲出庫單 (Yushu flat-list format)
 */

import ExcelJS from 'exceljs'
import { ProductMaster, RoundData, PriceMap, Category } from './parseYushuExcel'

// ── Company info ──────────────────────────────────────────────────────────────
const COMPANY_NAME = '日商夢多貿易股份有限公司台灣分公司'
const COMPANY_INFO = 'TEL: 02-2720-0322　　台北市信義區信義路五段五號5D17'

// ── Colours ───────────────────────────────────────────────────────────────────
const C_BLUE_LIGHT = 'FFEBF3FB'
const C_BLUE_DARK  = 'FF1F3864'
const C_GRAY       = 'FFD9D9D9'
const C_GRAY_LIGHT = 'FFF2F2F2'
const C_RED_STORE  = 'FFC0392B'
const C_ZERO_TEXT  = 'FFBBBBBB'

// ── Fixed LPA store table ─────────────────────────────────────────────────────

interface LpaStore {
  lpaNo: number          // 1-12
  code: string           // 台中, 桃園, ...
  aliases: string[]      // extra keys that map to this store
  fullName: string       // LaLaport 台中店
  yushuName: string      // 樂比亞xxx店青果部
}

const LPA_STORES: LpaStore[] = [
  { lpaNo: 1,  code: '台中', aliases: [],                 fullName: 'LaLaport 台中店',      yushuName: '樂比亞台中LaLaport店青果部' },
  { lpaNo: 2,  code: '桃園', aliases: [],                 fullName: '桃園春日店',            yushuName: '樂比亞桃園春日店青果部' },
  { lpaNo: 3,  code: '中和', aliases: [],                 fullName: '新北中和環球店',        yushuName: '樂比亞中和環球店青果部' },
  { lpaNo: 4,  code: '新荘', aliases: ['新莊'],           fullName: '新莊宏匯店',            yushuName: '樂比亞新莊宏匯店青果部' },
  { lpaNo: 5,  code: '高雄', aliases: ['巨蛋'],           fullName: '高雄漢神巨蛋店',        yushuName: '樂比亞高雄漢神巨蛋店青果部' },
  { lpaNo: 6,  code: '南港', aliases: [],                 fullName: '南港 LaLaport 店',      yushuName: '樂比亞南港LaLaport店青果部' },
  { lpaNo: 7,  code: 'IKEA', aliases: ['イケア'],         fullName: 'IKEA 台中南屯店',       yushuName: '樂比亞台中IKEA店青果部' },
  { lpaNo: 8,  code: '夢時', aliases: ['夢時代'],         fullName: '高雄夢時代店',          yushuName: '樂比亞高雄統一夢時代店青果部' },
  { lpaNo: 9,  code: '北門', aliases: ['台南'],           fullName: '台南小北門店',          yushuName: '樂比亞台南新光三越小北門店青果部' },
  { lpaNo: 10, code: 'MOP',  aliases: ['mop'],            fullName: '台南三井 Outlet 店',    yushuName: '樂比亞 台南MOP店青果部' },
  { lpaNo: 11, code: '中漢', aliases: ['中港'],           fullName: '台中漢神中港店',        yushuName: '樂比亞台中漢神洲際店青果部' },
  { lpaNo: 12, code: '北蛋', aliases: [],                 fullName: '台北大巨蛋店',          yushuName: '樂比亞台北大巨蛋店青果部' },
]

/** Resolve store code/alias → LpaStore */
function resolveLpa(code: string): LpaStore | undefined {
  const key = code.trim()
  return LPA_STORES.find(s =>
    s.code === key || s.aliases.includes(key)
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────

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

function applyRow(
  row: ExcelJS.Row,
  opts: {
    bg?: string; bold?: boolean; color?: string; size?: number
    align?: ExcelJS.Alignment['horizontal']
    valign?: ExcelJS.Alignment['vertical']
    borders?: boolean; height?: number
  }
) {
  if (opts.height) row.height = opts.height
  row.eachCell({ includeEmpty: true }, cell => {
    if (opts.bg)    cell.fill = fill(opts.bg)
    if (opts.bold !== undefined || opts.color || opts.size) {
      cell.font = { bold: opts.bold ?? false, color: opts.color ? { argb: opts.color } : undefined, size: opts.size, name: 'Arial' }
    }
    if (opts.align || opts.valign) {
      cell.alignment = { horizontal: opts.align ?? 'left', vertical: opts.valign ?? 'middle' }
    }
    if (opts.borders) cell.border = allBorders()
  })
}

function styleCell(
  ws: ExcelJS.Worksheet, ref: string,
  opts: { bg?: string; bold?: boolean; color?: string; size?: number; align?: ExcelJS.Alignment['horizontal']; numFmt?: string }
) {
  const c = ws.getCell(ref)
  if (opts.bg)   c.fill = fill(opts.bg)
  if (opts.bold !== undefined || opts.color || opts.size)
    c.font = { bold: opts.bold, color: opts.color ? { argb: opts.color } : undefined, size: opts.size, name: 'Arial' }
  if (opts.align) c.alignment = { ...c.alignment, horizontal: opts.align }
  if (opts.numFmt) c.numFmt = opts.numFmt
}

// ── Product line resolution ───────────────────────────────────────────────────

interface ProductLine {
  category: Category
  tama: number
}

/** Build ordered product line list from masters (category+tama unique combos) */
function buildProductLines(masters: ProductMaster[]): ProductLine[] {
  const seen = new Set<string>()
  const lines: ProductLine[] = []
  for (const m of masters) {
    const key = `${m.category}-${m.tama}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push({ category: m.category, tama: m.tama })
  }
  // Sort: サンふじ first (asc tama), then 王林 (asc tama)
  return lines.sort((a, b) => {
    if (a.category !== b.category) return a.category === 'サンふじ' ? -1 : 1
    return a.tama - b.tama
  })
}

// ── 店鋪貨單 — per-store sheet ────────────────────────────────────────────────

function addStoreSheet(
  wb: ExcelJS.Workbook,
  lpa: LpaStore,
  shipmentNo: string,
  dateStr: string,
  masters: ProductMaster[],
  storeItems: { bango: string; name: string; qty: number }[],
  priceMap: PriceMap,
  productLines: ProductLine[],
) {
  const ws = wb.addWorksheet(lpa.fullName.slice(0, 31), { views: [{ showGridLines: false }] })
  ws.columns = [
    { key: 'name',   width: 30 },
    { key: 'tama',   width: 8  },
    { key: 'qty',    width: 8  },
    { key: 'price',  width: 14 },
    { key: 'amount', width: 14 },
  ]

  // R1 company
  ws.addRow([COMPANY_NAME, '', '', '', ''])
  ws.mergeCells('A1:E1')
  applyRow(ws.getRow(1), { bg: C_BLUE_LIGHT, bold: true, size: 12, align: 'center', valign: 'middle', height: 22 })

  // R2 tel
  ws.addRow([COMPANY_INFO, '', '', '', ''])
  ws.mergeCells('A2:E2')
  applyRow(ws.getRow(2), { bg: C_BLUE_LIGHT, size: 10, align: 'center', valign: 'middle', height: 16 })

  // R3 spacer
  ws.addRow(['']); ws.getRow(3).height = 6

  // R4 title
  ws.addRow(['出貨單 / 納品書', '', '', '', ''])
  ws.mergeCells('A4:E4')
  applyRow(ws.getRow(4), { bold: true, size: 16, color: C_BLUE_DARK, align: 'center', valign: 'middle', height: 28 })

  // R5 shipment no
  ws.addRow(['出貨單號：', shipmentNo, '', '', ''])
  applyRow(ws.getRow(5), { valign: 'middle', height: 18 })
  styleCell(ws, 'A5', { color: 'FF888888', size: 11 })
  styleCell(ws, 'B5', { bold: true, size: 11 })

  // R6 date
  ws.addRow(['配送日期：', dateStr, '', '', ''])
  applyRow(ws.getRow(6), { valign: 'middle', height: 18 })
  styleCell(ws, 'A6', { color: 'FF888888', size: 11 })
  styleCell(ws, 'B6', { bold: true, size: 11 })

  // R7 store
  ws.addRow(['收貨店鋪：', lpa.fullName, '', '', ''])
  applyRow(ws.getRow(7), { valign: 'middle', height: 20 })
  styleCell(ws, 'A7', { color: 'FF888888', size: 11 })
  styleCell(ws, 'B7', { bold: true, size: 13, color: C_RED_STORE })

  // R8 spacer
  ws.addRow(['']); ws.getRow(8).height = 4

  // R9 table header
  ws.addRow(['商品名稱', '入數', '箱數', '單價(TWD/箱)', '小計(TWD)'])
  const hdrRow = ws.getRow(9)
  hdrRow.height = 20
  hdrRow.eachCell({ includeEmpty: true }, cell => {
    cell.fill = fill(C_BLUE_DARK)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = allBorders()
  })

  // Build a map: bango → shipped qty for this store
  const shipMap = new Map<string, { name: string; qty: number }>()
  for (const item of storeItems) {
    shipMap.set(item.bango, { name: item.name, qty: item.qty })
  }

  // For each product line, collect shipped 番号 that belong to this (category, tama)
  let dataRowStart = 10
  let rowIndex = dataRowStart
  const qtyRefs: string[] = []
  const amtRefs: string[] = []

  for (const line of productLines) {
    const price = priceMap[line.category] ?? 0
    // Find all masters matching this (category, tama)
    const matchMasters = masters.filter(m => m.category === line.category && m.tama === line.tama)
    // Find shipped items among those masters
    const shipped = matchMasters
      .filter(m => shipMap.has(m.bango))
      .map(m => ({ ...m, ...shipMap.get(m.bango)! }))

    const isAlt = (rowIndex % 2 === 0)
    const rowBg = isAlt ? 'FFFAFAFA' : 'FFFFFFFF'

    if (shipped.length === 0) {
      // 0-box row: just the variety name, grey
      const rn = rowIndex
      ws.addRow([line.category, line.tama, 0, price, 0])
      const r = ws.getRow(rn)
      r.height = 17
      r.eachCell({ includeEmpty: true }, cell => {
        cell.fill = fill(rowBg)
        cell.font = { color: { argb: C_ZERO_TEXT }, name: 'Arial', size: 10 }
        cell.border = allBorders()
        cell.alignment = { vertical: 'middle' }
      })
      styleCell(ws, `C${rn}`, { align: 'center', numFmt: '0' })
      styleCell(ws, `D${rn}`, { align: 'right',  numFmt: '#,##0' })
      styleCell(ws, `E${rn}`, { align: 'right',  numFmt: '#,##0' })
      qtyRefs.push(`C${rn}`)
      amtRefs.push(`E${rn}`)
      rowIndex++
    } else {
      // One row per shipped 番号
      for (const s of shipped) {
        const displayName = `${s.category}(${s.name})`
        const rn = rowIndex
        ws.addRow([displayName, s.tama, s.qty, price, { formula: `C${rn}*D${rn}` }])
        const r = ws.getRow(rn)
        r.height = 17
        r.eachCell({ includeEmpty: true }, cell => {
          cell.fill = fill(rowBg)
          cell.font = { name: 'Arial', size: 10 }
          cell.border = allBorders()
          cell.alignment = { vertical: 'middle' }
        })
        styleCell(ws, `B${rn}`, { align: 'center' })
        styleCell(ws, `C${rn}`, { align: 'center', bold: true })
        styleCell(ws, `D${rn}`, { align: 'right', numFmt: '#,##0' })
        styleCell(ws, `E${rn}`, { align: 'right', numFmt: '#,##0' })
        qtyRefs.push(`C${rn}`)
        amtRefs.push(`E${rn}`)
        rowIndex++
      }
    }
  }

  // Total row
  const totalRn = rowIndex
  ws.addRow(['合　計', '', { formula: qtyRefs.map(r => r).join('+') }, '箱', { formula: amtRefs.join('+') }])
  const totalRow = ws.getRow(totalRn)
  totalRow.height = 18
  totalRow.eachCell({ includeEmpty: true }, cell => {
    cell.fill = fill(C_GRAY)
    cell.font = { bold: true, name: 'Arial', size: 11 }
    cell.border = allBorders()
    cell.alignment = { vertical: 'middle' }
  })
  ws.mergeCells(`A${totalRn}:B${totalRn}`)
  styleCell(ws, `A${totalRn}`, { align: 'center' })
  styleCell(ws, `C${totalRn}`, { align: 'center', numFmt: '0' })
  styleCell(ws, `D${totalRn}`, { align: 'center' })
  styleCell(ws, `E${totalRn}`, { align: 'right', numFmt: '#,##0' })

  // Signature
  const sigRn = totalRn + 2
  ws.addRow(['', '', '', '', ''])
  ws.addRow(['收貨簽名：___________________________　　日期：___________', '', '', '', ''])
  ws.mergeCells(`A${sigRn}:E${sigRn}`)
  styleCell(ws, `A${sigRn}`, { size: 10 })
  ws.getRow(sigRn).height = 18
}

// ── 店鋪貨單 — 總表 ───────────────────────────────────────────────────────────

function addSummarySheet(
  wb: ExcelJS.Workbook,
  activeStores: LpaStore[],
  shipmentNo: string,
  dateStr: string,
  masters: ProductMaster[],
  roundData: RoundData,
  priceMap: PriceMap,
  productLines: ProductLine[],
) {
  const ws = wb.addWorksheet('總表', { views: [{ showGridLines: false }] })

  const storeCols = activeStores.length
  const totalCols = 3 + storeCols + 2  // name+tama+price + stores + 總箱數+總金額

  // Col widths
  ws.getColumn(1).width = 28  // name
  ws.getColumn(2).width = 7   // tama
  ws.getColumn(3).width = 11  // price
  for (let i = 0; i < storeCols; i++) ws.getColumn(4 + i).width = 9
  ws.getColumn(4 + storeCols).width = 9   // 總箱數
  ws.getColumn(5 + storeCols).width = 14  // 總金額

  // Build shipment maps per store
  const storeItemMaps = activeStores.map(lpa => {
    const storeShip = roundData.stores.find(s => {
      const resolved = resolveLpa(s.storeCode)
      return resolved?.lpaNo === lpa.lpaNo
    })
    const map = new Map<string, number>()
    for (const item of (storeShip?.items ?? [])) map.set(item.bango, item.qty)
    return map
  })

  // R1 title
  ws.addRow([`出貨總表　${dateStr}　${shipmentNo}`, ...Array(totalCols - 1).fill('')])
  ws.mergeCells(1, 1, 1, totalCols)
  applyRow(ws.getRow(1), { bg: C_BLUE_LIGHT, bold: true, size: 13, align: 'center', valign: 'middle', height: 22 })

  // R2 header
  const headerRow = ['商品名稱', '入數', '單價(TWD)', ...activeStores.map(s => s.fullName.replace(/LaLaport/, 'LaLa')), '總箱數', '總金額(TWD)']
  ws.addRow(headerRow)
  const hdr = ws.getRow(2)
  hdr.height = 36
  hdr.eachCell({ includeEmpty: true }, cell => {
    cell.fill = fill(C_BLUE_DARK)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = allBorders()
  })

  const qtyColRefs: { col: number; rows: number[] }[] = activeStores.map((_, i) => ({ col: 4 + i, rows: [] }))
  const totalQtyRows: number[] = []
  const totalAmtRows: number[] = []
  let rn = 3
  const isAlt = (r: number) => r % 2 === 1

  for (const line of productLines) {
    const price = priceMap[line.category] ?? 0
    const matchMasters = masters.filter(m => m.category === line.category && m.tama === line.tama)

    // Aggregate qty per store (sum all matching 番号)
    const storeQtys = storeItemMaps.map(map => {
      return matchMasters.reduce((sum, m) => sum + (map.get(m.bango) ?? 0), 0)
    })
    const totalQty = storeQtys.reduce((a, b) => a + b, 0)
    const rowBg = isAlt(rn) ? 'FFFAFAFA' : 'FFFFFFFF'
    const isZero = totalQty === 0
    const textColor = isZero ? C_ZERO_TEXT : undefined

    const displayName = `${line.category} ${line.tama}玉`
    const totalCol = 3 + storeCols + 1
    const amtCol   = 3 + storeCols + 2
    ws.addRow([displayName, line.tama, price, ...storeQtys,
      { formula: `SUM(D${rn}:${colLetter(3 + storeCols)}${rn})` },
      { formula: `${colLetter(totalCol)}${rn}*C${rn}` },
    ])
    const r = ws.getRow(rn)
    r.height = 16
    r.eachCell({ includeEmpty: true }, cell => {
      cell.fill = fill(rowBg)
      cell.font = { name: 'Arial', size: 10, ...(textColor ? { color: { argb: textColor } } : {}) }
      cell.border = allBorders()
      cell.alignment = { vertical: 'middle' }
    })
    styleCell(ws, `A${rn}`, { align: 'left' })
    styleCell(ws, `B${rn}`, { align: 'center' })
    styleCell(ws, `C${rn}`, { align: 'right', numFmt: '#,##0' })
    for (let i = 0; i < storeCols; i++) {
      const col = colLetter(4 + i)
      styleCell(ws, `${col}${rn}`, { align: 'center' })
    }
    // 總箱數 / 總金額 columns
    const tcLetter = colLetter(totalCol)
    const acLetter = colLetter(amtCol)
    const tcCell = ws.getCell(`${tcLetter}${rn}`)
    tcCell.fill = fill(C_GRAY_LIGHT)
    tcCell.font = { bold: !isZero, name: 'Arial', size: 10, ...(textColor ? { color: { argb: textColor } } : {}) }
    tcCell.border = allBorders()
    tcCell.alignment = { horizontal: 'center', vertical: 'middle' }
    tcCell.numFmt = '0'
    const acCell = ws.getCell(`${acLetter}${rn}`)
    acCell.fill = fill(C_GRAY_LIGHT)
    acCell.font = { bold: !isZero, name: 'Arial', size: 10, ...(textColor ? { color: { argb: textColor } } : {}) }
    acCell.border = allBorders()
    acCell.alignment = { horizontal: 'right', vertical: 'middle' }
    acCell.numFmt = '#,##0'

    totalQtyRows.push(rn)
    totalAmtRows.push(rn)
    rn++
  }

  // Total row
  ws.addRow(['合　計', '', '', ...activeStores.map((_, i) => ({
    formula: `SUM(${colLetter(4 + i)}3:${colLetter(4 + i)}${rn - 1})`,
  })),
  { formula: `SUM(${colLetter(3 + storeCols + 1)}3:${colLetter(3 + storeCols + 1)}${rn - 1})` },
  { formula: `SUM(${colLetter(3 + storeCols + 2)}3:${colLetter(3 + storeCols + 2)}${rn - 1})` },
  ])
  ws.mergeCells(rn, 1, rn, 3)
  const totalRow = ws.getRow(rn)
  totalRow.height = 18
  totalRow.eachCell({ includeEmpty: true }, cell => {
    cell.fill = fill(C_GRAY)
    cell.font = { bold: true, name: 'Arial', size: 10 }
    cell.border = allBorders()
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  styleCell(ws, `${colLetter(3 + storeCols + 2)}${rn}`, { numFmt: '#,##0' })
}

function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    s = String.fromCharCode(64 + (n % 26 || 26)) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// ── 優儲出庫單 ────────────────────────────────────────────────────────────────

function addChukuSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  stores: LpaStore[],
  round: number,
  deliveryDate: string | null,
  roundData: RoundData,
  shipmentNo: string,
) {
  const ws = wb.addWorksheet(sheetName)
  ws.columns = [
    { key: 'lpa',    width: 12 },
    { key: 'name',   width: 36 },
    { key: 'date',   width: 14 },
    { key: 'mdd',    width: 18 },
    { key: 'bango',  width: 12 },
    { key: 'item',   width: 16 },
    { key: 'temp',   width: 8  },
    { key: 'qty',    width: 8  },
    { key: 'note',   width: 28 },
  ]

  // R1 title
  ws.addRow(['出貨總單', '', '', '', '', '', '', '', ''])
  ws.mergeCells('A1:I1')
  const titleRow = ws.getRow(1)
  titleRow.height = 20
  titleRow.getCell(1).fill  = fill(C_BLUE_LIGHT)
  titleRow.getCell(1).font  = { bold: true, size: 13, name: 'Arial' }
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }

  // R2 header
  ws.addRow(['配送門市', '出貨門市名稱', '配送日期', '配送單號', '配送品號', '品名', '溫層', '數量', '單位名稱'])
  const hdr = ws.getRow(2)
  hdr.height = 18
  hdr.eachCell({ includeEmpty: true }, cell => {
    cell.fill  = fill(C_BLUE_DARK)
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = allBorders()
  })

  // Data rows — one per (store × product)
  const dateStr = deliveryDate ?? null
  const dateNum  = dateStr ? dateStr.replace(/\//g, '').replace(/-/g, '').slice(4) : '' // MMDD
  let mddSeq = 0
  let totalQty = 0

  for (const lpa of stores) {
    const storeShip = roundData.stores.find(s => {
      const resolved = resolveLpa(s.storeCode)
      return resolved?.lpaNo === lpa.lpaNo
    })
    if (!storeShip || storeShip.items.length === 0) continue

    mddSeq++
    const lpaCode = `LPA${String(lpa.lpaNo).padStart(2, '0')}-${round}`
    const mddCode = deliveryDate
      ? `MDD${deliveryDate.replace(/\//g, '').replace(/-/g, '')}-${mddSeq}`
      : ''

    for (const item of storeShip.items) {
      ws.addRow([
        lpaCode,
        lpa.yushuName,
        deliveryDate ? new Date(deliveryDate.replace(/\//g, '-')) : null,
        mddCode || null,
        item.bango,
        item.name,
        '冷藏',
        item.qty,
        '請優先出紙箱而非保麗龍盒',
      ])
      totalQty += item.qty
      const rn = ws.rowCount
      const row = ws.getRow(rn)
      row.height = 16
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = { name: 'Arial', size: 10 }
        cell.border = allBorders()
        cell.alignment = { vertical: 'middle' }
      })
      // Format date cell
      const dateCell = row.getCell(3)
      if (deliveryDate) {
        dateCell.numFmt = 'yyyy/mm/dd'
        dateCell.alignment = { horizontal: 'center', vertical: 'middle' }
      }
      row.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' }
    }
  }

  // Total row
  ws.addRow([null, null, null, null, null, null, null, totalQty, null])
  const totalRn = ws.rowCount
  const tRow = ws.getRow(totalRn)
  tRow.height = 16
  tRow.eachCell({ includeEmpty: true }, cell => {
    cell.font = { bold: true, name: 'Arial', size: 10 }
    cell.border = allBorders()
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
}

// ── Public generators ─────────────────────────────────────────────────────────

export interface YushuGenerateOptions {
  shipmentNo: string     // e.g. 'S20260508XX' — full number
  batchLabel: string     // e.g. '蘋果10.3' — for file naming / sheet title
  deliveryDate: string   // 'YYYY-MM-DD' or 'YYYY/MM/DD'
  round: number
  masters: ProductMaster[]
  roundData: RoundData
  priceMap: PriceMap
}

/** Generate 店鋪貨單 Excel buffer */
export async function generateStoreShipmentExcel(opts: YushuGenerateOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const dateStr = opts.deliveryDate.replace(/-/g, '/')
  const productLines = buildProductLines(opts.masters)

  // All 12 stores in fixed order
  for (const lpa of LPA_STORES) {
    const storeShip = opts.roundData.stores.find(s => {
      const resolved = resolveLpa(s.storeCode)
      return resolved?.lpaNo === lpa.lpaNo
    })
    addStoreSheet(
      wb, lpa, opts.shipmentNo, dateStr,
      opts.masters, storeShip?.items ?? [],
      opts.priceMap, productLines,
    )
  }

  addSummarySheet(
    wb, LPA_STORES, opts.shipmentNo, dateStr,
    opts.masters, opts.roundData, opts.priceMap, productLines,
  )

  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** Generate 優儲出庫單 Excel buffer */
export async function generateChukuExcel(opts: YushuGenerateOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const dateStr = opts.deliveryDate.replace(/-/g, '/')
  const mmdd = dateStr.slice(5).replace('/', '')  // e.g. '0508'

  const regularStores = LPA_STORES.filter(s => s.lpaNo !== 12)  // LPA01-11
  const hokutoStore   = LPA_STORES.filter(s => s.lpaNo === 12)  // LPA12

  addChukuSheet(wb, `${mmdd}(除北蛋)`, regularStores, opts.round, dateStr, opts.roundData, opts.shipmentNo)
  addChukuSheet(wb, '未定(北蛋)',       hokutoStore,   opts.round, null,    opts.roundData, opts.shipmentNo)

  return Buffer.from(await wb.xlsx.writeBuffer())
}
