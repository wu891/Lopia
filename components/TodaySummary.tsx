'use client'
import { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

interface Props {
  shipments: Shipment[]
  allRecords: ShipmentRecord[]
  lang: Lang
  onGoPreview: () => void
}

// 今日概況：今日出貨（箱/店）、在途批次、部分出貨——打開頁面先看該行動的事
export default function TodaySummary({ shipments, allRecords, lang, onGoPreview }: Props) {
  const T = t[lang]
  // 用瀏覽器當地日期（台灣/日本），不用 UTC，避免清晨時段差一天
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const valid = allRecords.filter(r => r.date && r.planStatus !== '已取消')
  const todayRecords = valid.filter(r => r.date === todayStr)
  const todayBoxes = todayRecords.reduce((s, r) => s + (r.boxes ?? 0), 0)
  const todayStores = new Set(todayRecords.map(r => r.store).filter(Boolean)).size

  const nextDate = valid.map(r => r.date as string).filter(d => d > todayStr).sort()[0] ?? null
  const nextDays = nextDate
    ? Math.round((new Date(nextDate).getTime() - new Date(todayStr).getTime()) / 86400000)
    : null

  const inTransit = shipments.filter(s => s.deliveryStatus === '未到').length
  const partial = shipments.filter(s => s.deliveryStatus === '部分出貨').length

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {/* 今日出貨 → 點擊跳進貨預告（含複製 LINE 格式） */}
      <button
        onClick={onGoPreview}
        className="col-span-2 text-left bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3
          hover:border-lopia-red transition-colors cursor-pointer group"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">{T.todayShip}</p>
          <span className="text-[11px] text-gray-400 group-hover:text-lopia-red transition-colors flex items-center gap-0.5">
            {T.viewPreview}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </div>
        {todayBoxes > 0 ? (
          <div className="flex items-baseline gap-2 mt-0.5">
            <p className="text-xl font-bold text-lopia-red">
              {todayBoxes} <span className="text-sm font-medium">{T.boxes}</span>
            </p>
            <p className="text-xs text-gray-500">{todayStores} {T.sumStores}</p>
          </div>
        ) : (
          <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
            <p className="text-base font-semibold text-gray-400">{T.todayNoShip}</p>
            {nextDate && (
              <p className="text-xs text-gray-500">
                {T.nextShip} {nextDate.slice(5).replace('-', '/')}（{nextDays} {T.daysLater}）
              </p>
            )}
          </div>
        )}
      </button>

      {/* 在途（未到） */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3">
        <p className="text-xs text-gray-500">{T.sumInTransit}</p>
        <p className="text-xl font-bold text-sky-600 mt-0.5">
          {inTransit} <span className="text-sm font-medium text-gray-400">{T.sumBatches}</span>
        </p>
      </div>

      {/* 部分出貨 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3">
        <p className="text-xs text-gray-500">{T.partialShip}</p>
        <p className="text-xl font-bold text-amber-600 mt-0.5">
          {partial} <span className="text-sm font-medium text-gray-400">{T.sumBatches}</span>
        </p>
      </div>
    </div>
  )
}
