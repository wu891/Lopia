'use client'
// ── 主頁「本週出貨」七天列 ───────────────────────────────────
// 週一～週日一字排開：今天紅框、已經出掉的打勾變灰、快出完的批次給綠字提醒。
// 資料是前端從既有的 shipments + records 算出來的（見 lib/weekStrip.ts），沒有新 API。
import type { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import { buildWeekStrip, weekRangeLabel } from '@/lib/weekStrip'
import { fmtDateW } from '@/lib/batchView'

/** 打勾（已出貨）*/
function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2f8f56"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export default function WeekShipmentStrip({
  shipments, records, today, lang,
}: {
  shipments: Shipment[]
  records: ShipmentRecord[]
  today: string
  lang: Lang
}) {
  const T = t[lang]
  const week = buildWeekStrip(shipments, records, today)
  const { start, end } = weekRangeLabel(today)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-extrabold tracking-[.02em] text-[var(--mod-ink)]">
          {T.weekShipTitle}　{fmtDateW(start, lang)} – {fmtDateW(end, lang)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {week.map(day => (
          <div
            key={day.date}
            className={`flex min-h-[132px] flex-col gap-2 ${
              day.isToday
                ? 'border-2 border-[var(--mod-red)] bg-[var(--mod-red-bg)] p-[9px]'
                : 'border border-[var(--mod-hair)] bg-white p-2.5'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className={`font-mono text-[11px] font-bold ${
                day.isToday ? 'text-[var(--mod-red-dark)]' : 'text-[var(--mod-sub2)]'
              }`}>
                {fmtDateW(day.date, lang)}
              </span>
              {day.isToday && (
                <span className="shrink-0 bg-[var(--mod-red)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {T.weekToday}
                </span>
              )}
            </div>

            {day.items.length === 0 ? (
              <span className="text-[12px] text-[var(--mod-faint)]">
                {day.isPast ? '—' : T.weekNone}
              </span>
            ) : (
              <div className="flex flex-col gap-2">
                {day.items.map(item => (
                  <div key={item.batchId} className="flex flex-col gap-0.5">
                    <span className={`flex items-center gap-1 text-[12.5px] font-bold ${
                      day.isPast ? 'text-[var(--mod-faint)]' : 'text-[var(--mod-ink)]'
                    }`}>
                      <span className="truncate">{item.product} {item.boxes} {T.boxes}</span>
                      {day.isPast && <Check />}
                    </span>
                    {/* 已經出掉的只講「幾店」，還沒出的列出門市名，方便照著排車 */}
                    <span className="text-[11px] leading-snug text-[var(--mod-sub2)]">
                      {day.isPast
                        ? `${T.weekShipped}・${item.stores.length} ${T.weekStoreUnit}`
                        : item.stores.join('・') || '—'}
                    </span>
                    {item.closesBatch && (
                      <span className="text-[11px] font-bold text-[#2f8f56]">{T.weekWillClose}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
