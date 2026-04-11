'use client'
import { useState, useEffect } from 'react'
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
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

interface LogisticsMarker {
  type: '放貨' | '配送' | '送達'
  batchId: string
  label: string
}

const MARKER_STYLE: Record<string, string> = {
  '放貨': 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200',
  '配送': 'bg-blue-100 text-blue-700 hover:bg-blue-200',
  '送達': 'bg-green-100 text-green-700 hover:bg-green-200',
}
const MARKER_ICON: Record<string, string> = {
  '放貨': '🟡',
  '配送': '🚚',
  '送達': '✅',
}

export default function CalendarView({ shipments, lang, logisticsEvents = [] }: Props) {
  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const isJa = lang === 'ja'
  const T = t[lang]

  // ESC key closes drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Derived data for drawer ───────────────────────────────────
  const selected         = shipments.find(s => s.id === selectedId) ?? null
  const selectedLogistics = selectedId ? logisticsEvents.filter(e => e.batchId === selectedId) : []
  const customsEvent     = selectedLogistics.find(e => e.eventType === '通關放貨')
  const deliveryEvents   = selectedLogistics.filter(e => e.eventType === '配送')

  const deliveryByRound = new Map<number, LogisticsEvent[]>()
  for (const e of deliveryEvents) {
    const key = e.round ?? 0
    if (!deliveryByRound.has(key)) deliveryByRound.set(key, [])
    deliveryByRound.get(key)!.push(e)
  }

  // ── Calendar grid ─────────────────────────────────────────────
  const startDow    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)

  function shipmentsOnDay(day: Date): Shipment[] {
    return shipments.filter(s => s.arrivalTW && isSameDay(parseLocalDate(s.arrivalTW), day))
  }

  function logisticsMarkersOnDay(day: Date): LogisticsMarker[] {
    const markers: LogisticsMarker[] = []
    for (const e of logisticsEvents) {
      if (e.eventType === '通關放貨' && e.releaseDate && isSameDay(parseLocalDate(e.releaseDate), day)) {
        const batch = shipments.find(s => s.id === e.batchId)
        markers.push({ type: '放貨', batchId: e.batchId ?? '', label: batch?.ivName ?? '' })
      }
      if (e.eventType === '配送' && e.estDelivery && isSameDay(parseLocalDate(e.estDelivery), day)) {
        const batch = shipments.find(s => s.id === e.batchId)
        if (!markers.find(m => m.type === '配送' && m.batchId === e.batchId))
          markers.push({ type: '配送', batchId: e.batchId ?? '', label: batch?.ivName ?? '' })
      }
      if (e.eventType === '配送' && e.actualDelivery && e.deliveryStatus === '已送達' &&
          isSameDay(parseLocalDate(e.actualDelivery), day)) {
        const batch = shipments.find(s => s.id === e.batchId)
        if (!markers.find(m => m.type === '送達' && m.batchId === e.batchId))
          markers.push({ type: '送達', batchId: e.batchId ?? '', label: batch?.ivName ?? '' })
      }
    }
    return markers
  }

  function prevMonth() {
    setSelectedId(null)
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    setSelectedId(null)
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  function handleSelect(id: string) {
    setSelectedId(prev => prev === id ? null : id)
  }

  const dowLabels = isJa
    ? ['日','月','火','水','木','金','土']
    : ['日','一','二','三','四','五','六']

  const drawerOpen = selectedId !== null

  return (
    <>
      {/* ── Backdrop ──────────────────────────────────────────── */}
      <div
        onClick={() => setSelectedId(null)}
        className={`fixed inset-0 bg-black/25 z-40 backdrop-blur-[1px]
          transition-opacity duration-300
          ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      />

      {/* ── Right-side Drawer ─────────────────────────────────── */}
      <div className={`fixed right-0 top-0 h-full w-[380px] max-w-[92vw] bg-white z-50
        border-l border-gray-200 shadow-2xl flex flex-col
        transition-transform duration-300 ease-out
        ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Drawer – sticky header */}
        <div className="flex items-start justify-between px-4 py-4 border-b border-gray-100 bg-white flex-shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            {selected ? (
              <>
                <p className="font-bold text-gray-900 text-base leading-tight truncate">{selected.ivName}</p>
                {selected.productSummary && (
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug line-clamp-2">{selected.productSummary}</p>
                )}
              </>
            ) : (
              <div className="h-6" />
            )}
          </div>
          <button
            onClick={() => setSelectedId(null)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400
              hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0 text-xl leading-none"
          >×</button>
        </div>

        {/* Drawer – scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {selected && (
            <div className="p-4 space-y-4">

              {/* Basic info */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  {isJa ? '基本情報' : '基本資訊'}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {[
                    { label: T.arrivalTW,    value: selected.arrivalTW },
                    { label: T.estClearance, value: selected.estClearance },
                    { label: T.warehouseIn,  value: selected.warehouseIn },
                    { label: T.totalBoxes,   value: selected.totalBoxes ? `${selected.totalBoxes} ${T.boxes}` : null },
                    { label: T.flightNo,     value: selected.flightNo },
                    { label: T.awbNo,        value: selected.awbNo },
                  ].filter(r => r.value).map(row => (
                    <div key={row.label}>
                      <p className="text-[10px] text-gray-400 mb-0.5">{row.label}</p>
                      <p className="text-gray-800 font-medium text-xs">{row.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Delivery status badge */}
              {selected.deliveryStatus && (
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                    bg-white border border-gray-200 text-gray-700">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[selected.deliveryStatus] ?? 'bg-gray-400'}`} />
                    {selected.deliveryStatus}
                  </div>
                </div>
              )}

              {/* Inspection status */}
              {(selected.radiationTest || selected.pesticideTest || selected.fumigation) && (
                <div className="pt-3 border-t border-gray-100 space-y-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{T.inspectionTitle}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {selected.radiationTest && (
                      <span className="text-xs">
                        <span className="text-gray-400">{T.radiationTest}：</span>
                        <span className={`font-medium ${
                          ['進行中','申請中'].includes(selected.radiationTest)
                            ? 'text-yellow-600 animate-pulse' : 'text-gray-700'
                        }`}>{selected.radiationTest}</span>
                      </span>
                    )}
                    {selected.pesticideTest && (
                      <span className="text-xs">
                        <span className="text-gray-400">{T.pesticideTest}：</span>
                        <span className={`font-medium ${
                          ['進行中','申請中'].includes(selected.pesticideTest)
                            ? 'text-yellow-600 animate-pulse' : 'text-gray-700'
                        }`}>{selected.pesticideTest}</span>
                      </span>
                    )}
                    {selected.fumigation && (
                      <span className="text-xs">
                        <span className="text-gray-400">{T.fumigationStatus}：</span>
                        <span className={`font-medium ${
                          ['進行中','申請中'].includes(selected.fumigation)
                            ? 'text-yellow-600 animate-pulse' : 'text-gray-700'
                        }`}>{selected.fumigation}</span>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Logistics section */}
              {selectedLogistics.length > 0 ? (
                <div className="pt-3 border-t border-gray-100 space-y-3">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    {T.logisticsSection}
                  </p>

                  {/* Customs release */}
                  {customsEvent && (
                    <div className="flex items-start gap-2.5 bg-yellow-50 rounded-lg p-3">
                      <span className="text-base leading-none mt-0.5">🟡</span>
                      <div className="text-xs space-y-0.5 flex-1">
                        <p className="font-semibold text-yellow-700">
                          {T.releaseDate}：{customsEvent.releaseDate}
                        </p>
                        {customsEvent.pickupLocation && (
                          <p className="text-yellow-600">{T.pickupLocation}：{customsEvent.pickupLocation}</p>
                        )}
                        {customsEvent.remarks && (
                          <p className="text-yellow-600 pt-0.5 border-t border-yellow-100 mt-1">
                            💬 {customsEvent.remarks}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Delivery rounds */}
                  {Array.from(deliveryByRound.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([round, events]) => {
                      const allDelivered  = events.every(e => e.deliveryStatus === '已送達')
                      const someDelivered = events.some(e => e.deliveryStatus === '已送達')
                      return (
                        <div key={round} className="rounded-lg border border-gray-100 overflow-hidden">
                          {/* Round header */}
                          <div className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold
                            ${allDelivered ? 'bg-green-50 text-green-700 border-b border-green-100'
                              : 'bg-blue-50 text-blue-700 border-b border-blue-100'}`}>
                            <span>{allDelivered ? '✅' : someDelivered ? '🚚' : '🚚'}</span>
                            <span>{T.roundNo}{round}{T.deliveryRound}</span>
                            {allDelivered && (
                              <span className="ml-auto text-green-600 text-[10px] font-medium bg-green-100 px-1.5 py-0.5 rounded-full">
                                {T.allDelivered}
                              </span>
                            )}
                          </div>
                          {/* Store rows */}
                          <div className="divide-y divide-gray-50">
                            {events.map(e => (
                              <div key={e.id}
                                className="flex items-center justify-between gap-2 px-3 py-2 text-xs bg-white">
                                <span className="text-gray-700 truncate flex-1">{e.store}</span>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {e.estDelivery && (
                                    <span className="text-gray-400 text-[10px]">{e.estDelivery}</span>
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
              ) : (
                <div className="pt-3 border-t border-gray-100 text-center py-6 text-xs text-gray-400">
                  {T.noData}
                </div>
              )}

            </div>
          )}
        </div>
      </div>

      {/* ── Calendar card ─────────────────────────────────────── */}
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

            const dow     = day.getDay()
            const isToday = isSameDay(day, today)
            const batches = shipmentsOnDay(day)
            const markers = logisticsMarkersOnDay(day)

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

                <div className="space-y-0.5">
                  {/* Batch arrival chips */}
                  {batches.map(s => {
                    const isActive = selectedId === s.id
                    const dotCls   = STATUS_DOT[s.deliveryStatus ?? ''] ?? 'bg-lopia-red'
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleSelect(s.id)}
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

                  {/* Logistics event markers (now clickable) */}
                  {markers.map((m, i) => {
                    const isActive = selectedId === m.batchId
                    return (
                      <button
                        key={`${m.type}-${m.batchId}-${i}`}
                        type="button"
                        onClick={() => handleSelect(m.batchId)}
                        title={`${m.type}: ${m.label}`}
                        className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                          leading-tight font-medium transition-all cursor-pointer
                          ${isActive ? 'bg-lopia-red text-white' : MARKER_STYLE[m.type]}`}
                      >
                        <span className="text-[10px]">{MARKER_ICON[m.type]}</span>
                        <span className="truncate">{m.type}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

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
    </>
  )
}
