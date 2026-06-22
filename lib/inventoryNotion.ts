import { Client } from '@notionhq/client'
import type { InventoryItem } from './parseInventoryExcel'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

function getDb(): string {
  const db = process.env.NOTION_INVENTORY_DB
  if (!db) throw new Error('Missing NOTION_INVENTORY_DB env var')
  return db
}

export interface InventoryRecord extends InventoryItem {
  id: string
  lastUpdated: string | null
}

export async function getInventory(): Promise<InventoryRecord[]> {
  const db = getDb()
  const all: InventoryRecord[] = []
  let cursor: string | undefined

  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await notion.databases.query({
      database_id: db,
      sorts: [{ property: '商品名稱', direction: 'ascending' }],
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of res.results) {
      const p = page.properties
      all.push({
        id: page.id,
        code:        p['商品編號']?.rich_text?.[0]?.plain_text ?? '',
        name:        p['商品名稱']?.title?.[0]?.plain_text ?? '',
        spec:        p['規格']?.rich_text?.[0]?.plain_text ?? '',
        stock:       p['庫存數量']?.number ?? 0,
        unit:        p['單位']?.select?.name ?? '箱',
        temperature: p['溫層']?.select?.name ?? '',
        lastUpdated: p['最後更新時間']?.date?.start ?? null,
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  return all
}

// 組出 Notion 頁面屬性（upsert 與 reconcile 共用，確保寫入欄位一致）
function inventoryProps(item: InventoryItem, syncTime: string) {
  return {
    '商品名稱':   { title: [{ text: { content: item.name } }] },
    '商品編號':   { rich_text: [{ text: { content: item.code } }] },
    '規格':       { rich_text: [{ text: { content: item.spec } }] },
    '庫存數量':   { number: item.stock },
    '單位':       { select: { name: item.unit || '箱' } },
    '溫層':       { select: { name: item.temperature || '冷藏品' } },
    '最後更新時間': { date: { start: syncTime } },
  }
}

export async function upsertInventory(
  items: InventoryItem[],
  syncTime: string,
): Promise<{ updated: number; created: number }> {
  const db = getDb()
  const existing = await getInventory()
  const byCode = new Map(existing.map(r => [r.code, r.id]))

  let updated = 0
  let created = 0

  for (const item of items) {
    const props = inventoryProps(item, syncTime)
    const existingId = byCode.get(item.code)
    if (existingId) {
      await notion.pages.update({ page_id: existingId, properties: props })
      updated++
    } else {
      await notion.pages.create({ parent: { database_id: db }, properties: props })
      created++
    }
  }

  return { updated, created }
}

// 上傳的報表 vs 目前清單，比對出的差異（只算、不寫入，給預覽用）
export interface InventoryDiff {
  create:    { code: string; name: string; stock: number }[]                       // 報表有、清單沒有 → 要新增
  update:    { code: string; name: string; oldStock: number; newStock: number }[]  // 兩邊都有、數量變了 → 要更新
  unchanged: { code: string; name: string; stock: number }[]                       // 兩邊都有、數量一樣
  remove:    { code: string; name: string; stock: number }[]                       // 清單有、報表沒有 → 出貨完了，要移除
}

// 比對「報表」與「目前 Notion 庫存」，算出差異。不會寫入任何資料。
export async function diffInventory(items: InventoryItem[]): Promise<InventoryDiff> {
  const existing = await getInventory()
  const existingByCode = new Map(existing.map(r => [r.code, r]))
  const fileCodes = new Set(items.map(i => i.code))

  const diff: InventoryDiff = { create: [], update: [], unchanged: [], remove: [] }

  for (const item of items) {
    const cur = existingByCode.get(item.code)
    if (!cur) {
      diff.create.push({ code: item.code, name: item.name, stock: item.stock })
    } else if (cur.stock !== item.stock) {
      diff.update.push({ code: item.code, name: item.name, oldStock: cur.stock, newStock: item.stock })
    } else {
      diff.unchanged.push({ code: item.code, name: item.name, stock: item.stock })
    }
  }
  // 清單裡有、但報表裡沒有的舊品項 → 視為出貨完了，要移除
  for (const cur of existing) {
    if (!fileCodes.has(cur.code)) {
      diff.remove.push({ code: cur.code, name: cur.name, stock: cur.stock })
    }
  }

  return diff
}

// 依報表「校正」庫存：報表內的品項更新/新增；報表沒有的舊品項封存（從清單移除）。
export async function reconcileInventory(
  items: InventoryItem[],
  syncTime: string,
): Promise<{ updated: number; created: number; removed: number }> {
  const db = getDb()
  const existing = await getInventory()
  const byCode = new Map(existing.map(r => [r.code, r.id]))
  const fileCodes = new Set(items.map(i => i.code))

  let updated = 0
  let created = 0
  let removed = 0

  // 1) 報表內的品項：更新或新增（同 upsertInventory）
  for (const item of items) {
    const props = inventoryProps(item, syncTime)
    const existingId = byCode.get(item.code)
    if (existingId) {
      await notion.pages.update({ page_id: existingId, properties: props })
      updated++
    } else {
      await notion.pages.create({ parent: { database_id: db }, properties: props })
      created++
    }
  }

  // 2) 報表沒有的舊品項：封存（archived=true → 移到垃圾桶，清單不再顯示，30 天內可救回）
  for (const cur of existing) {
    if (!fileCodes.has(cur.code)) {
      await notion.pages.update({ page_id: cur.id, archived: true })
      removed++
    }
  }

  return { updated, created, removed }
}
