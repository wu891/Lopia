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
  deliveryStatus: string    // 配送狀態（「全數出貨」＝已收完、不參與分配）
  intakeDate: string        // 入倉日（原值，空字串＝還沒填）；有值且≤今天＝已到倉＝出貨中
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
        intakeDate: p['入倉日']?.date?.start ?? '',   // 原值，不做兜底（抵台≠入倉，不能拿抵台日當到貨）
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
 * 檔名裡有沒有直接寫批次號（2026-07-24 Colin 拍板的新規則）。
 * 例：檔名「7.23出貨 地瓜 CITY20260501S」→ 這張單鎖定只記 CITY20260501S，完全不用猜。
 * 這是最高優先的判定方式——Colin 做單時自己標的批次，比任何關鍵字推測都準。
 * 注意：批次名稱會互相包含（CITY20260701 是 CITY20260701S 的開頭），
 * 檔名寫長的那個時短的也會被比中 → 只留「最長」的那個，避免誤鎖到別批。
 */
export function fileNameBatchTags(fileName: string, batches: BatchLite[]): BatchLite[] {
  const fn = fileName.toLowerCase()
  const hits = batches.filter(b =>
    b.ivName && b.ivName !== '(無名稱)' && fn.includes(b.ivName.toLowerCase()))
  return hits.filter(a =>
    !hits.some(b => b !== a && b.ivName.toLowerCase().includes(a.ivName.toLowerCase())))
}

/**
 * 找出一列商品的候選批次。
 * 先用商品名比、比不到再用檔名比（蘋果單商品列只有品種名，批號在檔名「蘋果11.3」裡）。
 * 規則①（訪談定案）：機器人只碰「已到倉、正在出貨中」的批次，用「入倉日」自動辨識，不用手動改狀態。
 *   - eligible（可扣）＝出貨中 ＋ 入倉日不晚於出貨日。
 *   - waiting（待到貨）＝還沒到、但沒收完、且出貨日不早於其入倉日 → 之後到貨會接手這張單；
 *     呼叫端據此把檔案標「待重掃」，等 Colin 填入倉日、批次啟用，下一輪自動補扣（不用手動重掃）。
 *   - 已收完(全數出貨) 或 出貨日早於入倉日 → 不扣、也不重掃（前者關帳、後者不可能是它出的）。
 *   這樣「貨還沒到的批次」不會被誤扣，「舊單」也不會在新批次啟用時被回頭亂扣（如 6月大學芋 vs 7/14到的601FS）。
 * usedFilenameFallback = 這列是靠「檔名」而非「商品名」對到的（可能對錯批，要提醒）。
 */
// 判斷一個批次現在「可不可以扣」＝已到倉、還沒收完。用入倉日自動辨識，Colin 登記到貨時本來就會填入倉日。
export function isActiveBatch(b: BatchLite): boolean {
  if (b.deliveryStatus === '全數出貨') return false   // 已收完關帳，不再扣
  if (b.deliveryStatus === '部分出貨') return true     // 明確標記出貨中（相容舊資料）
  const today = new Date().toISOString().slice(0, 10)
  return !!b.intakeDate && b.intakeDate <= today       // 有入倉日且已到＝到倉出貨中；空白或未到＝不扣
}
export function candidateBatches(rowName: string, fileName: string, batches: BatchLite[], noteDate: string, pinned: BatchLite[] = []): {
  eligible: BatchLite[]          // 可扣：到倉出貨中 ＋ 入倉日不晚於出貨日，FIFO 排序
  waiting: BatchLite[]           // 待到貨：現在不能扣、但沒收完、且出貨日不早於其入倉日 → 之後到貨會接手這張單（檔案要留著重掃）
  matched: BatchLite[]           // 所有命中關鍵字的批次（判斷是不是「完全對不到關鍵字」用）
  usedFilenameFallback: boolean
  ambiguousPinned: boolean       // 檔名指定了多個批次，但這列商品分不出屬於哪個 → 要人工補關鍵字
} {
  let hits: BatchLite[]
  let usedFilenameFallback = false
  if (pinned.length > 0) {
    // 檔名指定批次 → 候選「只限」指定的那幾批，絕不會跑去扣別批。
    // 指定多批（混搭單）時，用商品名關鍵字分流；只指定一批就全部記它。
    hits = pinned.filter(b => hitKeyword(rowName, b))
    if (hits.length === 0) {
      if (pinned.length === 1) hits = [...pinned]
      else return { eligible: [], waiting: [], matched: [], usedFilenameFallback: false, ambiguousPinned: true }
    }
  } else {
    const withKw = batches.filter(b => b.keywords.length > 0)
    hits = withKw.filter(b => hitKeyword(rowName, b))
    if (hits.length === 0) {
      hits = withKw.filter(b => hitKeyword(fileName, b))
      usedFilenameFallback = hits.length > 0
    }
  }
  // 防呆：貨還沒到倉不可能先出 → 出貨日不能早於批次入倉日（入倉日空白＝還沒填，先放行）。
  //   這道防呆讓「舊的大學芋單(6月)」不會在新批次 601FS(入倉7/14) 啟用時被誤扣。
  const dateOk = (b: BatchLite) => !b.intakeDate || b.intakeDate <= noteDate
  const eligible = hits.filter(b => isActiveBatch(b) && dateOk(b))
    .sort((a, b) => a.fifoDate.localeCompare(b.fifoDate))
  const waiting = hits.filter(b => !isActiveBatch(b) && b.deliveryStatus !== '全數出貨' && dateOk(b))
  return { eligible, waiting, matched: hits, usedFilenameFallback, ambiguousPinned: false }
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
  hasWaiting: boolean                  // 有商品的批次「還沒到貨、之後會接手」→ 呼叫端要把這檔標「待重掃」，等批次到貨自動補扣
  skipped: { name: string; store: string; boxes: number; reason: string }[]
  // ↑ 規則①跳過且「不會自動補扣」的商品列（已收完／出貨日早於入倉日）。
  //   混搭單裡若某商品全落在這裡，出貨紀錄就永遠少這個商品（2026-05 大學芋漏登336箱的根因），
  //   呼叫端要逐商品大聲警告，不能只看整張單是不是 0 箱。
}

/**
 * 把解析好的分頁（多店）分配到批次。
 * 原則：出貨單為準。所以「剩餘不夠扣」不再擋——照出貨單記到最符合的批次，
 *   容許批次「超領」（剩餘變負），只在 notes 裡標記請人工確認入倉數/漏建批次。
 *   ok=false 只在「某商品完全對不到任何批次關鍵字」時（系統無從得知該記哪批）。
 *   命中批次但還沒到貨(waiting)→這列先不扣、回傳 hasWaiting=true，讓呼叫端把檔案留著每輪重掃。
 * @param remainingByBatch 各批次目前「可分配剩餘」（呼叫端算好傳入）。就地扣減，可為負。
 * @param noteDate 這張出貨單的出貨日（防呆：出貨日不能早於批次入倉日）。
 */
export function allocateFifo(
  tabs: ParsedStoreTab[],
  fileName: string,
  batches: BatchLite[],
  remainingByBatch: Map<string, number>,
  noteDate: string,
): AllocationResult {
  const errors: string[] = []
  let hasWaiting = false
  const skipped: AllocationResult['skipped'] = []
  const acc = new Map<string, AllocationLine>()
  const perBatchTotal = new Map<string, number>()
  const notes: string[] = []
  const tempRemaining = new Map(remainingByBatch)
  const batchById = new Map(batches.map(b => [b.id, b]))

  // 檔名指定批次（最高優先）：Colin 做單時把批次號寫進檔名 → 這張單只認這幾批
  const pinned = fileNameBatchTags(fileName, batches)
  if (pinned.length > 0) {
    notes.push(`檔名指定批次：${pinned.map(b => b.ivName).join('、')}（本單只會記到指定批次，不做關鍵字推測）`)
  }

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
      const { eligible: candidates, waiting, matched, usedFilenameFallback, ambiguousPinned } = candidateBatches(row.name, fileName, batches, noteDate, pinned)
      if (ambiguousPinned) {
        // 檔名指定了多個批次（混搭單），但這列商品名對不到任何指定批次的關鍵字 → 分不出要記哪批，
        // 寧可整張單停下來請人工補關鍵字，也不要亂猜（0724 加工品誤扣的教訓）
        errors.push(`檔名指定了多個批次（${pinned.map(b => b.ivName).join('、')}），但商品「${row.name}」（${tab.store} ${row.boxes}箱）對不到其中任何一批的關鍵字 → 無法判斷記哪批`)
        continue
      }
      if (candidates.length === 0) {
        if (matched.length > 0) {
          // 命中批次但現在不能扣（尚未到貨／已收完／出貨日早於入倉日）→ 不擋整張單，只記提醒
          if (waiting.length > 0) {
            hasWaiting = true   // 有批次之後會接手這張單 → 檔案留著每輪重掃，等批次到貨（填入倉日）自動補扣
            const b = waiting[0]
            const why = b.intakeDate ? `尚未到貨，入倉日 ${b.intakeDate}` : '尚未填入倉日'
            notes.push(`商品「${row.name}」（${tab.store} ${row.boxes}箱）屬批次「${b.ivName}」（${why}）→ 暫不扣帳；到貨後自動補扣`)
          } else {
            const b = matched[0]
            const why = b.deliveryStatus === '全數出貨' ? '已收完(全數出貨)' : '出貨日早於入倉日'
            notes.push(`商品「${row.name}」（${tab.store} ${row.boxes}箱）屬批次「${b.ivName}」（${why}）→ 不扣帳`)
            skipped.push({ name: row.name, store: tab.store, boxes: row.boxes, reason: why })
          }
          continue
        }
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
    return { ok: false, lines: [], perBatchTotal: new Map(), errors, notes, hasWaiting, skipped }
  }

  for (const [id, v] of tempRemaining) remainingByBatch.set(id, v)
  const lines = Array.from(acc.values()).sort((a, b) => {
    const fa = batchById.get(a.batchId)?.fifoDate ?? ''
    const fb = batchById.get(b.batchId)?.fifoDate ?? ''
    return fa.localeCompare(fb) || a.store.localeCompare(b.store)
  })
  return { ok: true, lines, perBatchTotal, errors: [], notes, hasWaiting, skipped }
}
