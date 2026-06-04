// 毛利計算層（純函式，無外部相依）
// 毛利 = 出貨營收(未稅) − 進貨成本分攤 − (運費+倉儲)分攤，按箱數分攤到每一次出貨。
import type { Shipment, ShipmentRecord, FurikomiRecord, ExcelRow, BatchPriceEntry } from './notion'

export const JPY_PER_NTD = 4.5 // 1 NTD = 4.5 JPY

function num(n: number | null | undefined): number {
  return typeof n === 'number' && isFinite(n) ? n : 0
}

// 營收來源：手動填寫 / 對帳明細推算 / 批次單價推算 / 無法推算
export type RevenueSource = 'manual' | 'excel' | 'batchPrice' | 'none'

export interface RecordMargin {
  record: ShipmentRecord
  boxes: number
  revenue: number        // 未稅營收 (TWD)
  allocImport: number    // 分攤進貨成本 (TWD)
  allocLogistics: number // 分攤運費+倉儲 (TWD)
  margin: number
  marginRate: number     // 0..1（revenue<=0 時為 0）
  isFuture: boolean      // 出貨日 > 今天（尚未出貨）
  revenueSource: RevenueSource // 此列營收怎麼來的
  derivedAmount: number | null // 推算出的含稅金額（可一鍵寫回 Notion 金額欄；手動值時等於原金額）
}

export type CostSource = 'manual' | 'furikomi' | 'none'

export interface BatchMargin {
  batch: Shipment
  totalBoxes: number      // 分攤基準箱數
  shippedBoxes: number    // 計入的出貨箱數
  revenue: number         // 未稅營收合計 (TWD)
  importCostFull: number  // 整批進貨成本 (TWD)
  logisticsFull: number   // 整批運費+倉儲 (TWD)
  allocImport: number     // 分攤到已出貨的進貨成本
  allocLogistics: number  // 分攤到已出貨的運費+倉儲
  margin: number
  marginRate: number
  rows: RecordMargin[]
  costSource: CostSource  // 進貨成本來源：手動覆蓋 / 振込預帶 / 無
  currency: string        // 成本幣別
  taxMode: string         // 課稅別
  pendingWriteback: number // 可一鍵寫回 Notion 的列數（對帳/批價推算且金額尚空）
  missingPrice: number     // 有箱數卻完全抓不到營收的列數（需去對帳單補單價）
}

// 從振込明細加總某批的進貨成本（原価合計 + 燻煙費 + 農薬検査費）
export function furikomiCostForBatch(batchId: string, furikomi: FurikomiRecord[]): number {
  return furikomi
    .filter(f => f.batchId === batchId)
    .reduce((s, f) => s + num(f.originalCost) + num(f.fumigationFee) + num(f.pesticideFee), 0)
}

// 對帳明細索引：出貨單號 → 該單所有品項的含稅金額合計（箱數 × 單價）
export function buildExcelRevenueIndex(excelRows: ExcelRow[]): Map<string, number> {
  const idx = new Map<string, number>()
  for (const r of excelRows) {
    const sno = (r.shipmentNo || '').trim()
    if (!sno) continue
    idx.set(sno, (idx.get(sno) ?? 0) + num(r.quantity) * num(r.unitPrice))
  }
  return idx
}

// 推算單筆出貨的營收（含稅），與來源。優先序：
//   1. 手動已填金額（最優先，永不覆蓋）
//   2. 對帳明細：以出貨單號配對，加總箱數×單價
//   3. 批次單價：單一單價的批次 → 箱數×單價（多單價但價格一致也適用）
//   4. 都抓不到 → null（標示缺單價）
export function deriveRevenue(
  rec: ShipmentRecord,
  batchId: string,
  excelIndex: Map<string, number>,
  batchPrices: Record<string, BatchPriceEntry[]>,
): { amount: number | null; source: RevenueSource } {
  if (rec.amount != null) return { amount: rec.amount, source: 'manual' }

  const sno = (rec.shipmentNo || '').trim()
  if (sno) {
    const v = excelIndex.get(sno)
    if (v != null && v > 0) return { amount: v, source: 'excel' }
  }

  const boxes = num(rec.boxes)
  const prices = batchPrices[batchId] || []
  if (boxes > 0 && prices.length > 0) {
    const uniq = [...new Set(prices.map(p => num(p.unitPrice)).filter(p => p > 0))]
    // 單一單價（或多品項但單價一致）才可靠地用箱數推算；多種不同單價需靠對帳明細
    if (uniq.length === 1) return { amount: boxes * uniq[0], source: 'batchPrice' }
  }

  return { amount: null, source: 'none' }
}

export function computeBatchMargin(
  batch: Shipment,
  allRecords: ShipmentRecord[],
  furikomi: FurikomiRecord[],
  excelIndex: Map<string, number> = new Map(),
  batchPrices: Record<string, BatchPriceEntry[]> = {},
  today: string = new Date().toISOString().slice(0, 10),
): BatchMargin {
  const currency = batch.costCurrency || 'TWD'
  const taxMode = batch.taxMode || '免稅'
  const fx = currency === 'JPY' ? JPY_PER_NTD : 1 // 成本以原幣別輸入，JPY 換算成 TWD

  // 進貨成本：手動覆蓋優先，否則自振込明細預帶
  let importCostOrig = batch.importCost
  let costSource: CostSource = 'manual'
  if (importCostOrig == null) {
    const f = furikomiCostForBatch(batch.id, furikomi)
    if (f > 0) { importCostOrig = f; costSource = 'furikomi' }
    else { importCostOrig = 0; costSource = 'none' }
  }
  const importCostFull = num(importCostOrig) / fx
  const logisticsFull = (num(batch.freightCost) + num(batch.storageCost)) / fx

  const recs = allRecords.filter(r => r.batchId === batch.id && r.planStatus !== '已取消')
  const shippedBoxes = recs.reduce((s, r) => s + num(r.boxes), 0)
  // 分攤基準：批次總箱數優先（讓成本攤在整批）；無總箱數時退而用已排定箱數
  const base = num(batch.totalBoxes) > 0 ? num(batch.totalBoxes) : shippedBoxes

  const rows: RecordMargin[] = recs
    .map(r => {
      const boxes = num(r.boxes)
      const { amount: rawAmount, source: revenueSource } = deriveRevenue(r, batch.id, excelIndex, batchPrices)
      const grossAmount = num(rawAmount) // 含稅金額（手動或推算）
      const revenue = taxMode === '5%' ? grossAmount / 1.05 : grossAmount
      const ratio = base > 0 ? boxes / base : 0
      const allocImport = importCostFull * ratio
      const allocLogistics = logisticsFull * ratio
      const margin = revenue - allocImport - allocLogistics
      return {
        record: r,
        boxes,
        revenue,
        allocImport,
        allocLogistics,
        margin,
        marginRate: revenue > 0 ? margin / revenue : 0,
        isFuture: !!(r.date && r.date > today),
        revenueSource,
        derivedAmount: rawAmount,
      }
    })
    .sort((a, b) => (a.record.date ?? '').localeCompare(b.record.date ?? ''))

  const revenue = rows.reduce((s, x) => s + x.revenue, 0)
  const allocImport = rows.reduce((s, x) => s + x.allocImport, 0)
  const allocLogistics = rows.reduce((s, x) => s + x.allocLogistics, 0)
  const margin = revenue - allocImport - allocLogistics

  // 可寫回 = 對帳/批價推算且 Notion 金額尚空；缺單價 = 有箱數卻完全抓不到營收
  const pendingWriteback = rows.filter(
    x => x.record.amount == null && (x.revenueSource === 'excel' || x.revenueSource === 'batchPrice'),
  ).length
  const missingPrice = rows.filter(x => x.revenueSource === 'none' && x.boxes > 0).length

  return {
    batch,
    totalBoxes: base,
    shippedBoxes,
    revenue,
    importCostFull,
    logisticsFull,
    allocImport,
    allocLogistics,
    margin,
    marginRate: revenue > 0 ? margin / revenue : 0,
    rows,
    costSource,
    currency,
    taxMode,
    pendingWriteback,
    missingPrice,
  }
}

export function computeAllMargins(
  shipments: Shipment[],
  records: ShipmentRecord[],
  furikomi: FurikomiRecord[],
  excelRows: ExcelRow[] = [],
  batchPrices: Record<string, BatchPriceEntry[]> = {},
  today?: string,
): BatchMargin[] {
  const excelIndex = buildExcelRevenueIndex(excelRows)
  return shipments.map(s => computeBatchMargin(s, records, furikomi, excelIndex, batchPrices, today))
}
