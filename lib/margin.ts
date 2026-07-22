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

// 對帳明細裡的一張出貨單群組（同一單號在同店同日的箱數與含稅金額合計）
interface ExcelGroup { sno: string; qty: number; amount: number }
export interface ExcelRevenueIndex {
  bySno: Map<string, number>                    // 出貨單號 → 整張單含稅金額（全部門市合計）
  bySnoQty: Map<string, number>                 // 出貨單號 → 整張單總箱數（bySno 按箱數分攤時的分母）
  bySnoStore: Map<string, number>               // 「單號|門市」→ 該店含稅金額（單號能對上時的首選：一張單多家店，整張金額不能發給每家店）
  bySnoStoreQty: Map<string, number>            // 「單號|門市」→ 該店箱數（一店拆到多批次時按箱數比例分攤的分母）
  byStoreDate: Map<string, ExcelGroup[]>        // 「門市|日期」→ 該店該日的各張出貨單（用於門市+日期+箱數消歧）
}

// 建索引：出貨紀錄的單號多為亂數兜底格式，與對帳明細的 S 格式對不上，
// 因此主要靠「門市+日期」配對；同店同日跨多批時，再用箱數消除歧義。
export function buildExcelRevenueIndex(excelRows: ExcelRow[]): ExcelRevenueIndex {
  const bySno = new Map<string, number>()
  const bySnoQty = new Map<string, number>()
  const bySnoStore = new Map<string, number>()
  const bySnoStoreQty = new Map<string, number>()
  const sd = new Map<string, Map<string, ExcelGroup>>() // storeDateKey → sno → group
  for (const r of excelRows) {
    const amt = num(r.quantity) * num(r.unitPrice)
    const sno = (r.shipmentNo || '').trim()
    if (sno) {
      bySno.set(sno, (bySno.get(sno) ?? 0) + amt)
      bySnoQty.set(sno, (bySnoQty.get(sno) ?? 0) + num(r.quantity))
      const st = (r.store || '').trim()
      if (st) {
        bySnoStore.set(`${sno}|${st}`, (bySnoStore.get(`${sno}|${st}`) ?? 0) + amt)
        bySnoStoreQty.set(`${sno}|${st}`, (bySnoStoreQty.get(`${sno}|${st}`) ?? 0) + num(r.quantity))
      }
    }

    const store = (r.store || '').trim()
    const date = (r.date || '').slice(0, 10)
    if (store && date) {
      const k = `${store}|${date}`
      if (!sd.has(k)) sd.set(k, new Map())
      const m = sd.get(k)!
      const g = m.get(sno) ?? { sno, qty: 0, amount: 0 }
      g.qty += num(r.quantity)
      g.amount += amt
      m.set(sno, g)
    }
  }
  const byStoreDate = new Map<string, ExcelGroup[]>()
  for (const [k, m] of sd) byStoreDate.set(k, [...m.values()])
  return { bySno, bySnoQty, bySnoStore, bySnoStoreQty, byStoreDate }
}

// ── 按批次商品關鍵字歸屬的營收索引 ─────────────────────────────────────────────
// 問題背景（2026-06 實測）：一張店鋪貨單同時含地瓜＋大學芋、兩商品扣到不同批次時，
// 「單號|門市」索引把整張單（兩商品合計）的金額給每個批次的出貨紀錄各吸一次 → 月營收重複計。
// 解法：對帳明細每列有「商品名稱」，批次有「商品關鍵字」（Drive 扣帳同一套規則），
// 先把明細列按商品歸屬到批次，每個批次只用「自己商品的列」建索引。
export interface BatchKeywordsLite { id: string; productKeywords?: string[] }
export interface ExcelRevenueIndexes {
  forBatch(batchId: string): ExcelRevenueIndex
  full: ExcelRevenueIndex   // 全量索引（兜底用：關鍵字是「現在的設定」，歷史批次的關鍵字可能已被改掉）
}

export function buildExcelRevenueIndexes(excelRows: ExcelRow[], batches: BatchKeywordsLite[]): ExcelRevenueIndexes {
  const kwBatches = batches.filter(b => (b.productKeywords?.length ?? 0) > 0)
  const hitKw = (product: string, kws: string[]) => {
    const t = product.toLowerCase()
    return kws.some(k => k && t.includes(k.toLowerCase()))
  }
  // 每列先算出命中哪些批次的關鍵字（一次算完，之後查表）
  const rowHits = excelRows.map(r => new Set(kwBatches.filter(b => hitKw(r.product || '', b.productKeywords!)).map(b => b.id)))
  const fullIndex = buildExcelRevenueIndex(excelRows)
  const cache = new Map<string, ExcelRevenueIndex>()
  return {
    forBatch(batchId: string): ExcelRevenueIndex {
      // 批次沒填關鍵字（或未連結批次）→ 用全量索引（維持原行為）
      if (!kwBatches.some(b => b.id === batchId)) return fullIndex
      const hit = cache.get(batchId)
      if (hit) return hit
      // 本批次的列 ＝ 命中自己關鍵字的列 ＋ 誰的關鍵字都沒命中的列（商品名對不上任何批次時，
      // 寧可保留原本「大家都看得到」的行為，不要讓營收憑空消失）
      const mine = excelRows.filter((_, i) => rowHits[i].has(batchId) || rowHits[i].size === 0)
      const idx = buildExcelRevenueIndex(mine)
      cache.set(batchId, idx)
      return idx
    },
    full: fullIndex,
  }
}

// 兩段式推算：先用「歸屬到本批次商品」的索引（混搭單不重複吸金額），
// 完全找不到再退回全量索引＋批次單價兜底。
// 為什麼要兜底（2026-06 實測 S2026061101）：關鍵字欄是「現在的設定」，Colin 會隨新批次改寫；
// 歷史批次的關鍵字對不上當時的商品名時，若不兜底，整張單的營收會直接歸零消失——
// 寧可讓罕見的混搭+關鍵字失效情況回到舊行為（靠箱數比例分攤壓低重複），也不能讓營收憑空蒸發。
export function deriveRevenueWithFallback(
  rec: ShipmentRecord,
  batchId: string,
  indexes: ExcelRevenueIndexes,
  batchPrices: Record<string, BatchPriceEntry[]>,
): { amount: number | null; source: RevenueSource } {
  // 第一段不帶批次單價：過濾索引沒中就該去試全量索引，不能先被批次單價攔走
  const first = deriveRevenue(rec, batchId, indexes.forBatch(batchId), {})
  if (first.source !== 'none') return first
  return deriveRevenue(rec, batchId, indexes.full, batchPrices)
}

// 推算單筆出貨的營收（含稅），與來源。優先序：
//   1. 手動已填金額（最優先，永不覆蓋）
//   2. 對帳明細-單號：少數紀錄有正確 S 單號時直接對
//   3. 對帳明細-門市+日期：該店該日唯一出貨單 → 直接帶；多張 → 用箱數消歧，消不掉就不猜
//   4. 批次單價：單一單價的批次 → 箱數×單價（多單價但價格一致也適用）
//   5. 都抓不到 → null（標示缺單價）
export function deriveRevenue(
  rec: ShipmentRecord,
  batchId: string,
  excelIndex: ExcelRevenueIndex,
  batchPrices: Record<string, BatchPriceEntry[]>,
): { amount: number | null; source: RevenueSource } {
  if (rec.amount != null) return { amount: rec.amount, source: 'manual' }

  const boxes = num(rec.boxes)
  const store = (rec.store || '').trim()
  const date = (rec.date || '').slice(0, 10)

  const sno = (rec.shipmentNo || '').trim()
  if (sno) {
    // 首選「單號＋門市」：一張出貨單有很多家店，整張金額不能發給每家店的紀錄。
    // 同一店的商品若 FIFO 拆到多個批次（多筆紀錄），也不能每筆各吸整店金額 → 按箱數比例分攤
    if (store) {
      const vs = excelIndex.bySnoStore.get(`${sno}|${store}`)
      if (vs != null && vs > 0) {
        const qty = excelIndex.bySnoStoreQty.get(`${sno}|${store}`) ?? 0
        if (qty > 0 && boxes > 0 && boxes < qty) return { amount: vs * boxes / qty, source: 'excel' }
        return { amount: vs, source: 'excel' }
      }
    }
    // 對帳明細有這張單但門市對不上（店名寫法不同等）：按箱數比例分攤整張單金額
    const v = excelIndex.bySno.get(sno)
    if (v != null && v > 0) {
      const qty = excelIndex.bySnoQty.get(sno) ?? 0
      if (qty > 0 && boxes > 0) return { amount: v * Math.min(boxes, qty) / qty, source: 'excel' }
    }
  }
  if (store && date) {
    const groups = excelIndex.byStoreDate.get(`${store}|${date}`)
    if (groups && groups.length > 0) {
      if (groups.length === 1) {
        // 同一店同日的商品拆到多批次（多筆紀錄）→ 同樣按箱數比例分攤，不能每筆各吸整組金額
        const g = groups[0]
        if (g.amount > 0) {
          if (g.qty > 0 && boxes > 0 && boxes < g.qty) return { amount: g.amount * boxes / g.qty, source: 'excel' }
          return { amount: g.amount, source: 'excel' }
        }
      } else {
        // 同店同日有多張出貨單（跨批）→ 用箱數消歧，唯一吻合才採用，否則不猜
        const hit = groups.filter(g => g.qty === boxes && g.amount > 0)
        if (hit.length === 1) return { amount: hit[0].amount, source: 'excel' }
      }
    }
  }

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
  excelIndexes: ExcelRevenueIndexes = buildExcelRevenueIndexes([], []),
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
      const { amount: rawAmount, source: revenueSource } = deriveRevenueWithFallback(r, batch.id, excelIndexes, batchPrices)
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
  // 每個批次用「歸屬到自己商品」的索引，混搭單金額才不會被多個批次重複吸走
  const indexes = buildExcelRevenueIndexes(excelRows, shipments)
  return shipments.map(s => computeBatchMargin(s, records, furikomi, indexes, batchPrices, today))
}
