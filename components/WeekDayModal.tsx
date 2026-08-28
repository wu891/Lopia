'use client'
// ── 主頁「本週出貨」點日期格跳出的當日明細彈窗 ─────────────────
// 卡片格子太小塞不下 12 家門市，所以點下去用彈窗把逐店明細攤開。
// 資料是 lib/weekStrip.ts 已經算好的 WeekDay，這裡只負責畫，不再算一次。
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Lang, t } from '@/lib/i18n'
import { fmtDateW } from '@/lib/batchView'
import type { WeekDay } from '@/lib/weekStrip'

/** 灰底小標籤（單號／輪次／狀態共用）*/
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-[var(--mod-page)] px-1.5 py-0.5 text-[11px] text-[var(--mod-sub)]">
      {children}
    </span>
  )
}

export default function WeekDayModal({
  day, lang, onClose,
}: {
  day: WeekDay
  lang: Lang
  onClose: () => void
}) {
  const T = t[lang]
  const router = useRouter()

  // 按 Esc 關閉（跟點背景關閉一樣，兩條路都留著）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-[460px] overflow-y-auto border border-[var(--mod-line)] bg-white"
        onClick={e => e.stopPropagation()}
      >
        {/* 標題列：日期＋今天徽章＋關閉 */}
        <div className="flex items-center justify-between gap-3 border-b-2 border-[var(--mod-line)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={`font-mono text-[15px] font-bold ${
              day.isToday ? 'text-[var(--mod-red-dark)]' : 'text-[var(--mod-ink)]'
            }`}>
              {fmtDateW(day.date, lang)}
            </span>
            {day.isToday && (
              <span className="bg-[var(--mod-red)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                {T.weekToday}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={T.weekClose}
            className="cursor-pointer text-[18px] leading-none text-[var(--mod-faint)] hover:text-[var(--mod-ink)]"
          >
            ✕
          </button>
        </div>

        {/* 一天可能有好幾批貨（例：葡萄＋加工品同一天出），逐批列出 */}
        {day.items.map((item, i) => (
          <div key={item.batchId} className={i > 0 ? 'border-t-2 border-[var(--mod-line)]' : ''}>
            <div className="px-4 pb-2 pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-bold text-[var(--mod-ink)]">{item.product}</span>
                <span className="shrink-0 text-[14px] font-bold text-[var(--mod-ink)]">
                  {item.boxes} {T.boxes}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {item.shipmentNos.map(no => <Tag key={no}><span className="font-mono">{no}</span></Tag>)}
                {item.rounds.map(r => <Tag key={r}>{T.weekRoundPrefix}{r}{T.weekRoundSuffix}</Tag>)}
                {item.statuses.map(s => <Tag key={s}>{s}</Tag>)}
                {item.closesBatch && (
                  <span className="bg-[#eaf5ee] px-1.5 py-0.5 text-[11px] font-bold text-[#2f8f56]">
                    {T.weekWillClose}
                  </span>
                )}
              </div>
            </div>

            {/* 逐店明細 */}
            <div className="px-4">
              <div className="flex items-center justify-between border-b border-[var(--mod-hair)] py-1.5 text-[11px] text-[var(--mod-faint)]">
                <span>{T.weekStoreCol}（{item.rows.length}）</span>
                <span>{T.weekBoxCol}</span>
              </div>
              {item.rows.map((r, j) => (
                <div
                  key={`${r.store}-${j}`}
                  className="flex items-center justify-between gap-3 border-b border-[var(--mod-hair)] py-[7px]"
                >
                  <span className="text-[13px] text-[var(--mod-ink)]">{r.store}</span>
                  <span className="shrink-0 text-[13px] font-bold text-[var(--mod-ink)]">
                    {r.boxes} {T.boxes}
                  </span>
                </div>
              ))}

              {/* 合計 */}
              <div className="flex items-center justify-between gap-3 border-t-2 border-[var(--mod-line)] pt-2.5 text-[13px]">
                <span className="text-[var(--mod-sub)]">
                  {T.weekTotal}・{item.stores.length} {T.weekStoreUnit}
                </span>
                <span className="font-bold text-[var(--mod-ink)]">{item.boxes} {T.boxes}</span>
              </div>
            </div>

            <div className="px-4 pb-4 pt-3">
              <button
                onClick={() => router.push(`/batch/${item.batchId}`)}
                className="w-full cursor-pointer border border-[var(--mod-line)] py-2 text-[13px] font-bold text-[var(--mod-ink)] hover:bg-[var(--mod-page)]"
              >
                {T.weekBatchDetail}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
