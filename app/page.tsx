'use client'
import { useEffect, useState, useCallback } from 'react'
import { Shipment, ShipmentRecord, LogisticsEvent } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import Header from '@/components/Header'
import ShipmentCard from '@/components/ShipmentCard'
import StoreList from '@/components/StoreList'
import AddBatchForm from '@/components/AddBatchForm'
import CalendarView from '@/components/CalendarView'

type Tab = 'shipments' | 'stores'

// ── Month-grouped list ──────────────────────────────────────
function MonthGroupedList({
  shipments, lang, allRecords, onRecordChange,
}: {
  shipments: Shipment[]
  lang: Lang
  allRecords: ShipmentRecord[]
  onRecordChange: () => void
}) {
  // Group by YYYY-MM based on arrivalTW
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
          {/* Sticky month header */}
          <div className="sticky top-14 z-20 -mx-4 px-4 py-2 mb-3
            bg-gray-50/95 backdrop-blur-sm border-b border-gray-200">
            <span className="text-sm font-bold text-gray-700">{group.label}</span>
            <span className="ml-2 text-xs text-gray-400 font-normal">{group.items.length}</span>
          </div>
          {/* Full-width cards */}
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
  const [tab, setTab] = useState<Tab>('shipments')
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all')

  const T = t[lang]

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [shipmentsRes, recordsRes, logisticsRes] = await Promise.all([
        fetch('/api/shipments', { cache: 'no-store' }),
        fetch('/api/records',   { cache: 'no-store' }),
        fetch('/api/logistics', { cache: 'no-store' }),
      ])
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

  // Filter + sort by arrivalTW ascending (earliest first), nulls last
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

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'shipments', label: T.shipments, icon: '📦' },
    { key: 'stores',    label: T.stores,    icon: '🏪' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        lang={lang}
        setLang={setLang}
        lastUpdated={data?.lastUpdated ?? null}
        onRefresh={fetchData}
      />

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Tab navigation */}
        <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 mb-4 w-fit">
          {tabs.map(tab_ => (
            <button
              key={tab_.key}
              onClick={() => setTab(tab_.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === tab_.key
                  ? 'bg-lopia-red text-white shadow'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>{tab_.icon}</span>
              {tab_.label}
            </button>
          ))}
        </div>

        {/* Shipments tab */}
        {tab === 'shipments' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
              <AddBatchForm lang={lang} onBatchAdded={fetchData} />

              {/* List / Calendar toggle */}
              <div className="flex gap-0.5 bg-white border border-gray-200 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    viewMode === 'list' ? 'bg-lopia-red text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  ☰ {T.listView}
                </button>
                <button
                  onClick={() => setViewMode('calendar')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    viewMode === 'calendar' ? 'bg-lopia-red text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  📅 {T.calendarView}
                </button>
              </div>

              {/* Search + filter (list mode only) */}
              {viewMode === 'list' && (<>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={T.search}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red bg-white"
                />
                <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
                  {(['all', 'active', 'done'] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        filter === f ? 'bg-lopia-red text-white' : 'text-gray-500 hover:text-gray-700'
                      }`}>
                      {f === 'all' ? T.filterAll : f === 'active' ? T.filterActive : T.filterDone}
                    </button>
                  ))}
                </div>
              </>)}
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-lopia-red border-t-transparent rounded-full animate-spin" />
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
