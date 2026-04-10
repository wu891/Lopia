// Parses Japanese shipment schedule text like:
// りんご9更新スケジュール
// 全部で5回
// 3/15、9.1台南MOP＋北門　１５
// 4/10 150箱

export interface ParsedEntry {
  date: string        // YYYY-MM-DD
  dateRaw: string     // original text
  product: string     // e.g. りんご
  batch: string       // e.g. 9
  subBatch: string    // e.g. 9.1
  store: string       // e.g. 台南MOP
  qty: number | null
  note: string
}

// Convert full-width numbers to half-width
function toHalfWidth(str: string): string {
  return str.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
}

// Normalize separators
function normalize(str: string): string {
  return toHalfWidth(str)
    .replace(/、/g, ',')
    .replace(/　/g, ' ')
    .replace(/～/g, '-')
    .replace(/〜/g, '-')
    .trim()
}

// Extract year from context (default current year)
function currentYear(): number {
  return new Date().getFullYear()
}

function parseDate(raw: string, year: number): string[] {
  const n = normalize(raw)
  // Range like 3/17-20
  const rangeMatch = n.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})/)
  if (rangeMatch) {
    const month = parseInt(rangeMatch[1])
    const from = parseInt(rangeMatch[2])
    const to = parseInt(rangeMatch[3])
    const dates: string[] = []
    for (let d = from; d <= to; d++) {
      dates.push(`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`)
    }
    return dates
  }
  // Single date like 3/15
  const singleMatch = n.match(/^(\d{1,2})\/(\d{1,2})/)
  if (singleMatch) {
    const month = parseInt(singleMatch[1])
    const day = parseInt(singleMatch[2])
    return [`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`]
  }
  return []
}

// Known store name mappings
const STORE_MAP: Record<string, string> = {
  '台南MOP': '台南三井 Outlet 店',
  '台南mop': '台南三井 Outlet 店',
  'MOP': '台南三井 Outlet 店',
  '北門': '台南小北門店',
  '台中漢神': '台中漢神中港店',
  '漢神': '台中漢神中港店',
  '南港': '南港 LaLaport 店',
  '台北南港': '南港 LaLaport 店',
  '北蛋': '高雄漢神巨蛋店',
  '巨蛋': '高雄漢神巨蛋店',
  '夢時代': '高雄夢時代店',
  '中和': '新北中和環球店',
  '宏匯': '新莊宏匯店',
  '桃園': '桃園春日店',
  '台中': 'LaLaport 台中店',
  'IKEA': 'IKEA 台中南屯店',
}

function resolveStore(raw: string): string {
  for (const [key, val] of Object.entries(STORE_MAP)) {
    if (raw.includes(key)) return val
  }
  return raw.trim()
}

function extractQty(text: string): number | null {
  const n = normalize(text)
  const match = n.match(/(\d+)\s*箱?$/) || n.match(/\s(\d+)$/)
  if (match) return parseInt(match[1])
  return null
}

function extractSubBatch(text: string): string {
  const n = normalize(text)
  const match = n.match(/\b(\d+\.\d+)\b/)
  return match ? match[1] : ''
}

export function parseSchedule(text: string): {
  product: string
  batch: string
  totalDeliveries: number | null
  entries: ParsedEntry[]
  rawText: string
} {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const year = currentYear()

  let product = ''
  let batch = ''
  let totalDeliveries: number | null = null
  const entries: ParsedEntry[] = []

  for (const line of lines) {
    const norm = normalize(line)

    // Skip pure note lines starting with ※ or 納品 or notes
    if (line.startsWith('※') && !norm.match(/^\d/)) continue
    if (line === '納品願います') continue

    // Header line: extract product + batch number
    // e.g. りんご9更新スケジュール or りんご10
    const headerMatch = line.match(/^([ぁ-ん一-龯a-zA-Zａ-ｚＡ-Ｚ]+)(\d+)[^\d]/)
    if (headerMatch && !norm.match(/^\d/)) {
      product = headerMatch[1]
      batch = headerMatch[2]
      continue
    }

    // Total count line: 全部でN回
    const totalMatch = line.match(/全部で(\d+)回/)
    if (totalMatch) {
      totalDeliveries = parseInt(totalMatch[1])
      continue
    }

    // Date line: starts with digit (after normalization)
    const dateStartMatch = norm.match(/^(\d{1,2}\/\d{1,2})/)
    if (!dateStartMatch) continue

    const dateRaw = dateStartMatch[1]
    const dates = parseDate(dateRaw, year)
    if (dates.length === 0) continue

    // Rest of line after date
    const rest = norm.slice(dateRaw.length).replace(/^[,-\s]+/, '')

    const subBatch = extractSubBatch(rest)
    const qty = extractQty(rest)

    // Extract store: everything between sub-batch and qty, minus numbers at end
    let storeRaw = rest
      .replace(/\d+\.\d+/, '') // remove sub-batch
      .replace(/\d+\s*箱?$/, '') // remove qty
      .replace(/[,，＋+]/, ' ')
      .trim()

    // Handle multiple stores (e.g. 台南MOP＋北門)
    const storeParts = storeRaw.split(/[＋+&＆]/).map(s => s.trim()).filter(Boolean)
    const stores = storeParts.map(resolveStore)

    // Notes: lines with ※, 以降, 出来れば, 納品開始
    const noteMatch = line.match(/(※[^　\s]*|以降|出来れば[^　\s]*|納品開始|抜き)/)
    const note = noteMatch ? noteMatch[0] : ''

    for (const date of dates) {
      for (const store of (stores.length > 0 ? stores : [''])) {
        entries.push({
          date,
          dateRaw,
          product: product || '?',
          batch: batch || '?',
          subBatch,
          store,
          qty,
          note,
        })
      }
    }
  }

  return { product, batch, totalDeliveries, entries, rawText: text }
}
