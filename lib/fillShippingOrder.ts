// 對應 Python 版 fill_shipping_order.py，使用 SheetJS 處理 Excel
import * as XLSX from 'xlsx'

const STORE_MAPPING: Record<string, string[]> = {
  'LaLaport 台中店':    ['台中'],
  '桃園春日店':         ['桃園'],
  '新北中和環球店':     ['中和'],
  '新莊宏匯店':         ['新荘', '新莊'],
  '高雄漢神巨蛋店':     ['巨蛋', '高雄'],
  '南港 LaLaport 店':   ['南港'],
  'IKEA 台中南屯店':    ['IKEA'],
  '高雄夢時代店':       ['夢時'],
  '台南小北門店':       ['北門'],
  '台南三井 Outlet 店': ['MOP'],
  '台中漢神中港店':     ['中漢'],
  '台北大巨蛋店':       ['台北大巨蛋', '大巨蛋'],
}

const SANCHI_TYPE: Record<string, string> = {
  '青森サンふじ': 'sunfuji',
  '北海道産':     'sunfuji',
  '王林':         'orin',
}

const TOKKA_PRICE_THRESHOLD = 1500

interface StoreItem {
  bangou: string
  hinmei: string
  size: number | null
  count: number
}

function loadBangouSanchi(inventoryWb: XLSX.WorkBook): Record<string, string> {
  const ws = inventoryWb.Sheets['庫存管理表']
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
  const map: Record<string, string> = {}
  for (let i = 3; i < rows.length; i++) {
    const bangou = String(rows[i][0] ?? '').trim()
    const sanchi = String(rows[i][2] ?? '').trim()
    if (bangou) map[bangou] = sanchi
  }
  return map
}

function parseRoundItems(inventoryWb: XLSX.WorkBook, roundNumber: number): Record<string, StoreItem[]> {
  const sheetName = `第${roundNumber}回出貨明細`
  const ws = inventoryWb.Sheets[sheetName]
  if (!ws) throw new Error(`找不到分頁：${sheetName}`)

  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })

  let dataStart = -1
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === '門市' && String(rows[i][1]).trim() === '番号') {
      dataStart = i + 1
      break
    }
  }
  if (dataStart === -1) throw new Error(`${sheetName} 找不到表頭列`)

  const storeItems: Record<string, StoreItem[]> = {}
  let currentStore: string | null = null

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]
    const storeVal = String(row[0] ?? '').trim()
    const bangou   = String(row[1] ?? '').trim()
    const hinmei   = String(row[2] ?? '').trim()
    const countRaw = row[3]

    if (storeVal) currentStore = storeVal
    if (!currentStore || !bangou || !hinmei) continue

    const sizeMatch = hinmei.match(/(\d+)玉/)
    const size  = sizeMatch ? parseInt(sizeMatch[1]) : null
    const count = countRaw ? Math.round(Number(countRaw)) : 1

    if (!storeItems[currentStore]) storeItems[currentStore] = []
    storeItems[currentStore].push({ bangou, hinmei, size, count })
  }

  return storeItems
}

function fillWs(
  ws: XLSX.WorkSheet,
  items: StoreItem[],
  bangouSanchi: Record<string, string>
): void {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')

  for (let r = range.s.r; r <= range.e.r; r++) {
    const aAddr = XLSX.utils.encode_cell({ r, c: 0 })
    const bAddr = XLSX.utils.encode_cell({ r, c: 1 })

    const aCell = ws[aAddr]
    const bCell = ws[bAddr]
    if (!aCell || !bCell) continue

    const aVal = String(aCell.v ?? '').trim()
    const bVal = String(bCell.v ?? '').trim()

    const isSunfuji = aVal.includes('サンふじ') || aVal.includes('さんふじ')
    const isOrin    = aVal.includes('王林')
    if (!isSunfuji && !isOrin) continue

    const sizeMatch = bVal.match(/(\d+)/)
    if (!sizeMatch) continue
    const rowSize = parseInt(sizeMatch[1])

    const rowType  = isSunfuji ? 'sunfuji' : 'orin'
    const baseName = aVal.split(/[（(]/)[0].trim()

    const matched = items.filter(item => {
      if (item.size !== rowSize) return false
      const sanchi   = bangouSanchi[item.bangou] ?? ''
      const itemType = SANCHI_TYPE[sanchi] ?? 'sunfuji'
      return itemType === rowType
    })

    if (matched.length > 0) {
      const labels = matched.map(m => m.count > 1 ? `${m.hinmei}*${m.count}` : m.hinmei)
      aCell.v = `${baseName}（${labels.join('、')}）`
      aCell.w = aCell.v as string
    } else {
      aCell.v = baseName
      aCell.w = baseName
    }
  }
}

function fillDaijyudan(
  ws: XLSX.WorkSheet,
  storeItems: Record<string, StoreItem[]>,
  bangouSanchi: Record<string, string>
): void {
  const regularItems = storeItems['北蛋'] ?? []
  const tokkaItems   =
    storeItems['北蛋 (下段)'] ??
    storeItems['北蛋 (下段/特價)'] ??
    storeItems['北蛋\n(下段/特価)'] ?? []

  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')

  for (let r = range.s.r; r <= range.e.r; r++) {
    const aAddr = XLSX.utils.encode_cell({ r, c: 0 })
    const bAddr = XLSX.utils.encode_cell({ r, c: 1 })
    const dAddr = XLSX.utils.encode_cell({ r, c: 3 })

    const aCell = ws[aAddr]
    const bCell = ws[bAddr]
    const dCell = ws[dAddr]
    if (!aCell || !bCell) continue

    const aVal = String(aCell.v ?? '').trim()
    const bVal = String(bCell.v ?? '').trim()

    const isSunfuji = aVal.includes('サンふじ') || aVal.includes('さんふじ')
    const isOrin    = aVal.includes('王林')
    if (!isSunfuji && !isOrin) continue

    const sizeMatch = bVal.match(/(\d+)/)
    if (!sizeMatch) continue
    const rowSize = parseInt(sizeMatch[1])

    const price = dCell ? Number(dCell.v) || 9999 : 9999
    const items = price <= TOKKA_PRICE_THRESHOLD ? tokkaItems : regularItems
    const rowType  = isSunfuji ? 'sunfuji' : 'orin'
    const baseName = aVal.split(/[（(]/)[0].trim()

    const matched = items.filter(item => {
      if (item.size !== rowSize) return false
      const sanchi   = bangouSanchi[item.bangou] ?? ''
      const itemType = SANCHI_TYPE[sanchi] ?? 'sunfuji'
      return itemType === rowType
    })

    if (matched.length > 0) {
      const labels = matched.map(m => m.count > 1 ? `${m.hinmei}*${m.count}` : m.hinmei)
      aCell.v = `${baseName}（${labels.join('、')}）`
      aCell.w = aCell.v as string
    } else {
      aCell.v = baseName
      aCell.w = baseName
    }
  }
}

export function fillShippingOrder(
  shippingBuffer: ArrayBuffer,
  inventoryBuffer: ArrayBuffer,
  roundNumber: number
): XLSX.WorkBook {
  const shippingWb  = XLSX.read(shippingBuffer, { type: 'array' })
  const inventoryWb = XLSX.read(inventoryBuffer, { type: 'array' })

  const bangouSanchi = loadBangouSanchi(inventoryWb)
  const storeItems   = parseRoundItems(inventoryWb, roundNumber)

  for (const tabName of shippingWb.SheetNames) {
    if (['總表', '総表'].includes(tabName)) continue

    if (tabName === '台北大巨蛋店') {
      fillDaijyudan(shippingWb.Sheets[tabName], storeItems, bangouSanchi)
      continue
    }

    const codes = STORE_MAPPING[tabName]
    if (!codes) continue

    let tabItems: StoreItem[] | null = null
    for (const code of codes) {
      if (storeItems[code]) { tabItems = storeItems[code]; break }
    }
    if (!tabItems) continue

    fillWs(shippingWb.Sheets[tabName], tabItems, bangouSanchi)
  }

  return shippingWb
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string): void {
  const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([buf], { type: 'application/octet-stream' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
