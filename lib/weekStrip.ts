// ── 主頁「本週出貨」七天列的資料整理 ─────────────────────────
// 純函式、不碰畫面，方便單獨寫測試。
// 資料全部來自主頁本來就抓好的兩包東西：
//   shipments（批次，拿商品名與入倉箱數）＋ records（出貨紀錄，拿日期/箱數/門市）
// 所以這個功能不需要新的 API。
import type { Shipment, ShipmentRecord } from './notion'

/** 同一天、同一批貨的一筆彙總（多家門市會併成一筆）*/
export interface WeekItem {
  batchId: string
  product: string        // 商品名（顯示用）
  boxes: number          // 這天這批總共出幾箱
  stores: string[]       // 送去哪些門市（去重，依原順序）
  closesBatch: boolean   // 出完這批就可以關帳了（提醒用）
}

export interface WeekDay {
  date: string           // YYYY-MM-DD
  isToday: boolean
  isPast: boolean        // 比今天早＝已經出掉了
  items: WeekItem[]
}

const DAY = 86400000

/** 加減天數（輸入輸出都是 YYYY-MM-DD）*/
function addDays(date: string, days: number): string {
  return new Date(new Date(date).getTime() + days * DAY).toISOString().slice(0, 10)
}

/**
 * 本週一的日期。台灣習慣週一起算，
 * 算法與 lib/kanban.ts 的 computeKpis 一致（週一=0）。
 */
export function weekStartOf(today: string): string {
  const dow = (new Date(today).getDay() + 6) % 7
  return addDays(today, -dow)
}

/** 這筆出貨紀錄算不算數（全站統一：被標「已取消」的不算）*/
function counts(r: ShipmentRecord): boolean {
  return r.planStatus !== '已取消' && !!r.date && !!r.batchId && !!r.boxes
}

/**
 * 產生週一～週日七天的出貨資料。
 * records 要傳「全部」的出貨紀錄，不是只有本週的——
 * 判斷「出完即關帳」需要往回加總這批貨過去已經出掉多少。
 */
export function buildWeekStrip(
  shipments: Shipment[],
  records: ShipmentRecord[],
  today: string,
): WeekDay[] {
  const start = weekStartOf(today)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const end = days[6]

  const nameOf = new Map(shipments.map(s => [s.id, s.productSummary || s.ivName]))
  const totalOf = new Map(shipments.map(s => [s.id, s.totalBoxes]))

  const valid = records.filter(counts)

  // 這批貨到 date（含當天）為止總共出了幾箱——判斷關帳用
  const shippedUpTo = (batchId: string, date: string) =>
    valid.reduce((sum, r) => (r.batchId === batchId && r.date! <= date ? sum + r.boxes! : sum), 0)

  return days.map(date => {
    const rows = valid.filter(r => r.date === date)

    // 同一天同一批貨合併成一筆（多家門市＝多筆紀錄）
    const byBatch = new Map<string, WeekItem>()
    for (const r of rows) {
      const id = r.batchId!
      const item = byBatch.get(id) ?? {
        batchId: id,
        product: nameOf.get(id) ?? id,
        boxes: 0,
        stores: [],
        closesBatch: false,
      }
      item.boxes += r.boxes!
      if (r.store && !item.stores.includes(r.store)) item.stores.push(r.store)
      byBatch.set(id, item)
    }

    // 「出完即關帳」＝這天出完後剛好把整批出光，而且是「這天」把它出光的
    // （前一天就已經出光的話，就不要每天都跳提醒）
    for (const item of byBatch.values()) {
      const total = totalOf.get(item.batchId)
      if (total == null || total <= 0) continue
      const after = shippedUpTo(item.batchId, date)
      item.closesBatch = after >= total && after - item.boxes < total
    }

    return {
      date,
      isToday: date === today,
      isPast: date < today,
      items: [...byBatch.values()].sort((a, b) => b.boxes - a.boxes),
    }
  })
}

/** 週一～週日的範圍字串，給標題用（例：08/24 – 08/30）*/
export function weekRangeLabel(today: string): { start: string; end: string } {
  const start = weekStartOf(today)
  return { start, end: addDays(start, 6) }
}
