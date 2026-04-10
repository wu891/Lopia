'use client'
import { useEffect, useState, useCallback } from 'react'
import { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import Header from '@/components/Header'
import ShipmentCard from '@/components/ShipmentCard'
import ScheduleParser from '@/components/ScheduleParser'
import FileUpload from '@/components/FileUpload'
import StoreList from '@/components/StoreList'

type Tab = 'shipments' | 'tools' | 'stores'

interface ApiData {
  shipments: Shipment[]
  lastUpdated: string
}

interface RecordsData {
  records: ShipmentRecord[]
}

export default function Home() {
  const [lang, setLang] = useState<Lang>('zh')
  const [data, setData] = useState<ApiData | null>(null)
  const [recordsData, setRecordsData] = useState<RecordsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('shipments')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all')

  const T = t[lang]

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [shipmentsRes, recordsRes] = await Promise.all([
        fetch('/api/shipments', { cache: 'no-store' }),
        fetch('/api/records', { cache: 'no-store' }),
      ])
      const [shipmentsJson, recordsJson] = await Promise.all([
        shipmentsRes.json(),
        recordsRes.json(),
      ])
      setData(shipmentsJson)
      setRecordsData(recordsJson)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Lightweight records-only refresh (after add/edit/delete)
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

  const filtered = (data?.shipments ?? []).filter(s => {
    const matchSearch = !search ||
      s.ivName.toLowerCase().includes(search.toLowerCase()) ||
      (s.productSummary ?? '').toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === 'all' ? true :
      filter === 'active' ? s.deliveryStatus !== '全數出貨' :
      s.deliveryStatus === '全數出貨'
    return matchSearch && matchFilter
  })

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'shipments', label: T.shipments, icon: '📦' },
    { key: 'tools', label: lang === 'ja' ? 'ツール' : '工具', icon: '🛠' },
    { key: 'stores', label: T.stores, icon: '🏪' },
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
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={T.search}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red bg-white"
              />
              <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
                {(['all', 'active', 'done'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      filter === f ? 'bg-lopia-red text-white' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {f === 'all' ? T.filterAll : f === 'active' ? T.filterActive : T.filterDone}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-lopia-red border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-gray-400">{T.loading}</span>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-gray-400 text-sm">{T.noData}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filtered.map(s => (
                  <ShipmentCard
                    key={s.id}
                    shipment={s}
                    lang={lang}
                    allRecords={allRecords}
                    onRecordChange={refreshRecords}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tools tab */}
        {tab === 'tools' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ScheduleParser lang={lang} shipments={data?.shipments ?? []} />
            <FileUpload lang={lang} shipments={data?.shipments ?? []} />
          </div>
        )}

        {/* Stores tab */}
        {tab === 'stores' && (
          <div className="max-w-2xl">
            <StoreList lang={lang} />
          </div>
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
