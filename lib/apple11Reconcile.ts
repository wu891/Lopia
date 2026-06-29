/**
 * apple11Reconcile.ts
 *
 * 對帳：比較「系統現存」與「倉庫上傳的實際庫存」，逐品番列出差異。
 * 倉庫實際為最終真實；差異＝這段期間的出貨／損耗／退貨／點數修正。
 */

import { StockEntry } from './parseMudoStock'

export interface StockDiffRow {
  bango: string
  name: string
  systemQty: number      // 系統現存
  warehouseQty: number   // 倉庫實際
  delta: number          // 倉庫 - 系統（負=系統比倉庫多，通常是已出貨/損耗）
  kind: 'same' | 'decrease' | 'increase' | 'new' | 'gone'
}

export interface StockDiff {
  rows: StockDiffRow[]
  changedRows: StockDiffRow[]   // 只有差異的
  systemTotal: number
  warehouseTotal: number
}

export function diffStock(system: StockEntry[], warehouse: StockEntry[]): StockDiff {
  const sysMap = new Map(system.map(s => [s.bango, s]))
  const whMap = new Map(warehouse.map(w => [w.bango, w]))
  const allBango = new Set<string>([...sysMap.keys(), ...whMap.keys()])

  const rows: StockDiffRow[] = []
  for (const bango of allBango) {
    const s = sysMap.get(bango)
    const w = whMap.get(bango)
    const systemQty = s?.qty ?? 0
    const warehouseQty = w?.qty ?? 0
    const delta = warehouseQty - systemQty
    let kind: StockDiffRow['kind'] = 'same'
    if (!s && w) kind = 'new'
    else if (s && !w) kind = 'gone'
    else if (delta < 0) kind = 'decrease'
    else if (delta > 0) kind = 'increase'
    rows.push({
      bango,
      name: (w?.rawName || s?.rawName || ''),
      systemQty, warehouseQty, delta, kind,
    })
  }
  rows.sort((a, b) => a.bango.localeCompare(b.bango))
  return {
    rows,
    changedRows: rows.filter(r => r.kind !== 'same'),
    systemTotal: system.reduce((t, s) => t + s.qty, 0),
    warehouseTotal: warehouse.reduce((t, w) => t + w.qty, 0),
  }
}
