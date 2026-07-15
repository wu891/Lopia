/**
 * lib/monthlyMargin/parseCashflow.ts
 *
 * 解析「【支社】現金流.xlsx」的「２月進口管理表」的副本分頁，抓每批進口的營收與成本，
 * 供月結毛利頁比對「出貨單→來源批次」用。方法論見 000_Agent/skills/monthly-margin/SKILL.md。
 *
 * 用文字錨點找欄位（掃表頭列找標籤文字定位欄），不寫死欄位字母——Colin 之後增減欄位不會壞。
 *
 * 已知版面（2026-07 實測 gid 分頁「２月進口管理表」的副本）：
 *   税金／通関費／三義費用／優儲費用 這四組，標籤字落在「有無旗標」欄，金額在緊鄰的下一欄
 *   （合併儲存格造成，旗標本身不可靠——有樣本 flag=FALSE 但金額欄仍有值，見下方 readAmountNextTo）。
 *   其他費用／燻煙費／農薬検査費 這三個欄位，標籤字直接落在金額欄本身。
 *   仕入原価(元) 是公式 =ROUNDUP(仕入原価(円)*匯率,0)，xlsx 套件讀 .v 會拿到公式算好的快取值。
 */
import * as XLSX from 'xlsx'

export interface CashflowBatch {
  id: number                // 這批在表裡的序號（第幾個抓到的批次列），當唯一 key 用——Invoice 不保證唯一
  invoice: string          // Invoice 欄（如 CITY20260102、LOP-001），供「商品+售上高」交叉比對備援用
  sNos: string[]            // 出荷票欄，一格可以填多個 S 單號（逗號/頓號/換行分隔，一批供多次出貨時常見）
  product: string
  importDate: string | null
  totalBoxes: number       // CTNS 欄＝該批總箱數，用來把整批成本按箱數分攤到各次出貨；0＝這欄沒填或讀不到
  revenue: number          // 売上高（現金流本身記的，非出貨單營收，只供交叉比對）
  totalCost: number        // 仕入原価(元) + 稅金 + 通関費 + 三義 + 優儲 + 其他 + 燻煙 + 農薬，全部加總
  costBreakdown: {
    importCost: number
    tax: number
    customsFee: number
    sanyiFee: number
    yuchuFee: number
    otherFee: number
    fumigationFee: number
    pesticideFee: number
  }
}

export interface ParsedCashflow {
  sheetName: string
  batches: CashflowBatch[]
  warnings: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellStr(v: any): string {
  if (v == null) return ''
  return String(v).replace(/　/g, ' ').trim()
}

// 空白回 null；非空但解析不出數字（公式錯誤 #REF!、洽談中之類的佔位文字）也回 null——
// 呼叫端要能區分「本來就沒填」跟「填了但讀不出來」，後者要示警，不能悄悄當 0。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellNum(v: any): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v).replace(/[^0-9.\-]/g, '')
  if (!s) return null
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}

// 數字欄位取值：解析不出來但儲存格非空，記一筆警告後當 0（金額欄用，避免整批成本悄悄漏算）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function numOrZero(v: any, label: string, invoice: string, warnings: string[]): number {
  const n = cellNum(v)
  if (n != null) return n
  if (v != null && cellStr(v) !== '') {
    warnings.push(`批次「${invoice}」的「${label}」欄位讀不到數字（值：${JSON.stringify(cellStr(v))}），先當 0 計算，請人工確認`)
  }
  return 0
}

// 一格可能填一個或多個 S 單號（一批供多次出貨時，Colin 會用逗號/頓號/換行把好幾張單號都填進同一格）。
// 用逗號、頓號、換行、空白切開，每一段各自驗證格式，只留符合 S 單號格式的；其餘文字（如「有四筆」
// 這種備註）自然被濾掉。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSNos(v: any): string[] {
  const raw = cellStr(v)
  if (!raw) return []
  const parts = raw.toUpperCase().split(/[,，、\s\/]+/).map(s => s.trim()).filter(Boolean)
  return parts.filter(s => /^S\d{8,12}$/.test(s))
}

// 直接標在金額欄上的標籤（找到就是那一欄）
const DIRECT_LABELS = {
  invoice: 'Invoice',
  sNo: '出荷票',
  product: '商品',
  importDate: '輸入日',
  totalBoxes: 'CTNS',
  revenue: '売上高',
  importCostTWD: '仕入原価(元)',
  otherFee: 'その他費用',
  fumigationFee: '燻煙費',
  pesticideFee: '農薬検査費',
} as const

// 標籤落在「旗標」欄，金額在緊鄰右邊一欄（合併儲存格造成，旗標本身不可靠不拿來用）
const OFFSET_LABELS = {
  tax: '税金',
  customsFee: '通関費',
  sanyiFee: '三義費用',
  yuchuFee: '優儲費用',
} as const

type DirectKey = keyof typeof DIRECT_LABELS
type OffsetKey = keyof typeof OFFSET_LABELS

interface ColumnMap {
  direct: Record<DirectKey, number>
  offset: Record<OffsetKey, number> // 存的已經是「金額欄」的 index（標籤欄 index + 1）
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findTargetSheet(wb: XLSX.WorkBook): { name: string; grid: any[][] } | null {
  // 「進口管理表」或「副本」字樣的分頁優先試；都沒有再退而掃全部分頁
  const preferred = wb.SheetNames.filter(n => n.includes('進口管理表') || n.includes('副本'))
  const order = [...preferred, ...wb.SheetNames.filter(n => !preferred.includes(n))]
  for (const name of order) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null })
    const headerText = grid.slice(0, 4).map(r => (r || []).map(cellStr).join('|')).join('|')
    // 「副本」分頁欄位最完整（有出荷票／三義費用／優儲費用），跟舊版２月表區分開
    if (headerText.includes('出荷票') && headerText.includes('売上高') && headerText.includes('仕入原価')) {
      return { name, grid }
    }
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findColumns(grid: any[][]): { cols: ColumnMap; headerRow: number } | null {
  const direct: Partial<Record<DirectKey, number>> = {}
  const offset: Partial<Record<OffsetKey, number>> = {}
  let headerRow = -1

  for (let r = 0; r < Math.min(6, grid.length); r++) {
    const row = grid[r] || []
    for (let c = 0; c < row.length; c++) {
      const text = cellStr(row[c])
      if (!text) continue
      for (const [key, label] of Object.entries(DIRECT_LABELS)) {
        if (direct[key as DirectKey] == null && text === label) {
          direct[key as DirectKey] = c
          headerRow = Math.max(headerRow, r)
        }
      }
      for (const [key, label] of Object.entries(OFFSET_LABELS)) {
        if (offset[key as OffsetKey] == null && text === label) {
          offset[key as OffsetKey] = c + 1 // 金額在標籤欄的下一欄
          headerRow = Math.max(headerRow, r)
        }
      }
    }
  }

  const requiredDirect: DirectKey[] = ['invoice', 'sNo', 'product', 'revenue', 'importCostTWD']
  for (const k of requiredDirect) if (direct[k] == null) return null

  return { cols: { direct: direct as Record<DirectKey, number>, offset: offset as Record<OffsetKey, number> }, headerRow }
}

export function parseCashflowWorkbook(buf: Buffer): ParsedCashflow {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const target = findTargetSheet(wb)
  if (!target) {
    return { sheetName: '', batches: [], warnings: ['找不到含「出荷票／売上高／仕入原価」欄位的進口管理表分頁'] }
  }
  const { name, grid } = target
  const found = findColumns(grid)
  if (!found) {
    return { sheetName: name, batches: [], warnings: [`分頁「${name}」表頭列讀不到必要欄位（Invoice/出荷票/商品/売上高/仕入原価(元)）`] }
  }
  const { cols, headerRow } = found
  const warnings: string[] = []
  const batches: CashflowBatch[] = []

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || []
    const product = cellStr(row[cols.direct.product])
    // 附屬列（通關單號追蹤列等）商品欄一律空白，不是完整批次記錄，略過不當商品批次
    if (!product) continue

    const invoice = cellStr(row[cols.direct.invoice])
    const sNos = parseSNos(row[cols.direct.sNo])
    const revenue = numOrZero(row[cols.direct.revenue], '売上高', invoice, warnings)
    const importCost = numOrZero(row[cols.direct.importCostTWD], '仕入原価(元)', invoice, warnings)
    // CTNS 沒填是常見情況（不是每批都記總箱數），不當警告；用 cellNum 直接取，null 就當 0
    const totalBoxes = cellNum(row[cols.direct.totalBoxes]) ?? 0

    const tax = cols.offset.tax != null ? numOrZero(row[cols.offset.tax], '税金', invoice, warnings) : 0
    const customsFee = cols.offset.customsFee != null ? numOrZero(row[cols.offset.customsFee], '通関費', invoice, warnings) : 0
    const sanyiFee = cols.offset.sanyiFee != null ? numOrZero(row[cols.offset.sanyiFee], '三義費用', invoice, warnings) : 0
    const yuchuFee = cols.offset.yuchuFee != null ? numOrZero(row[cols.offset.yuchuFee], '優儲費用', invoice, warnings) : 0
    const otherFee = cols.direct.otherFee != null ? numOrZero(row[cols.direct.otherFee], 'その他費用', invoice, warnings) : 0
    const fumigationFee = cols.direct.fumigationFee != null ? numOrZero(row[cols.direct.fumigationFee], '燻煙費', invoice, warnings) : 0
    const pesticideFee = cols.direct.pesticideFee != null ? numOrZero(row[cols.direct.pesticideFee], '農薬検査費', invoice, warnings) : 0

    const totalCost = importCost + tax + customsFee + sanyiFee + yuchuFee + otherFee + fumigationFee + pesticideFee

    batches.push({
      id: batches.length,
      invoice,
      sNos,
      product,
      importDate: cellStr(row[cols.direct.importDate]) || null,
      totalBoxes,
      revenue,
      totalCost,
      costBreakdown: { importCost, tax, customsFee, sanyiFee, yuchuFee, otherFee, fumigationFee, pesticideFee },
    })
  }

  if (batches.length === 0) warnings.push(`分頁「${name}」讀不到任何批次資料（表頭抓到但下面沒有列）`)
  return { sheetName: name, batches, warnings }
}
