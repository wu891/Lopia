'use client'
// ── 四欄看板（設計 #2a）────────────────────────────────────────
// 欄位分組：出貨準備=prep／運送中=active+arrived／通關中=customs／已完成=done
// 視覺規格全部照 design_handoff_kanban_dashboard/README.md 的數值
import type { Shipment } from '@/lib/notion'
import { Lang } from '@/lib/i18n'
import {
  KanbanStatus, KANBAN_STEPS, STATUS_LABEL,
  deriveKanban, isUrgent, daysUntil, daysText, fmtMMDD,
} from '@/lib/kanban'

// 狀態徽章色票（文字色/底色）
const BADGE: Record<KanbanStatus, { fg: string; bg: string }> = {
  prep:    { fg: '#6b6b6b', bg: '#f0efec' },
  active:  { fg: '#1a56c4', bg: '#e8f0fe' },
  arrived: { fg: '#0d7a63', bg: '#e2f5f1' },
  customs: { fg: '#b45309', bg: '#fef1e0' },
  done:    { fg: '#1a7f3c', bg: '#e7f6ec' },
}

// 四欄的底色、圓點色、計數徽章色、日文欄名色
const COLUMNS: {
  key: string
  statuses: KanbanStatus[]
  zh: string; ja: string
  bg: string; dot: string; countBg: string; countFg: string; jaColor: string
}[] = [
  { key: 'prep',    statuses: ['prep'],              zh: '出貨準備', ja: '出荷準備', bg: '#efeee9', dot: '#9a988f', countBg: '#e2e0da', countFg: '#8f8d84', jaColor: '#a8a69d' },
  { key: 'transit', statuses: ['active', 'arrived'], zh: '運送中',   ja: '輸送中',   bg: '#eaeff7', dot: '#1a56c4', countBg: '#dbe4f4', countFg: '#5f7099', jaColor: '#9aa7bd' },
  { key: 'customs', statuses: ['customs'],           zh: '通關中',   ja: '通関中',   bg: '#f6eee1', dot: '#b45309', countBg: '#f0e0c8', countFg: '#a2712e', jaColor: '#c19a68' },
  { key: 'done',    statuses: ['done'],              zh: '已完成',   ja: '完了',     bg: '#e8f2ec', dot: '#1a7f3c', countBg: '#d6ecdd', countFg: '#40865b', jaColor: '#8fb79f' },
]

// 卡片上的小標籤文字（看板本體是中日雙語設計，只有這幾個跟著語言切換）
const L = {
  zh: { supplier: '供應商', cur: '目前', eta: '預計到港', urgent: '急件', boxes: '箱', empty: '目前沒有批次', from: '日本', to: '台灣', air: '空運', sea: '海運' },
  ja: { supplier: '仕入先', cur: '現在', eta: '入港予定', urgent: '至急', boxes: '箱', empty: '該当なし',     from: '日本', to: '台湾', air: '空輸', sea: '船便' },
}

interface CardData {
  s: Shipment
  status: KanbanStatus
  step: number
  daysLeft: number | null
  urgent: boolean
}

function BatchCard({ c, lang }: { c: CardData; lang: Lang }) {
  const w = L[lang]
  const { s, status, step, daysLeft, urgent } = c
  const badge = BADGE[status]
  const label = STATUS_LABEL[status][lang]
  const curStep = KANBAN_STEPS[step]?.[lang] ?? '—'
  // 運輸方式 + 班機/船次號（有什麼顯示什麼）
  const transport = [
    s.transportMode === '空運' ? w.air : s.transportMode === '海運' ? w.sea : s.transportMode,
    s.flightNo ?? s.awbNo,
  ].filter(Boolean).join(' ')
  const dt = daysText(daysLeft, lang)

  return (
    <div
      className="relative flex flex-col gap-3 overflow-hidden rounded-[14px] border border-[#eae8e2] bg-white pt-[15px] pr-4 pb-[15px] pl-[17px]"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}
    >
      {/* 急件：左緣 4px 紅色直條 */}
      {urgent && <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#e4002b]" />}

      {/* 第一列：批次號（＋急件標籤）／品名／狀態徽章 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-[3px] min-w-0">
          <div className="flex items-center gap-[7px]">
            <span className="font-mono text-[11px] font-semibold tracking-[.05em] text-[#a8a69d] break-all">
              {s.ivName}
            </span>
            {urgent && (
              <span className="shrink-0 rounded-[4px] bg-[#e4002b] px-1.5 py-0.5 text-[9px] font-bold tracking-[.05em] text-white">
                {w.urgent}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-[7px]">
            <span className="text-[16px] font-bold leading-snug text-[#26251f]">
              {s.productSummary || s.ivName}
            </span>
          </div>
        </div>
        <span
          className="shrink-0 whitespace-nowrap rounded-full px-[9px] py-1 text-[10px] font-bold"
          style={{ color: badge.fg, background: badge.bg }}
        >
          {label}
        </span>
      </div>

      {/* 供應商列 */}
      {s.supplier && (
        <div className="flex items-center gap-[7px] text-[12px]">
          <span className="rounded-[5px] bg-[#f4f3ef] px-[7px] py-0.5 text-[10px] font-semibold text-[#a8a69d]">
            {w.supplier}
          </span>
          <span className="font-semibold text-[#3a3a38]">{s.supplier}</span>
        </div>
      )}

      {/* 航線列：日本 → 台灣 ＋ 運輸方式/班機號 */}
      <div className="flex items-center gap-[7px] text-[12px]">
        <span className="font-bold text-[#26251f]">{w.from}</span>
        <span className="font-bold text-[#e4002b]">→</span>
        <span className="font-bold text-[#26251f]">{w.to}</span>
        {transport && <span className="text-[11px] text-[#bcbab2]">{transport}</span>}
      </div>

      {/* 進度區：目前階段 ＋ 6 段進度條（已完成=紅、目前=紅脈動、未達=灰） */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium text-[#a8a69d]">
          {w.cur} {curStep}
        </span>
        <div className="flex gap-[3px]">
          {KANBAN_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-[5px] flex-1 rounded-full ${
                i < step ? 'bg-[#e4002b]'
                : i === step ? 'bg-[#e4002b] animate-lp-pulse-fast'
                : 'bg-[#ecebe6]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* 底列：預計到港＋剩餘天數／倉庫＋箱數 */}
      <div className="flex items-end justify-between border-t border-[#f2f1ed] pt-[11px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium text-[#a8a69d]">{w.eta}</span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[14px] font-bold text-[#26251f]">{fmtMMDD(s.arrivalTW)}</span>
            {dt && <span className="text-[10px] font-semibold text-[#e4002b]">{dt}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] font-medium text-[#a8a69d]">{s.warehouse ?? ' '}</span>
          <span className="font-mono text-[13px] font-bold text-[#26251f]">
            {s.totalBoxes != null ? `${s.totalBoxes.toLocaleString()} ${w.boxes}` : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function KanbanBoard({
  shipments, lang, today,
}: {
  shipments: Shipment[]
  lang: Lang
  today: string
}) {
  // 每個批次先算好狀態/進度/急件，再分欄
  const cards: CardData[] = shipments.map(s => {
    const { status, step } = deriveKanban(s, today)
    const daysLeft = daysUntil(s.arrivalTW, today)
    return { s, status, step, daysLeft, urgent: isUrgent(status, daysLeft) }
  })

  const columnCards = (statuses: KanbanStatus[], key: string): CardData[] => {
    let list = cards.filter(c => statuses.includes(c.status))
    if (key === 'done') {
      // 已完成欄只留最近 30 天抵台的，太舊的看月曆/卡片檢視就好（不然欄位會無限長）
      list = list
        .filter(c => c.daysLeft !== null && c.daysLeft >= -30)
        .sort((a, b) => (b.s.arrivalTW ?? '').localeCompare(a.s.arrivalTW ?? ''))
    } else {
      // 急件排最前，其餘照到港日由近到遠，沒日期的沉底
      list = list.sort((a, b) => {
        if (a.urgent !== b.urgent) return a.urgent ? -1 : 1
        if (!a.s.arrivalTW && !b.s.arrivalTW) return 0
        if (!a.s.arrivalTW) return 1
        if (!b.s.arrivalTW) return -1
        return a.s.arrivalTW.localeCompare(b.s.arrivalTW)
      })
    }
    return list
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map(col => {
        const list = columnCards(col.statuses, col.key)
        return (
          <div key={col.key} className="flex flex-col gap-3 rounded-2xl px-3 py-3.5" style={{ background: col.bg }}>
            {/* 欄首：圓點＋中文欄名＋日文／計數徽章 */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="h-[9px] w-[9px] rounded-full" style={{ background: col.dot }} />
                <span className="text-[13px] font-bold text-[#3a3a38]">{col.zh}</span>
                <span className="text-[11px]" style={{ color: col.jaColor }}>{col.ja}</span>
              </div>
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[12px] font-bold"
                style={{ background: col.countBg, color: col.countFg }}
              >
                {list.length}
              </span>
            </div>

            {list.length === 0 ? (
              <p className="py-3 text-center text-[11px] text-[#a8a69d]">{L[lang].empty}</p>
            ) : (
              list.map(c => <BatchCard key={c.s.id} c={c} lang={lang} />)
            )}
          </div>
        )
      })}
    </div>
  )
}
