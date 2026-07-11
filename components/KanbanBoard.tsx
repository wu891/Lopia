'use client'
// ── 看板檢視（Modernist 改版）────────────────────────────────
// 5 欄：待出貨 → 運送中 → 通關中 → 配送中 → 已完成
// 欄頭色點是唯一的多色語意，卡片本體維持黑白紅；可水平捲動
import { useRouter } from 'next/navigation'
import type { Shipment } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import { deriveKanban, daysUntil, fmtMMDD } from '@/lib/kanban'
import { STAGES, deriveStage, isUrgentBatch, BOARD_COLS, etaInfo } from '@/lib/batchView'

interface CardData {
  s: Shipment
  stage: number
  done: boolean
  daysLeft: number | null
  urgent: boolean
}

function BatchCard({ c, lang, dot, today }: { c: CardData; lang: Lang; dot: string; today: string }) {
  const router = useRouter()
  const T = t[lang]
  const { s, stage, done, urgent } = c
  const stageName = done ? STAGES[4][lang] : STAGES[stage][lang]
  const transport = s.transportMode === '空運' ? T.airFreight : s.transportMode === '海運' ? T.seaFreight : s.transportMode
  const vessel = s.flightNo ?? s.awbNo
  const info = etaInfo(s, today)
  // 進度條填到目前階段（done = 全滿）
  const fillCount = done ? STAGES.length : stage + 1

  return (
    <div
      onClick={() => router.push(`/batch/${s.id}`)}
      tabIndex={0}
      role="button"
      onKeyDown={e => { if (e.key === 'Enter') router.push(`/batch/${s.id}`) }}
      className={`relative flex cursor-pointer flex-col gap-2.5 border border-[var(--mod-hair)] bg-white p-3.5 transition-colors hover:bg-[var(--mod-red-bg)] ${
        urgent ? 'bg-[var(--mod-red-bg2)]' : ''
      }`}
      style={urgent ? { boxShadow: 'inset 4px 0 0 var(--mod-red)' } : undefined}
    >
      {/* 批號 ＋ 狀態標籤（欄位色 12% 淡底） */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-[10px] font-semibold tracking-[.04em] text-[var(--mod-faint)] break-all">{s.ivName}</span>
          {urgent && (
            <span className="shrink-0 bg-[var(--mod-red)] px-1.5 py-0.5 text-[9px] font-bold text-white whitespace-nowrap">{T.urgentTag}</span>
          )}
        </div>
        <span
          className="shrink-0 whitespace-nowrap px-2 py-0.5 text-[10px] font-bold"
          style={{ color: dot, background: `${dot}1f` }}
        >
          {stageName}
        </span>
      </div>

      {/* 商品名 */}
      <span className="text-[15px] font-bold leading-snug text-[var(--mod-ink)]">
        {s.productSummary || s.ivName}
      </span>

      {/* 供應商標籤 */}
      {s.supplier && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="bg-[var(--mod-page)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--mod-faint)] whitespace-nowrap">{T.thSupplier}</span>
          <span className="font-semibold text-[var(--mod-sub)]">{s.supplier}</span>
        </div>
      )}

      {/* 路線 ＋ 運送方式 ＋ 船班 */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-bold text-[var(--mod-ink)] whitespace-nowrap">{T.routeJP}</span>
        <span className="font-bold text-[var(--mod-red)]">→</span>
        <span className="font-bold text-[var(--mod-ink)] whitespace-nowrap">{T.routeTW}</span>
        {transport && <span className="text-[var(--mod-sub2)] whitespace-nowrap">{transport}</span>}
        {vessel && <span className="font-mono text-[10px] text-[var(--mod-faint)] break-all">{vessel}</span>}
      </div>

      {/* 目前階段 ＋ 分段進度條（紅填到目前） */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-[var(--mod-faint)] whitespace-nowrap">
          {T.curStage} {stageName}
        </span>
        <div className="flex gap-[3px]">
          {STAGES.map((_, i) => (
            <div key={i} className={`h-[5px] flex-1 ${i < fillCount ? 'bg-[var(--mod-red)]' : 'bg-[#e5e3e1]'}`} />
          ))}
        </div>
      </div>

      {/* 底列：預計到港＋剩 N 天 ／ 倉庫＋數量 */}
      <div className="flex items-end justify-between border-t border-[var(--mod-hair)] pt-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium text-[var(--mod-faint)] whitespace-nowrap">{T.thEta}</span>
          <div className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="font-mono text-[13px] font-bold text-[var(--mod-ink)]">{fmtMMDD(s.arrivalTW)}</span>
            {info.kind === 'countdown' && (
              <span className={`text-[10px] font-bold ${info.hot ? 'text-[var(--mod-red)]' : 'text-[var(--mod-sub2)]'}`}>
                {T.remainDays} {info.days} {T.dayUnit}
              </span>
            )}
            {info.kind === 'today' && (
              <span className="text-[10px] font-bold text-[var(--mod-red)] whitespace-nowrap">{T.etaToday}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] font-medium text-[var(--mod-faint)] whitespace-nowrap">{s.warehouse ?? ' '}</span>
          <span className="font-mono text-[12px] font-bold text-[var(--mod-ink)] whitespace-nowrap">
            {s.totalBoxes != null ? `${s.totalBoxes.toLocaleString()} ${T.boxes}` : '—'}
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
  const T = t[lang]
  const cards: CardData[] = shipments.map(s => {
    const { stage, done } = deriveStage(s, today)
    return {
      s, stage, done,
      daysLeft: daysUntil(s.arrivalTW, today),
      urgent: isUrgentBatch(s, today),
    }
  })

  const columnCards = (statuses: string[], key: string) => {
    let list = cards.filter(c => statuses.includes(deriveKanban(c.s, today).status))
    if (key === 'done') {
      // 已完成欄只留最近 30 天抵台的（不然欄位無限長）
      list = list
        .filter(c => c.daysLeft !== null && c.daysLeft >= -30)
        .sort((a, b) => (b.s.arrivalTW ?? '').localeCompare(a.s.arrivalTW ?? ''))
    } else {
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
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-[1100px] items-start gap-0 border-2 border-[var(--mod-line)] bg-white">
        {BOARD_COLS.map((col, ci) => {
          const list = columnCards(col.statuses as string[], col.key)
          const urgentCount = list.filter(c => c.urgent).length
          return (
            <div
              key={col.key}
              className={`flex min-w-[220px] flex-1 flex-col gap-2.5 p-3 ${ci > 0 ? 'border-l border-[var(--mod-hair)]' : ''}`}
            >
              {/* 欄頭：色點＋名稱＋計數（含急件轉紅） */}
              <div className="flex items-center justify-between border-b-2 border-[var(--mod-line)] pb-2">
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="h-[9px] w-[9px] shrink-0" style={{ background: col.dot }} />
                  <span className="text-[13px] font-extrabold text-[var(--mod-ink)]">{col[lang]}</span>
                </div>
                <span className={`font-mono text-[13px] font-bold ${urgentCount > 0 ? 'text-[var(--mod-red)]' : 'text-[var(--mod-faint)]'}`}>
                  {list.length}
                </span>
              </div>

              {list.length === 0 ? (
                <p className="py-3 text-center text-[11px] text-[var(--mod-faint)]">{T.noData}</p>
              ) : (
                list.map(c => <BatchCard key={c.s.id} c={c} lang={lang} dot={col.dot} today={today} />)
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
