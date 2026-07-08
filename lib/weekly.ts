/**
 * 本週出貨計畫 — Notion 讀寫 + 週範圍工具 + 主頁自動同步（伺服器端）
 * ───────────────────────────────────────────────────────────────
 * 列的來源有兩種：
 *   ① 自動同步：打開「本週出貨」分頁時，伺服器自動把主頁（出貨紀錄 DB）
 *      該週的計畫聚合成列補進來（同批次＋同配送日＝一列）。這種列唯讀，
 *      要改內容請回主頁改，下次載入會自動跟上。
 *   ② 手動新增：川越さん／COLIN 手動登錄（給不經過主頁批次的臨時出貨），
 *      不受同步影響。
 * 每一列 = 一批出貨（一個配送日），可一鍵建立對應的三重檢查清單。
 *
 * 需要 Vercel env：NOTION_WEEKLY_DB（本週出貨計畫資料庫 ID）
 *
 * 一列的欄位（對應 Notion 屬性）：
 *   品項(title) / 配送日(date) / 店鋪(rich_text) / 數量備註(rich_text)
 *   建立者(rich_text) / 已建檢查單(checkbox) / 檢查單頁ID(rich_text)
 *   來源鍵(rich_text，自動列才有＝「批次ID|配送日」，同步用的身分證)
 *   建單快照(rich_text，建檢查單當下的內容快照，用來偵測「建單後計畫又變了」)
 */

import { Client } from '@notionhq/client'
import { getShipmentRecords, getShipments, type ShipmentRecord } from './notion'
import { STORES } from './stores'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

function weeklyDb(): string | null {
  return process.env.NOTION_WEEKLY_DB?.trim() || null
}

export function isWeeklyConfigured(): boolean {
  return !!weeklyDb()
}

export interface WeeklyRow {
  id: string
  product: string             // 品項（可含多個，如「蘋果11、地瓜」）
  deliveryDate: string | null // 預計配送日 yyyy-mm-dd
  stores: string              // 出貨店鋪（如「全12店」或「中和、南港…」）
  note: string                // 數量備註
  createdBy: string           // 建立者顯示名
  checklistCreated: boolean   // 是否已建立對應的檢查清單
  checklistId: string | null  // 已建的檢查清單 Notion page id
  sourceKey: string | null    // 自動列的身分證「批次ID|配送日」；手動列為 null
  snapshot: string | null     // 建檢查單當下的內容快照（偵測建單後變更用）
  lastEdited: string
  // ── 以下三個是同步時算出來的（不存 Notion，只在 API 回應出現）──
  planStatus?: string | null  // 來源計畫狀態（計畫中／已確認）
  changed?: boolean           // 已建檢查單後，主頁計畫內容又變了
  sourceGone?: boolean        // 已建檢查單，但主頁計畫已取消／刪除
}

/** 跟「一鍵建檢查單」用同一種組法：品項｜店鋪｜數量備註（快照比對要一致才準） */
export function composeWeeklyContent(product: string, stores: string, note: string): string {
  return [product, stores, note].map(s => (s || '').trim()).filter(Boolean).join('｜')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTitle(prop: any): string {
  if (prop?.type === 'title') return prop.title?.map((r: { plain_text: string }) => r.plain_text).join('') || ''
  return ''
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRich(prop: any): string {
  if (prop?.type === 'rich_text') return prop.rich_text?.map((r: { plain_text: string }) => r.plain_text).join('') || ''
  return ''
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDateStart(prop: any): string | null {
  return prop?.type === 'date' ? prop.date?.start ?? null : null
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCheckbox(prop: any): boolean {
  return prop?.type === 'checkbox' ? !!prop.checkbox : false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pageToRow(page: any): WeeklyRow {
  const p = page.properties
  return {
    id: page.id,
    product: getTitle(p['品項']),
    deliveryDate: getDateStart(p['配送日']),
    stores: getRich(p['店鋪']),
    note: getRich(p['數量備註']),
    createdBy: getRich(p['建立者']),
    checklistCreated: getCheckbox(p['已建檢查單']),
    checklistId: getRich(p['檢查單頁ID']) || null,
    sourceKey: getRich(p['來源鍵']) || null,
    snapshot: getRich(p['建單快照']) || null,
    lastEdited: page.last_edited_time ?? '',
  }
}

// 短文字轉 rich_text（本欄位內容都不長，仍防呆截到 1900 內）
function rt(s: string | null | undefined): { text: { content: string } }[] {
  const v = (s ?? '').slice(0, 1900)
  return v ? [{ text: { content: v } }] : []
}

// ── 週範圍（以台灣時區 UTC+8 為準）──────────────────────────────────────────
/**
 * 回傳指定週的週一～週日（yyyy-mm-dd）。offsetWeeks=0 是本週、-1 上週、+1 下週。
 * 為什麼要自己算時區：Vercel 伺服器是 UTC，直接用 new Date() 會在台灣週日晚上就跳到下一週。
 */
export function weekRange(offsetWeeks = 0, nowMs = Date.now()): { from: string; to: string; label: string } {
  const TW_OFFSET = 8 * 60 * 60 * 1000
  const tw = new Date(nowMs + TW_OFFSET) // 用底下的 getUTC* 讀，即等於台灣當地時間
  const dow = tw.getUTCDay()             // 0=日, 1=一, …, 6=六
  const mondayShift = (dow === 0 ? -6 : 1 - dow) + offsetWeeks * 7
  const monday = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate() + mondayShift))
  const sunday = new Date(monday.getTime() + 6 * 86400000)
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  const from = fmt(monday)
  const to = fmt(sunday)
  return { from, to, label: `${from} ~ ${to}` }
}

// ── 讀 ────────────────────────────────────────────────────────────────────
export async function getWeeklyRows(range?: { from: string; to: string }): Promise<WeeklyRow[]> {
  const DB = weeklyDb()
  if (!DB) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: any = range
    ? {
        and: [
          { property: '配送日', date: { on_or_after: range.from } },
          { property: '配送日', date: { on_or_before: range.to } },
        ],
      }
    : undefined

  const rows: WeeklyRow[] = []
  let cursor: string | undefined
  do {
    const res = await notion.databases.query({
      database_id: DB,
      page_size: 100,
      ...(filter ? { filter } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    rows.push(...res.results.map(pageToRow))
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)

  // 依配送日升冪；沒填日期的排最後
  return rows.sort((a, b) => (a.deliveryDate ?? '9999').localeCompare(b.deliveryDate ?? '9999'))
}

export async function getWeeklyRowById(id: string): Promise<WeeklyRow> {
  const page = await notion.pages.retrieve({ page_id: id })
  return pageToRow(page)
}

// ── 寫 ────────────────────────────────────────────────────────────────────
export async function createWeeklyRow(data: {
  product: string
  deliveryDate?: string | null
  stores?: string
  note?: string
  createdBy: string
  sourceKey?: string
}): Promise<WeeklyRow> {
  const DB = weeklyDb()
  if (!DB) throw new Error('尚未設定 NOTION_WEEKLY_DB')
  const page = await notion.pages.create({
    parent: { database_id: DB },
    properties: {
      '品項': { title: [{ text: { content: data.product.slice(0, 1900) } }] },
      ...(data.deliveryDate ? { '配送日': { date: { start: data.deliveryDate } } } : {}),
      '店鋪': { rich_text: rt(data.stores) },
      '數量備註': { rich_text: rt(data.note) },
      '建立者': { rich_text: rt(data.createdBy) },
      '已建檢查單': { checkbox: false },
      ...(data.sourceKey ? { '來源鍵': { rich_text: rt(data.sourceKey) } } : {}),
    },
  })
  return pageToRow(page)
}

export async function updateWeeklyRow(
  id: string,
  data: { product?: string; deliveryDate?: string | null; stores?: string; note?: string },
): Promise<WeeklyRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {}
  if (data.product !== undefined) props['品項'] = { title: [{ text: { content: data.product.slice(0, 1900) } }] }
  if (data.deliveryDate !== undefined) props['配送日'] = data.deliveryDate ? { date: { start: data.deliveryDate } } : { date: null }
  if (data.stores !== undefined) props['店鋪'] = { rich_text: rt(data.stores) }
  if (data.note !== undefined) props['數量備註'] = { rich_text: rt(data.note) }
  const page = await notion.pages.update({ page_id: id, properties: props })
  return pageToRow(page)
}

export async function deleteWeeklyRow(id: string): Promise<void> {
  // Notion 沒有真刪 API，改為封存（從資料庫視圖消失）
  await notion.pages.update({ page_id: id, archived: true })
}

export async function markWeeklyChecklistCreated(id: string, checklistId: string, snapshot?: string): Promise<WeeklyRow> {
  const page = await notion.pages.update({
    page_id: id,
    properties: {
      '已建檢查單': { checkbox: true },
      '檢查單頁ID': { rich_text: rt(checklistId) },
      // 記下建單當下的內容；之後同步若發現主頁計畫變了，就靠這個快照比對出「⚠️ 計畫已變更」
      ...(snapshot !== undefined ? { '建單快照': { rich_text: rt(snapshot) } } : {}),
    },
  })
  return pageToRow(page)
}

/**
 * 一次性建置：建立「本週出貨計畫」資料庫（與檢查清單同一個父頁面，整合自動有權限）。
 * 若已用 curl 建好並設好 env，這個就用不到；留著當備援。
 */
export async function provisionWeeklyDb(): Promise<{ databaseId: string }> {
  const importDb = process.env.NOTION_IMPORT_STATUS_DB?.trim()
  if (!importDb) throw new Error('缺 NOTION_IMPORT_STATUS_DB，無法定位父頁面')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (await notion.databases.retrieve({ database_id: importDb })) as any
  const parent = meta?.parent
  if (parent?.type !== 'page_id' || !parent.page_id) {
    throw new Error('既有資料庫的父層不是頁面，無法自動建立')
  }
  const created = await notion.databases.create({
    parent: { type: 'page_id', page_id: parent.page_id },
    title: [{ type: 'text', text: { content: '本週出貨計畫' } }],
    properties: {
      '品項': { title: {} },
      '配送日': { date: {} },
      '店鋪': { rich_text: {} },
      '數量備註': { rich_text: {} },
      '建立者': { rich_text: {} },
      '已建檢查單': { checkbox: {} },
      '檢查單頁ID': { rich_text: {} },
      '來源鍵': { rich_text: {} },
      '建單快照': { rich_text: {} },
    },
  })
  return { databaseId: created.id }
}

// ══ 主頁出貨計畫 → 本週出貨 自動同步 ═══════════════════════════════════════
//
// 打開「本週出貨」分頁（本週或未來的週）時執行：
//   1. 撈主頁出貨紀錄，把該週、狀態≠已取消的紀錄依「批次＋配送日」聚合
//   2. 跟週計畫 DB 現有的自動列（有來源鍵的）比對：
//      缺 → 建（建立者＝自動同步）；內容變了 → 更新（永遠跟著主頁）
//      來源消失 → 沒建檢查單就封存；建了檢查單就保留並標 sourceGone
//   3. 已建檢查單的列，若目前內容 ≠ 建單快照 → 標 changed（⚠️ 計畫已變更）
// 手動列（沒有來源鍵）完全不碰。

export const AUTO_SYNC_CREATOR = '自動同步'

/** 聚合後的一列來源（＝主頁上「某批次、某天」的出貨計畫全貌） */
interface WeeklySource {
  sourceKey: string
  product: string
  deliveryDate: string
  stores: string
  note: string
  planStatus: string
}

// 週計畫 DB 可能是舊版建的，缺「來源鍵／建單快照」欄位；第一次同步時自動補上。
// 補過一次就記在模組變數裡，同一個伺服器實例不再重查。
let syncSchemaReady = false
async function ensureSyncSchema(): Promise<void> {
  if (syncSchemaReady) return
  const DB = weeklyDb()
  if (!DB) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (await notion.databases.retrieve({ database_id: DB })) as any
  const props = meta?.properties ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const missing: Record<string, any> = {}
  if (!props['來源鍵']) missing['來源鍵'] = { rich_text: {} }
  if (!props['建單快照']) missing['建單快照'] = { rich_text: {} }
  if (Object.keys(missing).length > 0) {
    await notion.databases.update({ database_id: DB, properties: missing })
  }
  syncSchemaReady = true
}

/** 把該週的出貨紀錄聚合成「一批次＋一配送日＝一列」的來源清單 */
async function aggregateWeekSources(range: { from: string; to: string }): Promise<WeeklySource[]> {
  const [records, shipments] = await Promise.all([getShipmentRecords(), getShipments()])
  const batchById = new Map(shipments.map(s => [s.id, s]))

  const groups = new Map<string, ShipmentRecord[]>()
  for (const r of records) {
    if (!r.batchId || !r.date) continue
    if (r.date < range.from || r.date > range.to) continue
    if (r.planStatus === '已取消') continue
    const key = `${r.batchId}|${r.date}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }

  const openCount = STORES.filter(s => s.status === 'open').length
  const out: WeeklySource[] = []
  for (const [key, recs] of groups) {
    const batch = batchById.get(recs[0].batchId!)
    // 品項＝商品摘要（批次名）；批次沒填摘要就只放批次名
    const product = batch
      ? (batch.productSummary ? `${batch.productSummary}（${batch.ivName}）` : batch.ivName)
      : '（未知批次）'

    // 店鋪：去重後列出；家數達到全部營業中門市就簡寫「全N店」
    const storeNames: string[] = []
    for (const r of recs) {
      if (r.store && !storeNames.includes(r.store)) storeNames.push(r.store)
    }
    const stores = storeNames.length >= openCount ? `全${openCount}店` : storeNames.join('、')

    // 數量備註：共X箱＋各店明細（沒填箱數的店不列明細但仍算店鋪）
    let total = 0
    const parts: string[] = []
    for (const r of recs) {
      if (r.boxes != null && r.store) {
        total += r.boxes
        parts.push(`${r.store}${r.boxes}`)
      }
    }
    const note = parts.length > 0 ? `共${total}箱：${parts.join('、')}` : ''

    // 狀態：全部一致就用那個值，混雜（或沒填）一律當「計畫中」
    const statuses = Array.from(new Set(recs.map(r => r.planStatus ?? '計畫中')))
    const planStatus = statuses.length === 1 ? statuses[0] : '計畫中'

    out.push({ sourceKey: key, product, deliveryDate: recs[0].date!, stores, note, planStatus })
  }
  return out
}

/** 自動列的內容是否需要跟著主頁更新 */
function needsUpdate(row: WeeklyRow, src: WeeklySource): boolean {
  return row.product !== src.product
    || row.deliveryDate !== src.deliveryDate
    || row.stores !== src.stores
    || row.note !== src.note
}

/**
 * 同步一週：把主頁計畫補進／更新到週計畫 DB，回傳這一週的完整列
 * （自動列附 planStatus / changed / sourceGone；手動列原樣）。
 * 給 GET /api/weekly 與週一 LINE 通知共用。
 */
export async function syncWeeklyFromRecords(range: { from: string; to: string }): Promise<WeeklyRow[]> {
  const DB = weeklyDb()
  if (!DB) return []
  await ensureSyncSchema()

  const [sources, rows] = await Promise.all([aggregateWeekSources(range), getWeeklyRows(range)])

  // 現有自動列依來源鍵分組（理論上一鍵一列；若歷史上重複建了，多的沒建檢查單就順手封存）
  const autoByKey = new Map<string, WeeklyRow[]>()
  const out: WeeklyRow[] = []
  for (const row of rows) {
    if (row.sourceKey) {
      const list = autoByKey.get(row.sourceKey)
      if (list) list.push(row)
      else autoByKey.set(row.sourceKey, [row])
    } else {
      out.push(row) // 手動列：原樣保留，不受同步影響
    }
  }

  const seen = new Set<string>()
  for (const src of sources) {
    seen.add(src.sourceKey)
    const existing = autoByKey.get(src.sourceKey) ?? []
    let keep = existing.find(r => r.checklistCreated) ?? existing[0] ?? null
    for (const extra of existing) {
      if (extra === keep) continue
      if (!extra.checklistCreated) await deleteWeeklyRow(extra.id)
      else out.push(extra) // 罕見：同一來源重複建了檢查單——照樣顯示，不能讓它隱形
    }

    if (!keep) {
      keep = await createWeeklyRow({
        product: src.product,
        deliveryDate: src.deliveryDate,
        stores: src.stores,
        note: src.note,
        createdBy: AUTO_SYNC_CREATOR,
        sourceKey: src.sourceKey,
      })
    } else if (needsUpdate(keep, src)) {
      keep = await updateWeeklyRow(keep.id, {
        product: src.product,
        deliveryDate: src.deliveryDate,
        stores: src.stores,
        note: src.note,
      })
    }

    keep.planStatus = src.planStatus
    // 建過檢查單、而且目前內容跟建單當下的快照不一樣 → 提醒「計畫已變更」
    keep.changed = keep.checklistCreated && !!keep.snapshot
      && keep.snapshot !== composeWeeklyContent(src.product, src.stores, src.note)
    out.push(keep)
  }

  // 來源消失的自動列：沒建檢查單→封存；建了→保留並標「計畫已取消」
  for (const [key, list] of autoByKey) {
    if (seen.has(key)) continue
    for (const row of list) {
      if (row.checklistCreated) {
        row.sourceGone = true
        out.push(row)
      } else {
        await deleteWeeklyRow(row.id)
      }
    }
  }

  return out.sort((a, b) => (a.deliveryDate ?? '9999').localeCompare(b.deliveryDate ?? '9999'))
}
