/**
 * 本週出貨計畫 — Notion 讀寫 + 週範圍工具（伺服器端）
 * ───────────────────────────────────────────────────────────────
 * 川越さん（日本本社）每週把「這週要出什麼」輸入這裡，週一開會用；
 * 每一列 = 一批出貨（一個配送日），可一鍵建立對應的三重檢查清單。
 *
 * 需要 Vercel env：NOTION_WEEKLY_DB（本週出貨計畫資料庫 ID）
 *
 * 一列的欄位（對應 Notion 屬性）：
 *   品項(title) / 配送日(date) / 店鋪(rich_text) / 數量備註(rich_text)
 *   建立者(rich_text) / 已建檢查單(checkbox) / 檢查單頁ID(rich_text)
 */

import { Client } from '@notionhq/client'

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
  lastEdited: string
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

export async function markWeeklyChecklistCreated(id: string, checklistId: string): Promise<WeeklyRow> {
  const page = await notion.pages.update({
    page_id: id,
    properties: {
      '已建檢查單': { checkbox: true },
      '檢查單頁ID': { rich_text: rt(checklistId) },
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
    },
  })
  return { databaseId: created.id }
}
