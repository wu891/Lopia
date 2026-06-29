/**
 * apple11StockStore.ts
 *
 * 蘋果11「目前庫存」持久層（Notion DB「蘋果11目前庫存」）。
 * 一品番一列：品番(title)/品名/品種/等級/玉數/目前箱數。
 *
 * 用途：
 *   - getCurrentStock()  讀現存（含 pageId 供更新）
 *   - seedStock()        初始化（DB 空時用倉庫檔灌入）
 *   - overwriteStock()   對帳覆寫（以倉庫實際為準）
 *   - applyRemaining()   出貨後把各品番箱數更新為扣帳後剩餘
 *
 * 需求：NOTION_API_KEY 對應的整合要被分享到此 DB，否則讀寫會丟錯（呼叫端需處理）。
 */

import { Client } from '@notionhq/client'
import { StockEntry } from './parseMudoStock'
import { AppleVariety } from './appleGrades'

const STOCK_DB_ID = process.env.NOTION_APPLE11_STOCK_DB ?? 'a23e9492dd7f46c8b465d365bca04488'

export interface StoredStockEntry extends StockEntry {
  pageId: string
}

function rt(s: string) { return { rich_text: [{ text: { content: s } }] } }
function num(n: number) { return { number: n } }
function title(s: string) { return { title: [{ text: { content: s } }] } }

function client(): Client {
  if (!process.env.NOTION_API_KEY) throw new Error('NOTION_API_KEY 未設定')
  return new Client({ auth: process.env.NOTION_API_KEY })
}

function readText(prop: unknown): string {
  const p = prop as { rich_text?: { plain_text: string }[]; title?: { plain_text: string }[] }
  const arr = p?.rich_text ?? p?.title ?? []
  return arr.map(t => t.plain_text).join('')
}
function readNum(prop: unknown): number {
  return (prop as { number?: number })?.number ?? 0
}

/** 讀目前庫存（全部分頁，含 pageId）。整合無權限時會丟錯。 */
export async function getCurrentStock(): Promise<StoredStockEntry[]> {
  const notion = client()
  const out: StoredStockEntry[] = []
  let cursor: string | undefined = undefined
  do {
    const res = await notion.databases.query({ database_id: STOCK_DB_ID, start_cursor: cursor, page_size: 100 })
    for (const page of res.results as { id: string; properties: Record<string, unknown> }[]) {
      const p = page.properties
      const bango = readText(p['品番'])
      if (!bango) continue
      out.push({
        pageId: page.id,
        bango,
        rawName: readText(p['品名']),
        variety: (readText(p['品種']) || 'サンふじ') as AppleVariety,
        grade: readText(p['等級']),
        tama: readNum(p['玉數']),
        qty: readNum(p['目前箱數']),
        temp: '冷藏',
      })
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return out
}

/** DB 是否已有資料（用來判斷是初始化還是對帳） */
export async function isStockSeeded(): Promise<boolean> {
  const notion = client()
  const res = await notion.databases.query({ database_id: STOCK_DB_ID, page_size: 1 })
  return res.results.length > 0
}

/** 初始化：把倉庫解析出的蘋果逐筆建立 */
export async function seedStock(entries: StockEntry[]): Promise<number> {
  const notion = client()
  let n = 0
  for (const e of entries) {
    await notion.pages.create({
      parent: { database_id: STOCK_DB_ID },
      properties: {
        '品番': title(e.bango), '品名': rt(e.rawName), '品種': rt(e.variety),
        '等級': rt(e.grade), '玉數': num(e.tama), '目前箱數': num(e.qty),
      },
    })
    n++
  }
  return n
}

/**
 * 對帳覆寫：以倉庫實際(newEntries)為準。
 *   - 已存在品番 → 更新箱數（與其他欄位）
 *   - 新品番 → 建立
 *   - DB 有、倉庫沒有的品番 → 箱數歸 0（賣完/已出清）
 */
export async function overwriteStock(newEntries: StockEntry[]): Promise<{ updated: number; created: number; zeroed: number }> {
  const notion = client()
  const current = await getCurrentStock()
  const byBango = new Map(current.map(c => [c.bango, c]))
  let updated = 0, created = 0, zeroed = 0
  const seen = new Set<string>()
  for (const e of newEntries) {
    seen.add(e.bango)
    const exist = byBango.get(e.bango)
    if (exist) {
      await notion.pages.update({ page_id: exist.pageId, properties: {
        '品名': rt(e.rawName), '品種': rt(e.variety), '等級': rt(e.grade), '玉數': num(e.tama), '目前箱數': num(e.qty),
      } })
      updated++
    } else {
      await notion.pages.create({ parent: { database_id: STOCK_DB_ID }, properties: {
        '品番': title(e.bango), '品名': rt(e.rawName), '品種': rt(e.variety), '等級': rt(e.grade), '玉數': num(e.tama), '目前箱數': num(e.qty),
      } })
      created++
    }
  }
  for (const c of current) {
    if (!seen.has(c.bango) && c.qty !== 0) {
      await notion.pages.update({ page_id: c.pageId, properties: { '目前箱數': num(0) } })
      zeroed++
    }
  }
  return { updated, created, zeroed }
}

/** 出貨後：把各品番箱數更新為扣帳後剩餘（remaining 來自 allocateGrades） */
export async function applyRemaining(remaining: StockEntry[]): Promise<number> {
  const notion = client()
  const current = await getCurrentStock()
  const byBango = new Map(current.map(c => [c.bango, c]))
  let n = 0
  for (const r of remaining) {
    const exist = byBango.get(r.bango)
    if (exist && exist.qty !== r.qty) {
      await notion.pages.update({ page_id: exist.pageId, properties: { '目前箱數': num(r.qty) } })
      n++
    }
  }
  return n
}
