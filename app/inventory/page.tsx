'use client'
import { useState, useEffect, useCallback } from 'react'
import PasswordModal, { isAuthed } from '@/components/PasswordModal'
import { STORES } from '@/lib/stores'

interface InventoryItem {
  id: string
  code: string
  name: string
  spec: string
  stock: number
  unit: string
  temperature: string
  lastUpdated: string | null
}

// 庫存數量顏色（多→少）
function stockColor(n: number) {
  if (n <= 0) return 'text-gray-400'
  if (n <= 5) return 'text-red-500 font-bold'
  if (n <= 20) return 'text-amber-600 font-semibold'
  return 'text-emerald-600 font-semibold'
}

const openStores = STORES.filter(s => s.status === 'open').map(s => s.name)

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authed, setAuthed] = useState(false)

  // 訂單表單
  const [orderStore, setOrderStore] = useState('')
  const [orderProduct, setOrderProduct] = useState('')
  const [orderQty, setOrderQty] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [orderNote, setOrderNote] = useState('')
  const [orderSubmitting, setOrderSubmitting] = useState(false)
  const [orderMsg, setOrderMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Excel 上傳
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/inventory')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setItems(data.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '讀取失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setAuthed(isAuthed())
    load()
  }, [load])

  // 格式化最後更新時間
  const lastSync = items.find(i => i.lastUpdated)?.lastUpdated
  const lastSyncLabel = lastSync
    ? new Date(lastSync).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '尚未同步'

  // ── 上傳 Excel ─────────────────────────────────────────────────────────
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/inventory/sync', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSyncMsg(`同步完成：更新 ${data.updated} 筆 / 新增 ${data.created} 筆`)
      load()
    } catch (err) {
      setSyncMsg(`錯誤：${err instanceof Error ? err.message : '上傳失敗'}`)
    } finally {
      setSyncing(false)
      e.target.value = ''
    }
  }

  // ── 觸發 Gmail 拉取 ────────────────────────────────────────────────────
  async function handleGmailSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/inventory/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSyncMsg(`從 Gmail 同步完成：更新 ${data.updated} 筆 / 新增 ${data.created} 筆`)
      load()
    } catch (err) {
      setSyncMsg(`錯誤：${err instanceof Error ? err.message : 'Gmail 同步失敗'}`)
    } finally {
      setSyncing(false)
    }
  }

  // ── 送出訂單 ───────────────────────────────────────────────────────────
  async function handleOrder(e: React.FormEvent) {
    e.preventDefault()
    if (!orderStore || !orderProduct || !orderQty) return
    setOrderSubmitting(true)
    setOrderMsg(null)
    try {
      const selectedItem = items.find(i => i.name === orderProduct)
      const productText = selectedItem
        ? `${selectedItem.name}（${selectedItem.spec}）`
        : orderProduct

      const res = await fetch('/api/demand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: orderStore,
          product: productText,
          quantity: `${orderQty} ${selectedItem?.unit ?? '箱'}`,
          needDate: orderDate || null,
          note: orderNote || undefined,
          status: '待處理',
          source: 'LOPIA',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOrderMsg({ ok: true, text: '訂單送出成功！我們收到後會安排出貨。' })
      setOrderStore(''); setOrderProduct(''); setOrderQty(''); setOrderDate(''); setOrderNote('')
    } catch (err) {
      setOrderMsg({ ok: false, text: err instanceof Error ? err.message : '送出失敗，請再試一次' })
    } finally {
      setOrderSubmitting(false)
    }
  }

  const selectedItem = items.find(i => i.name === orderProduct)

  return (
    <div className="min-h-screen bg-gray-50">
      <PasswordModal onAuth={() => setAuthed(true)} />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <div className="w-2 h-6 bg-lopia-red rounded-full" />
        <h1 className="text-base font-bold text-gray-800">庫存查詢 ／ 線上訂單</h1>
        <span className="ml-auto text-xs text-gray-400">最後更新：{lastSyncLabel}</span>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* ── 庫存列表 ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-700">現有庫存</h2>
            {/* 管理員才看到 sync 控制 */}
            {authed && (
              <div className="flex items-center gap-2">
                <label className={`cursor-pointer text-xs px-3 py-1 rounded-lg border font-medium
                  ${syncing ? 'opacity-50 cursor-not-allowed bg-gray-100 border-gray-200 text-gray-400'
                            : 'bg-white border-gray-300 text-gray-600 hover:border-lopia-red hover:text-lopia-red'}`}>
                  {syncing ? '同步中…' : '上傳 Excel'}
                  <input type="file" accept=".xlsx" className="hidden" onChange={handleUpload} disabled={syncing} />
                </label>
                <button
                  onClick={handleGmailSync}
                  disabled={syncing}
                  className={`text-xs px-3 py-1 rounded-lg border font-medium
                    ${syncing ? 'opacity-50 cursor-not-allowed bg-gray-100 border-gray-200 text-gray-400'
                              : 'bg-white border-gray-300 text-gray-600 hover:border-lopia-red hover:text-lopia-red'}`}>
                  從 Gmail 同步
                </button>
              </div>
            )}
          </div>

          {syncMsg && (
            <p className={`text-xs mb-3 px-3 py-2 rounded-lg ${syncMsg.startsWith('錯誤') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
              {syncMsg}
            </p>
          )}

          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">讀取中…</p>
          ) : error ? (
            <p className="text-sm text-red-500 text-center py-8">{error}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">庫存資料尚未同步</p>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 font-semibold">
                    <th className="text-left px-4 py-2.5">商品名稱</th>
                    <th className="text-left px-4 py-2.5 hidden sm:table-cell">規格</th>
                    <th className="text-right px-4 py-2.5">庫存</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map(item => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{item.name}</div>
                        <div className="text-xs text-gray-400 sm:hidden">{item.spec}</div>
                        {item.temperature && (
                          <span className={`inline-block text-xs px-1.5 py-0.5 rounded mt-1 font-medium
                            ${item.temperature === '冷藏品' ? 'bg-blue-50 text-blue-600'
                            : item.temperature === '冷凍品' ? 'bg-purple-50 text-purple-600'
                            : 'bg-green-50 text-green-600'}`}>
                            {item.temperature}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{item.spec}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${stockColor(item.stock)}`}>
                        {item.stock} {item.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── 線上訂單 ─────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-bold text-gray-700 mb-3">線上訂單</h2>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-xs text-gray-500 mb-4">填寫後直接送出，不需要 Excel。</p>

            {orderMsg && (
              <div className={`text-sm mb-4 px-4 py-3 rounded-lg ${orderMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {orderMsg.text}
              </div>
            )}

            <form onSubmit={handleOrder} className="space-y-4">
              {/* 門市 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">門市 <span className="text-red-500">*</span></label>
                <select
                  value={orderStore}
                  onChange={e => setOrderStore(e.target.value)}
                  required
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lopia-red focus:border-transparent">
                  <option value="">選擇門市…</option>
                  {openStores.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* 商品 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">商品 <span className="text-red-500">*</span></label>
                <select
                  value={orderProduct}
                  onChange={e => setOrderProduct(e.target.value)}
                  required
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lopia-red focus:border-transparent">
                  <option value="">選擇商品…</option>
                  {items.filter(i => i.stock > 0).map(i => (
                    <option key={i.id} value={i.name}>
                      {i.name}（{i.spec}）— 庫存 {i.stock} {i.unit}
                    </option>
                  ))}
                  {items.filter(i => i.stock <= 0).length > 0 && (
                    <optgroup label="庫存不足（仍可填寫）">
                      {items.filter(i => i.stock <= 0).map(i => (
                        <option key={i.id} value={i.name}>
                          {i.name}（{i.spec}）— 庫存 0
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {selectedItem && selectedItem.stock <= 5 && selectedItem.stock > 0 && (
                  <p className="text-xs text-amber-600 mt-1">⚠ 庫存剩餘 {selectedItem.stock} {selectedItem.unit}，請注意數量。</p>
                )}
                {selectedItem && selectedItem.stock <= 0 && (
                  <p className="text-xs text-red-500 mt-1">此商品目前庫存為 0，訂單仍會送出供安排補貨。</p>
                )}
              </div>

              {/* 數量 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">數量（箱） <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min="1"
                  value={orderQty}
                  onChange={e => setOrderQty(e.target.value)}
                  required
                  placeholder="請輸入箱數"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lopia-red focus:border-transparent" />
              </div>

              {/* 需求日期 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">需求日期</label>
                <input
                  type="date"
                  value={orderDate}
                  onChange={e => setOrderDate(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lopia-red focus:border-transparent" />
              </div>

              {/* 備註 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">備註</label>
                <input
                  type="text"
                  value={orderNote}
                  onChange={e => setOrderNote(e.target.value)}
                  placeholder="特殊說明或要求（選填）"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lopia-red focus:border-transparent" />
              </div>

              <button
                type="submit"
                disabled={orderSubmitting}
                className={`w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-colors
                  ${orderSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-lopia-red hover:bg-lopia-red-dark'}`}>
                {orderSubmitting ? '送出中…' : '送出訂單'}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}
