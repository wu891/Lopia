// 毛利計算層（純函式，無外部相依）
// 毛利 = 出貨營收(未稅) − 進貨成本分攤 − (運費+倉儲)分攤，按箱數分攤到每一次出貨。
import type { Shipment, ShipmentRecord, FurikomiRecord } from './notion'

export const JPY_PER_NTD = 4.5 // 1 NTD = 4.5 JPY

function num(n: number | null | undefined): number {
  return typeof n === 'number' && isFinite(n) ? n : 0
}

export interface RecordMargin {
  record: ShipmentRecord
  boxes: number
  revenue: number        // 未稅營收 (TWD)
  allocImport: number    // 分攤進貨成本 (TWD)
  allocLogistics: number // 分攤運費+倉儲 (TWD)
  margin: number
  marginRate: number     // 0..1（revenue<=0 時為 0）
  isFuture: boolean      // 出貨日 > 今天（尚未出貨）
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
}

// 從振込明細加總某批的進貨成本（原価合計 + 燻煙費 + 農薬検査費）
export function furikomiCostForBatch(batchId: string, furikomi: FurikomiRecord[]): number {
  return furikomi
    .filter(f => f.batchId === batchId)
    .reduce((s, f) => s + num(f.originalCost) + num(f.fumigationFee) + num(f.pesticideFee), 0)
}

export function computeBatchMargin(
  batch: Shipment,
  allRecords: ShipmentRecord[],
  furikomi: FurikomiRecord[],
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
      const revenue = taxMode === '5%' ? num(r.amount) / 1.05 : num(r.amount)
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
      }
    })
    .sort((a, b) => (a.record.date ?? '').localeCompare(b.record.date ?? ''))

  const revenue = rows.reduce((s, x) => s + x.revenue, 0)
  const allocImport = rows.reduce((s, x) => s + x.allocImport, 0)
  const allocLogistics = rows.reduce((s, x) => s + x.allocLogistics, 0)
  const margin = revenue - allocImport - allocLogistics

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
  }
}

export function computeAllMargins(
  shipments: Shipment[],
  records: ShipmentRecord[],
  furikomi: FurikomiRecord[],
  today?: string,
): BatchMargin[] {
  return shipments.map(s => computeBatchMargin(s, records, furikomi, today))
}
