/**
 * lib/driveScan/match.ts
 *
 * Drive 自動扣帳 — 商品對批次＋FIFO 分配。
 * ───────────────────────────────────────────────────────────────
 * 規則（訪談定案）：
 *   1. 每個批次頁有「商品關鍵字」欄（逗號分隔），商品列名稱含任一關鍵字＝候選批次
 *      - 先用「商品列名稱」比對；比不到再用「檔名」比對（蘋果單的商品列只有品種名，
 *        批號資訊在檔名的「蘋果11.3」裡）
 *   2. 候選批次照 FIFO 排（入倉日 → 抵台日 → 日本出發日，最早的先扣）
 *      - 「全數出貨」的批次不參與分配（帳面上可能還有剩，但實體已出完）
 *   3. 可分配剩餘 = 入倉箱數 −（該批次所有未取消出貨紀錄的箱數合計）
 *      - 重新鏡像同一個檔案時，該檔自己的舊紀錄先排除（等於重算）
 *   4. 一列箱數可以跨批次拆（前一批剩餘不夠時往下一批扣）
 *   5. 全部候選批次加起來都不夠 → 整張單不寫，回報異常（不硬扣）
 */

import { Client } from '@notionhq/client'
import type { ParsedStoreTab } from './parseStoreOrder'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

export interface BatchLite {
  id: string
  ivName: string
  productSummary: string
  keywords: string[]        // 商品關鍵字欄位拆出來的清單
  totalBoxes: number
  deliveryStatus: string    // 配送狀態（「全數出貨」不參與分配）
  fifoDate: string          // FIFO 排序用日期
}

// 讀批次清單（只抓需要的欄位，含新加的「商品關鍵字」）
export async function fetchBatchesLite(): Promise<BatchLite[]> {
  const DB = process.env.NOTION_IMPORT_STATUS_DB?.trim()
  if (!DB) throw new Error('缺 NOTION_IMPORT_STATUS_DB')
  const out: BatchLite[] = []
  let cursor: string | undefined
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await notion.databases.query({
      database_id: DB,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of res.results) {
      const p = page.properties
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rich = (prop: any) => prop?.rich_text?.map((r: { plain_text: string }) => r.plain_text).join('') ?? ''
      const kw = rich(p['商品關鍵字'])
      out.push({
        id: page.id,
        ivName: p['IV Name']?.title?.[0]?.plain_text ?? '(無名稱)',
        productSummary: rich(p['商品摘要']),
        keywords: kw.split(/[,，、;；\n]/).map((s: string) => s.trim()).filter(Boolean),
        totalBoxes: p['入倉箱數']?.number ?? 0,
        deliveryStatus: p['配送狀態']?.select?.name ?? '',
        fifoDate: p['入倉日']?.date?.start
          ?? p['抵台日']?.date?.start
          ?? p['日本出發日']?.date?.start
          ?? '9999-12-31',
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return out
}

// 一段文字有沒有命中批次的任何一個關鍵字
function hitKeyword(text: string, b: BatchLite): boolean {
  const t = text.toLowerCase()
  return b.keywords.some(k => k && t.includes(k.toLowerCase()))
}

/**
 * 找出一列商品的候選批次（已照 FIFO 排序）。
 * 先用商品名比、比不到再用檔名比。
 * eligible = 可分配的候選；excludedShipped = 有對到關鍵字但已「全數出貨」被排除的
 * （後者只拿來讓錯誤訊息講清楚，不參與分配）。
 * usedFilenameFallback = 這列是靠「檔名」而非「商品名」對到的（可能對錯批，要提醒）。
 */
export function candidateBatches(rowName: string, fileName: string, batches: BatchLite[]): {
  eligible: BatchLite[]
  excludedShipped: BatchLite[]
  usedFilenameFallback: boolean
} {
  const withKw = batches.filter(b => b.keywords.length > 0)
  let hits = withKw.filter(b => hitKeyword(rowName, b))
  let usedFilenameFallback = false
  if (hits.length === 0) {
    hits = withKw.filter(b => hitKeyword(fileName, b))
    usedFilenameFallback = hits.length > 0
  }
  const eligible = hits.filter(b => b.deliveryStatus !== '全數出貨')
    .sort((a, b) => a.fifoDate.localeCompare(b.fifoDate))
  const excludedShipped = hits.filter(b => b.deliveryStatus === '全數出貨')
  return { eligible, excludedShipped, usedFilenameFallback }
}

// ── FIFO 分配 ─────────────────────────────────────────────────────────────────

export interface AllocationLine {
  batchId: string
  batchName: string
  store: string
  boxes: number
}

export interface AllocationResult {
  ok: boolean
  lines: AllocationLine[]              // (批次×門市) 加總後的扣帳明細
  perBatchTotal: Map<string, number>   // batchId → 本單合計箱數（訊息用）
  errors: string[]                     // 對不上 / 不夠扣 的原因（ok=false 時看這裡）
  notes: string[]                      // 軟提醒（如：某列是靠檔名對到批次的）
}

/**
 * 把解析好的分頁（多店）分配到批次。
 * @param remainingByBatch 各批次目前「可分配剩餘」（呼叫端算好傳入，已排除本檔舊紀錄）
 *                         這個 Map 會被就地扣減（同一次掃描處理多檔時共用）
 */
export function allocateFifo(
  tabs: ParsedStoreTab[],
  fileName: string,
  batches: BatchLite[],
  remainingByBatch: Map<string, number>,
): AllocationResult {
  const errors: string[] = []
  // 累積 (batchId|store) → boxes
  const acc = new Map<string, AllocationLine>()
  const perBatchTotal = new Map<string, number>()
  const notes: string[] = []
  // 本函式內先用暫存剩餘，全部成功才真正扣到共用 Map（失敗 = 完全不動）
  const tempRemaining = new Map(remainingByBatch)
  const batchById = new Map(batches.map(b => [b.id, b]))

  for (const tab of tabs) {
    if (!tab.store || tab.rows.length === 0) continue
    for (const row of tab.rows) {
      const { eligible: candidates, excludedShipped, usedFilenameFallback } = candidateBatches(row.name, fileName, batches)
      if (candidates.length === 0) {
        if (excludedShipped.length > 0) {
          errors.push(`商品「${row.name}」（${tab.store} ${row.boxes}箱）對到的批次都已標「全數出貨」：${excludedShipped.map(b => b.ivName).join('、')}（若確實要從這批出，請先把批次配送狀態改掉）`)
        } else {
          errors.push(`商品「${row.name}」（${tab.store} ${row.boxes}箱）對不到任何批次的商品關鍵字`)
        }
        continue
      }
      if (usedFilenameFallback) {
        notes.push(`商品「${row.name}」（${tab.store}）商品名對不到關鍵字，改用檔名判定為「${candidates[0].ivName}」，請確認批次正確`)
      }
      // FIFO：從最舊批次開始扣，不夠就往下一批
      let need = row.boxes
      for (const b of candidates) {
        if (need <= 0) break
        const remain = tempRemaining.get(b.id) ?? 0
        if (remain <= 0) continue
        const take = Math.min(remain, need)
        tempRemaining.set(b.id, remain - take)
        need -= take
        const key = `${b.id}|${tab.store}`
        const line = acc.get(key) ?? { batchId: b.id, batchName: b.ivName, store: tab.store, boxes: 0 }
        line.boxes += take
        acc.set(key, line)
        perBatchTotal.set(b.id, (perBatchTotal.get(b.id) ?? 0) + take)
      }
      if (need > 0) {
        const names = candidates.map(c => `${c.ivName}(剩${remainingByBatch.get(c.id) ?? 0})`).join('、')
        errors.push(`商品「${row.name}」（${tab.store}）需 ${row.boxes} 箱，候選批次不夠扣：${names}`)
      }
    }
  }

  if (errors.length > 0) {
    // 有任何一列出錯 → 整張單不寫（訪談決策：不硬扣、通知人工處理）
    return { ok: false, lines: [], perBatchTotal: new Map(), errors, notes }
  }

  // 全部成功 → 把暫存剩餘寫回共用 Map
  for (const [id, v] of tempRemaining) remainingByBatch.set(id, v)
  // 保持穩定順序：批次 FIFO 日期 → 門市名
  const lines = Array.from(acc.values()).sort((a, b) => {
    const fa = batchById.get(a.batchId)?.fifoDate ?? ''
    const fb = batchById.get(b.batchId)?.fifoDate ?? ''
    return fa.localeCompare(fb) || a.store.localeCompare(b.store)
  })
  return { ok: true, lines, perBatchTotal, errors: [], notes }
}
