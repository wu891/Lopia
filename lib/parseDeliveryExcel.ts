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
  // ── 非 LOPIA 門市但會出現在貨單，保留原名（必須在 fallback 子字串比對前先精確命中）──
  '台南大遠百': '台南大遠百',
  // ── 台南新光三越西門店（2026-08-21 開幕）──
  // ⚠️「西門」跟「台南」都是 2 個字，同長度時「先出現的 key 贏」，所以這三行一定要留在
  //    下面通用的 '台南' 之前。放錯位置的話「台南新光三越西門店」會被 '台南' 吃掉、
  //    整間店的貨會算到台南小北門店頭上（2026-08-19 S2026081901/S2026081903 實際踩過）。
  '台南新光三越西門店': '台南新光三越西門店',
  '新光三越': '台南新光三越西門店',
  '西門':     '台南新光三越西門店',
  // ── 較長/精確的別名放前面，避免子字串 fallback 誤判 ──
  '台中漢神':   '台中漢神中港店',   // S0805, S1001, S1003, S1004
  '漢神台中':   '台中漢神中港店',   // S0404, S0802
  '漢神(台中)': '台中漢神中港店',   // S0803
  '高雄巨蛋':   '高雄漢神巨蛋店',
  '台北巨蛋':   '台北大巨蛋店',
  '大巨蛋':     '台北大巨蛋店',
  '夢時代':     '高雄夢時代店',
  '小北門':     '台南小北門店',
  '美麗華':     '台北美麗華店',
  '大直':       '台北美麗華店',
  'らら台中':   'LaLaport 台中店',
  // 「台南三井Outlet店」這種寫法不含 MOP，只靠「台南」會誤判成小北門，
  // 所以補「三井／outlet」。三井要放在「台南」前面（同長度時先出現的 key 贏）。
  'outlet':     '台南三井 Outlet 店',
  '三井':       '台南三井 Outlet 店',
  // ── 即將開幕門市：不補的話「高雄漢神百貨店」會被「高雄」誤判成巨蛋、
  //    「台南SOGO新天店」會被「台南」誤判成小北門（長 key 優先，故放這幾個較長的）──
  '漢神百貨':   '高雄漢神百貨店',
  'SOGO':       '台南 SOGO 新天店',
  'sogo':       '台南 SOGO 新天店',
  '新天':       '台南 SOGO 新天店',
  // ── 對帳系統 STORE_MAP 有、這裡漏的縮寫，補齊避免落到原名新建門市 ──
  '南屯':       'IKEA 台中南屯店',
  '中港':       '台中漢神中港店',
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
  '美麗':   '台北美麗華店',
  '台南':   '台南小北門店',         // S1101 全店貨單的「台南」= 小北門（確認）
  'MOP':    '台南三井 Outlet 店',
  'mop':    '台南三井 Outlet 店',
  'MO':     '台南三井 Outlet 店',   // 多張貨單使用 MO 作為三井縮寫
  '漢神':   '台中漢神中港店',
  '中漢':   '台中漢神中港店',
}

/**
 * 分頁名（或縮寫）→ 完整門市名。**全站唯一一支**，前端後端都用這支。
 *
 * 白話：
 *   1. 先看有沒有一模一樣的 key（「夢時代」→ 高雄夢時代店）
 *   2. 沒有就找「包含在裡面、而且最長」的 key（「夢時代店」裡面有「夢時代」→ 高雄夢時代店）
 *   3. 還是找不到就原樣回傳（之後會被擋下來提醒，不會默默消失）
 *
 * ⚠️ 以前前端（出貨單產生頁）自己抄了一份「只做第 1 步」的版本，
 *    分頁名多一個字（例如「7回目夢時代店」）前端算出「夢時代店」、後端算出「高雄夢時代店」，
 *    兩邊對不起來 → 那間店的箱數整個變 0，總表也不會出現 → 就是「漏掉夢時代店」的原因。
 */
export function resolveStoreName(raw: string): string {
  return resolveStoreNameDetailed(raw).name
}

/**
 * 「純城市名」的 key。這幾個 key 只代表地理位置、不代表哪一間店，
 * 所以它們是最容易把「名單裡還沒有的新店」默默吃掉的兇手。
 * 例：新開的「台南新光三越西門店」→ 只命中 '台南' → 被判成台南小北門店。
 */
const WEAK_CITY_KEYS = new Set(['台中', '台南', '高雄', '桃園'])

export interface ResolvedStore {
  name: string
  /** exact = 對照表裡有一模一樣的名字；substring = 靠「包含」猜的；none = 完全對不到，原樣回傳 */
  matchedBy: 'exact' | 'substring' | 'none'
  /** 猜的時候是靠哪個 key 命中的 */
  key: string
  /**
   * true = 這個結果很可能是「猜錯的」，呼叫端應該擋下來問人，不要直接入帳。
   * 判定：靠「純城市名」猜到，而且原文既不等於那個城市名、也不等於猜出來的門市全名
   *       →「台南新光三越西門店」會 true（危險），「台南」「高雄漢神巨蛋店」會 false（安全）。
   */
  suspicious: boolean
}

/**
 * resolveStoreName 的完整版，額外回報「這個答案是查到的還是猜的」。
 * 貨單自動入帳一定要用這支，因為猜錯店名不會有任何錯誤訊息，貨會安靜地記到別間店去。
 */
export function resolveStoreNameDetailed(raw: string): ResolvedStore {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { name: trimmed, matchedBy: 'none', key: '', suspicious: false }
  const exact = EXCEL_STORE_MAP[trimmed]
  if (exact) return { name: exact, matchedBy: 'exact', key: trimmed, suspicious: false }
  const lower = trimmed.toLowerCase()
  let bestKey = ''
  for (const key of Object.keys(EXCEL_STORE_MAP)) {
    if (lower.includes(key.toLowerCase()) && key.length > bestKey.length) bestKey = key
  }
  if (!bestKey) return { name: trimmed, matchedBy: 'none', key: '', suspicious: false }
  const name = EXCEL_STORE_MAP[bestKey]
  const suspicious = WEAK_CITY_KEYS.has(bestKey) && trimmed !== bestKey && trimmed !== name
  return { name, matchedBy: 'substring', key: bestKey, suspicious }
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
  /**
   * 這一回目裡「有分頁、但一筆商品都讀不出來」的分頁。
   * 白話：Excel 裡明明有這一頁，程式卻讀不到東西（找不到表頭、或整頁都 0 箱）。
   * 以前這種分頁是默默跳過的，現在記下來讓上層可以擋下並告訴使用者。
   */
  skippedSheets?: { sheet: string; reason: string }[]
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
    const skippedSheets: { sheet: string; reason: string }[] = []

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

      // Resolve store name via map, fallback to raw sheet name（共用同一支解析函式）
      const storeRaw = sn.trim()
      const storeName = resolveStoreName(storeRaw)

      // Find header row
      let hdrIdx = -1
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row?.some(c => c != null && (
          String(c).includes('ケース') || String(c).includes('数量') ||
          String(c).includes('箱數') || String(c).includes('商品名')
        ))) { hdrIdx = i; break }
      }
      if (hdrIdx === -1) { skippedSheets.push({ sheet: sn, reason: '找不到表頭（沒有 ケース／数量／箱數／商品名 這幾個字）' }); continue }

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

      if (totalBoxes === 0 && !includeZero) { skippedSheets.push({ sheet: sn, reason: '整頁都是 0 箱' }); continue }

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
      skippedSheets,
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
  // roundNo → 被跳過的分頁（讀不到東西的）
  const skippedAccum = new Map<number, { sheet: string; reason: string }[]>()
  const noteSkipped = (r: number, sheet: string, reason: string) => {
    if (!skippedAccum.has(r)) skippedAccum.set(r, [])
    skippedAccum.get(r)!.push({ sheet, reason })
  }

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
        if (!m) {
          // 容錯：分頁名如「回目夢時」缺少回次數字（Excel 打字錯誤）
          // 從前一張有效分頁推斷回次
          const fallback = sn.trim().match(/^回[目か](.+)/)
          if (!fallback) continue
          storeRaw = fallback[1].trim()
          const idx = sheets.indexOf(sn)
          let inferred = 1
          for (let j = idx - 1; j >= 0; j--) {
            const pm = sheets[j].trim().match(ROUND_RE)
            if (pm) { inferred = parseInt(pm[1], 10); break }
          }
          roundNo = inferred
        } else {
          roundNo = parseInt(m[1], 10)
          storeRaw = sn.trim().replace(ROUND_RE, '').trim()
        }
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

    // Map shorthand → full store name（共用 resolveStoreName：完全比對 → 最長子字串 → 原名）
    const storeName = resolveStoreName(storeRaw)

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
    if (hdrIdx === -1) {
      noteSkipped(roundNo, sn, '找不到表頭（沒有 ケース／数量／箱數／商品名 這幾個字）')
      continue
    }

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

    if (totalBoxes === 0 && !includeZero) {
      noteSkipped(roundNo, sn, '整頁都是 0 箱')
      continue
    }

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
  // 注意：只有被跳過分頁、完全沒有店的回目也要出現在結果裡，
  // 否則上層只會看到「找不到第 N 回目」，看不到真正的原因。
  for (const r of skippedAccum.keys()) {
    if (!roundAccum.has(r)) roundAccum.set(r, new Map())
  }
  return Array.from(roundAccum.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([roundNo, storeMap]) => ({
      roundNo,
      stores: Array.from(storeMap.entries()).map(([name, data]) => ({
        name,
        boxes: data.totalBoxes,
        products: data.products,
      })),
      skippedSheets: skippedAccum.get(roundNo) ?? [],
    }))
}
