/**
 * lib/liveMargin.ts — 批次即時毛利（/profit 頁）計算層
 *
 * 2026-07 重建版，取代舊 /margin 與月結毛利系統。設計原則：
 *   資料全部住在 Notion，這裡只做純計算，永遠不碰任何 Drive 檔案解析。
 *
 * 成本模型（新三欄制）：
 *   批次成本 = 仕入原價JPY÷4.5 ＋ 關稅通關費(台幣) ＋ 雜費(台幣)
 *   物流成本 = 「月度物流費用」DB 的當月三義＋優儲總額，按當月所有出貨箱數比例分攤
 *   （為什麼物流按月不按批：三義/優儲的帳單本來就是月結一張，拆批只能用箱數比例估）
 *
 * 營收模型：沿用 lib/margin.ts 的三層推算（手動金額 → 對帳明細 → 批次單價×箱數），
 * 課稅別=5% 的批次金額÷1.05 取未稅。
 *
 * 「即時」的定義：只計入出貨日 ≤ 今天的紀錄；未來的出貨計畫另外統計不進毛利，
 * 避免「還沒發生的營收」美化數字。
 */
import type { Shipment, ShipmentRecord, ExcelRow, BatchPriceEntry, MonthlyLogistics } from './notion'
import { buildExcelRevenueIndex, deriveRevenue, JPY_PER_NTD, type RevenueSource } from './margin'

function num(n: number | null | undefined): number {
  return typeof n === 'number' && isFinite(n) ? n : 0
}

// 財年：4月～隔年3月（例：2026-03 屬 FY2025，2026-04 屬 FY2026）
export function fiscalYearOf(month: string): number {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m >= 4 ? y : y - 1
}

export type CostStatus = 'complete' | 'partial' | 'none'

export interface LiveRecordRow {
  id: string
  date: string | null
  month: string | null       // 'YYYY-MM'，無日期時 null
  store: string | null
  boxes: number
  revenue: number            // 未稅 TWD
  revenueSource: RevenueSource
  allocImport: number
  allocLogistics: number
  margin: number
  isFuture: boolean
}

export interface LiveBatchMargin {
  batchId: string
  ivName: string
  productSummary: string | null
  supplier: string | null
  arrivalTW: string | null
  deliveryStatus: string | null // Notion「配送狀態」：全數出貨=人工認定已出完（歷史批次的紀錄可能不完整，以這欄為準）
  totalBoxes: number         // 分攤基準（入倉箱數優先，沒填退回已出箱數）
  shippedBoxes: number       // 已出貨（≤今天）
  futureBoxes: number        // 未來計畫中
  // 成本（TWD 換算後，計算用）
  shiireTwd: number
  tariffCustoms: number
  miscFee: number
  costFull: number           // 整批成本合計
  costStatus: CostStatus     // 三欄都填=complete、填了一部分=partial、全空=none
  // 成本原始值（Notion 裡實際存的，null=沒填；給前端表單預帶用，仕入是日圓）
  shiireJpyRaw: number | null
  tariffCustomsRaw: number | null
  miscFeeRaw: number | null
  // 已出貨部分
  revenue: number
  allocImport: number
  allocLogistics: number
  margin: number
  marginRate: number
  missingPriceRows: number   // 有箱數卻抓不到營收的列數
  rows: LiveRecordRow[]
}

export interface LiveMonthSummary {
  month: string
  fiscalYear: number
  boxes: number
  revenue: number
  importCost: number
  logistics: number          // 該月已填的三義+優儲總額（沒填=0）
  logisticsFilled: boolean   // 該月月度物流有沒有填
  margin: number
  marginRate: number
}

export interface LiveMarginResult {
  batches: LiveBatchMargin[]
  months: LiveMonthSummary[]           // 有出貨的月份，新到舊
  fy: {                                // 本財年（今天所屬財年）已出貨總覽
    fiscalYear: number
    revenue: number
    importCost: number
    logistics: number
    margin: number
    marginRate: number
    batchesWithMissingCost: number     // 本財年有出貨但成本沒填齊的批次數
    monthsWithMissingLogistics: string[] // 本財年有出貨但月度物流沒填的月份
  }
  logisticsEntries: MonthlyLogistics[] // 已填的月度物流（給前端表單顯示）
}

function costStatusOf(b: Shipment): CostStatus {
  const filled = [b.shiireJpy, b.tariffCustoms, b.miscFee].filter(v => v != null).length
  if (filled === 3) return 'complete'
  if (filled === 0) return 'none'
  return 'partial'
}

export function computeLiveMargins(
  shipments: Shipment[],
  records: ShipmentRecord[],
  logistics: MonthlyLogistics[],
  excelRows: ExcelRow[] = [],
  batchPrices: Record<string, BatchPriceEntry[]> = {},
  today: string = new Date().toISOString().slice(0, 10),
): LiveMarginResult {
  const excelIndex = buildExcelRevenueIndex(excelRows)
  const logisticsByMonth = new Map<string, MonthlyLogistics>()
  for (const l of logistics) logisticsByMonth.set(l.month, l)

  // ── 前處理：把紀錄分成「有連批次」跟「沒連批次」兩堆 ─────────────────────
  // 沒連批次的主要是 3~4 月對帳時代手動建的紀錄（有金額、沒關聯批次），不能直接丟掉
  // （3月整個月、4月大半營收都在這裡），也不能直接全加（其中一部分跟批次計畫紀錄
  // 是同一趟出貨記兩次，會重複計算）。
  const batchById = new Map(shipments.map(s => [s.id, s]))
  const linkedRecs: { rec: ShipmentRecord; batch: Shipment }[] = []
  const unlinkedRecs: ShipmentRecord[] = []
  for (const r of records) {
    if (r.planStatus === '已取消') continue
    const batch = r.batchId ? batchById.get(r.batchId) : undefined
    if (batch) linkedRecs.push({ rec: r, batch })
    else unlinkedRecs.push(r)
  }

  // 合體去重：同店＋同日＋同箱數，一邊有批次沒金額、一邊有金額沒批次 → 同一趟出貨，
  // 把金額補給有批次的那筆，未連結那筆丟掉。（2026-04 實測 43 筆計畫紀錄有 32 筆這樣配上）
  const dupKey = (r: ShipmentRecord) => `${(r.store ?? '').trim()}|${(r.date ?? '').slice(0, 10)}|${num(r.boxes)}`
  const linkedNoAmount = new Map<string, { rec: ShipmentRecord; batch: Shipment }[]>()
  for (const l of linkedRecs) {
    if (l.rec.amount != null) continue
    const k = dupKey(l.rec)
    const arr = linkedNoAmount.get(k) ?? []
    arr.push(l)
    linkedNoAmount.set(k, arr)
  }
  const mergedAmounts = new Map<string, number>() // 連結紀錄 id → 從未連結雙胞胎接收的金額
  const remainingUnlinked: ShipmentRecord[] = []
  for (const u of unlinkedRecs) {
    const twin = u.amount != null ? linkedNoAmount.get(dupKey(u))?.shift() : undefined
    if (twin) mergedAmounts.set(twin.rec.id, u.amount!)
    else remainingUnlinked.push(u)
  }

  // ── 第一輪：把每筆出貨紀錄算出營收、歸月，先不算物流（要等全月箱數才知道分攤率）──
  interface Prep { rec: ShipmentRecord; batch: Shipment | null; boxes: number; revenue: number; source: RevenueSource; month: string | null; isFuture: boolean }
  const prepped: Prep[] = []
  const prepOne = (r: ShipmentRecord, batch: Shipment | null) => {
    const boxes = num(r.boxes)
    const merged = mergedAmounts.get(r.id)
    const recForRevenue = merged != null && r.amount == null ? { ...r, amount: merged } : r
    const { amount, source } = deriveRevenue(recForRevenue, batch?.id ?? '', excelIndex, batchPrices)
    const gross = num(amount)
    // 未連結批次不知道課稅別，當免稅處理（大宗是蔬果；加工品會略高估5%）
    const revenue = batch?.taxMode === '5%' ? gross / 1.05 : gross
    const month = r.date ? r.date.slice(0, 7) : null
    const isFuture = !!(r.date && r.date > today)
    prepped.push({ rec: r, batch, boxes, revenue, source, month, isFuture })
  }
  for (const l of linkedRecs) prepOne(l.rec, l.batch)
  for (const u of remainingUnlinked) prepOne(u, null)

  // 每月已出貨總箱數（所有批次合計）＝物流分攤的分母
  const monthBoxes = new Map<string, number>()
  for (const p of prepped) {
    if (p.isFuture || !p.month) continue
    monthBoxes.set(p.month, (monthBoxes.get(p.month) ?? 0) + p.boxes)
  }
  const perBoxLogistics = (month: string | null): number => {
    if (!month) return 0
    const entry = logisticsByMonth.get(month)
    const total = num(entry?.sanyi) + num(entry?.yuchu)
    const boxes = monthBoxes.get(month) ?? 0
    return total > 0 && boxes > 0 ? total / boxes : 0
  }

  // ── 第二輪：組每批的即時毛利 ──
  const batches: LiveBatchMargin[] = []
  for (const batch of shipments) {
    const mine = prepped.filter(p => p.batch?.id === batch.id)
    const shipped = mine.filter(p => !p.isFuture)
    const shippedBoxes = shipped.reduce((s, p) => s + p.boxes, 0)
    const futureBoxes = mine.filter(p => p.isFuture).reduce((s, p) => s + p.boxes, 0)

    const shiireTwd = num(batch.shiireJpy) / JPY_PER_NTD
    const tariffCustoms = num(batch.tariffCustoms)
    const miscFee = num(batch.miscFee)
    const costFull = shiireTwd + tariffCustoms + miscFee
    // 分攤基準：入倉箱數優先（成本攤在整批），沒填退回已出箱數
    const base = num(batch.totalBoxes) > 0 ? num(batch.totalBoxes) : shippedBoxes

    const rows: LiveRecordRow[] = mine.map(p => {
      const ratio = !p.isFuture && base > 0 ? p.boxes / base : 0
      const allocImport = costFull * ratio
      const allocLogistics = p.isFuture ? 0 : perBoxLogistics(p.month) * p.boxes
      return {
        id: p.rec.id,
        date: p.rec.date,
        month: p.month,
        store: p.rec.store,
        boxes: p.boxes,
        revenue: p.isFuture ? 0 : p.revenue,
        revenueSource: p.source,
        allocImport,
        allocLogistics,
        margin: (p.isFuture ? 0 : p.revenue) - allocImport - allocLogistics,
        isFuture: p.isFuture,
      }
    }).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

    const shippedRows = rows.filter(r => !r.isFuture)
    const revenue = shippedRows.reduce((s, r) => s + r.revenue, 0)
    const allocImport = shippedRows.reduce((s, r) => s + r.allocImport, 0)
    const allocLogistics = shippedRows.reduce((s, r) => s + r.allocLogistics, 0)
    const margin = revenue - allocImport - allocLogistics

    batches.push({
      batchId: batch.id,
      ivName: batch.ivName,
      productSummary: batch.productSummary,
      supplier: batch.supplier,
      arrivalTW: batch.arrivalTW,
      deliveryStatus: batch.deliveryStatus,
      totalBoxes: base,
      shippedBoxes,
      futureBoxes,
      shiireTwd,
      tariffCustoms,
      miscFee,
      costFull,
      costStatus: costStatusOf(batch),
      shiireJpyRaw: batch.shiireJpy,
      tariffCustomsRaw: batch.tariffCustoms,
      miscFeeRaw: batch.miscFee,
      revenue,
      allocImport,
      allocLogistics,
      margin,
      marginRate: revenue > 0 ? margin / revenue : 0,
      missingPriceRows: shippedRows.filter(r => r.revenueSource === 'none' && r.boxes > 0).length,
      rows,
    })
  }

  // ── 未連結批次（虛擬一列）：去重後仍沒有批次的紀錄，營收照算、進貨成本攤不了 ──
  const orphans = prepped.filter(p => !p.batch)
  if (orphans.length > 0) {
    const rows: LiveRecordRow[] = orphans.map(p => {
      const allocLogistics = p.isFuture ? 0 : perBoxLogistics(p.month) * p.boxes
      return {
        id: p.rec.id, date: p.rec.date, month: p.month, store: p.rec.store, boxes: p.boxes,
        revenue: p.isFuture ? 0 : p.revenue, revenueSource: p.source,
        allocImport: 0, allocLogistics,
        margin: (p.isFuture ? 0 : p.revenue) - allocLogistics, isFuture: p.isFuture,
      }
    }).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    const shippedRows = rows.filter(r => !r.isFuture)
    const revenue = shippedRows.reduce((s, r) => s + r.revenue, 0)
    const allocLogistics = shippedRows.reduce((s, r) => s + r.allocLogistics, 0)
    const shippedBoxes = shippedRows.reduce((s, r) => s + r.boxes, 0)
    batches.push({
      batchId: '__unlinked__',
      ivName: '未連結批次',
      productSummary: '出貨紀錄沒填「關聯批次」（多為3–4月對帳時代資料），營收計入月度，進貨成本無法分攤',
      supplier: null, arrivalTW: null, deliveryStatus: null,
      totalBoxes: shippedBoxes, shippedBoxes,
      futureBoxes: rows.filter(r => r.isFuture).reduce((s, r) => s + r.boxes, 0),
      shiireTwd: 0, tariffCustoms: 0, miscFee: 0, costFull: 0, costStatus: 'none',
      shiireJpyRaw: null, tariffCustomsRaw: null, miscFeeRaw: null,
      revenue, allocImport: 0, allocLogistics,
      margin: revenue - allocLogistics,
      marginRate: revenue > 0 ? (revenue - allocLogistics) / revenue : 0,
      missingPriceRows: shippedRows.filter(r => r.revenueSource === 'none' && r.boxes > 0).length,
      rows,
    })
  }

  // ── 月度彙總（只算已出貨）──
  const monthMap = new Map<string, LiveMonthSummary>()
  for (const b of batches) {
    for (const r of b.rows) {
      if (r.isFuture || !r.month) continue
      let m = monthMap.get(r.month)
      if (!m) {
        const entry = logisticsByMonth.get(r.month)
        m = {
          month: r.month,
          fiscalYear: fiscalYearOf(r.month),
          boxes: 0, revenue: 0, importCost: 0,
          logistics: num(entry?.sanyi) + num(entry?.yuchu),
          logisticsFilled: entry != null && (entry.sanyi != null || entry.yuchu != null),
          margin: 0, marginRate: 0,
        }
        monthMap.set(r.month, m)
      }
      m.boxes += r.boxes
      m.revenue += r.revenue
      m.importCost += r.allocImport
    }
  }
  const months = [...monthMap.values()]
    .map(m => {
      const margin = m.revenue - m.importCost - m.logistics
      return { ...m, margin, marginRate: m.revenue > 0 ? margin / m.revenue : 0 }
    })
    .sort((a, b) => b.month.localeCompare(a.month))

  // ── 本財年總覽 ──
  const currentFy = fiscalYearOf(today.slice(0, 7))
  const fyMonths = months.filter(m => m.fiscalYear === currentFy)
  const fyRevenue = fyMonths.reduce((s, m) => s + m.revenue, 0)
  const fyImport = fyMonths.reduce((s, m) => s + m.importCost, 0)
  const fyLogistics = fyMonths.reduce((s, m) => s + m.logistics, 0)
  const fyMargin = fyRevenue - fyImport - fyLogistics
  const fyBatchIds = new Set<string>()
  for (const b of batches) {
    if (b.rows.some(r => !r.isFuture && r.month && fiscalYearOf(r.month) === currentFy)) fyBatchIds.add(b.batchId)
  }
  // 「未連結批次」那列本來就沒有成本可填，不算進成本未填齊的警告
  const batchesWithMissingCost = batches.filter(b => b.batchId !== '__unlinked__' && fyBatchIds.has(b.batchId) && b.costStatus !== 'complete').length

  return {
    // 排序：有出貨的批次照抵台日新到舊排前面，完全沒出貨的排最後
    batches: batches.sort((a, b) => {
      const aActive = a.shippedBoxes > 0 || a.futureBoxes > 0 ? 0 : 1
      const bActive = b.shippedBoxes > 0 || b.futureBoxes > 0 ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return (b.arrivalTW ?? '').localeCompare(a.arrivalTW ?? '')
    }),
    months,
    fy: {
      fiscalYear: currentFy,
      revenue: fyRevenue,
      importCost: fyImport,
      logistics: fyLogistics,
      margin: fyMargin,
      marginRate: fyRevenue > 0 ? fyMargin / fyRevenue : 0,
      batchesWithMissingCost,
      monthsWithMissingLogistics: fyMonths.filter(m => !m.logisticsFilled).map(m => m.month),
    },
    logisticsEntries: [...logistics].sort((a, b) => b.month.localeCompare(a.month)),
  }
}
