'use client'
import { useState } from 'react'
import { Lang, t } from '@/lib/i18n'
import { STORES } from '@/lib/stores'
import { Shipment, ShipmentRecord } from '@/lib/notion'

interface Props {
  lang: Lang
  allRecords: ShipmentRecord[]
  shipments: Shipment[]
}

interface StoreType {
  id: string
  name_zh: string
  name_ja: string
  city_zh: string
  address_zh: string
  opened: string
  status: string
}

export default function StoreList({ lang, allRecords, shipments }: Props) {
  const T = t[lang]
  const isJa = lang === 'ja'
  const [selectedStore, setSelectedStore] = useState<StoreType | null>(null)

  const open   = STORES.filter(s => s.status === 'open')
  const coming = STORES.filter(s => s.status === 'coming_soon')
  const cities = [...new Set(open.map(s => s.city_zh))]

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Get future delivery records for a store name
  function getFutureDeliveries(storeName: string) {
    return allRecords
      .filter(r => {
        if (r.store !== storeName) return false
        if (r.planStatus === '已取消') return false
        if (!r.date) return false
        return new Date(r.date) >= today
      })
      .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())
  }

  function getBatchName(batchId: string | null) {
    if (!batchId) return '—'
    return shipments.find(s => s.id === batchId)?.ivName ?? '—'
  }

  function getProductSummary(batchId: string | null) {
    if (!batchId) return null
    return shipments.find(s => s.id === batchId)?.productSummary ?? null
  }

  function fmtDate(d: string) {
    const dt = new Date(d)
    return isJa
      ? `${dt.getMonth()+1}月${dt.getDate()}日`
      : `${dt.getMonth()+1}/${dt.getDate()}`
  }

  const storeName = selectedStore
    ? (isJa ? selectedStore.name_ja : selectedStore.name_zh)
    : ''
  const deliveries = selectedStore ? getFutureDeliveries(isJa ? selectedStore.name_ja : selectedStore.name_zh) : []

  return (
    <div className="relative">
      {/* Store list */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <span className="text-lopia-red text-lg">🏪</span>
          <h2 className="font-bold text-gray-800">{T.storeList}</h2>
          <span className="ml-auto text-xs text-gray-400">
            {open.length} {T.openStores} / {coming.length} {T.comingSoon}
          </span>
        </div>

        <div className="p-4 space-y-4">
          {/* Open stores */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">{T.openStores}</p>
            <div className="space-y-3">
              {cities.map(city => (
                <div key={city}>
                  <p className="text-xs text-lopia-red font-medium mb-1">{city}</p>
                  <div className="space-y-1">
                    {open.filter(s => s.city_zh === city).map(store => {
                      const sName = isJa ? store.name_ja : store.name_zh
                      const futureCount = getFutureDeliveries(sName).length
                      const isActive = selectedStore?.id === store.id
                      return (
                        <button
                          key={store.id}
                          type="button"
                          onClick={() => setSelectedStore(isActive ? null : store)}
                          className={`w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 transition-all
                            ${isActive
                              ? 'bg-lopia-red text-white'
                              : 'bg-gray-50 hover:bg-red-50 hover:text-lopia-red'
                            }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isActive ? 'text-white' : 'text-gray-800'}`}>
                              {sName}
                            </p>
                            <p className={`text-xs truncate ${isActive ? 'text-red-100' : 'text-gray-400'}`}>
                              {store.address_zh}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {futureCount > 0 && (
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium
                                ${isActive ? 'bg-white text-lopia-red' : 'bg-lopia-red text-white'}`}>
                                {futureCount}
                              </span>
                            )}
                            <span className={`text-xs ${isActive ? 'text-red-200' : 'text-gray-300'}`}>›</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Coming soon */}
          {coming.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">{T.comingSoon}</p>
              <div className="space-y-1">
                {coming.map(store => {
                  const sName = isJa ? store.name_ja : store.name_zh
                  const futureCount = getFutureDeliveries(sName).length
                  const isActive = selectedStore?.id === store.id
                  return (
                    <button
                      key={store.id}
                      type="button"
                      onClick={() => setSelectedStore(isActive ? null : store)}
                      className={`w-full text-left flex items-center gap-2 border border-dashed rounded-lg px-3 py-2 transition-all
                        ${isActive
                          ? 'bg-yellow-500 border-yellow-500'
                          : 'border-gray-200 hover:border-yellow-300 hover:bg-yellow-50'
                        }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isActive ? 'text-white' : 'text-gray-600'}`}>
                          {sName}
                        </p>
                        <p className={`text-xs truncate ${isActive ? 'text-yellow-100' : 'text-gray-400'}`}>
                          {store.address_zh}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {futureCount > 0 ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium
                            ${isActive ? 'bg-white text-yellow-600' : 'bg-yellow-400 text-white'}`}>
                            {futureCount}
                          </span>
                        ) : (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full
                            ${isActive ? 'bg-yellow-300 text-white' : 'bg-yellow-100 text-yellow-700'}`}>
                            {isJa ? 'まもなく' : '即將'}
                          </span>
                        )}
                        <span className={`text-xs ${isActive ? 'text-yellow-200' : 'text-gray-300'}`}>›</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Side panel overlay */}
      {selectedStore && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setSelectedStore(null)}
          />

          {/* Drawer */}
          <div className="fixed top-0 right-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 bg-white">
              <div>
                <h3 className="font-bold text-gray-900 text-base">{storeName}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {isJa ? '今後の出荷予定' : '未來出貨時程'}
                </p>
              </div>
              <button
                onClick={() => setSelectedStore(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 text-xl transition-colors"
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {deliveries.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                  <span className="text-3xl mb-2">📭</span>
                  <p className="text-sm">{isJa ? '予定はありません' : '目前無未來出貨計畫'}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {deliveries.map((r, i) => {
                    const batchName = getBatchName(r.batchId)
                    const summary   = getProductSummary(r.batchId)
                    const isPlan    = r.planStatus === '計畫中' || !r.planStatus
                    return (
                      <div key={r.id ?? i}
                        className="border border-gray-100 rounded-xl p-3 bg-white hover:border-lopia-red/30 transition-colors">
                        {/* Date + round */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lopia-red font-bold text-sm">
                              {fmtDate(r.date!)}
                            </span>
                            {r.round != null && (
                              <span className="text-xs text-gray-400">
                                {isJa ? `第${r.round}回` : `第 ${r.round} 次`}
                              </span>
                            )}
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                            ${isPlan
                              ? 'bg-blue-50 text-blue-600'
                              : 'bg-green-50 text-green-600'
                            }`}>
                            {r.planStatus ?? '計畫中'}
                          </span>
                        </div>

                        {/* Batch name */}
                        <p className="text-xs font-semibold text-gray-700 truncate">{batchName}</p>

                        {/* Product summary */}
                        {summary && (
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{summary}</p>
                        )}

                        {/* Boxes */}
                        {r.boxes != null && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                            <span>📦</span>
                            <span className="font-semibold text-gray-700">{r.boxes}</span>
                            <span>{isJa ? '箱' : '箱'}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-400 text-center">
                {isJa ? `${deliveries.length}件の出荷予定` : `共 ${deliveries.length} 筆未來出貨計畫`}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
