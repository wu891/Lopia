/**
 * lib/driveScan/parseStoreOrder.ts
 *
 * Drive 自動扣帳 — 解析「店鋪貨單」Excel。
 * ───────────────────────────────────────────────────────────────
 * 貨單有三種產生器版型（通用5欄 / 優儲蘋果5欄 / apple11 6欄）加上手動改過的
 * Google 試算表，格式相當混亂，所以這裡「不用固定列號」，全部用文字錨點掃：
 *   - 「出貨單號：」值 = S 單號（一律以內容為準，檔名不可信）
 *   - 「配送日期：」值 = 配送日
 *   - 「收貨店鋪：」值 = 店名（分頁名稱不可信，曾出現分頁名≠內容）
 *     ↑ 標籤與值可能同一格（手打）或分兩格，兩種都吃
 *   - 出現「商品名稱」的列 = 表頭列，用表頭文字決定每一欄是什麼
 *   - 「合計 / 未稅合計 / 小計 / 稅」開頭的列 = 表格結束標記，跳過
 *
 * 安全原則（審查後強化）：任何「讀不準」的情況都不硬猜，改標成 hardWarnings，
 * 讓 sync 把整張單當異常（不寫、不鏡像、不封存），通知人工處理。會 hard 的有：
 *   - 分頁有商品列但讀不到收貨店鋪
 *   - 店名對不到 12+3 標準門市（避免在 Notion 亂建門市）
 *   - 表頭缺「箱數」欄、或箱數欄有值卻讀不出數字（可能全形數字以外的怪值）
 *   - 同一檔同一天出現兩個不同 S 單號（無法判斷哪張是本尊）
 *
 * 已知地雷（全部在此處理）：
 *   - 蘋果單「佔位列」箱數空白→略過；地瓜單「0 箱列」→略過
 *   - 數字可能 "2,020"、2020、"NT$15,300"、全形 "１０" → 一律正規化再清
 *   - 同檔殘留舊模板分頁（7月檔混5月）→ 依（S單號＋配送日）分組，只取配送日最新那組
 *   - 合計列「合　計」中間全形空白 U+3000；日文「箱数」「税」也要當標記
 */

import * as XLSX from 'xlsx'
import { EXCEL_STORE_MAP } from '../parseDeliveryExcel'
import { STORES } from '../stores'

export interface ParsedOrderRow {
  name: string
  spec: string
  boxes: number
  price: number | null
}

export interface ParsedStoreTab {
  sheetName: string
  sNo: string | null
  deliveryDate: string | null
  storeRaw: string | null
  store: string | null
  rows: ParsedOrderRow[]
  totalBoxes: number
  warnings: string[]
  blocking: boolean   // 表頭壞掉 / 箱數讀不出 → 這張單不能自動入帳
}

export interface ParsedWorkbook {
  activeTabs: ParsedStoreTab[]
  staleTabs: ParsedStoreTab[]
  skippedSheets: string[]
  dominantSno: string | null
  dominantDate: string | null
  warnings: string[]       // 軟警告：會顯示在通知裡，但仍照常入帳
  hardWarnings: string[]   // 硬警告：整張單當異常、不寫入
}

// 12 營業中 + 3 即將開幕的標準門市名，外加會出現在貨單的非 LOPIA 門市
const CANONICAL_STORES = new Set<string>([...STORES.map(s => s.name_zh), '台南大遠百'])

// ── 小工具 ────────────────────────────────────────────────────────────────────

// 全形數字/小數點/負號 → 半形（手打 IME 會打成「１０」）
function normalizeDigits(s: string): string {
  return s.replace(/[０-９．－]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
}

// 儲存格 → 乾淨字串：全形空白→半形、去頭尾空白
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellStr(v: any): string {
  if (v == null) return ''
  return String(v).replace(/　/g, ' ').trim()
}

// 儲存格是不是「真的空」（null 或空字串）；用來區分「佔位空白」vs「有值但讀不出」
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isBlank(v: any): boolean {
  return v == null || cellStr(v) === ''
}

// "2,020" / "NT$15,300" / 2020 / 全形"１０" → 數字；解析不出來回 null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellNum(v: any): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const cleaned = normalizeDigits(String(v)).replace(/[^0-9.\-]/g, '')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return isFinite(n) ? n : null
}

// 日期 → YYYY-MM-DD：吃 "2026/07/03"、"2026-7-3"、Excel 日期序號
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toIsoDate(v: any): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = normalizeDigits(cellStr(v))
  const m = s.match(/(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

// 店名對照：完全比對 → 子字串 fallback（最長 key 優先）→ 原文
// 跟 lib/parseDeliveryExcel.ts 既有邏輯一致，共用同一張 EXCEL_STORE_MAP
export function resolveStoreName(raw: string): string {
  const trimmed = raw.trim()
  let name = EXCEL_STORE_MAP[trimmed]
  if (!name) {
    const lower = trimmed.toLowerCase()
    let bestKey = ''
    for (const key of Object.keys(EXCEL_STORE_MAP)) {
      if (lower.includes(key.toLowerCase()) && key.length > bestKey.length) bestKey = key
    }
    name = bestKey ? EXCEL_STORE_MAP[bestKey] : trimmed
  }
  return name
}

// 合計 / 小計 / 稅（含日文税、簡體计） / 簽名 之類的「非商品」列
function isMarkerText(s: string): boolean {
  if (!s) return false
  return /^合\s*計|合\s*計$|未[稅税]合計|含[稅税]|小[計计]|^[稅税]|收貨簽名|簽名|茶?色框|^備註/.test(s)
}

function isNonStoreSheet(sheetName: string, grid: string[][]): boolean {
  const n = sheetName.trim()
  if (n === '總表' || n.startsWith('總表')) return true
  if (n.includes('出庫')) return true
  const firstRowText = (grid[0] ?? []).join(' ')
  if (/出貨總表|出庫總單|出貨總單/.test(firstRowText)) return true
  return false
}

// ── 單一分頁解析 ──────────────────────────────────────────────────────────────

function parseSheet(sheetName: string, ws: XLSX.WorkSheet): ParsedStoreTab | 'non-store' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null })
  const grid: string[][] = raw.map(row => (row ?? []).map(cellStr))

  if (isNonStoreSheet(sheetName, grid)) return 'non-store'

  const tab: ParsedStoreTab = {
    sheetName, sNo: null, deliveryDate: null, storeRaw: null, store: null,
    rows: [], totalBoxes: 0, warnings: [], blocking: false,
  }

  let col: { name: number; spec: number; boxes: number; price: number } | null = null

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]
    const rawRow = raw[r] ?? []

    // 1) 標籤列：出貨單號／配送日期／收貨店鋪
    //    值可能跟標籤同一格（手打「收貨店鋪：高雄夢時代店」）或在右邊一格
    //    「出貨日期」「客戶名稱」是舊版（driveScan 上線前，約 2026 年 3 月以前）貨單用的標籤，
    //    當時是純手工出貨單、跟現在的產生器版型完全不同（無「配送日期」「收貨店鋪」字樣）。
    //    月結毛利要回頭看舊月份，所以額外認這兩個當同義詞；新版檔案不含這兩個字串，不影響現有解析。
    for (let c = 0; c < row.length; c++) {
      const lm = row[c].match(/^(出貨單號|配送日期|出貨日期|收貨店鋪|客戶名稱)[：:]?\s*(.*)$/)
      if (!lm) continue
      const kind = lm[1]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rawVal: any = lm[2].trim() || null
      let strVal = lm[2].trim()
      if (!strVal) {
        for (let k = c + 1; k < rawRow.length; k++) {
          if (!isBlank(rawRow[k])) { rawVal = rawRow[k]; strVal = cellStr(rawRow[k]); break }
        }
      }
      if (kind === '出貨單號' && !tab.sNo && strVal) {
        const up = normalizeDigits(strVal).toUpperCase()
        if (/^S\d{8,12}$/.test(up)) tab.sNo = up
        else { tab.sNo = strVal; tab.warnings.push(`出貨單號格式特殊：「${strVal}」`) }
      } else if ((kind === '配送日期' || kind === '出貨日期') && !tab.deliveryDate) {
        tab.deliveryDate = toIsoDate(rawVal)
      } else if ((kind === '收貨店鋪' || kind === '客戶名稱') && !tab.storeRaw && strVal) {
        tab.storeRaw = strVal
        tab.store = resolveStoreName(strVal)
      }
    }

    // 2) 表頭列：包含「商品名稱」→ 建立欄位對應
    const nameCol = row.findIndex(s => s === '商品名稱')
    if (nameCol >= 0) {
      const findCol = (pred: (s: string) => boolean) => row.findIndex(pred)
      col = {
        name: nameCol,
        spec: findCol(s => s === '規格' || s === '入數'),
        boxes: findCol(s => s === '箱數' || s === '箱数'),   // 容忍日文「箱数」
        price: findCol(s => s.includes('單價')),
      }
      if (col.boxes < 0) {
        tab.warnings.push(`表頭列缺「箱數」欄（第 ${r + 1} 列），該段商品無法讀取`)
        tab.blocking = true
        col = null
      }
      continue
    }

    // 3) 商品列
    if (!col) continue
    const name = row[col.name] ?? ''
    if (!name || isMarkerText(name)) continue
    const boxCell = rawRow[col.boxes]
    const boxes = cellNum(boxCell)
    if (boxes == null) {
      // 真的空白 = 佔位列，略過；有值卻讀不出 = 可疑，擋整張單
      if (!isBlank(boxCell)) {
        tab.warnings.push(`「${name}」箱數「${cellStr(boxCell)}」讀不出數字`)
        tab.blocking = true
      }
      continue
    }
    if (boxes === 0) continue
    if (boxes < 0 || !Number.isInteger(boxes)) {
      tab.warnings.push(`「${name}」箱數異常（${boxes}）`)
      tab.blocking = true
      continue
    }
    tab.rows.push({
      name,
      spec: col.spec >= 0 ? (row[col.spec] ?? '') : '',
      boxes,
      price: col.price >= 0 ? cellNum(rawRow[col.price]) : null,
    })
  }

  tab.totalBoxes = tab.rows.reduce((s, x) => s + x.boxes, 0)
  return tab
}

// ── 整本工作簿解析 ────────────────────────────────────────────────────────────

export function parseStoreOrderWorkbook(buf: Buffer): ParsedWorkbook {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const out: ParsedWorkbook = {
    activeTabs: [], staleTabs: [], skippedSheets: [],
    dominantSno: null, dominantDate: null, warnings: [], hardWarnings: [],
  }

  const tabs: ParsedStoreTab[] = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const parsed = parseSheet(sheetName, ws)
    if (parsed === 'non-store') { out.skippedSheets.push(sheetName); continue }
    tabs.push(parsed)
  }

  // 依（S單號｜配送日）分組
  const groups = new Map<string, ParsedStoreTab[]>()
  for (const t of tabs) {
    if (!t.sNo || !t.deliveryDate) {
      if (t.rows.length > 0 || t.storeRaw) {
        out.warnings.push(`分頁「${t.sheetName}」缺出貨單號或配送日期，無法入帳`)
        out.staleTabs.push(t)
      }
      continue
    }
    const key = `${t.sNo}|${t.deliveryDate}`
    const arr = groups.get(key) ?? []
    arr.push(t)
    groups.set(key, arr)
  }

  if (groups.size === 0) {
    if (out.skippedSheets.length > 0) {
      out.warnings.push(`檔案只有總表／出庫分頁（${out.skippedSheets.join('、')}），沒有店鋪分頁`)
    }
    return out
  }

  // 找「配送日最新」那組當本尊。toIsoDate 一律補零，故字串比較＝時序比較
  const keys = Array.from(groups.keys())
  const maxDate = keys.map(k => k.split('|')[1]).sort((a, b) => b.localeCompare(a))[0]
  const newest = keys.filter(k => k.split('|')[1] === maxDate)

  if (newest.length > 1) {
    // 同一天出現兩個不同 S 單號 → 無法判斷本尊，整檔當異常（不硬猜）
    out.hardWarnings.push(
      `同一天（${maxDate}）出現多個出貨單號：${newest.map(k => k.split('|')[0]).join('、')}，請拆成不同檔案，這次不自動入帳`)
    // 仍把資訊塞進 warnings 供通知顯示
    for (const k of keys) out.staleTabs.push(...(groups.get(k) ?? []))
    return out
  }

  const dominantKey = newest[0]
  const [sno, date] = dominantKey.split('|')
  out.dominantSno = sno
  out.dominantDate = date
  out.activeTabs = groups.get(dominantKey) ?? []
  for (const k of keys) {
    if (k === dominantKey) continue
    const arr = groups.get(k) ?? []
    out.staleTabs.push(...arr)
    out.warnings.push(`偵測到舊分頁組（${k.replace('|', '，')}）共 ${arr.length} 頁，已略過不入帳`)
  }

  // 把分頁層警告收上來（本尊分頁的才進通知）
  for (const t of out.activeTabs) {
    for (const w of t.warnings) out.warnings.push(`分頁「${t.sheetName}」：${w}`)
  }

  // ── 硬檢查：任何一個本尊分頁讀不準 → 整張單當異常 ──────────────────────────────
  for (const t of out.activeTabs) {
    if (t.blocking) {
      out.hardWarnings.push(`分頁「${t.sheetName}」表頭或箱數讀不準，這張單不自動入帳`)
    }
    if (t.rows.length > 0 && !t.store) {
      out.hardWarnings.push(`分頁「${t.sheetName}」有 ${t.rows.length} 筆商品但讀不到收貨店鋪，這張單不自動入帳`)
    }
    if (t.store && !CANONICAL_STORES.has(t.store)) {
      out.hardWarnings.push(`分頁「${t.sheetName}」店名「${t.storeRaw}」對不到標準門市，這張單不自動入帳`)
    }
  }

  // 同組內同店兩個分頁 → 提醒（軟警告）
  const seenStores = new Map<string, string>()
  for (const t of out.activeTabs) {
    if (!t.store || t.rows.length === 0) continue
    const prev = seenStores.get(t.store)
    if (prev) out.warnings.push(`同一張單「${t.store}」出現在兩個分頁（${prev}、${t.sheetName}），請確認是否重複`)
    else seenStores.set(t.store, t.sheetName)
  }

  return out
}
