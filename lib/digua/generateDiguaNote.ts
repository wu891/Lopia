/**
 * 地瓜（茨城）＋大學芋 店鋪貨單／納品書 產生引擎
 *
 * 白話重點：這支程式「不會自己組樣式」——它只會打開 template.xlsx（一份格式已經
 * 跟真實出貨過的檔案核對過、確認正確的範本），複製裡面已經排好版的分頁，
 * 然後只改「數字」跟「店名」這幾格，其他顏色/字型/框線全部原封不動繼承。
 * 這是吸取教訓後的做法：之前試過照文字規則自己重刻樣式，結果漏了很多細節
 * （字型抄成相近但不同的、列高漏設、框線漏掉）。詳見記憶
 * excel-format-fidelity-clone-not-rebuild。
 *
 * 公式格（小計/稅額/合計）不是單純「不動」——複製過來的公式格會帶著「借款店」
 * 原本的舊快取結果，Excel 打開時雖然會自動重算成正確答案，但任何直接讀檔案
 * 的工具（包括核對用的程式）會看到錯的舊數字。所以這裡每次改完輸入格之後，
 * 都會自己重新算一次，把正確答案連同公式一起寫回去，讀檔案跟開 Excel 看到的
 * 保證一致。
 *
 * 目前只涵蓋地瓜(茨城)＋大學芋這個品項組合、且只涵蓋 template.xlsx 裡已經有的
 * 11 間店（不含新開幕的台北美麗華——還沒有它的真實範例分頁可以複製）。
 */
import ExcelJS from 'exceljs'
import path from 'path'

// ── 型別 ─────────────────────────────────────────────────────────

export interface DiguaGradeQty {
  L: number
  M: number
  S: number
  '2S': number
}

export interface DiguaStoreInput {
  /** 對應 DIGUA_STORES 的 id */
  storeId: string
  grades: DiguaGradeQty
  /** 大學芋箱數，0 代表這間店這批沒有大學芋（會省略整個大學芋區塊，比照真實格式） */
  daigakuimo: number
}

export interface DiguaNoteInput {
  /** 出貨單號，例如 S2026071801 */
  shipmentNo: string
  /** 配送日期，YYYY-MM-DD */
  deliveryDate: string
  /** 只放「這批真的有出貨」的店，沒有的店不要放進來（不會產生空白分頁） */
  stores: DiguaStoreInput[]
}

export interface DiguaStoreMeta {
  id: string
  /** 這份文件專用的分頁命名（沿用範本既有慣例，跟 lib/stores.ts 的 name_zh 用字順序不同，不要混用） */
  sheetName: string
}

// ── 常數（跟範本裡的真實儲存格位置、價格規則一一對應，皆已核對真實檔案）──

const TEMPLATE_PATH = path.join(process.cwd(), 'lib', 'digua', 'template.xlsx')

export const DIGUA_STORES: DiguaStoreMeta[] = [
  { id: 'taichung-lalaport', sheetName: '台中LaLaport店' },
  { id: 'taoyuan-chunri', sheetName: '桃園春日店' },
  { id: 'zhonghe-global', sheetName: '新北中和環球店' },
  { id: 'xinzhuang-honghui', sheetName: '新莊宏匯店' },
  { id: 'kaohsiung-hanshin-dome', sheetName: '高雄漢神巨蛋店' },
  { id: 'nangang-lalaport', sheetName: '南港LaLaport店' },
  { id: 'taichung-ikea', sheetName: 'IKEA台中南屯店' },
  { id: 'kaohsiung-dream-times', sheetName: '高雄夢時代店' },
  { id: 'tainan-xiaobei', sheetName: '台南小北門店' },
  { id: 'tainan-mitsui', sheetName: '台南三井Outlet店' },
  { id: 'taichung-hanshin', sheetName: '台中漢神中港店' },
]

// 結構樣板來源：借一間「含大學芋區塊」、一間「不含大學芋區塊」的真實分頁當骨架
// （店名等一下會被覆蓋，選哪間店不影響內容——但實測發現 台中LaLaport店 在
//  【產地茨城】小計列有一格字型跟其他 10 間店不一致的歷史遺留問題，避開它、
//  改借 桃園春日店，跟其餘 with-shape 店互相核對過是一致的）。
const WITH_DGI_SHAPE_SOURCE = '桃園春日店'
const WITHOUT_DGI_SHAPE_SOURCE = '南港LaLaport店'

const GRADE_PRICE = 885 // 地瓜(茨城) 單價，免稅
const DGI_UNIT_PRICE = 1950 // 大學芋未稅單價
const DGI_IRISU = 10 // 大學芋入數
const TAX_RATE = 0.05 // 大學芋加工品稅率

const GRADE_ORDER: (keyof DiguaGradeQty)[] = ['L', 'M', 'S', '2S']
// 每店分頁裡，四個規格的箱數輸入格固定在第 10~13 列的 C 欄（已用真實檔案核對過，
// 11 間店結構一致）；大學芋箱數輸入格固定在第 16 列 C 欄（只有 with-shape 分頁才有）。
const GRADE_ROWS: Record<keyof DiguaGradeQty, number> = { L: 10, M: 11, S: 12, '2S': 13 }
const DGI_ROW = 16

// 總表分頁：11 間店的數量欄固定在 D~N（第 4~14 欄），跟 DIGUA_STORES 順序一一對應。
const SUMMARY_STORE_COL_START = 4
const SUMMARY_STORE_COL_END = SUMMARY_STORE_COL_START + DIGUA_STORES.length - 1 // N = 14

// ── 共用工具 ─────────────────────────────────────────────────────

async function loadTemplate(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(TEMPLATE_PATH)
  return wb
}

/** 把來源分頁「整份複製」到目標 workbook（欄寬/列高/樣式/合併儲存格全部照抄），回傳新分頁 */
function cloneSheet(sourceWb: ExcelJS.Workbook, sourceName: string, targetWb: ExcelJS.Workbook, newSheetName: string): ExcelJS.Worksheet {
  const src = sourceWb.getWorksheet(sourceName)
  if (!src) throw new Error(`範本缺少分頁「${sourceName}」，template.xlsx 可能被改壞了`)

  const dst = targetWb.addWorksheet(newSheetName)
  dst.columns = src.columns.map(c => ({ width: c && 'width' in c ? c.width : undefined }))

  src.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const dstRow = dst.getRow(rowNumber)
    dstRow.height = row.height
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const dstCell = dstRow.getCell(colNumber)
      dstCell.value = cell.value
      dstCell.font = cell.font
      dstCell.fill = cell.fill
      dstCell.border = cell.border
      dstCell.alignment = cell.alignment
      if (cell.numFmt) dstCell.numFmt = cell.numFmt
    })
  })

  // 合併儲存格放在寫值之後：合併後只有左上角那一格的樣式才是 Excel 實際顯示用的,
  // 其餘格子會被合併機制重置，這是正常現象、不影響外觀。
  for (const merge of src.model.merges || []) dst.mergeCells(merge)

  return dst
}

/** 把 richText 陣列裡「文字內容」換掉，但每個 run 的字型設定原封不動繼承（不手刻字型） */
function patchRichText(
  original: ExcelJS.CellRichTextValue,
  replacements: Record<number, string>
): ExcelJS.CellRichTextValue {
  return {
    richText: original.richText.map((run, i) =>
      i in replacements ? { font: run.font, text: replacements[i] } : run
    ),
  }
}

function toSlashDate(isoDate: string): string {
  return isoDate.replace(/-/g, '/')
}

/** 設定一格「公式 + 正確算好的結果」，讀檔案的人跟開 Excel 的人看到的數字保證一致 */
function setFormula(ws: ExcelJS.Worksheet, addr: string, formula: string, result: number) {
  ws.getCell(addr).value = { formula, result } as ExcelJS.CellFormulaValue
}

function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// ── 單店分頁 ─────────────────────────────────────────────────────

function buildStoreSheet(template: ExcelJS.Workbook, out: ExcelJS.Workbook, meta: DiguaStoreMeta, input: DiguaStoreInput, shipmentNo: string, deliveryDate: string) {
  const hasDgi = input.daigakuimo > 0
  const shapeSource = hasDgi ? WITH_DGI_SHAPE_SOURCE : WITHOUT_DGI_SHAPE_SOURCE
  const ws = cloneSheet(template, shapeSource, out, meta.sheetName)

  // 收貨店鋪名稱：不手打文字，直接從這間店自己在範本裡的真實分頁「整格搬過來」
  // （範本裡的店名是混合字型的富文字，手打會把富文字攤平成單一字型，等於重蹈覆轍）
  const identitySheet = template.getWorksheet(meta.sheetName)
  if (identitySheet) {
    const identityCell = identitySheet.getCell('B7')
    ws.getCell('B7').value = identityCell.value
    ws.getCell('B7').font = identityCell.font // richText 儲存格外層 font 也要一起搬，避免跟複製來的骨架殘留不一致
  }

  ws.getCell('B5').value = shipmentNo
  // 日期格式（YYYY/MM/DD 或 yyyy/mm/dd）直接沿用範本 clone 過來的 numFmt，不重新指定，避免大小寫跟範本不一致
  ws.getCell('B6').value = new Date(deliveryDate)

  // ── 地瓜(茨城) 區塊：四個規格箱數是輸入格，小計/合計是公式格，兩種都要正確 ──
  let subQty = 0
  let subAmt = 0
  for (const grade of GRADE_ORDER) {
    const row = GRADE_ROWS[grade]
    const qty = input.grades[grade]
    const amt = qty * GRADE_PRICE
    subQty += qty
    subAmt += amt
    ws.getRow(row).getCell(3).value = qty
    setFormula(ws, `E${row}`, `C${row}*D${row}`, amt)
  }
  setFormula(ws, 'C14', 'SUM(C10:C13)', subQty)
  setFormula(ws, 'E14', 'SUM(E10:E13)', subAmt)

  if (hasDgi) {
    const dgiAmt = input.daigakuimo * DGI_UNIT_PRICE
    const taxAmt = Math.floor(dgiAmt * TAX_RATE)
    const grandQty = subQty + input.daigakuimo
    const grandAmt = subAmt + dgiAmt + taxAmt

    ws.getRow(DGI_ROW).getCell(3).value = input.daigakuimo
    setFormula(ws, 'E16', 'C16*D16', dgiAmt)
    setFormula(ws, 'C17', 'C16', input.daigakuimo)
    setFormula(ws, 'E17', 'E16', dgiAmt)
    setFormula(ws, 'E18', 'INT(E17*0.05)', taxAmt)
    setFormula(ws, 'C19', 'C14+C17', grandQty)
    setFormula(ws, 'E19', 'E14+E17+E18', grandAmt)
  } else {
    setFormula(ws, 'C15', 'C14', subQty)
    setFormula(ws, 'E15', 'E14', subAmt)
  }
}

// ── 總表_茨城：L/M/S/2S 各一列，11 間店橫排，右側總箱數/總金額是公式 ──

function buildIbarakiSummarySheet(
  template: ExcelJS.Workbook,
  out: ExcelJS.Workbook,
  stores: DiguaStoreInput[],
  shipmentNo: string,
  deliveryDate: string
) {
  const ws = cloneSheet(template, '總表_茨城', out, '總表_茨城')

  const titleCell = ws.getCell('A1')
  titleCell.value = patchRichText(titleCell.value as ExcelJS.CellRichTextValue, {
    1: toSlashDate(deliveryDate),
    3: shipmentNo,
  })

  const byStoreId = new Map(stores.map(s => [s.storeId, s]))
  const gradeRowNumber: Record<keyof DiguaGradeQty, number> = { L: 3, M: 4, S: 5, '2S': 6 }
  const totalRow = 7
  const totalQtyCol = SUMMARY_STORE_COL_END + 1 // O
  const totalAmtCol = totalQtyCol + 1 // P

  const perStoreColTotalQty = new Array(DIGUA_STORES.length).fill(0)
  const perStoreColTotalAmt = new Array(DIGUA_STORES.length).fill(0)

  for (const grade of GRADE_ORDER) {
    const row = gradeRowNumber[grade]
    let rowQty = 0
    DIGUA_STORES.forEach((meta, idx) => {
      const col = SUMMARY_STORE_COL_START + idx
      const qty = byStoreId.get(meta.id)?.grades[grade] ?? 0
      ws.getRow(row).getCell(col).value = qty
      rowQty += qty
      perStoreColTotalQty[idx] += qty
      perStoreColTotalAmt[idx] += qty * GRADE_PRICE
    })
    const rowAmt = rowQty * GRADE_PRICE
    const colRange = `${colLetter(SUMMARY_STORE_COL_START)}${row}:${colLetter(SUMMARY_STORE_COL_END)}${row}`
    setFormula(ws, `${colLetter(totalQtyCol)}${row}`, `SUM(${colRange})`, rowQty)
    setFormula(ws, `${colLetter(totalAmtCol)}${row}`, `C${row}*${colLetter(totalQtyCol)}${row}`, rowAmt)
  }

  // 【產地茨城】合計列：每欄（含每間店、總箱數、總金額）都是上面四列的直向加總
  let grandQty = 0
  let grandAmt = 0
  DIGUA_STORES.forEach((_, idx) => {
    const col = SUMMARY_STORE_COL_START + idx
    const letter = colLetter(col)
    setFormula(ws, `${letter}${totalRow}`, `SUM(${letter}3:${letter}6)`, perStoreColTotalQty[idx])
    grandQty += perStoreColTotalQty[idx]
    grandAmt += perStoreColTotalAmt[idx]
  })
  setFormula(ws, `${colLetter(totalQtyCol)}${totalRow}`, `SUM(${colLetter(totalQtyCol)}3:${colLetter(totalQtyCol)}6)`, grandQty)
  setFormula(ws, `${colLetter(totalAmtCol)}${totalRow}`, `SUM(${colLetter(totalAmtCol)}3:${colLetter(totalAmtCol)}6)`, grandAmt)
}

// ── 總表_大學芋：只有一列商品，右側總箱數/未稅金額/稅額/含稅合計是公式 ──

function buildDaigakuimoSummarySheet(
  template: ExcelJS.Workbook,
  out: ExcelJS.Workbook,
  stores: DiguaStoreInput[],
  shipmentNo: string,
  deliveryDate: string
) {
  const ws = cloneSheet(template, '總表_大學芋', out, '總表_大學芋')

  const titleCell = ws.getCell('A1')
  titleCell.value = patchRichText(titleCell.value as ExcelJS.CellRichTextValue, {
    1: toSlashDate(deliveryDate),
    3: shipmentNo,
  })

  const byStoreId = new Map(stores.map(s => [s.storeId, s]))
  const dataRow = 3
  const totalRow = 4
  const totalQtyCol = SUMMARY_STORE_COL_END + 1 // O
  const untaxedAmtCol = totalQtyCol + 1 // P
  const taxCol = untaxedAmtCol + 1 // Q
  const taxedTotalCol = taxCol + 1 // R

  let totalQty = 0
  DIGUA_STORES.forEach((meta, idx) => {
    const col = SUMMARY_STORE_COL_START + idx
    const qty = byStoreId.get(meta.id)?.daigakuimo ?? 0
    ws.getRow(dataRow).getCell(col).value = qty
    totalQty += qty
  })

  const untaxedAmt = totalQty * DGI_UNIT_PRICE
  const taxAmt = Math.floor(untaxedAmt * TAX_RATE)
  const taxedTotal = untaxedAmt + taxAmt
  const colRange = `${colLetter(SUMMARY_STORE_COL_START)}${dataRow}:${colLetter(SUMMARY_STORE_COL_END)}${dataRow}`

  setFormula(ws, `${colLetter(totalQtyCol)}${dataRow}`, `SUM(${colRange})`, totalQty)
  setFormula(ws, `${colLetter(untaxedAmtCol)}${dataRow}`, `C${dataRow}*${colLetter(totalQtyCol)}${dataRow}`, untaxedAmt)
  setFormula(ws, `${colLetter(taxCol)}${dataRow}`, `INT(${colLetter(untaxedAmtCol)}${dataRow}*0.05)`, taxAmt)
  setFormula(ws, `${colLetter(taxedTotalCol)}${dataRow}`, `${colLetter(untaxedAmtCol)}${dataRow}+${colLetter(taxCol)}${dataRow}`, taxedTotal)

  // 合計列：只有一個商品，合計＝那一列本身
  DIGUA_STORES.forEach((meta, idx) => {
    const col = SUMMARY_STORE_COL_START + idx
    const letter = colLetter(col)
    setFormula(ws, `${letter}${totalRow}`, `${letter}${dataRow}`, byStoreId.get(meta.id)?.daigakuimo ?? 0)
  })
  setFormula(ws, `${colLetter(totalQtyCol)}${totalRow}`, `${colLetter(totalQtyCol)}${dataRow}`, totalQty)
  setFormula(ws, `${colLetter(untaxedAmtCol)}${totalRow}`, `${colLetter(untaxedAmtCol)}${dataRow}`, untaxedAmt)
  setFormula(ws, `${colLetter(taxCol)}${totalRow}`, `${colLetter(taxCol)}${dataRow}`, taxAmt)
  setFormula(ws, `${colLetter(taxedTotalCol)}${totalRow}`, `${colLetter(taxedTotalCol)}${dataRow}`, taxedTotal)
}

// ── 主入口 ────────────────────────────────────────────────────────

export async function generateDiguaNoteWorkbook(input: DiguaNoteInput): Promise<ExcelJS.Workbook> {
  if (input.stores.length === 0) {
    throw new Error('沒有任何店鋪有出貨數量，沒有東西可以產生')
  }
  const knownIds = new Set(DIGUA_STORES.map(s => s.id))
  for (const s of input.stores) {
    if (!knownIds.has(s.storeId)) {
      throw new Error(`未知店鋪 id「${s.storeId}」——這份範本目前只涵蓋既有 11 間店，新店要先補一份真實範例分頁才能支援`)
    }
  }

  const template = await loadTemplate()
  const out = new ExcelJS.Workbook()

  for (const meta of DIGUA_STORES) {
    const s = input.stores.find(x => x.storeId === meta.id)
    if (!s) continue // 這批沒出貨給這間店，不產生分頁
    buildStoreSheet(template, out, meta, s, input.shipmentNo, input.deliveryDate)
  }

  buildIbarakiSummarySheet(template, out, input.stores, input.shipmentNo, input.deliveryDate)
  buildDaigakuimoSummarySheet(template, out, input.stores, input.shipmentNo, input.deliveryDate)

  return out
}

export { GRADE_PRICE, DGI_UNIT_PRICE, DGI_IRISU, TAX_RATE }
