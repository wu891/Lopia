'use client'
import { useState, useEffect, useCallback, Fragment } from 'react'
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

const ORDER_STORES = STORES
  .filter(s => !!s.excelSheetName)
  .sort((a, b) => {
    const order = ['台中', '桃園', '中和', '新荘', '巨蛋', '南港', 'IKEA', '夢時', '北門', 'MOP', '中漢', '美麗', '北蛋']
    const ai = order.indexOf(a.excelSheetName ?? '')
    const bi = order.indexOf(b.excelSheetName ?? '')
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

type Category = '蘋果' | '地瓜加工品'
const CATEGORY_ORDER: Category[] = ['蘋果', '地瓜加工品']

// 品名含「地瓜」→ 地瓜加工品，其餘（Sunfuji 等）→ 蘋果
function getCategory(item: InventoryItem): Category {
  return item.name.includes('地瓜') ? '地瓜加工品' : '蘋果'
}

function stockColor(n: number) {
  if (n <= 0) return 'text-gray-400'
  if (n <= 5) return 'text-red-500 font-bold'
  if (n <= 20) return 'text-amber-600 font-semibold'
  return 'text-emerald-600'
}

function formatSyncDate(iso: string): string {
  const d = new Date(iso)
  const taipei = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
  const month = taipei.getMonth() + 1
  const day = taipei.getDate()
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][taipei.getDay()]
  return `${month}月${day}日（週${weekday}）`
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authed, setAuthed] = useState(false)
  const [showModal, setShowModal] = useState(false)

  // grid[productId][storeName] = 箱數
  const [grid, setGrid] = useState<Record<string, Record<string, number>>>({})

  // 訂單資訊
  const [shipDate, setShipDate] = useState('')
  const [roundNum, setRoundNum] = useState('')
  const [batchName, setBatchName] = useState('蘋果11')

  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const initGrid = useCallback((loadedItems: InventoryItem[]) => {
    const g: Record<string, Record<string, number>> = {}
    for (const item of loadedItems) {
      g[item.id] = Object.fromEntries(ORDER_STORES.map(s => [s.name_zh, 0]))
    }
    setGrid(g)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/inventory')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const loaded = data.items ?? []
      setItems(loaded)
      initGrid(loaded)
    } catch (e) {
      setError(e instanceof Error ? e.message : '讀取失敗')
    } finally {
      setLoading(false)
    }
  }, [initGrid])

  useEffect(() => {
    setAuthed(isAuthed())
    load()
  }, [load])

  const lastSync = items.find(i => i.lastUpdated)?.lastUpdated

  function setBox(productId: string, storeName: string, v: number) {
    setGrid(prev => ({
      ...prev,
      [productId]: { ...prev[productId], [storeName]: Math.max(0, v) },
    }))
  }

  function rowTotal(productId: string): number {
    return Object.values(grid[productId] ?? {}).reduce((a, b) => a + b, 0)
  }

  function colTotal(storeName: string): number {
    return items.reduce((sum, item) => sum + (grid[item.id]?.[storeName] ?? 0), 0)
  }

  function grandTotal(): number {
    return items.reduce((sum, item) => sum + rowTotal(item.id), 0)
  }

  async function handleSubmit() {
    if (!authed) { setShowModal(true); return }
    if (!shipDate) { setSubmitMsg({ ok: false, text: '請填寫出貨日期' }); return }
    if (grandTotal() === 0) { setSubmitMsg({ ok: false, text: '請至少填入一筆箱數' }); return }

    setSubmitting(true)
    setSubmitMsg(null)

    const note = roundNum ? `第${roundNum}回` : ''
    const rows = items.flatMap(item =>
      ORDER_STORES
        .filter(store => (grid[item.id]?.[store.name_zh] ?? 0) > 0)
        .map(store => ({
          store: store.name_zh,
          product: `${batchName} ${item.name}${item.spec ? `（${item.spec}）` : ''}`,
          quantity: `${grid[item.id][store.name_zh]} ${item.unit}`,
          needDate: shipDate,
          note,
          status: '待處理',
          source: 'LOPIA',
        }))
    )

    let ok = 0
    for (const row of rows) {
      const res = await fetch('/api/demand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      })
      if (res.ok) ok++
    }

    if (ok === rows.length) {
      setSubmitMsg({ ok: true, text: `成功送出 ${ok} 筆訂單！` })
      initGrid(items)
      setRoundNum('')
      setShipDate('')
    } else {
      setSubmitMsg({ ok: false, text: `${rows.length} 筆中 ${ok} 筆成功，請重試` })
    }
    setSubmitting(false)
  }

  async function handleGmailSync() {
    setSyncing(true); setSyncMsg(null)
    try {
      const res = await fetch('/api/inventory/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSyncMsg(`Gmail 同步完成：更新 ${data.updated} / 新增 ${data.created} 筆`)
      load()
    } catch (e) {
      setSyncMsg(`錯誤：${e instanceof Error ? e.message : '失敗'}`)
    } finally {
      setSyncing(false)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setSyncing(true); setSyncMsg(null)
    try {
      const form = new FormData(); form.append('file', file)
      const res = await fetch('/api/inventory/sync', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSyncMsg(`Excel 同步完成：更新 ${data.updated} / 新增 ${data.created} 筆`)
      load()
    } catch (e) {
      setSyncMsg(`錯誤：${e instanceof Error ? e.message : '失敗'}`)
    } finally {
      setSyncing(false); e.target.value = ''
    }
  }

  const orderCount = items.filter(i => rowTotal(i.id) > 0).length

  return (
    <div className="min-h-screen bg-gray-50">
      {showModal && (
        <PasswordModal
          onSuccess={() => { setAuthed(true); setShowModal(false) }}
          onCancel={() => setShowModal(false)}
        />
      )}

      {/* 頁頭 */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
        <div className="w-2 h-6 bg-lopia-red rounded-full" />
        <h1 className="text-base font-bold text-gray-800">線上訂單</h1>
        <div className="ml-auto">
          {authed ? (
            <span className="text-xs text-emerald-600 font-medium px-2 py-1 bg-emerald-50 rounded-lg">已登入</span>
          ) : (
            <button
              onClick={() => setShowModal(true)}
              className="text-xs text-gray-500 hover:text-lopia-red font-medium px-2.5 py-1 border border-gray-200 hover:border-lopia-red rounded-lg transition-colors">
              登入
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-4 space-y-3 max-w-full">

        {/* 庫存日期橫幅 */}
        {lastSync && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 mt-0.5 flex-shrink-0">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <p className="text-sm text-amber-800">
              目前庫存資料以 <span className="font-semibold">{formatSyncDate(lastSync)}</span> 優儲寄出的報表為準
            </p>
          </div>
        )}

        {/* 訂單資訊列 */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                出貨日期 <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={shipDate}
                onChange={e => setShipDate(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-lopia-red"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">回数</label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-500">第</span>
                <input
                  type="number" min="1" value={roundNum} onChange={e => setRoundNum(e.target.value)}
                  placeholder="11"
                  className="w-16 text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-lopia-red"
                />
                <span className="text-sm text-gray-500">回</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">批次名稱</label>
              <input
                type="text" value={batchName} onChange={e => setBatchName(e.target.value)}
                className="w-28 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-lopia-red"
              />
            </div>
            {authed && (
              <div className="flex items-end gap-2 ml-auto">
                <label className={`cursor-pointer text-xs px-2.5 py-1.5 rounded border font-medium
                  ${syncing ? 'opacity-40 bg-gray-50 border-gray-200 text-gray-400'
                            : 'bg-white border-gray-300 text-gray-600 hover:border-lopia-red hover:text-lopia-red'}`}>
                  {syncing ? '…' : '上傳 Excel'}
                  <input type="file" accept=".xlsx" className="hidden" onChange={handleUpload} disabled={syncing} />
                </label>
                <button onClick={handleGmailSync} disabled={syncing}
                  className={`text-xs px-2.5 py-1.5 rounded border font-medium
                    ${syncing ? 'opacity-40 bg-gray-50 border-gray-200 text-gray-400'
                              : 'bg-white border-gray-300 text-gray-600 hover:border-lopia-red hover:text-lopia-red'}`}>
                  Gmail 同步
                </button>
              </div>
            )}
          </div>
          {syncMsg && (
            <p className={`text-xs mt-2 ${syncMsg.startsWith('錯誤') ? 'text-red-600' : 'text-green-700'}`}>
              {syncMsg}
            </p>
          )}
        </div>

        {/* 送出結果 */}
        {submitMsg && (
          <div className={`text-sm px-4 py-3 rounded-xl ${submitMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
            {submitMsg.text}
          </div>
        )}

        {/* 訂單表格 */}
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-10">讀取庫存中…</p>
        ) : error ? (
          <p className="text-sm text-red-500 text-center py-10">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">庫存資料尚未同步，請先上傳 Excel 或從 Gmail 同步</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="text-sm border-collapse" style={{ minWidth: '900px' }}>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {/* 商品欄（固定） */}
                    <th className="text-left px-3 py-2.5 font-semibold text-gray-600 text-xs sticky left-0 bg-gray-50 z-10 border-r border-gray-200 min-w-[130px]">
                      商品
                    </th>
                    <th className="text-right px-2 py-2.5 font-semibold text-gray-600 text-xs min-w-[52px]">庫存</th>
                    {ORDER_STORES.map(store => (
                      <th key={store.id} className="text-center px-1 py-2.5 font-semibold text-gray-600 text-xs min-w-[44px]">
                        <div>{store.excelSheetName}</div>
                        {store.status === 'coming_soon' && (
                          <div className="text-amber-500 font-normal" style={{ fontSize: '9px' }}>即將</div>
                        )}
                      </th>
                    ))}
                    <th className="text-right px-2 py-2.5 font-semibold text-lopia-red text-xs min-w-[44px]">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORY_ORDER.map(cat => {
                    const catItems = items.filter(i => getCategory(i) === cat)
                    if (catItems.length === 0) return null
                    return (
                      <Fragment key={cat}>
                        {/* 分類標頭列 */}
                        <tr key={`hdr-${cat}`} className="border-t-2 border-gray-300">
                          <td
                            colSpan={2 + ORDER_STORES.length + 1}
                            className="px-3 py-1.5 text-xs font-bold tracking-wide sticky left-0 z-10"
                            style={{ background: cat === '蘋果' ? '#fef3c7' : '#f0fdf4', color: cat === '蘋果' ? '#92400e' : '#166534' }}
                          >
                            {cat === '蘋果' ? '🍎 蘋果' : '🍠 地瓜加工品'}
                          </td>
                        </tr>
                        {catItems.map(item => {
                          const rt = rowTotal(item.id)
                          return (
                            <tr key={item.id} className={`hover:bg-gray-50 transition-colors border-b border-gray-100 ${rt > 0 ? 'bg-red-50/30' : ''}`}>
                              <td className="px-3 py-2 sticky left-0 bg-white z-10 border-r border-gray-100" style={{ background: rt > 0 ? '#fff5f5' : 'white' }}>
                                <div className="font-medium text-gray-800 leading-tight">{item.name}</div>
                                {item.spec && <div className="text-xs text-gray-400">{item.spec}</div>}
                              </td>
                              <td className={`px-2 py-2 text-right tabular-nums text-xs ${stockColor(item.stock)}`}>
                                {item.stock}
                              </td>
                              {ORDER_STORES.map(store => (
                                <td key={store.id} className="px-1 py-1.5 text-center">
                                  <input
                                    type="number"
                                    min="0"
                                    value={grid[item.id]?.[store.name_zh] ?? 0}
                                    onChange={e => setBox(item.id, store.name_zh, Number(e.target.value))}
                                    className="w-10 text-center text-xs border border-gray-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-lopia-red tabular-nums"
                                  />
                                </td>
                              ))}
                              <td className={`px-2 py-2 text-right tabular-nums text-xs font-bold ${rt > 0 ? 'text-lopia-red' : 'text-gray-300'}`}>
                                {rt > 0 ? rt : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td className="px-3 py-2 text-xs font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 border-r border-gray-200">各店合計</td>
                    <td />
                    {ORDER_STORES.map(store => {
                      const ct = colTotal(store.name_zh)
                      return (
                        <td key={store.id} className={`px-1 py-2 text-center text-xs font-semibold tabular-nums ${ct > 0 ? 'text-lopia-red' : 'text-gray-300'}`}>
                          {ct > 0 ? ct : '—'}
                        </td>
                      )
                    })}
                    <td className="px-2 py-2 text-right text-sm font-bold text-lopia-red tabular-nums">
                      {grandTotal() > 0 ? grandTotal() : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* 送出按鈕 */}
        {!loading && !error && items.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {orderCount > 0 ? `已填寫 ${orderCount} 種商品，共 ${grandTotal()} 箱` : '請填入箱數後送出'}
            </span>
            <button
              disabled={!shipDate || grandTotal() === 0 || submitting}
              onClick={handleSubmit}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors
                ${!shipDate || grandTotal() === 0 || submitting
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-lopia-red hover:bg-lopia-red-dark'}`}>
              {submitting ? '送出中…' : `確認送出（共 ${grandTotal()} 箱）`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
