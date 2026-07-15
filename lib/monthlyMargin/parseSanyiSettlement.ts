/**
 * lib/monthlyMargin/parseSanyiSettlement.ts
 *
 * 解析三義物流的月結費用明細（單頁逐日寬表，跟優儲的固定41x4總表版面完全不同）。
 *
 * ⚠️ 信心度較低：目前只有 1 個月樣本（115-03，即 2026年3月）可驗證，版面是否每月都
 * 一樣穩定還不確定。Colin 已知情並接受風險——抓錯了之後再補樣本調規則。
 *
 * 用「同列往右找第一個數字」而非固定欄位（如 N37），因為只有一份樣本，不敢賭標籤跟數字
 * 一定緊鄰；同列掃描對「標籤跟數字中間隔了合計/小計等說明欄」的情況也扛得住。
 */
import * as XLSX from 'xlsx'

export interface ParsedSanyiSettlement {
  sheetName: string
  untaxedSubtotal: number | null  // 未稅小計
  taxAmount: number | null        // 稅額
  billedTotal: number | null      // 請款金額（含稅）
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

// 找到標籤文字所在儲存格後，取同一列「最右邊」那個數字（不是最靠近標籤那個）。
// 「未稅小計」那列前面還有一串按費用類別分的小計（理貨/拆櫃/等待費…），真正的列總計
// 是最後一欄；只取「標籤右邊第一個數字」會誤抓成第一個類別的小計（實測踩到這個坑）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findValueRightOfLabel(grid: any[][], labelIncludes: string): number | null {
  for (const row of grid) {
    for (let c = 0; c < row.length; c++) {
      if (!cellStr(row[c]).includes(labelIncludes)) continue
      let last: number | null = null
      for (let k = c + 1; k < row.length; k++) {
        const n = cellNum(row[k])
        if (n != null) last = n
      }
      if (last != null) return last
    }
  }
  return null
}

export function parseSanyiSettlementWorkbook(buf: Buffer): ParsedSanyiSettlement {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheetName = wb.SheetNames[0] ?? ''
  if (!sheetName) return { sheetName: '', untaxedSubtotal: null, taxAmount: null, billedTotal: null, warnings: ['檔案沒有任何分頁'] }

  const ws = wb.Sheets[sheetName]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grid: any[][] = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null })

  const untaxedSubtotal = findValueRightOfLabel(grid, '未稅小計')
  const taxAmount = findValueRightOfLabel(grid, '稅額')
  const billedTotal = findValueRightOfLabel(grid, '請款金額')

  const warnings: string[] = []
  if (untaxedSubtotal == null) warnings.push(`分頁「${sheetName}」找不到「未稅小計」`)
  if (billedTotal == null) warnings.push(`分頁「${sheetName}」找不到「請款金額」`)
  // 交叉核對：未稅+稅額應該≈請款金額，兜不起來就警告（可能抓到不相干的儲存格）
  if (untaxedSubtotal != null && taxAmount != null && billedTotal != null) {
    const diff = Math.abs(untaxedSubtotal + taxAmount - billedTotal)
    if (diff > 1) warnings.push(`三義對帳單金額兜不起來：未稅${untaxedSubtotal}+稅額${taxAmount}≠請款${billedTotal}（差${diff.toFixed(1)}），可能抓錯儲存格，請人工核對`)
  }

  return {
    sheetName,
    untaxedSubtotal: untaxedSubtotal != null ? Math.round(untaxedSubtotal) : null,
    taxAmount: taxAmount != null ? Math.round(taxAmount) : null,
    billedTotal: billedTotal != null ? Math.round(billedTotal) : null,
    warnings,
  }
}
