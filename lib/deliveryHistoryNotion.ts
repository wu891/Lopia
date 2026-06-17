import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

export interface DeliveryHistoryEntry {
  fileName: string
  roundNo: number
  storeCount: number
  totalBoxes: number
  stores: { name: string; boxes: number }[]
}

export async function saveDeliveryHistory(entry: DeliveryHistoryEntry): Promise<void> {
  const dbId = process.env.NOTION_DELIVERY_HISTORY_DB
  if (!dbId) return // 未設定就略過，不影響主流程

  const today = new Date().toISOString().split('T')[0]
  const title = `${entry.fileName.replace(/\.xlsx$/i, '')} 第${entry.roundNo}回`
  const storesSummary = entry.stores.map(s => `${s.name}:${s.boxes}箱`).join('、')

  await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      '名稱':  { title: [{ text: { content: title.slice(0, 100) } }] },
      '上傳日期': { date: { start: today } },
      '檔案名稱': { rich_text: [{ text: { content: entry.fileName.slice(0, 200) } }] },
      '回次':  { number: entry.roundNo },
      '門市數': { number: entry.storeCount },
      '總箱數': { number: entry.totalBoxes },
      '各店分配': { rich_text: [{ text: { content: storesSummary.slice(0, 1000) } }] },
      '狀態':  { select: { name: '已填入' } },
    },
  })
}
