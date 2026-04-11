'use client'
import { useState, useRef, useEffect } from 'react'
import { Shipment, LogisticsEvent } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

interface Props {
  shipments: Shipment[]
  lang: Lang
  logisticsEvents?: LogisticsEvent[]
}

const STATUS_DOT: Record<string, string> = {
  '待出貨':   'bg-gray-400',
  '部分出貨': 'bg-yellow-400',
  '全數出貨': 'bg-green-500',
  '未到':     'bg-blue-400',
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate()
}

function parseLocalDate(dateStr: string): Date {
  // Parse YYYY-MM-DD as local date to avoid UTC shift
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Logistics event types shown in the calendar cell
interface LogisticsMarker {
  type: '放貨' | '配送' | '送達'
  batchId: string
  label: string
}

export default function CalendarView({ shipments, lang, logisticsEvents = [] }: Props) {
  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selected, setSelected] = useState<Shipment | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const isJa = lang === 'ja'
  const T = t[lang]

  useEffect(() => {
    if (selected && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selected])

  // Build grid
  const startDow    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)

  function shipmentsOnDay(day: Date): Shipment[] {
    return shipments.filter(s => {
      if (!s.arrivalTW) return false
      return isSameDay(parseLocalDate(s.arrivalTW), day)
    })
  }

  function logisticsMarkersOnDay(day: Date): LogisticsMarker[] {
    const markers: LogisticsMarker[] = []
    for (const e of logisticsEvents) {
      if (e.eventType === '通關放貨' && e.releaseDate) {
        if (isSameDay(parseLocalDate(e.releaseDate), day)) {
          const batch = shipments.find(s => s.id === e.batchId)
          markers.push({ type: '放貨', batchId: e.batchId ?? '', label: batch?.ivName ?? '' })
        }
      }
      if (e.eventType === '配送' && e.estDelivery) {
        if (isSameDay(parseLocalDate(e.estDelivery), day)) {
          const batch = shipments.find(s => s.id === e.batchId)
          const existing = markers.find(m => m.type === '配送' && m.batchId === e.batchId)
          if (!existing) markers.push({ type: '配送', batchId: e.batchId ?? '', label: batch?.ivName ?? '' })
        }
      }
      if (e.eventType === '配送' && e.actualDelivery && e.deliveryStatus === '已送達') {
        if (isSameDay(parseLocalDate(e.actualDelivery), day)) {
          const batch = shipments.find(s => s.id === e.batchId)
          const existing = markers.find(m => m.type === '送達' && m.batchId === e.batchId)
          if (!existing) markers.push({ type: '送達', batchId: e.batchId ?? '', label: batch?.ivName ?? '' })
        }
      }
    }
    return markers
  }

  function prevMonth() {
    setSelected(null)
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    setSelected(null)
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  function handleChipClick(e: React.MouseEvent, s: Shipment) {
    e.stopPropagation()
    setSelected(prev => prev?.id === s.id ? null : s)
  }

  const dowLabels = isJa
    ? ['日','月','火','水','木','金','土']
    : ['日','一','二','三','四','五','六']

  // Logistics detail for selected batch
  const selectedLogistics = selected
    ? logisticsEvents.filter(e => e.batchId === selected.id)
    : []
  const customsEvent = selectedLogistics.find(e => e.eventType === '通關放貨')
  const deliveryEvents = selectedLogistics.filter(e => e.eventType === '配送')

  // Group delivery events by round
  const deliveryByRound = new Map<number, LogisticsEvent[]>()
  for (const e of deliveryEvents) {
    const key = e.round ?? 0
    if (!deliveryByRound.has(key)) deliveryByRound.set(key, [])
    deliveryByRound.get(key)!.push(e)
  }

  const MARKER_STYLE: Record<string, string> = {
    '放貨': 'bg-yellow-100 text-yellow-700',
    '配送': 'bg-blue-100 text-blue-700',
    '送達': 'bg-green-100 text-green-700',
  }
  const MARKER_ICON: Record<string, string> = {
    '放貨': '🟡',
    '配送': '🚚',
    '送達': '✅',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

      {/* Month header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
        <button onClick={prevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-lg transition-colors">‹</button>
        <span className="font-bold text-gray-800 text-sm">
          {isJa ? `${year}年${month+1}月` : `${year} 年 ${month+1} 月`}
        </span>
        <button onClick={nextMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-lg transition-colors">›</button>
      </div>

      {/* Day-of-week row */}
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
        {dowLabels.map((d, i) => (
          <div key={d} className={`py-1.5 text-center text-xs font-semibold
            ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 divide-x divide-gray-100">
        {cells.map((day, idx) => {
          if (!day) return (
            <div key={`e-${idx}`} className="min-h-[80px] bg-gray-50/40 border-b border-gray-100" />
          )

          const dow      = day.getDay()
          const isToday  = isSameDay(day, today)
          const batches  = shipmentsOnDay(day)
          const markers  = logisticsMarkersOnDay(day)

          return (
            <div key={day.toISOString()}
              className="min-h-[80px] p-1.5 border-b border-gray-100 bg-white">

              {/* Day number */}
              <div className={`text-xs font-semibold mb-1 w-5 h-5 flex items-center justify-center rounded-full leading-none
                ${isToday ? 'bg-lopia-red text-white' :
                  dow === 0 ? 'text-red-400' :
                  dow === 6 ? 'text-blue-400' : 'text-gray-600'}`}>
                {day.getDate()}
              </div>

              {/* Batch chips (arrivalTW) */}
              <div className="space-y-0.5">
                {batches.map(s => {
                  const isActive = selected?.id === s.id
                  const dotCls   = STATUS_DOT[s.deliveryStatus ?? ''] ?? 'bg-lopia-red'
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={(e) => handleChipClick(e, s)}
                      className={`w-full text-left flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                        leading-tight font-medium border transition-all
                        ${isActive
                          ? 'bg-lopia-red text-white border-lopia-red'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-lopia-red hover:text-lopia-red'
                        }`}
                      title={s.ivName}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-white' : dotCls}`} />
                      <span className="truncate">{s.ivName}</span>
                    </button>
                  )
                })}

                {/* Logistics markers */}
                {markers.map((m, i) => (
                  <div
                    key={`${m.type}-${m.batchId}-${i}`}
                    title={`${m.type}: ${m.label}`}
                    className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-xs leading-tight font-medium ${MARKER_STYLE[m.type]}`}
                  >
                    <span className="text-[10px]">{MARKER_ICON[m.type]}</span>
                    <span className="truncate">{m.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Selected batch detail panel */}
      {selected && (
        <div ref={detailRef} className="border-t-2 border-lopia-red bg-red-50/30 px-4 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="font-bold text-gray-900 text-base">{selected.ivName}</p>
              {selected.productSummary && (
                <p className="text-xs text-gray-500 mt-0.5">{selected.productSummary}</p>
              )}
            </div>
            <button onClick={() => setSelected(null)}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-3 flex-shrink-0">×</button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            {[
              { label: isJa ? '台湾着'   : '抵台日',    value: selected.arrivalTW },
              { label: isJa ? '通関予定' : '預計出關',  value: selected.estClearance },
              { label: isJa ? '入庫日'   : '入倉日',    value: selected.warehouseIn },
              { label: isJa ? '総箱数'   : '入倉箱數',  value: selected.totalBoxes ? `${selected.totalBoxes} 箱` : null },
              { label: isJa ? '便名'     : '班機號',    value: selected.flightNo },
              { label: 'AWB',                           value: selected.awbNo },
            ].filter(r => r.value).map(row => (
              <div key={row.label}>
                <span className="text-xs text-gray-400">{row.label}：</span>
                <span className="text-gray-800 font-medium">{row.value}</span>
              </div>
            ))}
          </div>

          {selected.deliveryStatus && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
              bg-white border border-gray-200 text-gray-700">
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[selected.deliveryStatus] ?? 'bg-gray-400'}`} />
              {selected.deliveryStatus}
            </div>
          )}

          {/* Inspection status */}
          {(selected.radiationTest || selected.pesticideTest || selected.fumigation) && (
            <div className="mt-3 pt-3 border-t border-red-100 flex flex-wrap gap-x-4 gap-y-1">
              {selected.radiationTest && (
                <span className="text-xs text-gray-500">
                  <span className="text-gray-400">{isJa ? '放射線検査' : '輻射檢驗'}：</span>
                  <span className={`font-medium ${
                    selected.radiationTest === '進行中' || selected.radiationTest === '申請中'
                      ? 'text-yellow-600 animate-pulse' : 'text-gray-700'
                  }`}>{selected.radiationTest}</span>
                </span>
              )}
              {selected.pesticideTest && (
                <span className="text-xs text-gray-500">
                  <span className="text-gray-400">{isJa ? '農薬検査' : '農藥檢驗'}：</span>
                  <span className={`font-medium ${
                    selected.pesticideTest === '進行中' || selected.pesticideTest === '申請中'
                      ? 'text-yellow-600 animate-pulse' : 'text-gray-700'
                  }`}>{selected.pesticideTest}</span>
                </span>
              )}
              {selected.fumigation && (
                <span className="text-xs text-gray-500">
                  <span className="text-gray-400">{isJa ? '燻蒸処理' : '煙燻處理'}：</span>
                  <span className={`font-medium ${
                    selected.fumigation === '進行中' || selected.fumigation === '申請中'
                      ? 'text-yellow-600 animate-pulse' : 'text-gray-700'
                  }`}>{selected.fumigation}</span>
                </span>
              )}
            </div>
          )}

          {/* Logistics section */}
          {selectedLogistics.length > 0 && (
            <div className="mt-3 pt-3 border-t border-red-100 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {T.logisticsSection}
              </p>

              {/* Customs release */}
              {customsEvent && (
                <div className="flex items-start gap-2 text-xs">
                  <span>🟡</span>
                  <div>
                    <span className="font-medium text-yellow-700">
                      {T.releaseDate}：{customsEvent.releaseDate}
                    </span>
                    {customsEvent.pickupLocation && (
                      <p className="text-gray-500 mt-0.5">{T.pickupLocation}：{customsEvent.pickupLocation}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Delivery rounds */}
              {Array.from(deliveryByRound.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([round, events]) => {
                  const allDelivered = events.every(e => e.deliveryStatus === '已送達')
                  const someDelivered = events.some(e => e.deliveryStatus === '已送達')
                  return (
                    <div key={round} className="text-xs">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span>{allDelivered ? '✅' : someDelivered ? '🚚' : '🚚'}</span>
                        <span className="font-medium text-gray-700">
                          {T.roundNo}{round}{T.deliveryRound}
                          {allDelivered && <span className="text-green-600 ml-1">{T.allDelivered}</span>}
                        </span>
                      </div>
                      <div className="ml-5 space-y-0.5">
                        {events.map(e => (
                          <div key={e.id} className="flex items-center justify-between gap-2 text-gray-500">
                            <span className="truncate">{e.store}</span>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {e.estDelivery && (
                                <span className="text-gray-400">{e.estDelivery}</span>
                              )}
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                e.deliveryStatus === '已送達' ? 'bg-green-100 text-green-700' :
                                e.deliveryStatus === '配送中' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-500'
                              }`}>
                                {e.deliveryStatus ?? '待配送'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center gap-3">
        {Object.entries(STATUS_DOT).map(([label, dot]) => (
          <div key={label} className="flex items-center gap-1 text-xs text-gray-500">
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            {label}
          </div>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-gray-400">🟡{T.releaseDate}</span>
          <span className="text-xs text-gray-400">🚚{T.delivering}</span>
          <span className="text-xs text-gray-400">✅{T.allDelivered}</span>
        </div>
      </div>
    </div>
  )
}
