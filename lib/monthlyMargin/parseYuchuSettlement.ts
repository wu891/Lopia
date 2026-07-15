/**
 * lib/monthlyMargin/parseYuchuSettlement.ts
 *
 * 解析優儲有限公司開給日商夢多的倉儲月結對帳單。
 * 版面（2026-07 實測 202603/202603補/202604 三個月樣本，版面完全一致）：
 *   固定有一個「N總表」分頁，A1:D41，用關鍵字掃「合計(未稅)：」「應收帳款總計(含稅)：」
 *   兩列，抓同列下一欄的數字。不用固定列號（18/20）——樣本雖然剛好都在那，但用關鍵字比較
 *   耐得住 Colin 手動調整格式時多插一列費用項目。
 *   金額儲存格實際值含小數（如 33300.75）但畫面顯示成整數，讀出來要 Math.round()。
 */
import * as XLSX from 'xlsx'

export interface ParsedYuchuSettlement {
  sheetName: string
  untaxedTotal: number | null   // 合計(未稅)
  taxedTotal: number | null     // 應收帳款總計(含稅)
  warnings: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellStr(v: any): string {
  if (v == null) return ''
  return String(v).replace(/　/g, ' ').trim()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellNum(v: any): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v).replace(/[^0-9.\-]/g, '')
  if (!s) return null
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}

function findSummarySheet(wb: XLSX.WorkBook): string | null {
  // 分頁名含月份會變（「202603總表」→「202604總表」），用「包含『總表』」比對
  const candidates = wb.SheetNames.filter(n => n.includes('總表'))
  return candidates[0] ?? wb.SheetNames[0] ?? null
}

export function parseYuchuSettlementWorkbook(buf: Buffer): ParsedYuchuSettlement {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheetName = findSummarySheet(wb)
  if (!sheetName) return { sheetName: '', untaxedTotal: null, taxedTotal: null, warnings: ['檔案沒有任何分頁'] }

  const ws = wb.Sheets[sheetName]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grid: any[][] = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null })

  let untaxedTotal: number | null = null
  let taxedTotal: number | null = null
  const warnings: string[] = []

  for (const row of grid) {
    for (let c = 0; c < row.length; c++) {
      const text = cellStr(row[c])
      if (!text) continue
      if (untaxedTotal == null && text.includes('合計') && text.includes('未稅')) {
        untaxedTotal = cellNum(row[c + 1])
      }
      if (taxedTotal == null && text.includes('應收帳款總計') && text.includes('含稅')) {
        taxedTotal = cellNum(row[c + 1])
      }
    }
  }

  if (untaxedTotal == null) warnings.push(`分頁「${sheetName}」找不到「合計(未稅)：」這一列`)
  if (taxedTotal == null) warnings.push(`分頁「${sheetName}」找不到「應收帳款總計(含稅)：」這一列`)

  return {
    sheetName,
    untaxedTotal: untaxedTotal != null ? Math.round(untaxedTotal) : null,
    taxedTotal: taxedTotal != null ? Math.round(taxedTotal) : null,
    warnings,
  }
}
