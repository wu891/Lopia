/**
 * allocateGrades.ts
 *
 * 蘋果11 等級分配引擎。
 * 輸入：倉庫庫存(StockEntry[]) + 各店需求(品種/玉數/箱數)。
 * 規則（Colin 確認 2026-06-29）：
 *   1. 先驗總量：任一「品種+玉數」各等級加總仍不足 → 整批擋下（回傳 shortages，不分配）。
 *   2. 少拆行：每店每筆先找「裝得下整筆的最高等級」整筆給（單一品番一行）。
 *   3. 沒有單一等級裝得下才拆：照「貴先扣」依序補下一級。
 *   4. 等級只在同品種同玉數內比；價格(特價)無關品番。
 *
 * 已用第2回真實檔在 python 原型驗證（scratchpad/alloc.py）：35筆需求、0缺貨、僅1筆拆行。
 */

import { StockEntry } from './parseMudoStock'
import { AppleVariety, gradeOrder } from './appleGrades'

/** 一筆店鋪需求（來自計画書 N回目店名 分頁，ケース>0 的列） */
export interface Demand {
  store: string          // 店鋪 code（計画書分頁的店名，如 '台中'/'美麗'）
  variety: AppleVariety
  tama: number
  qty: number            // 箱數（ケース）
}

/** 分配出的一行（對應出庫總單一列） */
export interface AllocationLine {
  store: string
  variety: AppleVariety
  tama: number
  grade: string
  bango: string
  rawName: string        // 倉庫品名（出庫總單品名欄用）
  temp: string           // 溫層
  qty: number
}

export interface Shortage {
  variety: AppleVariety
  tama: number
  demand: number
  stock: number
  short: number          // 缺幾箱
}

export interface AllocationResult {
  ok: boolean
  lines: AllocationLine[]
  shortages: Shortage[]
  remaining: StockEntry[]  // 扣完後的剩餘庫存（含未出貨品項）
}

function keyOf(variety: string, tama: number, grade: string) {
  return `${variety}|${tama}|${grade}`
}

export function allocateGrades(stock: StockEntry[], demands: Demand[]): AllocationResult {
  // ── 庫存索引：key(品種|玉數|等級) → entry（remaining 可變） ─────────────
  const stockMap = new Map<string, StockEntry & { remaining: number }>()
  for (const s of stock) {
    stockMap.set(keyOf(s.variety, s.tama, s.grade), { ...s, remaining: s.qty })
  }

  // ── Step 1：先驗總量（aggregate per 品種+玉數） ───────────────────────
  const demandAgg = new Map<string, number>()           // '品種|玉數' → 需求總箱
  for (const d of demands) {
    const k = `${d.variety}|${d.tama}`
    demandAgg.set(k, (demandAgg.get(k) ?? 0) + d.qty)
  }
  const stockAgg = (variety: string, tama: number) => {
    let sum = 0
    for (const g of gradeOrder(variety as AppleVariety)) {
      sum += stockMap.get(keyOf(variety, tama, g))?.remaining ?? 0
    }
    return sum
  }
  const shortages: Shortage[] = []
  for (const [k, dem] of demandAgg) {
    const [variety, tamaStr] = k.split('|')
    const tama = parseInt(tamaStr, 10)
    const stk = stockAgg(variety, tama)
    if (dem > stk) {
      shortages.push({ variety: variety as AppleVariety, tama, demand: dem, stock: stk, short: dem - stk })
    }
  }
  if (shortages.length > 0) {
    // 整批擋下：不分配，剩餘＝原庫存
    return { ok: false, lines: [], shortages, remaining: stock.map(s => ({ ...s })) }
  }

  // ── Step 2/3：分配（少拆行、貴先扣） ─────────────────────────────────
  // 依 (品種,玉數) 分組，組內保留 demand 原順序（＝店鋪順序）
  const groups = new Map<string, Demand[]>()
  for (const d of demands) {
    const k = `${d.variety}|${d.tama}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(d)
  }

  const lines: AllocationLine[] = []
  for (const [k, orders] of groups) {
    const [variety, tamaStr] = k.split('|')
    const tama = parseInt(tamaStr, 10)
    const grades = gradeOrder(variety as AppleVariety)
      .filter(g => stockMap.has(keyOf(variety, tama, g)))

    for (const d of orders) {
      // 先找裝得下整筆的最高等級
      let placed = false
      for (const g of grades) {
        const e = stockMap.get(keyOf(variety, tama, g))!
        if (e.remaining >= d.qty) {
          e.remaining -= d.qty
          lines.push({ store: d.store, variety: d.variety, tama, grade: g, bango: e.bango, rawName: e.rawName, temp: e.temp, qty: d.qty })
          placed = true
          break
        }
      }
      if (placed) continue
      // 沒有單一等級裝得下 → 拆行，貴先扣
      let left = d.qty
      for (const g of grades) {
        if (left <= 0) break
        const e = stockMap.get(keyOf(variety, tama, g))!
        if (e.remaining <= 0) continue
        const take = Math.min(e.remaining, left)
        e.remaining -= take
        left -= take
        lines.push({ store: d.store, variety: d.variety, tama, grade: g, bango: e.bango, rawName: e.rawName, temp: e.temp, qty: take })
      }
      // Step 1 已保證 left 會歸 0
    }
  }

  // ── 剩餘庫存（含未出貨品項） ─────────────────────────────────────────
  const remaining: StockEntry[] = stock.map(s => {
    const e = stockMap.get(keyOf(s.variety, s.tama, s.grade))
    return { ...s, qty: e ? e.remaining : s.qty }
  })

  return { ok: true, lines, shortages: [], remaining }
}
