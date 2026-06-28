/**
 * apple11Notion.ts
 *
 * 把每次蘋果11 出貨循環寫進 Notion「蘋果11庫存歷史」資料庫。
 * 設計為 best-effort：未設定 NOTION_APPLE11_DB（或無 API key）時自動略過，不影響產出。
 *
 * DB 屬性：
 *   單號(title)、配送日期(date)、回目(number)、批次(rich_text)、
 *   出貨箱數(number)、剩餘箱數(number)、出貨明細(rich_text)、剩餘明細(rich_text)
 */

import { Client } from '@notionhq/client'
import { AllocationLine } from './allocateGrades'
import { StockEntry } from './parseMudoStock'

const DB_ID = process.env.NOTION_APPLE11_DB ?? ''

export interface Apple11CyclePayload {
  date: string            // 'YYYY-MM-DD'
  shipmentNo: string
  round: number
  batchLabel: string
  lines: AllocationLine[]
  remaining: StockEntry[]
}

export interface NotionLogResult {
  ok: boolean
  note: string
  url?: string
}

function clip(s: string, max = 1900): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

export async function logApple11Cycle(p: Apple11CyclePayload): Promise<NotionLogResult> {
  if (!process.env.NOTION_API_KEY || !DB_ID) {
    return { ok: false, note: '未設定 Notion 蘋果11 資料庫，已略過紀錄' }
  }
  const notion = new Client({ auth: process.env.NOTION_API_KEY })

  const shippedTotal = p.lines.reduce((s, l) => s + l.qty, 0)
  const remainTotal = p.remaining.reduce((s, r) => s + r.qty, 0)

  const shipDetail = clip(
    p.lines.map(l => `${l.store}:${l.rawName}×${l.qty}`).join('；')
  )
  const remainDetail = clip(
    p.remaining.filter(r => r.qty > 0).map(r => `${r.rawName}=${r.qty}`).join('；')
  )

  try {
    const res = await notion.pages.create({
      parent: { database_id: DB_ID },
      properties: {
        '單號':       { title: [{ text: { content: p.shipmentNo } }] },
        '配送日期':   { date: { start: p.date } },
        '回目':       { number: p.round },
        '批次':       { rich_text: [{ text: { content: p.batchLabel || `第${p.round}回` } }] },
        '出貨箱數':   { number: shippedTotal },
        '剩餘箱數':   { number: remainTotal },
        '出貨明細':   { rich_text: [{ text: { content: shipDetail || '（無）' } }] },
        '剩餘明細':   { rich_text: [{ text: { content: remainDetail || '（無）' } }] },
      },
    })
    const url = (res as { url?: string }).url
    return { ok: true, note: '已寫入 Notion 歷史', url }
  } catch (e) {
    return { ok: false, note: 'Notion 寫入失敗（已略過）：' + (e instanceof Error ? e.message : String(e)) }
  }
}
