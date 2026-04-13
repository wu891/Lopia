'use client'
import { useEffect, useState, useCallback } from 'react'
import { Shipment, ShipmentRecord, LogisticsEvent } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import Header from '@/components/Header'
import ShipmentCard from '@/components/ShipmentCard'
import CompactShipmentRow from '@/components/CompactShipmentRow'
import StoreList from '@/components/StoreList'
import AddBatchForm from '@/components/AddBatchForm'
import CalendarView from '@/components/CalendarView'

type Tab = 'shipments' | 'stores'

// ── Month-grouped list ──────────────────────────────────────
function MonthGroupedList({
  shipments, lang, allRecords, onRecordChange, compact = false,
}: {
  shipments: Shipment[]
  lang: Lang
  allRecords: ShipmentRecord[]
  onRecordChange: () => void
  compact?: boolean
}) {
  const groups: { monthKey: string; label: string; items: Shipment[] }[] = []
  for (const s of shipments) {
    let monthKey = 'no-date'
    let label = lang === 'ja' ? '日付なし' : '未定日期'
    if (s.arrivalTW) {
      const [y, m] = s.arrivalTW.split('-').map(Number)
      monthKey = `${y}-${String(m).padStart(2, '0')}`
      label = lang === 'ja' ? `${y}年${m}月` : `${y} 年 ${m} 月`
    }
    const existing = groups.find(g => g.monthKey === monthKey)
    if (existing) existing.items.push(s)
    else groups.push({ monthKey, label, items: [s] })
  }

  return (
    <div>
      {groups.map(group => (
        <div key={group.monthKey} className="mb-6">
          <div className={`sticky top-14 z-20 -mx-4 px-4 py-2 mb-3
            bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 flex items-center gap-2`}>
            <span className="text-sm font-bold text-gray-700">{group.label}</span>
            <span className="text-xs text-gray-400 font-normal">{group.items.length}</span>
          </div>

          {compact ? (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden divide-y divide-gray-100">
              {group.items.map(s => (
                <CompactShipmentRow
                  key={s.id}
                  shipment={s}
                  lang={lang}
                  allRecords={allRecords}
                  onRecordChange={onRecordChange}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {group.items.map(s => (
                <ShipmentCard
                  key={s.id}
                  shipment={s}
                  lang={lang}
                  allRecords={allRecords}
                  onRecordChange={onRecordChange}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

interface ApiData {
  shipments: Shipment[]
  lastUpdated: string
}

interface RecordsData {
  records: ShipmentRecord[]
}

interface LogisticsData {
  events: LogisticsEvent[]
}

export default function Home() {
  const [lang, setLang] = useState<Lang>('zh')
  const [data, setData] = useState<ApiData | null>(null)
  const [recordsData, setRecordsData] = useState<RecordsData | null>(null)
  const [logisticsData, setLogisticsData] = useState<LogisticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('shipments')
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all')

  const T = t[lang]

  const fetchData = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const [shipmentsRes, recordsRes, logisticsRes] = await Promise.all([
        fetch('/api/shipments', { cache: 'no-store' }),
        fetch('/api/records',   { cache: 'no-store' }),
        fetch('/api/logistics', { cache: 'no-store' }),
      ])
      if (!shipmentsRes.ok || !recordsRes.ok || !logisticsRes.ok) {
        throw new Error('API returned error status')
      }
      const [shipmentsJson, recordsJson, logisticsJson] = await Promise.all([
        shipmentsRes.json(),
        recordsRes.json(),
        logisticsRes.json(),
      ])
      setData(shipmentsJson)
      setRecordsData(recordsJson)
      setLogisticsData(logisticsJson)
    } catch (e) {
      console.error(e)
      setFetchError('資料載入失敗，請重新整理頁面')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshRecords = useCallback(async () => {
    try {
      const res = await fetch('/api/records', { cache: 'no-store' })
      const json = await res.json()
      setRecordsData(json)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchData])

  const allRecords = recordsData?.records ?? []

  const filtered = (data?.shipments ?? [])
    .filter(s => {
      const matchSearch = !search ||
        s.ivName.toLowerCase().includes(search.toLowerCase()) ||
        (s.productSummary ?? '').toLowerCase().includes(search.toLowerCase())
      const matchFilter =
        filter === 'all'    ? true :
        filter === 'active' ? s.deliveryStatus !== '全數出貨' :
        s.deliveryStatus === '全數出貨'
      return matchSearch && matchFilter
    })
    .sort((a, b) => {
      if (!a.arrivalTW && !b.arrivalTW) return 0
      if (!a.arrivalTW) return 1
      if (!b.arrivalTW) return -1
      return new Date(a.arrivalTW).getTime() - new Date(b.arrivalTW).getTime()
    })

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        lang={lang}
        setLang={setLang}
        lastUpdated={data?.lastUpdated ?? null}
        onRefresh={fetchData}
      />

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Underline Tab navigation */}
        <nav className="flex border-b border-gray-200 mb-4">
          <button
            onClick={() => setTab('shipments')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
              tab === 'shipments'
                ? 'border-lopia-red text-lopia-red'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
            {T.shipments}
          </button>
          <button
            onClick={() => setTab('stores')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
              tab === 'stores'
                ? 'border-lopia-red text-lopia-red'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            {T.stores}
          </button>
        </nav>

        {/* Shipments tab */}
        {tab === 'shipments' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
              <AddBatchForm lang={lang} onBatchAdded={fetchData} />

              {/* List / Calendar toggle */}
              <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    viewMode === 'list'
                      ? 'bg-lopia-red-light text-lopia-red'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                  {T.listView}
                </button>
                <button
                  onClick={() => setViewMode('calendar')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer border-l border-gray-200 ${
                    viewMode === 'calendar'
                      ? 'bg-lopia-red-light text-lopia-red'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  {T.calendarView}
                </button>
              </div>

              {/* Search + filter (list mode only) */}
              {viewMode === 'list' && (<>
                <div className="flex-1 relative min-w-0">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={T.search}
                    className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red bg-white"
                  />
                </div>
                <div className="flex gap-1">
                  {(['all', 'active', 'done'] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border cursor-pointer ${
                        filter === f
                          ? 'bg-lopia-red text-white border-lopia-red'
                          : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                      }`}>
                      {f === 'all' ? T.filterAll : f === 'active' ? T.filterActive : T.filterDone}
                    </button>
                  ))}
                </div>
              </>)}
            </div>

            {fetchError ? (
              <div className="flex items-center justify-center h-48">
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="text-sm text-red-500 font-medium">{fetchError}</p>
                  <button onClick={fetchData} className="px-4 py-1.5 bg-lopia-red text-white text-sm rounded-lg hover:bg-lopia-red-dark transition-colors">
                    重新載入
                  </button>
                </div>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="flex flex-col items-center gap-3">
                  {/* Skeleton cards */}
                  <div className="w-full max-w-2xl space-y-3">
                    {[1, 2].map(i => (
                      <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
                        <div className="flex justify-between mb-3">
                          <div className="h-4 bg-gray-200 rounded w-32" />
                          <div className="h-4 bg-gray-200 rounded w-16" />
                        </div>
                        <div className="flex gap-4 mb-3">
                          {[1,2,3,4].map(j => (
                            <div key={j} className="flex-1 flex flex-col items-center gap-1">
                              <div className="w-7 h-7 bg-gray-200 rounded-full" />
                              <div className="h-3 bg-gray-200 rounded w-10" />
                            </div>
                          ))}
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full" />
                      </div>
                    ))}
                  </div>
                  <span className="text-sm text-gray-400">{T.loading}</span>
                </div>
              </div>
            ) : viewMode === 'calendar' ? (
              <CalendarView
                shipments={data?.shipments ?? []}
                lang={lang}
                logisticsEvents={logisticsData?.events ?? []}
              />
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-gray-400 text-sm">{T.noData}</p>
              </div>
            ) : (
              <MonthGroupedList
                shipments={filtered}
                lang={lang}
                allRecords={allRecords}
                onRecordChange={refreshRecords}
                compact={filter === 'done'}
              />
            )}
          </div>
        )}

        {/* Stores tab */}
        {tab === 'stores' && (
          <StoreList
            lang={lang}
            allRecords={allRecords}
            shipments={data?.shipments ?? []}
          />
        )}
      </div>

      <footer className="mt-8 py-4 border-t border-gray-200 text-center">
        <p className="text-xs text-gray-300">
          LOPIA Taiwan Import Tracker · {T.autoRefresh}
        </p>
      </footer>
    </div>
  )
}
