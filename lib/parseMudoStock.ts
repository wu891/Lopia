/**
 * parseMudoStock.ts
 *
 * 解析「日商夢多 庫存明細」Excel（倉庫每次出貨後給的最新剩餘庫存）。
 * 只抽出「蘋果」品項，把混寫在「商品名稱」一欄裡的 品種 / 等級 / 玉數 拆開，
 * 連同 6 碼品番與剩餘箱數，產出 StockEntry[]，作為等級分配引擎(allocateGrades)的庫存底。
 *
 * 倉庫檔格式（單一 Sheet，表頭約在第 5 列）：
 *   倉別名稱 | 商品編號 | 商品名稱(全名) | 規格說明 | 批次 | 溫層 | 庫存 | 出貨包裝階
 *
 * 蘋果判定：規格為「NN PCS/箱」且名稱含「玉」→ 蘋果；「NN入/箱」或含「地瓜」→ 排除。
 */

import * as XLSX from 'xlsx'
import { AppleVariety, APPLE_VARIETIES, VARIETY_ALIASES } from './appleGrades'

export interface StockEntry {
  bango: string         // 6 碼品番，例 '000489'
  rawName: string       // 倉庫原始品名，例 '有袋ふじ 秀 28玉'
  variety: AppleVariety // 品種
  grade: string         // 等級，例 '秀' / '特A' / '特秀(金)' / '丸秀'
  tama: number          // 玉數，例 28
  qty: number           // 剩餘箱數
  temp: string          // 溫層（冷藏品/冷凍品）
}

export interface MudoParseResult {
  apples: StockEntry[]
  excluded: { bango: string; rawName: string; qty: number }[] // 非蘋果（地瓜等），保留供顯示
}

/** 從規格「26PCS/箱」抓玉數；抓不到再退而從品名「26玉」抓 */
function extractTama(spec: string, name: string): number {
  const m = spec.match(/(\d+)\s*PCS/i)
  if (m) return parseInt(m[1], 10)
  const m2 = name.match(/(\d+)\s*玉/)
  return m2 ? parseInt(m2[1], 10) : 0
}

/** 從品名抓品種；找不到品種 token 但出現 サンふじ 專屬等級字 → 視為 サンふじ */
function detectVariety(name: string): AppleVariety | null {
  for (const [token, v] of Object.entries(VARIETY_ALIASES)) {
    if (name.includes(token)) return v
  }
  if (/特上|丸秀/.test(name)) return 'サンふじ' // 例「特上 26玉」未寫 Sun Fuji
  return null
}

/** 等級 = 品名去掉品種 token、玉數、單獨數字後剩下的字 */
function extractGrade(name: string): string {
  let g = name
  for (const token of Object.keys(VARIETY_ALIASES)) g = g.split(token).join('')
  g = g.replace(/\d+\s*玉/g, '')      // 去 NN玉
  g = g.replace(/\bSun\s*Fuji\b/gi, '')
  g = g.replace(/(?<![A-Za-z(])\d+(?![A-Za-z)])/g, '') // 去單獨數字（保留 特A 之類）
  return g.replace(/\s+/g, ' ').trim()
}

/**
 * 蘋果判定：規格為「NN PCS/箱」且非地瓜即視為蘋果。
 * （蘋果按顆數計 → 規格用 PCS；地瓜加工品用「NN入/箱」。名稱不一定寫「玉」，
 *   例如「特選 26 Sun Fuji」就沒有玉字，故不能硬要求名稱含「玉」。
 *   品種偵測 detectVariety 會再做二次把關，抓不出品種者另行排除。）
 */
function isApple(spec: string, name: string): boolean {
  if (/地瓜/.test(name)) return false
  return /\d+\s*PCS/i.test(spec)
}

/** 找出表頭列與各欄索引（用欄名定位，較耐格式漂移） */
function locateColumns(rows: (string | number | null)[][]): {
  headerRow: number
  col: { bango: number; name: number; spec: number; temp: number; qty: number }
} | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i].map(c => String(c ?? '').trim())
    const bango = r.findIndex(c => c.includes('商品編號') || c === '品番')
    const name = r.findIndex(c => c.includes('商品名稱'))
    const qty = r.findIndex(c => c === '庫存' || c.includes('庫存'))
    if (bango >= 0 && name >= 0 && qty >= 0) {
      const spec = r.findIndex(c => c.includes('規格'))
      const temp = r.findIndex(c => c.includes('溫層'))
      return { headerRow: i, col: { bango, name, spec, temp, qty } }
    }
  }
  return null
}

export async function parseMudoStock(buffer: ArrayBuffer): Promise<MudoParseResult> {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })

  const loc = locateColumns(rows)
  const apples: StockEntry[] = []
  const excluded: MudoParseResult['excluded'] = []
  if (!loc) return { apples, excluded }

  const { col } = loc
  for (let i = loc.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]
    const bango = String(r[col.bango] ?? '').trim()
    if (!/^\d{6}$/.test(bango)) continue
    const name = String(r[col.name] ?? '').trim()
    const spec = col.spec >= 0 ? String(r[col.spec] ?? '').trim() : ''
    const temp = col.temp >= 0 ? String(r[col.temp] ?? '').trim() : ''
    const qtyRaw = r[col.qty]
    const qty = typeof qtyRaw === 'number' ? qtyRaw : parseFloat(String(qtyRaw ?? '0')) || 0

    if (!isApple(spec, name)) {
      excluded.push({ bango, rawName: name, qty })
      continue
    }
    const variety = detectVariety(name)
    const tama = extractTama(spec, name)
    if (!variety || !tama) {
      // 蘋果但拆不出品種/玉數 → 當例外排除，避免錯誤扣帳
      excluded.push({ bango, rawName: name + '（無法判定品種/玉數）', qty })
      continue
    }
    const grade = extractGrade(name) || '（無等級）'
    apples.push({ bango, rawName: name, variety, grade, tama, qty, temp })
  }

  // 過濾掉非蘋果品種（保險：APPLE_VARIETIES 之外的不留）
  return {
    apples: apples.filter(a => APPLE_VARIETIES.includes(a.variety)),
    excluded,
  }
}
