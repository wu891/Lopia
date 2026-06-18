'use client'
import { useState, useEffect, useCallback, Fragment } from 'react'
import PasswordModal, { isAuthed } from '@/components/PasswordModal'
import { STORES } from '@/lib/stores'
import { parseDeliveryExcel, ParsedDeliveryRound } from '@/lib/parseDeliveryExcel'

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

  // 出貨指示匯入
  const [deliveryRounds, setDeliveryRounds] = useState<ParsedDeliveryRound[] | null>(null)
  const [deliveryFileName, setDeliveryFileName] = useState('')
  const [importingDelivery, setImportingDelivery] = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // 正在產出 Excel 的回次（null = 閒置中）
  const [generatingRound, setGeneratingRound] = useState<number | null>(null)
  // 產出後的下載連結（blob URL），記錄是哪一回次的
  const [excelDownload, setExcelDownload] = useState<{ url: string; filename: string; roundNo: number } | null>(null)
  // 派貨通知：正在發送中的回次 / 已成功發送的回次
  const [dispatchingRound, setDispatchingRound] = useState<number | null>(null)
  const [dispatchedRound, setDispatchedRound]   = useState<number | null>(null)

  // 發送派貨通知 Email 給倉庫（呼叫 /api/notify，type='dispatch'）
  async function handleDispatch(round: ParsedDeliveryRound) {
    setDispatchingRound(round.roundNo)
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'dispatch',
          batchName,
          roundNo: round.roundNo,
          dispatchDate: shipDate || new Date().toISOString().slice(0, 10),
          storeOrders: round.stores.map(s => ({
            storeName:    s.name,
            products:     s.products,
            boxes:        s.boxes,
            deliveryDate: shipDate || undefined,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '發送失敗' }))
        throw new Error(err.error)
      }
      setDispatchedRound(round.roundNo)
      setTimeout(() => setDispatchedRound(null), 6000)
    } catch (e) {
      alert(`派貨通知發送失敗：${e instanceof Error ? e.message : '未知錯誤'}`)
    } finally {
      setDispatchingRound(null)
    }
  }

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

  async function handleDeliveryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setImportingDelivery(true); setDeliveryRounds(null); setImportMsg(null)
    try {
      const buffer = await file.arrayBuffer()
      const rounds = await parseDeliveryExcel(buffer)
      if (!rounds.length) throw new Error('Excel 裡找不到任何門市資料，請確認格式是否正確')
      setDeliveryRounds(rounds)
      setDeliveryFileName(file.name)
    } catch (err) {
      setImportMsg({ ok: false, text: `解析失敗：${err instanceof Error ? err.message : '未知錯誤'}` })
    } finally {
      setImportingDelivery(false); e.target.value = ''
    }
  }

  function applyDeliveryRound(round: ParsedDeliveryRound, fileName: string) {
    const newGrid: Record<string, Record<string, number>> = {}
    for (const item of items) {
      newGrid[item.id] = { ...grid[item.id] }
    }

    const unmatched: string[] = []

    for (const storeData of round.stores) {
      const matchedStore = ORDER_STORES.find(s =>
        s.name_zh === storeData.name ||
        storeData.name.includes(s.name_zh) ||
        (s.excelSheetName != null && storeData.name.includes(s.excelSheetName))
      )
      if (!matchedStore) {
        const key = `門市「${storeData.name}」`
        if (!unmatched.includes(key)) unmatched.push(key)
        continue
      }

      for (const product of storeData.products) {
        let matchedItem = items.find(i => i.name === product.name)
        if (!matchedItem) {
          matchedItem = items.find(i =>
            i.name.includes(product.name) || product.name.includes(i.name)
          )
        }
        if (!matchedItem) {
          const key = `商品「${product.name}」`
          if (!unmatched.includes(key)) unmatched.push(key)
          continue
        }
        newGrid[matchedItem.id][matchedStore.name_zh] = product.quantity
      }
    }

    setGrid(newGrid)
    setExcelDownload(null)
    setImportMsg(
      unmatched.length
        ? {
            ok: false,
            text: `已填入，但 ${unmatched.length} 個項目未比對到：${unmatched.slice(0, 2).join('、')}${unmatched.length > 2 ? '…等' : ''}，請手動補填`,
          }
        : { ok: true, text: `第 ${round.roundNo} 回成功填入訂單格！` }
    )

    // 背景產出店鋪貨單 + 出貨總表 Excel，完成後在回次卡片內顯示下載按鈕
    const thisRoundNo = round.roundNo
    setGeneratingRound(thisRoundNo)
    void (async () => {
      try {
        const dateStr = shipDate || new Date().toISOString().slice(0, 10)
        const shipmentNo = `S${dateStr.replace(/-/g, '')}01`
        const storeOrders = round.stores.map(s => ({
          storeName: s.name,
          products: s.products,
          deliveryDate: dateStr,
        }))
        const res = await fetch('/api/generate-order-from-round', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeOrders, shipmentNo, batchName }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: '下載失敗' }))
          setImportMsg(prev => prev ? { ...prev, text: `${prev.text}　⚠️ 貨單產出失敗：${err.error}` } : null)
        } else {
          const blob = await res.blob()
          const shipNo = res.headers.get('X-Shipment-No') ?? shipmentNo
          const filename = `${shipNo}_${batchName}_店鋪貨單.xlsx`
          setExcelDownload({ url: URL.createObjectURL(blob), filename, roundNo: thisRoundNo })
        }
      } catch (e) {
        setImportMsg(prev => prev ? { ...prev, text: `${prev.text}　⚠️ 貨單產出失敗：${e instanceof Error ? e.message : ''}` } : null)
      } finally {
        setGeneratingRound(null)
      }
    })()

    // 背景存進 Notion 歷史，失敗不影響主流程
    void fetch('/api/delivery-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName,
        roundNo: round.roundNo,
        storeCount: round.stores.length,
        totalBoxes: round.stores.reduce((sum, s) => sum + s.boxes, 0),
        stores: round.stores.map(s => ({ name: s.name, boxes: s.boxes })),
      }),
    }).catch(() => undefined)
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
                <span className="w-px h-5 bg-gray-200 self-center" />
                <label className={`cursor-pointer text-xs px-2.5 py-1.5 rounded border font-medium
                  ${importingDelivery
                    ? 'opacity-40 bg-gray-50 border-gray-200 text-gray-400'
                    : 'bg-blue-50 border-blue-300 text-blue-700 hover:border-blue-500 hover:bg-blue-100'}`}>
                  {importingDelivery ? '解析中…' : '📋 匯入出貨指示'}
                  <input type="file" accept=".xlsx" className="hidden" onChange={handleDeliveryUpload} disabled={importingDelivery} />
                </label>
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

        {/* 出貨指示匯入訊息 */}
        {importMsg && (
          <div className={`text-sm px-4 py-3 rounded-xl ${importMsg.ok ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
            {importMsg.text}
          </div>
        )}

        {/* 出貨指示預覽面板 */}
        {deliveryRounds && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-blue-800 flex-shrink-0">📋 出貨指示預覽</span>
                <span className="text-xs text-blue-500 truncate">{deliveryFileName}</span>
              </div>
              <button
                onClick={() => { setDeliveryRounds(null); setDeliveryFileName(''); setImportMsg(null); setExcelDownload(null) }}
                className="text-xs text-blue-400 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-100 flex-shrink-0 ml-2">
                ✕ 關閉
              </button>
            </div>
            {deliveryRounds.map(round => {
              const totalBoxes = round.stores.reduce((sum, s) => sum + s.boxes, 0)
              return (
                <div key={round.roundNo} className="bg-white rounded-lg border border-blue-100 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-bold text-gray-800">
                      第 {round.roundNo} 回　合計 {totalBoxes} 箱
                    </span>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {/* 產出中：旋轉圈 */}
                      {generatingRound === round.roundNo && (
                        <span className="flex items-center gap-1.5 text-xs text-gray-500">
                          <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                          產出中…
                        </span>
                      )}
                      {/* 產出完成：綠色下載按鈕 */}
                      {generatingRound === null && excelDownload?.roundNo === round.roundNo && (
                        <a
                          href={excelDownload.url}
                          download={excelDownload.filename}
                          className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors"
                          onClick={() => setTimeout(() => { URL.revokeObjectURL(excelDownload.url); setExcelDownload(null) }, 3000)}
                        >
                          📥 下載 Excel
                        </a>
                      )}
                      {/* 通知倉庫：派貨 Email */}
                      {dispatchedRound === round.roundNo ? (
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600 px-2 py-1.5">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          已通知倉庫
                        </span>
                      ) : (
                        <button
                          onClick={() => handleDispatch(round)}
                          disabled={dispatchingRound !== null}
                          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold border transition-colors flex-shrink-0
                            ${dispatchingRound !== null
                              ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                              : 'bg-white border-amber-300 text-amber-700 hover:bg-amber-50 hover:border-amber-400'}`}
                        >
                          {dispatchingRound === round.roundNo ? (
                            <>
                              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                              </svg>
                              發送中…
                            </>
                          ) : '📧 通知倉庫'}
                        </button>
                      )}
                      <button
                        onClick={() => applyDeliveryRound(round, deliveryFileName)}
                        disabled={generatingRound !== null}
                        className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors flex-shrink-0
                          ${generatingRound !== null
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'bg-lopia-red text-white hover:bg-red-700'}`}>
                        確認填入第 {round.roundNo} 回
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {round.stores.map(store => (
                      <div key={store.name} className="text-xs bg-gray-50 rounded-lg p-2 border border-gray-100">
                        <div className="font-semibold text-gray-700 leading-tight">{store.name}</div>
                        <div className="text-lopia-red font-bold mt-0.5">{store.boxes} 箱</div>
                        {store.products.map((p, idx) => (
                          <div key={idx} className="text-gray-400 leading-tight mt-0.5">
                            {p.name} ×{p.quantity}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
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
                    const catStock = catItems.reduce((sum, i) => sum + i.stock, 0)
                    return (
                      <Fragment key={cat}>
                        {/* 分類標頭列 */}
                        <tr key={`hdr-${cat}`} className="border-t-2 border-gray-300">
                          <td
                            colSpan={2 + ORDER_STORES.length + 1}
                            className="px-3 py-1.5 text-xs font-bold tracking-wide sticky left-0 z-10"
                            style={{ background: cat === '蘋果' ? '#fef3c7' : '#f0fdf4', color: cat === '蘋果' ? '#92400e' : '#166534' }}
                          >
                            <span>{cat === '蘋果' ? '🍎 蘋果' : '🍠 地瓜加工品'}</span>
                            <span className="ml-3 font-normal opacity-70">目前總庫存 {catStock} 箱</span>
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
