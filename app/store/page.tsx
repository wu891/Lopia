'use client'
// 門市庫存入口頁 — 門市員工自助查詢
// 功能：選擇門市 → 查看即將到貨 / 倉庫庫存
// 不需要 Colin 密碼；門市選擇存在 localStorage，重開頁面不用再選
import { useState, useEffect, useCallback } from 'react'
import { STORES } from '@/lib/stores'

// ── 型別定義 ──────────────────────────────────────────────────────────────────
interface ShipmentRecord {
  id: string
  shipmentNo: string
  batchId: string | null
  store: string | null
  date: string | null
  boxes: number | null
  round: number | null
  planStatus: string | null
}

interface Batch {
  id: string
  ivName: string
  productSummary: string | null
  warehouseIn: string | null
  deliveryStatus: string | null
}

interface InventoryItem {
  id: string
  name: string
  spec: string
  stock: number
  unit: string
  lastUpdated: string | null
}

type Tab = 'incoming' | 'inventory'

// ── 工具函式 ──────────────────────────────────────────────────────────────────
function todayTW(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00+08:00')
  const m = dt.getMonth() + 1
  const day = dt.getDate()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${m}月${day}日（週${weekdays[dt.getDay()]}）`
}

function statusBadge(status: string | null) {
  const map: Record<string, string> = {
    '已完成':  'bg-green-50 text-green-700 border-green-200',
    '已安排':  'bg-blue-50 text-blue-700 border-blue-200',
    '待處理':  'bg-amber-50 text-amber-700 border-amber-200',
    '待確認':  'bg-gray-50 text-gray-500 border-gray-200',
    '計畫中':  'bg-blue-50 text-blue-600 border-blue-200',
    '已取消':  'bg-gray-50 text-gray-400 border-gray-100',
  }
  return map[status ?? ''] ?? 'bg-gray-50 text-gray-500 border-gray-200'
}

function stockColor(n: number) {
  if (n <= 0)  return 'text-gray-300'
  if (n <= 10) return 'text-red-500 font-bold'
  if (n <= 30) return 'text-amber-500 font-semibold'
  return 'text-emerald-600 font-semibold'
}

const OPEN_STORES = STORES.filter(s => s.status === 'open')

// ── 選門市畫面 ────────────────────────────────────────────────────────────────
function StoreSelector({ onSelect }: { onSelect: (name: string) => void }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 頁頂 */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-lopia-red rounded-xl flex items-center justify-center flex-shrink-0">
          <span className="text-white text-sm font-bold tracking-tight">L</span>
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-800">LOPIA 門市庫存通</h1>
          <p className="text-xs text-gray-400">請選擇你的門市</p>
        </div>
      </div>

      {/* 門市列表 */}
      <div className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <p className="text-xs text-gray-400 mb-4">
          選擇後可查看即將到貨商品、倉庫庫存，以及提交進貨需求。
        </p>
        <div className="space-y-2">
          {OPEN_STORES.map(store => (
            <button
              key={store.id}
              onClick={() => onSelect(store.name_zh)}
              className="w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3.5
                hover:border-lopia-red hover:shadow-sm transition-all active:bg-gray-50 group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-800 text-sm group-hover:text-lopia-red transition-colors">
                    {store.name_zh}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{store.city_zh}</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className="text-gray-300 group-hover:text-lopia-red transition-colors flex-shrink-0">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 主要頁面元件 ──────────────────────────────────────────────────────────────
export default function StorePage() {
  const [selectedStore, setSelectedStore] = useState<string | null>(null)
  const [records, setRecords]       = useState<ShipmentRecord[]>([])
  const [batches, setBatches]       = useState<Batch[]>([])
  const [inventory, setInventory]   = useState<InventoryItem[]>([])
  const [loading, setLoading]       = useState(false)
  const [activeTab, setActiveTab]   = useState<Tab>('incoming')

  // 從 localStorage 讀取上次選的門市
  useEffect(() => {
    const saved = localStorage.getItem('lopia_store_portal')
    if (saved && OPEN_STORES.some(s => s.name_zh === saved)) {
      setSelectedStore(saved)
    }
  }, [])

  function selectStore(name: string) {
    localStorage.setItem('lopia_store_portal', name)
    setSelectedStore(name)
  }

  function clearStore() {
    localStorage.removeItem('lopia_store_portal')
    setSelectedStore(null)
    setActiveTab('incoming')
  }

  // 讀取資料（批次、出貨紀錄、庫存）
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [recRes, shiRes, invRes] = await Promise.all([
        fetch('/api/records',   { cache: 'no-store' }),
        fetch('/api/shipments', { cache: 'no-store' }),
        fetch('/api/inventory', { cache: 'no-store' }),
      ])
      const [r, s, inv] = await Promise.all([
        recRes.json(), shiRes.json(), invRes.json(),
      ])
      setRecords(r.records ?? [])
      setBatches(s.shipments ?? [])
      setInventory(inv.items ?? [])
    } catch (e) {
      console.error('[StorePage fetchData]', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedStore) fetchData()
  }, [selectedStore, fetchData])

  // ── 沒選門市就顯示選門市畫面 ─────────────────────────────────────────────
  if (!selectedStore) return <StoreSelector onSelect={selectStore} />

  const today = todayTW()

  // 這家門市的未來出貨紀錄（今天 + 未來，排除已取消）
  const storeRecords = records
    .filter(r =>
      r.store === selectedStore &&
      r.date && r.date >= today &&
      r.planStatus !== '已取消'
    )
    .sort((a, b) => (a.date ?? '') < (b.date ?? '') ? -1 : 1)

  function getBatch(batchId: string | null): Batch | null {
    return batches.find(b => b.id === batchId) ?? null
  }

  const store = STORES.find(s => s.name_zh === selectedStore)

  const lastSync = inventory.find(i => i.lastUpdated)?.lastUpdated

  // ── 頁面本體 ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── 頁頂 ── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-lopia-red rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">L</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-gray-800 text-sm leading-tight truncate">
              {selectedStore}
            </h1>
            <p className="text-[11px] text-gray-400">{store?.city_zh} · 庫存通知</p>
          </div>
          <button
            onClick={clearStore}
            className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200
              px-2.5 py-1 rounded-md hover:border-gray-300 transition-colors whitespace-nowrap"
          >
            換門市
          </button>
        </div>

        {/* ── Tab 列 ── */}
        <div className="max-w-lg mx-auto grid grid-cols-2 border-t border-gray-100">
          {(
            [
              ['incoming',  '即將到貨', storeRecords.length],
              ['inventory', '倉庫庫存', inventory.length],
            ] as [Tab, string, number][]
          ).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors
                flex items-center justify-center gap-1.5 ${
                  activeTab === key
                    ? 'border-lopia-red text-lopia-red'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              {label}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  activeTab === key
                    ? 'bg-lopia-red text-white'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── 內容區 ── */}
      <div className="max-w-lg mx-auto px-4 py-4">

        {/* 載入中 */}
        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-lopia-red border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && (
          <>
            {/* ══ 即將到貨 ══ */}
            {activeTab === 'incoming' && (
              <div className="space-y-3">
                {storeRecords.length === 0 ? (
                  <div className="text-center py-14">
                    <svg className="mx-auto mb-3 opacity-20" width="40" height="40" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                      <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <p className="text-sm text-gray-400">目前沒有排定的到貨計畫</p>
                    <p className="text-xs text-gray-300 mt-1">有新的出貨計畫時會在這裡顯示</p>
                  </div>
                ) : (
                  storeRecords.map(rec => {
                    const batch = getBatch(rec.batchId)
                    const isToday = rec.date === today
                    return (
                      <div
                        key={rec.id}
                        className={`bg-white border rounded-xl p-4 ${
                          isToday ? 'border-lopia-red shadow-sm' : 'border-gray-200'
                        }`}
                      >
                        {/* 商品 + 箱數 */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              {isToday && (
                                <span className="text-[11px] font-bold text-white bg-lopia-red px-2 py-0.5 rounded-full">
                                  今日到貨
                                </span>
                              )}
                              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${statusBadge(rec.planStatus)}`}>
                                {rec.planStatus ?? '計畫中'}
                              </span>
                            </div>
                            {/* 商品名稱優先顯示 productSummary，否則顯示批次名稱 */}
                            <p className="text-sm font-semibold text-gray-800 leading-tight">
                              {batch?.productSummary ?? batch?.ivName ?? '—'}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              批次：{batch?.ivName ?? rec.batchId?.slice(0, 8) ?? '—'}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-2xl font-bold text-lopia-red leading-none">
                              {rec.boxes ?? '?'}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">箱</p>
                          </div>
                        </div>

                        {/* 日期 + 輪次 */}
                        <div className="flex items-center gap-4 mt-2.5 pt-2.5 border-t border-gray-100">
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="4" width="18" height="18" rx="2"/>
                              <line x1="16" y1="2" x2="16" y2="6"/>
                              <line x1="8" y1="2" x2="8" y2="6"/>
                              <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            {formatDate(rec.date)}
                          </div>
                          {rec.round != null && (
                            <span className="text-xs text-gray-400">第 {rec.round} 輪</span>
                          )}
                          <span className="text-xs text-gray-300 ml-auto">{rec.shipmentNo}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {/* ══ 倉庫庫存 ══ */}
            {activeTab === 'inventory' && (
              <div className="space-y-3">
                {/* 庫存日期說明 */}
                {lastSync && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      className="text-amber-600 mt-0.5 flex-shrink-0">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <p className="text-xs text-amber-800">
                      此為倉庫整體庫存，非本店專屬。
                      最後更新：{new Date(lastSync).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' })}
                    </p>
                  </div>
                )}

                {inventory.length === 0 ? (
                  <div className="text-center py-14 text-gray-400">
                    <p className="text-sm">庫存資料尚未同步</p>
                    <p className="text-xs mt-1 text-gray-300">請聯絡 TMJ 業務</p>
                  </div>
                ) : (
                  inventory.map(item => (
                    <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{item.name}</p>
                        {item.spec && <p className="text-xs text-gray-400 mt-0.5">{item.spec}</p>}
                      </div>
                      <div className="text-right">
                        <p className={`text-xl font-bold ${stockColor(item.stock)}`}>
                          {item.stock > 0 ? item.stock : '—'}
                        </p>
                        <p className="text-xs text-gray-400">{item.unit}</p>
                        {item.stock <= 0 && (
                          <p className="text-[10px] text-gray-300">目前無庫存</p>
                        )}
                        {item.stock > 0 && item.stock <= 10 && (
                          <p className="text-[10px] text-red-500 font-medium">庫存偏低</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

          </>
        )}
      </div>
    </div>
  )
}
