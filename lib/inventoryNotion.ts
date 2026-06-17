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
    const props = {
      '商品名稱':   { title: [{ text: { content: item.name } }] },
      '商品編號':   { rich_text: [{ text: { content: item.code } }] },
      '規格':       { rich_text: [{ text: { content: item.spec } }] },
      '庫存數量':   { number: item.stock },
      '單位':       { select: { name: item.unit || '箱' } },
      '溫層':       { select: { name: item.temperature || '冷藏品' } },
      '最後更新時間': { date: { start: syncTime } },
    }

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
