// ── 看板改版邏輯（純函式，不碰畫面）─────────────────────────────
// 把 Notion 批次資料換算成看板需要的「狀態、進度階段、急件、KPI」。
// 設計來源：design_handoff_kanban_dashboard/README.md（#2a 看板主畫面）

import type { Shipment } from './notion'

// 看板 5 種狀態（README 色票表）：
// prep=出貨準備、active=運送中、arrived=已到港、customs=通關中、done=已完成
export type KanbanStatus = 'prep' | 'active' | 'arrived' | 'customs' | 'done'

// 6 個進度階段（中/日），順序固定：0出貨 →1海運 →2到港 →3通關 →4入倉 →5門市
export const KANBAN_STEPS: { zh: string; ja: string }[] = [
  { zh: '出貨', ja: '出荷' },
  { zh: '海運', ja: '輸送' },
  { zh: '到港', ja: '入港' },
  { zh: '通關', ja: '通関' },
  { zh: '入倉', ja: '入庫' },
  { zh: '門市', ja: '店舗' },
]

// 狀態的顯示文字（中/日）
export const STATUS_LABEL: Record<KanbanStatus, { zh: string; ja: string }> = {
  prep:    { zh: '出貨準備', ja: '出荷準備' },
  active:  { zh: '運送中',   ja: '輸送中' },
  arrived: { zh: '已到港',   ja: '入港済' },
  customs: { zh: '通關中',   ja: '通関中' },
  done:    { zh: '已完成',   ja: '完了' },
}

/** 今天的日期字串（台灣時區，YYYY-MM-DD）——整個看板都用這個當「今天」 */
export function todayTaipei(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

/** 目標日距離今天幾天（正數=還有幾天、0=今天、負數=已過幾天、null=沒填日期） */
export function daysUntil(dateStr: string | null, today: string): number | null {
  if (!dateStr) return null
  const target = new Date(dateStr.slice(0, 10)).getTime()
  const base = new Date(today).getTime()
  return Math.round((target - base) / 86400000)
}

/**
 * 從批次資料推導看板狀態與進度階段。
 * 判斷順序（由後往前）：
 *   全數出貨 → done(5)；部分出貨 → active(5)（正在送門市）
 *   已入倉  → active(4)；已出關 → active(4)（正要入倉）
 *   已抵台  → 當天算 arrived(2)，隔天起算 customs(3)（通關中）
 *   已出發  → active(1)；其他 → prep(0)
 * 註：原型範例把「入倉後配送中」也歸在運送中欄（status=active, step=4），這裡照做。
 */
export function deriveKanban(s: Shipment, today: string): { status: KanbanStatus; step: number } {
  if (s.deliveryStatus === '全數出貨') return { status: 'done', step: 5 }
  if (s.deliveryStatus === '部分出貨') return { status: 'active', step: 5 }
  if (s.warehouseIn && s.warehouseIn.slice(0, 10) <= today) return { status: 'active', step: 4 }
  if (s.actualClearance) return { status: 'active', step: 4 }

  const arrived = !!s.arrivalTW && s.arrivalTW.slice(0, 10) <= today
  const departed = !!s.departJP && s.departJP.slice(0, 10) <= today
  if (arrived) {
    // 到港當天顯示「已到港」，隔天起視為進入通關程序
    if (s.arrivalTW!.slice(0, 10) === today) return { status: 'arrived', step: 2 }
    return { status: 'customs', step: 3 }
  }
  if (departed) return { status: 'active', step: 1 }
  return { status: 'prep', step: 0 }
}

/**
 * 急件判定（README：daysLeft <= 1 且未完成）。
 * 加一條保險：到港超過 2 天的舊批次不再標急件，不然歷史批次會整片紅。
 */
export function isUrgent(status: KanbanStatus, daysLeft: number | null): boolean {
  return status !== 'done' && daysLeft !== null && daysLeft <= 1 && daysLeft >= -2
}

/** 剩餘天數文字：今天到港 / 剩 N 天；已過或沒日期回空字串 */
export function daysText(daysLeft: number | null, lang: 'zh' | 'ja'): string {
  if (daysLeft === null || daysLeft < 0) return ''
  if (daysLeft === 0) return lang === 'ja' ? '本日入港' : '今日到港'
  return lang === 'ja' ? `あと ${daysLeft} 日` : `剩 ${daysLeft} 天`
}

/** 日期字串 → MM/DD 顯示（沒填回 '—'） */
export function fmtMMDD(dateStr: string | null): string {
  if (!dateStr) return '—'
  const [, m, d] = dateStr.slice(0, 10).split('-')
  return `${m}/${d}`
}

// ── KPI 指標列 ───────────────────────────────────────────────

export interface KanbanKpis {
  ongoing: number            // 進行中批次（未全數出貨）
  newThisWeek: number        // 最近 7 天出發的批次（KPI 徽章 +N）
  arrivalsThisWeek: number   // 本週（一～日）抵台的批次
  nearestArrival: string | null // 最近一筆未來到港日（MM/DD）
  customsCount: number       // 通關中批次
  customsAttention: number   // 已超過預計出關日還沒出關（徽章「留意 N」）
  doneThisMonth: number      // 本月抵台且已全數出貨
  monthDonePct: number | null // 本月抵台批次的完成率（%）
}

export function computeKpis(shipments: Shipment[], today: string): KanbanKpis {
  const statuses = shipments.map(s => ({ s, k: deriveKanban(s, today) }))

  // 本週範圍：週一～週日（台灣習慣）
  const base = new Date(today)
  const dow = (base.getDay() + 6) % 7 // 週一=0
  const weekStart = new Date(base.getTime() - dow * 86400000).toISOString().slice(0, 10)
  const weekEnd = new Date(base.getTime() + (6 - dow) * 86400000).toISOString().slice(0, 10)
  const monthPrefix = today.slice(0, 7) // YYYY-MM

  const inWeek = (d: string | null) =>
    !!d && d.slice(0, 10) >= weekStart && d.slice(0, 10) <= weekEnd

  const ongoing = statuses.filter(({ k }) => k.status !== 'done').length
  const newThisWeek = shipments.filter(s => {
    const dd = daysUntil(s.departJP, today)
    return dd !== null && dd <= 0 && dd >= -6 // 最近 7 天內出發
  }).length

  const arrivalsThisWeek = shipments.filter(s => inWeek(s.arrivalTW)).length
  const futureArrivals = shipments
    .map(s => s.arrivalTW?.slice(0, 10))
    .filter((d): d is string => !!d && d >= today)
    .sort()
  const nearestArrival = futureArrivals[0] ? fmtMMDD(futureArrivals[0]) : null

  const customsList = statuses.filter(({ k }) => k.status === 'customs')
  const customsAttention = customsList.filter(({ s }) =>
    !!s.estClearance && s.estClearance.slice(0, 10) < today
  ).length

  const monthArrived = statuses.filter(({ s }) => s.arrivalTW?.slice(0, 7) === monthPrefix)
  const doneThisMonth = monthArrived.filter(({ k }) => k.status === 'done').length
  const monthDonePct = monthArrived.length > 0
    ? Math.round((doneThisMonth / monthArrived.length) * 100)
    : null

  return {
    ongoing, newThisWeek, arrivalsThisWeek, nearestArrival,
    customsCount: customsList.length, customsAttention,
    doneThisMonth, monthDonePct,
  }
}
