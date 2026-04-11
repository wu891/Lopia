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
  '台中':   'LaLaport 台中店',
  '桃園':   '桃園春日店',
  '中和':   '新北中和環球店',
  '新荘':   '新莊宏匯店',
  '新莊':   '新莊宏匯店',
  '高雄':   '高雄漢神巨蛋店',
  '高雄巨蛋': '高雄漢神巨蛋店',
  '巨蛋':   '高雄漢神巨蛋店',
  '北蛋':   '台北大巨蛋店',
  '大巨蛋': '台北大巨蛋店',
  '台北巨蛋': '台北大巨蛋店',
  '南港':   '南港 LaLaport 店',
  'IKEA':   'IKEA 台中南屯店',
  'イケア': 'IKEA 台中南屯店',
  '夢時':   '高雄夢時代店',
  '夢時代': '高雄夢時代店',
  '北門':   '台南小北門店',
  'MOP':    '台南三井 Outlet 店',
  'mop':    '台南三井 Outlet 店',
  '漢神':   '台中漢神中港店',
  '中漢':   '台中漢神中港店',
}

// Matches "1回目" or "1か目" at the start of a sheet name
const ROUND_RE = /^(\d+)[回か]目/

// Sheets to skip
const EXCLUDE_SHEETS = new Set([
  '彙整_商品總數', '請款単', '総数', '総量', '総計', 'summary',
])

export interface ParsedDeliveryRound {
  roundNo: number
  /** Stores with their total box count for this round */
  stores: { name: string; boxes: number }[]
}

/**
 * Call this in a client component after obtaining the file's ArrayBuffer.
 * Dynamically imports 'xlsx' so the heavy library only loads on demand.
 */
export async function parseDeliveryExcel(
  buffer: ArrayBuffer
): Promise<ParsedDeliveryRound[]> {
  // Dynamic import keeps the xlsx bundle out of the main JS chunk
  const XLSX = await import('xlsx')

  const wb = XLSX.read(buffer, { type: 'array', cellFormula: false, cellDates: true })

  const sheets = wb.SheetNames.filter(n => {
    const b = n.trim()
    return (
      !EXCLUDE_SHEETS.has(b) &&
      !b.startsWith('出貨単_') &&
      !b.startsWith('彙整')
    )
  })

  const isMultiRound = sheets.some(s => ROUND_RE.test(s.trim()))

  // roundNo → storeName → totalBoxes
  const roundAccum = new Map<number, Map<string, number>>()

  for (const sn of sheets) {
    const ws = wb.Sheets[sn]
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
      defval: null,
      raw: true,
    })

    let roundNo: number
    let storeRaw: string

    if (isMultiRound) {
      const m = sn.trim().match(ROUND_RE)
      if (!m) continue
      roundNo = parseInt(m[1], 10)
      storeRaw = sn.trim().replace(ROUND_RE, '').trim()
    } else {
      roundNo = 1
      storeRaw = sn.trim()
    }

    if (!storeRaw) continue

    // Map shorthand → full store name (fall back to raw if unknown)
    const storeName = EXCEL_STORE_MAP[storeRaw] ?? storeRaw

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

    // Sum box counts across all products for this store+round
    let totalBoxes = 0
    for (let r = hdrIdx + 1; r < rows.length; r++) {
      const row = rows[r]
      if (!row) continue
      const productName = String(row[1] ?? '').trim()
      const cases = row[2]
      if (!productName || typeof cases !== 'number' || cases <= 0) continue
      totalBoxes += cases
    }

    if (totalBoxes === 0) continue

    if (!roundAccum.has(roundNo)) roundAccum.set(roundNo, new Map())
    const storeMap = roundAccum.get(roundNo)!
    storeMap.set(storeName, (storeMap.get(storeName) ?? 0) + totalBoxes)
  }

  // Sort by round number and convert to array
  return Array.from(roundAccum.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([roundNo, storeMap]) => ({
      roundNo,
      stores: Array.from(storeMap.entries()).map(([name, boxes]) => ({
        name,
        boxes,
      })),
    }))
}
