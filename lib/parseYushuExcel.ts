/**
 * parseYushuExcel.ts
 *
 * Parses two Excel files for the 優儲出貨單 generator:
 *   1. 庫存管理表 — master product list + per-round per-store shipment detail
 *   2. 計画書 (台湾ロピアりんごXX.xlsx) — product structure + unit prices
 */

import * as XLSX from 'xlsx'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Category = 'サンふじ' | '王林'

/** One entry in the master product list (from 庫存管理表 sheet 1) */
export interface ProductMaster {
  bango: string      // e.g. '000430'
  name: string       // e.g. '丸秀 36玉'
  category: Category // derived from 産地
  tama: number       // pieces per box, e.g. 36
}

/** One shipped item for a store in a given round */
export interface ShipmentItem {
  bango: string
  name: string
  qty: number
}

/** Shipment data for one store in one round */
export interface StoreShipment {
  storeCode: string      // abbrev key: '台中', '北蛋', etc.
  items: ShipmentItem[]
}

/** All store shipments for one round */
export interface RoundData {
  round: number
  stores: StoreShipment[]
}

/** Price per category (same price regardless of 玉数) */
export interface PriceMap {
  [category: string]: number   // 'サンふじ' → 2232, '王林' → 2223
}

export interface YushuParseResult {
  masters: ProductMaster[]
  rounds: RoundData[]
  availableRounds: number[]
}

export interface PlanParseResult {
  priceMap: PriceMap
  /** All (category, tama) combos that appear in this round's 計画書 */
  productLines: { category: Category; tama: number }[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** 産地 → Category */
const CATEGORY_MAP: Record<string, Category> = {
  '北海道産':    'サンふじ',
  '青森サンふじ': 'サンふじ',
  '王林':        '王林',
}

/** Extract 玉数 from product name like '丸秀 36玉' → 36 */
function extractTama(name: string): number {
  const m = name.match(/(\d+)玉/)
  return m ? parseInt(m[1]) : 0
}

// ── Parse 庫存管理表 ──────────────────────────────────────────────────────────

export async function parseKanriExcel(buffer: ArrayBuffer): Promise<YushuParseResult> {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })

  // 1. Parse master list from first sheet
  const masterSheet = wb.Sheets[wb.SheetNames[0]]
  const masters = parseMasterSheet(masterSheet)

  // 2. Parse round sheets (第X回出貨明細)
  const rounds: RoundData[] = []
  for (const sn of wb.SheetNames) {
    const m = sn.match(/第(\d+)回出貨明細/)
    if (!m) continue
    const round = parseInt(m[1])
    const ws = wb.Sheets[sn]
    const stores = parseRoundSheet(ws)
    rounds.push({ round, stores })
  }

  const availableRounds = rounds.map(r => r.round).sort((a, b) => a - b)
  return { masters, rounds, availableRounds }
}

function parseMasterSheet(ws: XLSX.WorkSheet): ProductMaster[] {
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: null }) as (string | number | null)[][]
  const masters: ProductMaster[] = []

  for (const row of rows) {
    const bango = row[0]
    if (!bango || typeof bango !== 'string' || !/^\d{6}$/.test(bango)) continue
    const name   = String(row[1] ?? '')
    const sanchi = String(row[2] ?? '')
    const category = CATEGORY_MAP[sanchi]
    if (!category) continue
    const tama = extractTama(name)
    if (!tama) continue
    masters.push({ bango, name, category, tama })
  }

  return masters
}

/** Parse one 第X回出貨明細 sheet — extracts from "各門市出貨番号明細" section */
function parseRoundSheet(ws: XLSX.WorkSheet): StoreShipment[] {
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })

  // Find "各門市出貨番号明細" header row
  let startRow = -1
  for (let i = 0; i < rows.length; i++) {
    const first = String(rows[i][0] ?? '')
    if (first.includes('各門市出貨番号明細')) { startRow = i + 1; break }
  }
  if (startRow < 0) return []

  // Skip the column header row (門市 | 番号 | 品名 | 數量 | 計畫...)
  startRow += 1

  const stores: StoreShipment[] = []
  let currentStore: StoreShipment | null = null

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i]
    const col0 = String(row[0] ?? '').trim()
    const col1 = String(row[1] ?? '').trim()
    const col2 = String(row[2] ?? '').trim()
    const col3 = row[3]

    if (!col1 && !col2) continue  // fully empty row → skip

    // New store row: col0 has store name
    if (col0 && col0 !== '') {
      // strip special suffixes like '(下段)', '(下段/特價)' — treat as same store
      const storeKey = col0.replace(/[\s　]*(下段|下段\/特價).*$/, '').trim()
      // Find or create store
      currentStore = stores.find(s => s.storeCode === storeKey) ?? null
      if (!currentStore) {
        currentStore = { storeCode: storeKey, items: [] }
        stores.push(currentStore)
      }
    }

    if (!currentStore) continue

    // Parse product row: col1=番号, col2=品名, col3=數量
    const bango = col1.match(/^\d{6}$/) ? col1 : null
    if (!bango || !col2) continue
    const qty = typeof col3 === 'number' ? col3 : parseFloat(String(col3 ?? '0')) || 0
    if (qty <= 0) continue

    currentStore.items.push({ bango, name: col2, qty })
  }

  return stores
}

// ── Parse 計画書 (台湾ロピアりんご) ──────────────────────────────────────────

/**
 * Parses the 計画書 for a specific round.
 * Sheet names follow pattern: N回目店名 (e.g., '5回目台中', '5回目北蛋')
 * Reads any sheet matching the round number and builds:
 *   - priceMap: category → price
 *   - productLines: all (category, tama) combos present
 */
export async function parsePlanExcel(
  buffer: ArrayBuffer,
  round: number
): Promise<PlanParseResult> {
  const wb = XLSX.read(buffer, { type: 'array' })

  const priceMap: PriceMap = {}
  const lineSet = new Map<string, { category: Category; tama: number }>()

  const prefix = `${round}回目`
  for (const sn of wb.SheetNames) {
    if (!sn.startsWith(prefix)) continue
    const ws = wb.Sheets[sn]
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })

    // Row 0 = header, rows 1+ = data
    // Columns: A=玉数, B=品種, C=ケース, D=数量, E=原価
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const tamaRaw = row[0]
      const catRaw  = String(row[1] ?? '').trim()
      const price    = typeof row[4] === 'number' ? row[4] : null

      if (!tamaRaw || !catRaw) continue
      const tama = typeof tamaRaw === 'number' ? tamaRaw : parseInt(String(tamaRaw))
      if (!tama || isNaN(tama)) continue

      // Normalise category name
      const category: Category = catRaw === '王林' ? '王林' : 'サンふじ'

      // Track price (first non-null value wins)
      if (price && !priceMap[category]) priceMap[category] = price

      // Track product lines
      const key = `${category}-${tama}`
      if (!lineSet.has(key)) lineSet.set(key, { category, tama })
    }
  }

  // Sort: サンふじ first (asc tama), then 王林 (asc tama)
  const productLines = Array.from(lineSet.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category === 'サンふじ' ? -1 : 1
    return a.tama - b.tama
  })

  return { priceMap, productLines }
}
