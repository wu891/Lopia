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
 * 原則：出貨單為準，Notion 有誤差。所以「全數出貨」的批次也當候選（不排除）——
 *   Notion 的配送狀態可能還沒更新，出貨單說有出就是有出。
 * usedFilenameFallback = 這列是靠「檔名」而非「商品名」對到的（可能對錯批，要提醒）。
 */
export function candidateBatches(rowName: string, fileName: string, batches: BatchLite[]): {
  eligible: BatchLite[]
  usedFilenameFallback: boolean
} {
  const withKw = batches.filter(b => b.keywords.length > 0)
  let hits = withKw.filter(b => hitKeyword(rowName, b))
  let usedFilenameFallback = false
  if (hits.length === 0) {
    hits = withKw.filter(b => hitKeyword(fileName, b))
    usedFilenameFallback = hits.length > 0
  }
  const eligible = hits.slice().sort((a, b) => a.fifoDate.localeCompare(b.fifoDate))
  return { eligible, usedFilenameFallback }
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
  errors: string[]                     // 只有「對不到任何批次關鍵字」才會有（ok=false 時看這裡）
  notes: string[]                      // 軟提醒（如：某列靠檔名對到批次、某批超領）
}

/**
 * 把解析好的分頁（多店）分配到批次。
 * 原則：出貨單為準。所以「剩餘不夠扣」不再擋——照出貨單記到最符合的批次，
 *   容許批次「超領」（剩餘變負），只在 notes 裡標記請人工確認入倉數/漏建批次。
 *   唯一會 ok=false 的情況＝某商品對不到任何批次關鍵字（系統無從得知該記哪批）。
 * @param remainingByBatch 各批次目前「可分配剩餘」（呼叫端算好傳入）。就地扣減，可為負。
 */
export function allocateFifo(
  tabs: ParsedStoreTab[],
  fileName: string,
  batches: BatchLite[],
  remainingByBatch: Map<string, number>,
): AllocationResult {
  const errors: string[] = []
  const acc = new Map<string, AllocationLine>()
  const perBatchTotal = new Map<string, number>()
  const notes: string[] = []
  const tempRemaining = new Map(remainingByBatch)
  const batchById = new Map(batches.map(b => [b.id, b]))

  const book = (b: BatchLite, store: string, boxes: number) => {
    const key = `${b.id}|${store}`
    const line = acc.get(key) ?? { batchId: b.id, batchName: b.ivName, store, boxes: 0 }
    line.boxes += boxes
    acc.set(key, line)
    perBatchTotal.set(b.id, (perBatchTotal.get(b.id) ?? 0) + boxes)
    tempRemaining.set(b.id, (tempRemaining.get(b.id) ?? 0) - boxes)
  }

  for (const tab of tabs) {
    if (!tab.store || tab.rows.length === 0) continue
    for (const row of tab.rows) {
      const { eligible: candidates, usedFilenameFallback } = candidateBatches(row.name, fileName, batches)
      if (candidates.length === 0) {
        errors.push(`商品「${row.name}」（${tab.store} ${row.boxes}箱）對不到任何批次的商品關鍵字`)
        continue
      }
      if (usedFilenameFallback) {
        notes.push(`商品「${row.name}」（${tab.store}）商品名對不到關鍵字，改用檔名判定為「${candidates[0].ivName}」，請確認批次正確`)
      }
      // FIFO：從最舊批次開始扣（有剩的先扣），扣完就往下一批
      let need = row.boxes
      for (const b of candidates) {
        if (need <= 0) break
        const remain = tempRemaining.get(b.id) ?? 0
        if (remain <= 0) continue
        const take = Math.min(remain, need)
        book(b, tab.store, take)
        need -= take
      }
      // 還沒扣完（所有候選都沒剩）→ 出貨單為準，硬記到「有日期的最新候選批次」，容許超領
      // （避開沒填日期的批次＝fifoDate 兜底 9999，會被排到最後但其實不是真的最新）
      if (need > 0) {
        const dated = candidates.filter(c => c.fifoDate < '9999')
        const target = (dated.length > 0 ? dated : candidates)[
          (dated.length > 0 ? dated : candidates).length - 1]
        book(target, tab.store, need)
        need = 0
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, lines: [], perBatchTotal: new Map(), errors, notes }
  }

  for (const [id, v] of tempRemaining) remainingByBatch.set(id, v)
  const lines = Array.from(acc.values()).sort((a, b) => {
    const fa = batchById.get(a.batchId)?.fifoDate ?? ''
    const fb = batchById.get(b.batchId)?.fifoDate ?? ''
    return fa.localeCompare(fb) || a.store.localeCompare(b.store)
  })
  return { ok: true, lines, perBatchTotal, errors: [], notes }
}
