/**
 * parsePlanShipment.ts
 *
 * 解析「台湾ロピアりんごXX」計画書 = LOPIA 出貨指示來源。
 * 分頁命名「N回目店名」（如 2回目台中、2回目MOP）。每分頁欄位：
 *   A=玉数  B=品種  C=ケース(箱數)  D=数量(顆)  E=原価(單價)  …利潤試算
 *
 * 產出：
 *   - 每回目各店的商品列（含 0 箱、含同玉數雙價格列）→ 給店鋪貨單 / 總表
 *   - ケース>0 的列 → 等級分配引擎的需求(Demand)
 */

import * as XLSX from 'xlsx'
import { AppleVariety, VARIETY_ALIASES } from './appleGrades'

export interface PlanRow {
  variety: AppleVariety
  tama: number
  price: number     // 原価（TWD/箱）
  cases: number     // ケース（箱數）
}

export interface PlanStore {
  code: string      // 計画書分頁的店名，如 '台中'/'美麗'/'巨蛋'
  rows: PlanRow[]   // 依分頁列序，含 0 箱列
}

export interface PlanRoundData {
  round: number
  stores: PlanStore[]
}

function detectVariety(s: string): AppleVariety | null {
  const t = s.trim()
  for (const [token, v] of Object.entries(VARIETY_ALIASES)) {
    if (t.includes(token)) return v
  }
  return null
}

/** 從分頁名「N回目店名」抓 round 與 店名 code（容忍前後空白） */
function parseSheetName(name: string): { round: number; code: string } | null {
  const m = name.trim().match(/^(\d+)回目(.+)$/)
  if (!m) return null
  return { round: parseInt(m[1], 10), code: m[2].trim() }
}

/** 掃出所有可用回目 */
export function detectPlanRounds(sheetNames: string[]): number[] {
  const set = new Set<number>()
  for (const sn of sheetNames) {
    const m = sn.trim().match(/^(\d+)回目/)
    if (m) set.add(parseInt(m[1], 10))
  }
  return Array.from(set).sort((a, b) => a - b)
}

function parseStoreSheet(ws: XLSX.WorkSheet): PlanRow[] {
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null })
  const out: PlanRow[] = []
  for (let i = 1; i < rows.length; i++) {  // 第 0 列為表頭
    const r = rows[i]
    const tamaRaw = r[0]
    const variety = detectVariety(String(r[1] ?? ''))
    if (variety == null) continue           // 合計列 / 空列：B 欄非品種
    const tama = typeof tamaRaw === 'number' ? tamaRaw : parseInt(String(tamaRaw ?? ''), 10)
    if (!tama || isNaN(tama)) continue
    // ケース＝箱數，必為整數；四捨五入避免小數造成逐列顯示與合計對不上
    const casesRaw = typeof r[2] === 'number' ? r[2] : parseFloat(String(r[2] ?? '0')) || 0
    const cases = Math.round(casesRaw)
    const price = typeof r[4] === 'number' ? r[4] : parseFloat(String(r[4] ?? '0')) || 0
    out.push({ variety, tama, price, cases })
  }
  return out
}

/** 解析指定回目；回傳該回目各店的商品列 */
export async function parsePlanRound(buffer: ArrayBuffer, round: number): Promise<PlanRoundData> {
  const wb = XLSX.read(buffer, { type: 'array' })
  const stores: PlanStore[] = []
  for (const sn of wb.SheetNames) {
    const parsed = parseSheetName(sn)
    if (!parsed || parsed.round !== round) continue
    const rows = parseStoreSheet(wb.Sheets[sn])
    if (rows.length > 0) stores.push({ code: parsed.code, rows })
  }
  return { round, stores }
}

/** 只讀分頁名，快速回傳可用回目（前端上傳後即時顯示用） */
export async function peekPlanRounds(buffer: ArrayBuffer): Promise<number[]> {
  const wb = XLSX.read(buffer, { type: 'array', bookSheets: true })
  return detectPlanRounds(wb.SheetNames)
}
