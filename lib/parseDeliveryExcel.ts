/**
 * parseDeliveryExcel
 *
 * Reads a LOPIA supplier Excel file and returns per-round, per-store
 * total box counts — ready to be loaded into the DeliveryPlan form.
 *
 * Excel conventions understood:
 *   Multi-round:  sheet name = "1回目 台中"  → round 1, store "台中"
 *   Single-round: sheet name = "台中"         → round 1, store "台中"
 *
 * Within each sheet the header row contains one of:
 *   ケース / 数量 / 箱數 / 商品名
 * Columns: [0] 入数/箱  [1] 商品名  [2] ケース数(箱)  [4] 原価
 */

// Maps the shorthand store names used in Excel sheets
// to the full display names used in our STORES list.
export const EXCEL_STORE_MAP: Record<string, string> = {
  // ── 較長/精確的別名放前面，避免子字串 fallback 誤判 ──
  '台中漢神':   '台中漢神中港店',   // S0805, S1001, S1003, S1004
  '漢神台中':   '台中漢神中港店',   // S0404, S0802
  '漢神(台中)': '台中漢神中港店',   // S0803
  '高雄巨蛋':   '高雄漢神巨蛋店',
  '台北巨蛋':   '台北大巨蛋店',
  '大巨蛋':     '台北大巨蛋店',
  '夢時代':     '高雄夢時代店',
  '小北門':     '台南小北門店',
  'らら台中':   'LaLaport 台中店',
  // ── 一般縮寫 ──
  '台中':   'LaLaport 台中店',
  '桃園':   '桃園春日店',
  '中和':   '新北中和環球店',
  '新荘':   '新莊宏匯店',
  '新莊':   '新莊宏匯店',
  '高雄':   '高雄漢神巨蛋店',
  '巨蛋':   '高雄漢神巨蛋店',
  '北蛋':   '台北大巨蛋店',
  '南港':   '南港 LaLaport 店',
  'IKEA':   'IKEA 台中南屯店',
  'イケア': 'IKEA 台中南屯店',
  '夢時':   '高雄夢時代店',
  '北門':   '台南小北門店',
  '台南':   '台南小北門店',         // S1101 全店貨單的「台南」= 小北門（確認）
  'MOP':    '台南三井 Outlet 店',
  'mop':    '台南三井 Outlet 店',
  'MO':     '台南三井 Outlet 店',   // 多張貨單使用 MO 作為三井縮寫
  '漢神':   '台中漢神中港店',
  '中漢':   '台中漢神中港店',
}

// Matches "1回目" or "1か目" at the start of a sheet name
const ROUND_RE = /^(\d+)[回か]目/
// Matches "台中(4)" — round number in parentheses at end of sheet name
const ROUND_PAREN_RE = /^(.+?)\((\d+)\)$/

// Sheets to skip
const EXCLUDE_SHEETS = new Set([
  '彙整_商品總數', '請款単', '総数', '総量', '総計', 'summary',
])

export interface ParsedProduct {
  name: string           // 商品名稱 (e.g., "Fresh Grapes(Shine muscat) 8房")
  boxSpec: string        // 箱入數 (e.g., "8房", "5房")
  quantity: number       // 箱數
  unitPrice: number      // 單價 (原価)
  category: string       // 商品類別 (default: "水果")
}

export interface ParsedDeliveryRound {
  roundNo: number
  /** Stores with their total box count for this round */
  stores: { name: string; boxes: number; products: ParsedProduct[] }[]
}

/**
 * Call this in a client component after obtaining the file's ArrayBuffer.
 * Dynamically imports 'xlsx' so the heavy library only loads on demand.
 * @param includeZero - if true, include products with 0 boxes (default false)
 * @param manualSheets - if provided, skip round detection and treat each sheet as a store in round 1
 */
export async function parseDeliveryExcel(
  buffer: ArrayBuffer,
  includeZero = false,
  manualSheets?: string[]
): Promise<ParsedDeliveryRound[]> {
  // Dynamic import keeps the xlsx bundle out of the main JS chunk
  const XLSX = await import('xlsx')

  const wb = XLSX.read(buffer, { type: 'array', cellFormula: false, cellDates: true })

  // Manual mode: user explicitly selected which sheets to parse
  if (manualSheets && manualSheets.length > 0) {
    const validSheets = manualSheets.filter(sn => wb.SheetNames.includes(sn))
    const storeMap = new Map<string, { totalBoxes: number; products: ParsedProduct[] }>()

    for (const sn of validSheets) {
      const ws = wb.Sheets[sn]
      const wsRef = ws['!ref']
      if (wsRef) {
        const range = XLSX.utils.decode_range(wsRef)
        for (const addr of Object.keys(ws)) {
          if (addr.startsWith('!')) continue
          const cell = XLSX.utils.decode_cell(addr)
          if (cell.r > range.e.r) range.e.r = cell.r
          if (cell.c > range.e.c) range.e.c = cell.c
        }
        ws['!ref'] = XLSX.utils.encode_range(range)
      }

      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
        header: 1, defval: null, raw: true,
      })

      // Resolve store name via map, fallback to raw sheet name
      const storeRaw = sn.trim()
      let storeName = EXCEL_STORE_MAP[storeRaw]
      if (!storeName) {
        const lower = storeRaw.toLowerCase()
        let bestKey = ''
        for (const key of Object.keys(EXCEL_STORE_MAP)) {
          if (lower.includes(key.toLowerCase()) && key.length > bestKey.length) bestKey = key
        }
        storeName = bestKey ? EXCEL_STORE_MAP[bestKey] : storeRaw
      }

      // Find header row
      let hdrIdx = -1
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row?.some(c => c != null && (
          String(c).includes('ケース') || String(c).includes('数量') ||
          String(c).includes('箱數') || String(c).includes('商品名')
        ))) { hdrIdx = i; break }
      }
      if (hdrIdx === -1) continue

      let totalBoxes = 0
      const products: ParsedProduct[] = []
      for (let r = hdrIdx + 1; r < rows.length; r++) {
        const row = rows[r]
        if (!row) continue
        const productName = String(row[1] ?? '').trim()
        const casesRaw = row[2]
        const cases = typeof casesRaw === 'number' ? casesRaw : 0
        if (!productName) continue
        if (!includeZero && cases <= 0) continue
        totalBoxes += cases
        const boxSpecRaw = row[0]
        const boxSpec = boxSpecRaw != null ? String(boxSpecRaw).trim() : ''
        const priceRaw = row[4]
        const unitPrice = typeof priceRaw === 'number' ? priceRaw : 0
        products.push({
          name: productName,
          boxSpec: boxSpec ? `${boxSpec}房`.replace(/房房$/, '房') : '',
          quantity: cases,
          unitPrice,
          category: '水果',
        })
      }

      if (totalBoxes === 0 && !includeZero) continue

      const existing = storeMap.get(storeName)
      if (existing) {
        existing.totalBoxes += totalBoxes
        existing.products.push(...products)
      } else {
        storeMap.set(storeName, { totalBoxes, products })
      }
    }

    return [{
      roundNo: 1,
      stores: Array.from(storeMap.entries()).map(([name, data]) => ({
        name, boxes: data.totalBoxes, products: data.products,
      })),
    }]
  }

  const sheets = wb.SheetNames.filter(n => {
    const b = n.trim()
    return (
      !EXCLUDE_SHEETS.has(b) &&
      !b.startsWith('出貨単_') &&
      !b.startsWith('彙整')
    )
  })

  // Detect round naming convention
  const hasKaimeFormat = sheets.some(s => ROUND_RE.test(s.trim()))
  const hasParenFormat = sheets.some(s => ROUND_PAREN_RE.test(s.trim()))
  const isMultiRound = hasKaimeFormat || hasParenFormat

  // roundNo → storeName → { totalBoxes, products }
  const roundAccum = new Map<number, Map<string, { totalBoxes: number; products: ParsedProduct[] }>>()

  for (const sn of sheets) {
    const ws = wb.Sheets[sn]

    // Extend !ref to cover cells below any blank rows.
    // Excel sometimes sets !ref to stop before a mid-sheet blank row,
    // causing sheet_to_json to miss data in the section below the gap.
    const wsRef = ws['!ref']
    if (wsRef) {
      const range = XLSX.utils.decode_range(wsRef)
      for (const addr of Object.keys(ws)) {
        if (addr.startsWith('!')) continue
        const cell = XLSX.utils.decode_cell(addr)
        if (cell.r > range.e.r) range.e.r = cell.r
        if (cell.c > range.e.c) range.e.c = cell.c
      }
      ws['!ref'] = XLSX.utils.encode_range(range)
    }

    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
      defval: null,
      raw: true,
    })

    let roundNo: number
    let storeRaw: string

    if (isMultiRound) {
      if (hasKaimeFormat) {
        const m = sn.trim().match(ROUND_RE)
        if (!m) continue
        roundNo = parseInt(m[1], 10)
        storeRaw = sn.trim().replace(ROUND_RE, '').trim()
      } else {
        const m = sn.trim().match(ROUND_PAREN_RE)
        if (m) {
          storeRaw = m[1].trim()
          roundNo = parseInt(m[2], 10)
        } else {
          // Plain store name in a multi-round file → round 1
          roundNo = 1
          storeRaw = sn.trim()
        }
      }
    } else {
      roundNo = 1
      storeRaw = sn.trim()
    }

    if (!storeRaw) continue

    // Map shorthand → full store name
    // 1. Exact key match  2. Substring fallback (longest matching key wins)  3. Raw name
    let storeName = EXCEL_STORE_MAP[storeRaw]
    if (!storeName) {
      const lower = storeRaw.toLowerCase()
      let bestKey = ''
      for (const key of Object.keys(EXCEL_STORE_MAP)) {
        if (lower.includes(key.toLowerCase()) && key.length > bestKey.length) {
          bestKey = key
        }
      }
      storeName = bestKey ? EXCEL_STORE_MAP[bestKey] : storeRaw
    }

    // Find header row
    let hdrIdx = -1
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (
        row?.some(
          c =>
            c != null &&
            (String(c).includes('ケース') ||
              String(c).includes('数量') ||
              String(c).includes('箱數') ||
              String(c).includes('商品名'))
        )
      ) {
        hdrIdx = i
        break
      }
    }
    if (hdrIdx === -1) continue

    // Extract product details and sum box counts
    let totalBoxes = 0
    const products: ParsedProduct[] = []
    for (let r = hdrIdx + 1; r < rows.length; r++) {
      const row = rows[r]
      if (!row) continue
      const productName = String(row[1] ?? '').trim()
      const casesRaw = row[2]
      const cases = typeof casesRaw === 'number' ? casesRaw : 0
      if (!productName) continue
      if (!includeZero && cases <= 0) continue
      totalBoxes += cases

      // Per SKILL spec: A 欄 = 入數（箱入數 e.g. "5房"）
      const boxSpecRaw = row[0]
      const boxSpec = boxSpecRaw != null ? String(boxSpecRaw).trim() : ''

      // Per SKILL spec: E 欄 (index 4) = 原価（TWD 售價，不換算）
      const priceRaw = row[4]
      const unitPrice = typeof priceRaw === 'number' ? priceRaw : 0

      products.push({
        name: productName,
        boxSpec: boxSpec ? `${boxSpec}房`.replace(/房房$/, '房') : '',
        quantity: cases,
        unitPrice,
        category: '水果',
      })
    }

    if (totalBoxes === 0 && !includeZero) continue

    if (!roundAccum.has(roundNo)) roundAccum.set(roundNo, new Map())
    const storeMap = roundAccum.get(roundNo)!
    const existing = storeMap.get(storeName)
    if (existing) {
      existing.totalBoxes += totalBoxes
      existing.products.push(...products)
    } else {
      storeMap.set(storeName, { totalBoxes, products })
    }
  }

  // Sort by round number and convert to array
  return Array.from(roundAccum.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([roundNo, storeMap]) => ({
      roundNo,
      stores: Array.from(storeMap.entries()).map(([name, data]) => ({
        name,
        boxes: data.totalBoxes,
        products: data.products,
      })),
    }))
}
