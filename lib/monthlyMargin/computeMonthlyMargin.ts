/**
 * lib/monthlyMargin/computeMonthlyMargin.ts
 *
 * 月結毛利主流程：複製 000_Agent/skills/monthly-margin/SKILL.md 的方法論——
 * 「每張出貨單的營收，對回它真正的來源進口批次成本，加上物流分攤」。
 * 跟現有 /margin 頁（lib/margin.ts）不同：那個以 Notion 批次為單位、即時；
 * 這個以「月份」為單位，成本對回現金流表的真實進口批次，物流對回真實對帳單。
 *
 * 資料來源（全部即時抓 Drive，不存快照）：
 *   ① 現金流表（固定檔案，DRIVE_CASHFLOW_FILE_ID）
 *   ② 出貨單資料夾「N月」子資料夾（DRIVE_SHIPMENT_FOLDER_ID，沿用 driveScan 既有慣例）
 *   ③ 優儲倉儲對帳單「N月」子資料夾（DRIVE_YUCHU_FOLDER_ID）
 *   ④ 三義物流對帳單「N月」子資料夾（DRIVE_SANYI_FOLDER_ID）
 *
 * 批次比對只認現金流「出荷票」欄直接比對 S 單號；比對不到的標 unmatched，交給前端
 * 手動指定（只是當次預覽，不寫回，見 public/monthly-margin-dashboard.html）。
 *
 * 分攤重點：一個來源批次可能同月被好幾張出貨單瓜分（見 SKILL.md 2.4「一批供多次出貨」），
 * 所以先把「哪些出貨單命中同一個批次」全部收集起來，再一次算分攤比例——不能每筆各自
 * 獨立算，否則 CTNS(總箱數) 沒填時的備援比例（=1）會讓同一批成本被重複計進好幾筆。
 */
import { parseStoreOrderWorkbook, type ParsedOrderRow } from '../driveScan/parseStoreOrder'
import { listMonthFolderFiles, downloadAsXlsx, type DriveFileInfo } from './driveMonthFolder'
import { parseCashflowWorkbook, type CashflowBatch } from './parseCashflow'
import { parseYuchuSettlementWorkbook, type ParsedYuchuSettlement } from './parseYuchuSettlement'
import { parseSanyiSettlementWorkbook, type ParsedSanyiSettlement } from './parseSanyiSettlement'
import { getReadonlyDrive } from '../driveScan/drive'

// 加工品關鍵字：命中就是應稅 5%，稅後金額要 ÷1.05 取未稅；沒命中的當蔬果免稅（見 SKILL.md 1.3）
const PROCESSED_KEYWORDS = ['大学芋', '大學芋', 'あんぽ柿', '加工']
function isProcessedProduct(name: string): boolean {
  return PROCESSED_KEYWORDS.some(k => name.includes(k))
}

function untaxedRevenueOfRow(row: ParsedOrderRow): number {
  if (row.price == null) return 0
  const gross = row.boxes * row.price
  return isProcessedProduct(row.name) ? gross / 1.05 : gross
}

export interface ShipmentMargin {
  fileId: string
  fileName: string
  sNo: string
  date: string
  store: string
  boxes: number
  revenue: number            // 未稅
  matchedInvoice: string | null
  matchedBatchId: number | null  // 對到的現金流批次 id，分組用（Invoice 不保證唯一，不能拿來分組）
  matchStatus: 'matched' | 'unmatched'
  allocImportCost: number    // 分攤到這筆的進口批次成本（未含物流）；unmatched 時為 0
  allocLogisticsCost: number
  margin: number
  marginRate: number
  productNames: string[]
  missingPrice: boolean      // 有箱數卻有列讀不到單價（該列不計入營收，需人工去對帳單補）
  warnings: string[]
}

export interface BatchGroupMargin {
  invoice: string
  sNos: string[]
  product: string
  shipments: ShipmentMargin[]
  revenue: number
  importCost: number
  logisticsCost: number
  margin: number
  marginRate: number
}

export interface MonthlyMarginTotals {
  boxes: number
  revenue: number
  importCost: number
  logisticsCost: number
  margin: number
  marginRate: number
  unmatchedCount: number      // 待指定筆數（這些筆的成本沒算進 importCost，margin 會偏高）
  missingPriceCount: number
}

export interface MonthlyMarginResult {
  year: number
  month: number
  groups: BatchGroupMargin[]
  unmatched: ShipmentMargin[]
  totals: MonthlyMarginTotals
  logistics: {
    status: 'complete' | 'partial'
    yuchu: ParsedYuchuSettlement | null
    sanyi: ParsedSanyiSettlement | null
  }
  allBatches: CashflowBatch[]  // 供前端「待指定」手動選單使用（前端用陣列 index 當 key，Invoice 不保證唯一）
  sourceFiles: {
    shipmentOrderFiles: string[]
    cashflowSheet: string
    yuchuFile: string | null
    sanyiFile: string | null
  }
  warnings: string[]
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`缺 ${name} env var`)
  return v
}

const MAX_FILE_BYTES = 20 * 1024 * 1024

async function downloadFileBuffers(files: DriveFileInfo[], warnings: string[]): Promise<{ file: DriveFileInfo; buf: Buffer }[]> {
  const out: { file: DriveFileInfo; buf: Buffer }[] = []
  for (const f of files) {
    if (f.size != null && Number(f.size) > MAX_FILE_BYTES) {
      warnings.push(`檔案「${f.name}」過大（${Math.round(Number(f.size) / 1048576)}MB），略過`)
      continue
    }
    try {
      const buf = await downloadAsXlsx(f)
      out.push({ file: f, buf })
    } catch (e) {
      warnings.push(`檔案「${f.name}」下載失敗：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

// 對帳單資料夾理論上一個月只有一份，但廠商偶爾會補一份修正版丟進同一個資料夾
// （優儲樣本就出現過「202603」跟「202603補」並存）。取「最後修改」那份，並把有幾份
// 攤在警告裡，讓 Colin 自己判斷要不要去 Drive 清掉舊檔。
function pickLatestSettlementFile(files: DriveFileInfo[], label: string, warnings: string[]): DriveFileInfo | null {
  if (files.length === 0) return null
  if (files.length > 1) {
    warnings.push(`${label}對帳單資料夾裡有 ${files.length} 個檔案（${files.map(f => f.name).join('、')}），已取「最後修改」的那份，其餘請確認是否為舊檔`)
  }
  // listMonthFolderFiles 依 modifiedTime 由舊到新排序，最後一個就是最新
  return files[files.length - 1]
}

interface RawTab {
  fileId: string
  fileName: string
  sNo: string
  date: string
  store: string
  boxes: number
  revenue: number
  productNames: string[]
  missingPrice: boolean
}

export async function computeMonthlyMargin(year: number, month: number): Promise<MonthlyMarginResult> {
  const warnings: string[] = []

  const shipmentFolderId = requireEnv('DRIVE_SHIPMENT_FOLDER_ID')
  const cashflowFileId = process.env.DRIVE_CASHFLOW_FILE_ID?.trim() || '1vvm9h1sS6AQT0VwUju3wXPQGWoMU59Yj'
  const yuchuFolderId = process.env.DRIVE_YUCHU_FOLDER_ID?.trim() || null
  const sanyiFolderId = process.env.DRIVE_SANYI_FOLDER_ID?.trim() || null

  // ── ① 現金流表：抓一次全部批次，不分月（成本要對回「真正來源批次」，不是當月通關的批次）──
  const drive = getReadonlyDrive()
  let cashflowBuf: Buffer
  try {
    if (cashflowFileId.length === 0) throw new Error('DRIVE_CASHFLOW_FILE_ID 是空字串')
    const cashflowRes = await drive.files.get(
      { fileId: cashflowFileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    )
    const raw = Buffer.from(cashflowRes.data as ArrayBuffer)
    if (raw.length > MAX_FILE_BYTES) throw new Error(`現金流表過大（${Math.round(raw.length / 1048576)}MB）`)
    cashflowBuf = raw
  } catch (e) {
    throw new Error(`現金流表下載失敗：${e instanceof Error ? e.message : String(e)}`)
  }
  const cashflow = parseCashflowWorkbook(cashflowBuf)
  warnings.push(...cashflow.warnings)
  // 一個批次的出荷票欄可能填了好幾個 S 單號（一批供多次出貨），每個 S 單號都個別指到同一個批次物件
  const cashflowBySNo = new Map<string, CashflowBatch>()
  for (const b of cashflow.batches) {
    for (const sNo of b.sNos) {
      if (cashflowBySNo.has(sNo)) warnings.push(`現金流表「出荷票」欄有重複 S 單號 ${sNo}（${b.invoice} 跟 ${cashflowBySNo.get(sNo)!.invoice}），取第一筆`)
      else cashflowBySNo.set(sNo, b)
    }
  }

  // ── ② 出貨單資料夾：抓這個月的「N月」子資料夾，解析成一筆筆「店鋪分頁」原始資料 ──
  const shipmentFiles = await listMonthFolderFiles(shipmentFolderId, month)
  if (shipmentFiles.length === 0) warnings.push(`出貨單資料夾找不到「${month}月」子資料夾，或裡面沒有試算表檔案`)
  const shipmentBufs = await downloadFileBuffers(shipmentFiles, warnings)

  const seenSNo = new Map<string, string>() // sNo -> fileName，抓同月同單號重複出現
  const rawTabs: RawTab[] = []

  for (const { file, buf } of shipmentBufs) {
    let parsed
    try {
      parsed = parseStoreOrderWorkbook(buf)
    } catch (e) {
      warnings.push(`檔案「${file.name}」解析失敗：${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    if (parsed.hardWarnings.length > 0) {
      warnings.push(`檔案「${file.name}」讀不準（${parsed.hardWarnings.join('；')}），這張單不算進月結毛利，請人工確認`)
      continue
    }
    if (!parsed.dominantSno || !parsed.dominantDate || parsed.activeTabs.length === 0) {
      warnings.push(`檔案「${file.name}」找不到出貨單號或店鋪明細，略過`)
      continue
    }
    const sNo = parsed.dominantSno
    if (seenSNo.has(sNo)) {
      // 同一個 S 單號出現在兩個檔案，無法判斷哪張才是本尊——兩張都算會重複計入營收成本，
      // 兩張都不算又可能漏掉真正該請款的那張，所以整個略過不算，交給人工比對後只留一張。
      warnings.push(`出貨單號 ${sNo} 出現在兩個檔案（「${seenSNo.get(sNo)}」與「${file.name}」），無法判斷哪張才對，這個月結報告先跳過這張單，請人工確認後只保留一張再重新整理`)
      continue
    }
    seenSNo.set(sNo, file.name)

    for (const tab of parsed.activeTabs) {
      if (!tab.store || tab.rows.length === 0) continue
      rawTabs.push({
        fileId: file.id,
        fileName: file.name,
        sNo,
        date: parsed.dominantDate,
        store: tab.store,
        boxes: tab.totalBoxes,
        revenue: tab.rows.reduce((s, r) => s + untaxedRevenueOfRow(r), 0),
        productNames: [...new Set(tab.rows.map(r => r.name))],
        missingPrice: tab.rows.some(r => r.price == null),
      })
    }
  }

  // ── 比對來源批次＋分攤進貨成本 ──────────────────────────────────────────────
  // 同一個來源批次可能被好幾張出貨單瓜分，所以先分組再算比例，不能逐筆各自獨立算
  // （逐筆各自算的話，CTNS 沒填時的備援比例會讓同一批成本被算好幾次）。用批次的 id
  // （不是出荷票 S 單號）當分組 key——一個批次現在可能對到好幾個 S 單號。
  const byBatchId = new Map<number, RawTab[]>()
  const unmatchedTabs: RawTab[] = []
  for (const t of rawTabs) {
    const matched = cashflowBySNo.get(t.sNo)
    if (!matched) { unmatchedTabs.push(t); continue }
    const arr = byBatchId.get(matched.id) ?? []
    arr.push(t)
    byBatchId.set(matched.id, arr)
  }
  const cashflowById = new Map(cashflow.batches.map(b => [b.id, b]))

  const shipments: ShipmentMargin[] = []
  for (const [batchId, tabs] of byBatchId) {
    const batch = cashflowById.get(batchId)!
    const claimedBoxes = tabs.reduce((s, t) => s + t.boxes, 0)
    let base = batch.totalBoxes
    if (base <= 0) {
      base = claimedBoxes
      warnings.push(`批次「${batch.invoice}」現金流表沒有 CTNS(總箱數) 資料，先用這個月比對到的箱數（合計 ${claimedBoxes} 箱）當分攤基準，可能不是這批的全部箱數，成本分攤僅供參考`)
    } else if (claimedBoxes > base) {
      warnings.push(`批次「${batch.invoice}」這個月比對到的箱數合計(${claimedBoxes})超過總箱數(${base})，分攤比例會超過100%，請確認`)
    }
    for (const t of tabs) {
      const ratio = base > 0 ? t.boxes / base : 0
      const allocImportCost = batch.totalCost * ratio
      const shipWarnings: string[] = []
      if (t.missingPrice) shipWarnings.push('有商品項讀不到單價，該項未計入營收')
      shipments.push({
        fileId: t.fileId, fileName: t.fileName, sNo: t.sNo, date: t.date, store: t.store, boxes: t.boxes,
        revenue: t.revenue, matchedInvoice: batch.invoice, matchedBatchId: batch.id, matchStatus: 'matched',
        allocImportCost, allocLogisticsCost: 0, margin: 0, marginRate: 0,
        productNames: t.productNames, missingPrice: t.missingPrice, warnings: shipWarnings,
      })
    }
  }
  for (const t of unmatchedTabs) {
    const shipWarnings: string[] = []
    if (t.missingPrice) shipWarnings.push('有商品項讀不到單價，該項未計入營收')
    shipments.push({
      fileId: t.fileId, fileName: t.fileName, sNo: t.sNo, date: t.date, store: t.store, boxes: t.boxes,
      revenue: t.revenue, matchedInvoice: null, matchedBatchId: null, matchStatus: 'unmatched',
      allocImportCost: 0, allocLogisticsCost: 0, margin: 0, marginRate: 0,
      productNames: t.productNames, missingPrice: t.missingPrice, warnings: shipWarnings,
    })
  }

  // ── ③④ 倉儲／物流對帳單 ──
  let yuchu: ParsedYuchuSettlement | null = null
  let sanyiFileName: string | null = null
  let yuchuFileName: string | null = null
  let sanyi: ParsedSanyiSettlement | null = null

  if (yuchuFolderId) {
    const files = await listMonthFolderFiles(yuchuFolderId, month)
    const target = pickLatestSettlementFile(files, '優儲', warnings)
    if (!target) {
      warnings.push(`優儲對帳單資料夾找不到「${month}月」子資料夾或檔案，物流成本先算「尚未到帳」`)
    } else {
      const { buf } = (await downloadFileBuffers([target], warnings))[0] ?? {}
      if (buf) {
        yuchu = parseYuchuSettlementWorkbook(buf)
        yuchuFileName = target.name
        warnings.push(...yuchu.warnings)
      }
    }
  } else {
    warnings.push('未設定 DRIVE_YUCHU_FOLDER_ID，優儲倉儲成本先算「尚未到帳」')
  }

  if (sanyiFolderId) {
    const files = await listMonthFolderFiles(sanyiFolderId, month)
    const target = pickLatestSettlementFile(files, '三義', warnings)
    if (!target) {
      warnings.push(`三義對帳單資料夾找不到「${month}月」子資料夾或檔案，物流成本先算「尚未到帳」`)
    } else {
      const { buf } = (await downloadFileBuffers([target], warnings))[0] ?? {}
      if (buf) {
        sanyi = parseSanyiSettlementWorkbook(buf)
        sanyiFileName = target.name
        warnings.push(...sanyi.warnings)
      }
    }
  } else {
    warnings.push('未設定 DRIVE_SANYI_FOLDER_ID，三義物流成本先算「尚未到帳」')
  }

  const logisticsTotal = (yuchu?.untaxedTotal ?? 0) + (sanyi?.untaxedSubtotal ?? 0)
  const logisticsComplete = yuchu?.untaxedTotal != null && sanyi?.untaxedSubtotal != null
  const totalBoxesThisMonth = shipments.reduce((s, x) => s + x.boxes, 0)
  const perBoxLogistics = totalBoxesThisMonth > 0 ? logisticsTotal / totalBoxesThisMonth : 0

  for (const s of shipments) {
    s.allocLogisticsCost = perBoxLogistics * s.boxes
    s.margin = s.revenue - s.allocImportCost - s.allocLogisticsCost
    s.marginRate = s.revenue > 0 ? s.margin / s.revenue : 0
  }

  // ── 依來源批次分組（用批次 id 當 key，保證唯一；Invoice 可能同名但不同批次）──
  const groupMap = new Map<number, BatchGroupMargin>()
  const unmatched: ShipmentMargin[] = []
  for (const s of shipments) {
    if (s.matchStatus === 'unmatched' || s.matchedBatchId == null) { unmatched.push(s); continue }
    let g = groupMap.get(s.matchedBatchId)
    if (!g) {
      const batch = cashflowById.get(s.matchedBatchId)
      g = { invoice: s.matchedInvoice ?? '', sNos: batch?.sNos ?? [s.sNo], product: s.productNames.join('/'), shipments: [], revenue: 0, importCost: 0, logisticsCost: 0, margin: 0, marginRate: 0 }
      groupMap.set(s.matchedBatchId, g)
    }
    g.shipments.push(s)
    g.revenue += s.revenue
    g.importCost += s.allocImportCost
    g.logisticsCost += s.allocLogisticsCost
  }
  const groups = [...groupMap.values()].map(g => {
    const margin = g.revenue - g.importCost - g.logisticsCost
    return { ...g, margin, marginRate: g.revenue > 0 ? margin / g.revenue : 0 }
  }).sort((a, b) => a.marginRate - b.marginRate)

  const totals: MonthlyMarginTotals = shipments.reduce((acc, s) => ({
    boxes: acc.boxes + s.boxes,
    revenue: acc.revenue + s.revenue,
    importCost: acc.importCost + s.allocImportCost,
    logisticsCost: acc.logisticsCost + s.allocLogisticsCost,
    margin: 0,
    marginRate: 0,
    unmatchedCount: acc.unmatchedCount + (s.matchStatus === 'unmatched' ? 1 : 0),
    missingPriceCount: acc.missingPriceCount + (s.missingPrice ? 1 : 0),
  }), { boxes: 0, revenue: 0, importCost: 0, logisticsCost: 0, margin: 0, marginRate: 0, unmatchedCount: 0, missingPriceCount: 0 })
  totals.margin = totals.revenue - totals.importCost - totals.logisticsCost
  totals.marginRate = totals.revenue > 0 ? totals.margin / totals.revenue : 0

  return {
    year,
    month,
    groups,
    unmatched,
    totals,
    logistics: { status: logisticsComplete ? 'complete' : 'partial', yuchu, sanyi },
    allBatches: cashflow.batches,
    sourceFiles: {
      shipmentOrderFiles: shipmentFiles.map(f => f.name),
      cashflowSheet: cashflow.sheetName,
      yuchuFile: yuchuFileName,
      sanyiFile: sanyiFileName,
    },
    warnings,
  }
}
