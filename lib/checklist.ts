/**
 * 三重檢查體制 — Notion 讀寫（伺服器端）
 * ───────────────────────────────────────────────────────────────
 * 純邏輯（人員／層級／狀態計算）在 lib/checklistModel.ts；這裡只負責把狀態
 * 存進 / 讀出 Notion 資料庫，並 re-export 模型讓其他伺服器檔案一個入口拿齊。
 *
 * 狀態怎麼存：整份勾選狀態以 JSON 字串存在 Notion 的「狀態」rich_text 欄位，
 * 另外把「出貨單號 / 配送日期 / 目前階段 / 已完結」拉成獨立欄位，方便一眼看與篩選。
 *
 * 需要 Vercel env：NOTION_CHECKLIST_DB（檢查清單資料庫 ID）
 */

import { Client } from '@notionhq/client'
import { ChecklistState, parseState, stageLabel, isCompleted } from '@/lib/checklistModel'

// re-export 模型，讓 API route / auth 只需從這裡 import
export * from '@/lib/checklistModel'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

function checklistDb(): string | null {
  return process.env.NOTION_CHECKLIST_DB?.trim() || null
}

export function isChecklistConfigured(): boolean {
  return !!checklistDb()
}

export interface Checklist {
  id: string
  shipmentNo: string
  deliveryDate: string | null
  content: string | null   // 這批要出什麼（品項／店鋪），從週清單帶入；沒有則 null
  stage: string
  completed: boolean
  state: ChecklistState
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
function pageToChecklist(page: any): Checklist {
  const p = page.properties
  const state = parseState(getRich(p['狀態']))
  return {
    id: page.id,
    shipmentNo: getTitle(p['出貨單號']),
    deliveryDate: getDateStart(p['配送日期']),
    content: state.content ?? null,
    stage: stageLabel(state),
    completed: isCompleted(state),
    state,
    lastEdited: page.last_edited_time ?? '',
  }
}

// Notion 單一 rich_text 物件上限 2000 字。整份狀態 JSON 可能超過（多筆退回原因會累加），
// 所以切成多個 ~1900 字片段存成陣列；讀取時 getRich 會把所有片段接回完整字串，不會截斷。
function chunkRichText(s: string, size = 1900): { text: { content: string } }[] {
  if (!s) return [{ text: { content: '' } }]
  const parts: { text: { content: string } }[] = []
  for (let i = 0; i < s.length; i += size) {
    parts.push({ text: { content: s.slice(i, i + size) } })
  }
  return parts
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stateProps(state: ChecklistState): any {
  return {
    '狀態': { rich_text: chunkRichText(JSON.stringify(state)) },
    '目前階段': { select: { name: stageLabel(state) } },
    '已完結': { checkbox: isCompleted(state) },
  }
}

export async function getChecklists(): Promise<Checklist[]> {
  const DB = checklistDb()
  if (!DB) return []
  const results: Checklist[] = []
  let cursor: string | undefined
  do {
    const res = await notion.databases.query({
      database_id: DB,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...res.results.map(pageToChecklist))
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  // 未完結排前面，再依配送日期升冪
  return results.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    return (a.deliveryDate ?? '9999').localeCompare(b.deliveryDate ?? '9999')
  })
}

export async function getChecklistById(id: string): Promise<Checklist> {
  const page = await notion.pages.retrieve({ page_id: id })
  return pageToChecklist(page)
}

export async function getChecklistByShipmentNo(shipmentNo: string): Promise<Checklist | null> {
  const DB = checklistDb()
  if (!DB) return null
  const res = await notion.databases.query({
    database_id: DB,
    filter: { property: '出貨單號', title: { equals: shipmentNo } },
    page_size: 1,
  })
  return res.results.length ? pageToChecklist(res.results[0]) : null
}

export async function createChecklist(data: {
  shipmentNo: string
  deliveryDate?: string | null
  content?: string | null    // 這批要出什麼（從週清單帶入），存進 state.content
}): Promise<Checklist> {
  const DB = checklistDb()
  if (!DB) throw new Error('尚未設定 NOTION_CHECKLIST_DB')

  const existing = await getChecklistByShipmentNo(data.shipmentNo)
  if (existing) throw new Error(`${data.shipmentNo} 已經有檢查清單了`)

  const content = data.content?.trim() || undefined
  const state: ChecklistState = { version: 1, checks: {}, rejections: [], ...(content ? { content } : {}) }
  const page = await notion.pages.create({
    parent: { database_id: DB },
    properties: {
      '出貨單號': { title: [{ text: { content: data.shipmentNo } }] },
      ...(data.deliveryDate ? { '配送日期': { date: { start: data.deliveryDate } } } : {}),
      ...stateProps(state),
    },
  })
  return pageToChecklist(page)
}

// 刪除＝把 Notion 頁面設成 archived（等於丟進 Notion 垃圾桶，30 天內可以救回來）
export async function deleteChecklist(id: string): Promise<void> {
  await notion.pages.update({ page_id: id, archived: true })
}

// 更新基本資料：出貨單號／配送日期／出貨內容。
// 勾選與退回紀錄完全不動（content 存在狀態 JSON 裡，所以要連同原本的 state 一起寫回）
export async function updateChecklistInfo(id: string, state: ChecklistState, data: {
  shipmentNo: string
  deliveryDate: string | null
  content: string | null
}): Promise<Checklist> {
  const next: ChecklistState = { ...state, content: data.content ?? undefined }
  const page = await notion.pages.update({
    page_id: id,
    properties: {
      '出貨單號': { title: [{ text: { content: data.shipmentNo } }] },
      '配送日期': { date: data.deliveryDate ? { start: data.deliveryDate } : null },
      ...stateProps(next),
    },
  })
  return pageToChecklist(page)
}

// 把整份新狀態寫回 Notion
export async function saveChecklistState(id: string, state: ChecklistState): Promise<Checklist> {
  const page = await notion.pages.update({
    page_id: id,
    properties: stateProps(state),
  })
  return pageToChecklist(page)
}

/**
 * 一次性：用 app 自己的 Notion 整合建立「出貨三重檢查清單」資料庫。
 * 建在既有進口批次 DB 的同一個父頁面底下 → 保證 app 整合對它有讀寫權限
 * （不用另外去 Notion 手動分享）。回傳新 DB 的 id，貼進 Vercel env NOTION_CHECKLIST_DB 即可。
 */
export async function provisionChecklistDb(): Promise<{ databaseId: string }> {
  const importDb = process.env.NOTION_IMPORT_STATUS_DB?.trim()
  if (!importDb) throw new Error('缺 NOTION_IMPORT_STATUS_DB，無法定位父頁面')

  // 讀既有 DB 的父頁面（新 DB 要建在同一個 page 底下，整合才有權限）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = await notion.databases.retrieve({ database_id: importDb }) as any
  const parent = meta?.parent
  if (parent?.type !== 'page_id' || !parent.page_id) {
    throw new Error('既有資料庫的父層不是頁面，無法自動建立；請改用手動建立方式')
  }

  const created = await notion.databases.create({
    parent: { type: 'page_id', page_id: parent.page_id },
    title: [{ type: 'text', text: { content: '出貨三重檢查清單' } }],
    properties: {
      '出貨單號': { title: {} },
      '配送日期': { date: {} },
      '狀態': { rich_text: {} },
      '目前階段': {
        select: {
          options: [
            { name: '待互查' }, { name: '待林さん確認' }, { name: '待蔡さん確認' },
            { name: '待川越さん共享' }, { name: '已完結' },
          ],
        },
      },
      '已完結': { checkbox: {} },
    },
  })
  return { databaseId: created.id }
}
