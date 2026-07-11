// ── Modernist 改版（ETA-first）共用邏輯 ─────────────────────────
// 5 關流水線、看板 5 欄、急件判定、倒數文字。純函式，不碰畫面。
// 「關」對應 Notion 現有日期欄：出貨=日本出發日、到港=抵台日、
// 通關=實際出關日、入庫配送=入倉日（海運沒有自己的日期，介於出貨與到港之間）

import type { Shipment } from './notion'
import type { Lang } from './i18n'
import { deriveKanban, daysUntil, type KanbanStatus } from './kanban'

// ── 5 關階段 ──────────────────────────────────────────────────
export const STAGES = [
  { key: 'ship',      zh: '出貨',     ja: '出荷' },
  { key: 'sea',       zh: '海運',     ja: '海上輸送' },
  { key: 'arrive',    zh: '到港',     ja: '入港' },
  { key: 'customs',   zh: '通關',     ja: '通関' },
  { key: 'warehouse', zh: '入庫配送', ja: '入庫配送' },
] as const

/**
 * 目前在第幾關（0-4）；done=true 表示 5 關全部完成（全數出貨）。
 * 沿用 deriveKanban 的 6 段 step（0出貨→5門市），壓成 5 關：
 *   step0→關0、step1→關1、step2→關2、step3→關3、step4/5→關4、done→全完成
 */
export function deriveStage(s: Shipment, today: string): { stage: number; done: boolean; status: KanbanStatus } {
  const { status, step } = deriveKanban(s, today)
  if (status === 'done') return { stage: 4, done: true, status }
  return { stage: Math.min(step, 4), done: false, status }
}

/** 每一關對應的日期（明細垂直時間軸用；null=還沒發生/沒填） */
export function stageDates(s: Shipment): (string | null)[] {
  return [
    s.departJP,                          // 出貨
    s.departJP,                          // 海運（跟出發同日啟程，備註顯示船班）
    s.arrivalTW,                         // 到港
    s.actualClearance ?? null,           // 通關（實際；沒有就顯示預計）
    s.warehouseIn,                       // 入庫配送
  ]
}

// ── 急件 ─────────────────────────────────────────────────────
/**
 * 急件＝備註含「急」字（Colin 手動標）或 明天內到港但還沒完成（自動催）。
 * 到港超過 2 天的舊批次不標，不然歷史批次整片紅。
 */
export function isUrgentBatch(s: Shipment, today: string): boolean {
  if ((s.remarks ?? '').includes('急')) {
    const { done } = deriveStage(s, today)
    return !done
  }
  const { done } = deriveStage(s, today)
  const d = daysUntil(s.arrivalTW, today)
  return !done && d !== null && d <= 1 && d >= -2
}

// ── 看板 5 欄（Modernist 配色）───────────────────────────────
export type BoardColKey = 'wait' | 'transit' | 'customs' | 'delivering' | 'done'

export const BOARD_COLS: {
  key: BoardColKey
  statuses: KanbanStatus[]
  zh: string; ja: string
  dot: string           // 欄頭色點（唯一的多色語意）
}[] = [
  { key: 'wait',       statuses: ['prep'],              zh: '待出貨', ja: '出荷待ち', dot: '#8a8785' },
  { key: 'transit',    statuses: ['active', 'arrived'], zh: '運送中', ja: '輸送中',   dot: '#2a6fdb' },
  { key: 'customs',    statuses: ['customs'],           zh: '通關中', ja: '通関中',   dot: '#c67a00' },
  { key: 'delivering', statuses: ['shipping'],          zh: '配送中', ja: '配送中',   dot: '#7a52c7' },
  { key: 'done',       statuses: ['done'],              zh: '已完成', ja: '完了',     dot: '#2f8f56' },
]

// ── 日期／倒數顯示 ────────────────────────────────────────────
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEK_JA = ['日', '月', '火', '水', '木', '金', '土']

/** 07/14(一) 這種格式 */
export function fmtDateW(dateStr: string | null, lang: Lang): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00')
  const w = lang === 'ja' ? WEEK_JA[d.getDay()] : WEEK_ZH[d.getDay()]
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}/${day}(${w})`
}

export interface EtaInfo {
  kind: 'countdown' | 'today' | 'arrived' | 'tbd'
  days: number | null      // countdown 用
  hot: boolean             // ≤7 天 → 紅色
}

/** 預計到港欄要顯示什麼（清單/明細共用） */
export function etaInfo(s: Shipment, today: string): EtaInfo {
  const d = daysUntil(s.arrivalTW, today)
  if (d === null) return { kind: 'tbd', days: null, hot: false }
  if (d === 0) return { kind: 'today', days: 0, hot: true }
  if (d < 0) return { kind: 'arrived', days: d, hot: false }
  return { kind: 'countdown', days: d, hot: d <= 7 }
}

/**
 * 清單排序：「快到的在最上」
 *   ① 還沒到港的：預計到港升冪（越快到越上面）
 *   ② 已到港的：入港日新→舊
 *   ③ 沒日期的沉底
 */
export function sortByEtaAsc(list: Shipment[], today: string): Shipment[] {
  const rank = (s: Shipment) => {
    if (!s.arrivalTW) return 2
    return s.arrivalTW.slice(0, 10) >= today ? 0 : 1
  }
  return [...list].sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 0) return a.arrivalTW!.localeCompare(b.arrivalTW!)   // 未到：近的在前
    if (ra === 1) return b.arrivalTW!.localeCompare(a.arrivalTW!)   // 已到：新的在前
    return 0
  })
}
