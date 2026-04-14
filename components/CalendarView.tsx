'use client'
import { useState, useEffect } from 'react'
import { Shipment, LogisticsEvent, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

interface Props {
  shipments: Shipment[]
  lang: Lang
  logisticsEvents?: LogisticsEvent[]
  records?: ShipmentRecord[]
  onRefresh?: () => void
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
  // Support both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM' (datetime-local)
  const datePart = dateStr.split('T')[0]
  const [y, m, d] = datePart.split('-').map(Number)
  return new Date(y, m - 1, d)
}

interface LogisticsMarker {
  type: '放貨' | '配送' | '送達'
  batchId: string
  label: string
  count: number   // number of stores for this batch on this day
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

const BATCH_STATUSES = ['未到', '待出貨', '部分出貨', '配送中', '全數出貨']
const STORE_STATUSES = ['待配送', '配送中', '已送達'] as const

export default function CalendarView({ shipments, lang, logisticsEvents = [], records = [], onRefresh }: Props) {
  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const isJa = lang === 'ja'
  const T = t[lang]

  // ── Auth state ────────────────────────────────────────────────
  const [authed, setAuthed] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pendingEdit, setPendingEdit] = useState<(() => void) | null>(null)

  // ── Edit state ────────────────────────────────────────────────
  const [editingBatchStatus, setEditingBatchStatus] = useState(false)
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setAuthed(sessionStorage.getItem('lopia_authed') === '1')
    }
  }, [])

  // Reset edit state when switching batches
  useEffect(() => {
    setEditingBatchStatus(false)
    setEditingStoreId(null)
  }, [selectedId])

  function requireAuth(fn: () => void) {
    if (authed) { fn() } else {
      setPendingEdit(() => fn)
      setShowPwModal(true)
    }
  }

  async function handlePwSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPwLoading(true)
    setPwError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwInput }),
      })
      const json = await res.json()
      if (json.ok) {
        sessionStorage.setItem('lopia_authed', '1')
        setAuthed(true)
        setShowPwModal(false)
        setPwInput('')
        pendingEdit?.()
        setPendingEdit(null)
      } else {
        setPwError(json.error ?? '密碼錯誤')
      }
    } finally {
      setPwLoading(false)
    }
  }

  async function saveBatchStatus(batchId: string, status: string) {
    setSavingId(batchId)
    try {
      await fetch(`/api/shipments/${batchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryStatus: status }),
      })
      setEditingBatchStatus(false)
      onRefresh?.()
    } finally {
      setSavingId(null)
    }
  }

  async function saveStoreStatus(eventId: string, status: string) {
    setSavingId(eventId)
    try {
      await fetch(`/api/logistics/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryStatus: status }),
      })
      setEditingStoreId(null)
      onRefresh?.()
    } finally {
      setSavingId(null)
    }
  }

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
    const deliveryCount  = new Map<string, number>()  // batchId → # stores with estDelivery on day
    const deliveredCount = new Map<string, number>()  // batchId → # stores actualDelivery+已送達 on day

    for (const e of logisticsEvents) {
      const bid = e.batchId ?? ''
      if (e.eventType === '通關放貨' && e.releaseDate && isSameDay(parseLocalDate(e.releaseDate), day)) {
        const batch = shipments.find(s => s.id === e.batchId)
        if (!markers.find(m => m.type === '放貨' && m.batchId === bid))
          markers.push({ type: '放貨', batchId: bid, label: batch?.ivName ?? '', count: 0 })
      }
      if (e.eventType === '配送' && e.estDelivery && isSameDay(parseLocalDate(e.estDelivery), day)) {
        deliveryCount.set(bid, (deliveryCount.get(bid) ?? 0) + 1)
      }
      if (e.eventType === '配送' && e.actualDelivery && e.deliveryStatus === '已送達' &&
          isSameDay(parseLocalDate(e.actualDelivery), day)) {
        deliveredCount.set(bid, (deliveredCount.get(bid) ?? 0) + 1)
      }
    }

    // 配送中 markers（按 estDelivery 日期，顯示門市數）
    for (const [bid, count] of deliveryCount) {
      const batch = shipments.find(s => s.id === bid)
      markers.push({ type: '配送', batchId: bid, label: batch?.ivName ?? '', count })
    }
    // 已送達 markers（按 actualDelivery 日期，顯示已送達門市數）
    for (const [bid, count] of deliveredCount) {
      const batch = shipments.find(s => s.id === bid)
      markers.push({ type: '送達', batchId: bid, label: batch?.ivName ?? '', count })
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

              {/* Delivery status badge – editable */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => requireAuth(() => setEditingBatchStatus(v => !v))}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                      bg-white border border-gray-200 text-gray-700 hover:border-gray-400 transition-colors"
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[selected.deliveryStatus ?? ''] ?? 'bg-gray-400'}`} />
                    {selected.deliveryStatus ?? '—'}
                    <span className="text-gray-300 text-[9px]">▼</span>
                  </button>
                  {editingBatchStatus && (
                    <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 py-1 min-w-[130px]">
                      {BATCH_STATUSES.map(s => (
                        <button
                          key={s}
                          disabled={savingId === selected.id}
                          onClick={() => saveBatchStatus(selected.id, s)}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 ${s === selected.deliveryStatus ? 'font-semibold text-lopia-red' : 'text-gray-700'}`}
                        >
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[s] ?? 'bg-gray-400'}`} />
                          {s}
                          {savingId === selected.id ? ' ⋯' : ''}
                        </button>
                      ))}
                      <button
                        onClick={() => setEditingBatchStatus(false)}
                        className="w-full text-center px-3 py-1.5 text-[10px] text-gray-400 border-t border-gray-100 mt-0.5 hover:bg-gray-50"
                      >取消</button>
                    </div>
                  )}
                </div>
              </div>

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
                            {events.map(e => {
                              const rec = records.find(r =>
                                r.batchId === e.batchId &&
                                r.round === round &&
                                r.store === e.store
                              )
                              return (
                              <div key={e.id}
                                className="flex items-center justify-between gap-2 px-3 py-2 text-xs bg-white">
                                <span className="text-gray-700 truncate flex-1">
                                  {e.store}
                                  {rec?.boxes != null && (
                                    <span className="ml-1.5 text-gray-400 font-normal">{rec.boxes}箱</span>
                                  )}
                                </span>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {e.estDelivery && (
                                    <span className="text-gray-400 text-[10px]">{e.estDelivery}</span>
                                  )}
                                  <div className="relative">
                                    <button
                                      onClick={() => requireAuth(() => setEditingStoreId(id => id === e.id ? null : e.id))}
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium hover:opacity-75 transition-opacity ${
                                        e.deliveryStatus === '已送達' ? 'bg-green-100 text-green-700' :
                                        e.deliveryStatus === '配送中' ? 'bg-blue-100 text-blue-700' :
                                        'bg-gray-100 text-gray-500'
                                      }`}
                                    >
                                      {savingId === e.id ? '⋯' : (e.deliveryStatus ?? '待配送')}
                                    </button>
                                    {editingStoreId === e.id && (
                                      <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 py-1 min-w-[90px]">
                                        {STORE_STATUSES.map(s => (
                                          <button
                                            key={s}
                                            disabled={savingId === e.id}
                                            onClick={() => saveStoreStatus(e.id, s)}
                                            className={`w-full text-left px-2.5 py-1.5 text-[10px] hover:bg-gray-50 ${s === (e.deliveryStatus ?? '待配送') ? 'font-semibold text-lopia-red' : 'text-gray-700'}`}
                                          >{s}</button>
                                        ))}
                                        <button
                                          onClick={() => setEditingStoreId(null)}
                                          className="w-full text-center px-2.5 py-1 text-[10px] text-gray-400 border-t border-gray-100 hover:bg-gray-50"
                                        >取消</button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              )
                            })}
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

        {/* ── Password modal overlay ──────────────────────────── */}
        {showPwModal && (
          <div className="absolute inset-0 bg-black/40 z-60 flex items-center justify-center p-6">
            <div className="bg-white rounded-2xl p-5 w-full max-w-xs shadow-xl">
              <p className="font-semibold text-gray-800 mb-1">需要編輯密碼</p>
              <p className="text-xs text-gray-400 mb-4">輸入密碼後可修改狀態</p>
              <form onSubmit={handlePwSubmit} className="space-y-3">
                <input
                  type="password"
                  value={pwInput}
                  onChange={e => setPwInput(e.target.value)}
                  autoFocus
                  placeholder="密碼"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
                />
                {pwError && <p className="text-red-500 text-xs">{pwError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowPwModal(false); setPwInput(''); setPwError(''); setPendingEdit(null) }}
                    className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50"
                  >取消</button>
                  <button
                    type="submit"
                    disabled={pwLoading}
                    className="flex-1 py-2 rounded-xl bg-lopia-red text-white text-sm font-medium disabled:opacity-50"
                  >{pwLoading ? '⋯' : '確認'}</button>
                </div>
              </form>
            </div>
          </div>
        )}
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
                        <span className="text-[10px] flex-shrink-0">{MARKER_ICON[m.type]}</span>
                        <span className="truncate">
                          {m.type}{m.count > 0 ? ` ${m.count}間` : ''}
                        </span>
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
