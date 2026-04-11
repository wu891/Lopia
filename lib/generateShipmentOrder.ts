/**
 * generateShipmentOrder
 *
 * Generates a LOPIA 出貨單 Excel workbook in the Trade Media Japan format.
 * One sheet per store + a 總量 summary sheet.
 */

import { STORES } from './stores'
import { ParsedProduct } from './parseDeliveryExcel'

// ── Trade Media Japan company info (static header) ─────────────────────────

const COMPANY_NAME = '日商夢多貿易股份有限公司台灣分公司'
const COMPANY_ADDRESS = '地址：台北市信義區信義路五段五號5D17'
const COMPANY_PHONE = '電話：02-2720-0322'
const COMPANY_URL = ''

// ── Store display name mapping for 出貨單 ──────────────────────���──────────

const STORE_DISPLAY_MAP: Record<string, string> = {
  'LaLaport 台中店': 'LOPIA 台中店',
  '桃園春日店': 'LOPIA 桃園店',
  '新北中和環球店': 'LOPIA 中和店',
  '新莊宏匯店': 'LOPIA 新荘店',
  '高雄漢神巨蛋店': 'LOPIA 高雄巨蛋店',
  '南港 LaLaport 店': 'LOPIA 南港店',
  'IKEA 台中南屯店': 'LOPIA IKEA台中店',
  '高雄夢時代店': 'LOPIA 夢時代店',
  '台南小北門店': 'LOPIA 北門店',
  '台南三井 Outlet 店': 'LOPIA MOP店',
  '台中漢神中港店': 'LOPIA 漢神中港店',
  '台北大巨蛋店': 'LOPIA 台北巨蛋店',
  '台南 SOGO 新天店': 'LOPIA 台南SOGO店',
  '高雄漢神百貨店': 'LOPIA 高雄漢神店',
}

// Short store name for 總量 sheet column headers
const STORE_SHORT_MAP: Record<string, string> = {
  'LaLaport 台中店': '台中',
  '桃園春日店': '桃園',
  '新北中和環球店': '中和',
  '新莊宏匯店': '新莊',
  '高雄漢神巨蛋店': '巨蛋',
  '南港 LaLaport 店': '南港',
  'IKEA 台中南屯店': 'IKEA',
  '高雄夢時代店': '夢時',
  '台南小北門店': '北門',
  '台南三井 Outlet 店': 'MOP',
  '台中漢神中港店': '漢神',
  '台北大巨蛋店': '北蛋',
  '台南 SOGO 新天店': 'SOGO',
  '高雄漢神百貨店': '高漢',
}

// Excel sheet name (max 31 chars, no special chars)
const STORE_SHEET_MAP: Record<string, string> = {
  'LaLaport 台中店': '台中',
  '桃園春日店': '桃園',
  '新北中和環球店': '中和',
  '新莊宏匯店': '新莊',
  '高雄漢神巨蛋店': '巨蛋',
  '南港 LaLaport 店': '南港',
  'IKEA 台中南屯店': 'IKEA',
  '高雄夢時代店': '夢時',
  '台南小北門店': '北門',
  '台南三井 Outlet 店': 'MOP',
  '台中漢神中港店': '漢神',
  '台北大巨蛋店': '北蛋',
  '台南 SOGO 新天店': 'SOGO',
  '高雄漢神百貨店': '高漢',
}

export interface StoreOrder {
  storeName: string      // Full store name from STORES
  products: ParsedProduct[]
  deliveryDate: string   // YYYY-MM-DD
}

function getStoreAddress(storeName: string): string {
  const store = STORES.find(s => s.name_zh === storeName)
  return store?.address_zh ?? ''
}

function dateToExcelSerial(dateStr: string): number {
  // Excel serial date: days since 1899-12-30
  const d = new Date(dateStr + 'T00:00:00')
  const epoch = new Date('1899-12-30T00:00:00')
  return Math.round((d.getTime() - epoch.getTime()) / (1000 * 60 * 60 * 24))
}

function formatDateForDisplay(dateStr: string): string {
  // YYYY-MM-DD → YYYY/MM/DD
  return dateStr.replace(/-/g, '/')
}

export function generateShipmentOrder(
  storeOrders: StoreOrder[],
  shipmentNo: string,
  batchName: string,
): ArrayBuffer {
  // Dynamic import not needed server-side; xlsx is already available
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx')

  const wb = XLSX.utils.book_new()

  // ── Per-store sheets ────────────────────��─────────────────────────────────

  for (const order of storeOrders) {
    const displayName = STORE_DISPLAY_MAP[order.storeName] ?? order.storeName
    const sheetName = STORE_SHEET_MAP[order.storeName] ?? order.storeName.slice(0, 31)
    const address = getStoreAddress(order.storeName)
    const dateSerial = dateToExcelSerial(order.deliveryDate)

    // Build rows
    const rows: (string | number | null)[][] = []
    // Row 0: Company name
    rows.push([COMPANY_NAME, null, null, null, null, null, null, null])
    // Row 1-2: empty
    rows.push([null, null, null, null, null, null, null, null])
    rows.push([null, null, null, null, null, null, null, null])
    // Row 3: 出貨明細 + address
    rows.push(['出貨明細', null, null, COMPANY_ADDRESS, null, null, null, null])
    // Row 4: phone
    rows.push([null, null, null, COMPANY_PHONE, null, null, null, null])
    // Row 5: website
    rows.push([null, null, null, COMPANY_URL, null, null, null, null])
    // Row 6: customer + date
    rows.push(['客戶名稱：', displayName, null, '出貨日期：', dateSerial, null, null, null])
    // Row 7: tax ID + shipment no
    rows.push(['客戶統編：', null, null, '出貨單號：', shipmentNo, null, null, null])
    // Row 8: delivery address + method
    rows.push(['客戶送貨地址：', address, null, '送貨方式：', '貨運', null, null, null])
    // Row 9-11: contact info (blank for now)
    rows.push(['客戶連絡人：', '', null, '銷售員：', '', null, null, null])
    rows.push(['客戶電話：', '', null, null, '', null, null, null])
    rows.push(['客戶EMAIK：', '', null, null, null, null, null, null])
    // Row 12: empty
    rows.push([null, null, null, null, null, null, null, null])
    // Row 13: header
    rows.push(['日期', '商品類別', '商品名稱', '箱入數', '箱數', '單價', '總金額', '備註'])
    // Row 14+: products
    let totalAmount = 0
    for (const p of order.products) {
      const amount = p.quantity * p.unitPrice
      totalAmount += amount
      rows.push([
        dateSerial,
        p.category,
        p.name,
        p.boxSpec,
        p.quantity,
        p.unitPrice,
        amount,
        null,
      ])
    }
    // Empty rows to match template
    for (let i = 0; i < Math.max(0, 10 - order.products.length); i++) {
      rows.push([null, null, null, null, null, null, null, null])
    }
    // Total row
    rows.push(['總　計：', null, null, null, '含稅', null, totalAmount, null])
    // Remarks
    rows.push(['備註', null, null, null, null, null, null, null])

    const ws = XLSX.utils.aoa_to_sheet(rows)

    // Set column widths
    ws['!cols'] = [
      { wch: 14 }, // 日期
      { wch: 14 }, // 商品類別
      { wch: 36 }, // 商品名稱
      { wch: 10 }, // 箱入數
      { wch: 8 },  // 箱數
      { wch: 10 }, // 單價
      { wch: 12 }, // 總金額
      { wch: 10 }, // 備註
    ]

    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  // ── 總量 summary sheet ────────────────────────────────────────────────────

  // Collect all unique product names across all stores
  const allProducts = new Map<string, { unitPrice: number; category: string }>()
  for (const order of storeOrders) {
    for (const p of order.products) {
      if (!allProducts.has(p.name)) {
        allProducts.set(p.name, { unitPrice: p.unitPrice, category: p.category })
      }
    }
  }
  const productNames = Array.from(allProducts.keys())

  // Build header: [日期, 商品名, store1, store2, ..., 總數量, 商品單價, 總金額]
  const storeNames = storeOrders.map(o => STORE_SHORT_MAP[o.storeName] ?? o.storeName.slice(0, 4))
  const summaryHeader = ['', ...storeNames, '總數量', '商品單價', '總金額']

  // First row: header with store names
  const summaryRows: (string | number | null)[][] = [
    ['店舗', ...storeNames, '總數量', '商品單價', '總金額'],
  ]

  // One row per product
  const dateSerial = storeOrders.length > 0 ? dateToExcelSerial(storeOrders[0].deliveryDate) : 0
  for (const pName of productNames) {
    const info = allProducts.get(pName)!
    const row: (string | number | null)[] = [dateSerial, pName]
    let totalQty = 0
    for (const order of storeOrders) {
      const found = order.products.find(p => p.name === pName)
      const qty = found?.quantity ?? 0
      row.push(qty || '')
      totalQty += qty
    }
    row.push(totalQty, info.unitPrice, totalQty * info.unitPrice)
    summaryRows.push(row)
  }

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows)
  summaryWs['!cols'] = [
    { wch: 12 },
    ...storeNames.map(() => ({ wch: 8 })),
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
  ]
  XLSX.utils.book_append_sheet(wb, summaryWs, '總量')

  // Write to buffer
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return buf
}

/**
 * Generate the S+date shipment number.
 * Format: S{YYYYMMDD}{NN} where NN is a sequence number (default 01).
 */
export function generateShipmentNo(dateStr: string, seq: number = 1): string {
  const d = dateStr.replace(/-/g, '')
  return `S${d}${String(seq).padStart(2, '0')}`
}
