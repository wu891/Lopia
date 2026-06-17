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

interface SelectedProduct {
  item: InventoryItem
  totalBoxes: number
}

// 依 EXCEL_SHEET_ORDER 排列，只取有 excelSheetName 的門市（LOPIA 配送門市）
const ORDER_STORES = STORES
  .filter(s => !!s.excelSheetName)
  .sort((a, b) => {
    const order = ['台中', '桃園', '中和', '新荘', '巨蛋', '南港', 'IKEA', '夢時', '北門', 'MOP', '中漢', '美麗', '北蛋']
    const ai = order.indexOf(a.excelSheetName ?? '')
    const bi = order.indexOf(b.excelSheetName ?? '')
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

// 把 ISO 時間轉成 "6月12日（週四）" 格式（台北時區）
function formatSyncDate(iso: string): string {
  const d = new Date(iso)
  const taipei = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
  const month = taipei.getMonth() + 1
  const day = taipei.getDate()
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][taipei.getDay()]
  return `${month}月${day}日（週${weekday}）`
}

function stockColor(n: number) {
  if (n <= 0) return 'text-gray-400'
  if (n <= 5) return 'text-red-500 font-bold'
  if (n <= 20) return 'text-amber-600 font-semibold'
  return 'text-emerald-600 font-semibold'
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authed, setAuthed] = useState(false)
  const [showModal, setShowModal] = useState(false)

  // 向導狀態
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selected, setSelected] = useState<SelectedProduct[]>([])
  // dist[productId][storeName] = 箱數
  const [dist, setDist] = useState<Record<string, Record<string, number>>>({})
  const [shipDate, setShipDate] = useState('')
  const [roundNum, setRoundNum] = useState('')
  const [batchName, setBatchName] = useState('蘋果11')
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // 管理員同步
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

  const lastSync = items.find(i => i.lastUpdated)?.lastUpdated
  const lastSyncLabel = lastSync
    ? new Date(lastSync).toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '尚未同步'

  // ── Step 1 helpers ────────────────────────────────────────────────
  function toggleProduct(item: InventoryItem) {
    setSelected(prev => {
      const exists = prev.find(s => s.item.id === item.id)
      if (exists) return prev.filter(s => s.item.id !== item.id)
      return [...prev, { item, totalBoxes: 1 }]
    })
  }

  function updateTotal(id: string, boxes: number) {
    setSelected(prev =>
      prev.map(s => s.item.id === id
        ? { ...s, totalBoxes: Math.max(1, Math.min(boxes, s.item.stock)) }
        : s
      )
    )
  }

  // ── Step 2 helpers ────────────────────────────────────────────────
  function goToStep2() {
    setDist(prev => {
      const next: Record<string, Record<string, number>> = {}
      for (const sel of selected) {
        next[sel.item.id] = {}
        for (const store of ORDER_STORES) {
          next[sel.item.id][store.name_zh] = prev[sel.item.id]?.[store.name_zh] ?? 0
        }
      }
      return next
    })
    setStep(2)
  }

  function setBox(productId: string, storeName: string, v: number) {
    setDist(prev => ({
      ...prev,
      [productId]: { ...prev[productId], [storeName]: Math.max(0, v) },
    }))
  }

  function allocated(productId: string) {
    return Object.values(dist[productId] ?? {}).reduce((a, b) => a + b, 0)
  }

  function step2Valid() {
    return selected.every(s => allocated(s.item.id) === s.totalBoxes)
  }

  // ── Step 3 submit ─────────────────────────────────────────────────
  async function handleSubmit() {
    if (!authed) {
      setShowModal(true)
      return
    }
    setSubmitting(true)
    setSubmitMsg(null)
    try {
      const note = roundNum ? `第${roundNum}回` : ''
      const rows = selected.flatMap(sel =>
        ORDER_STORES
          .filter(store => (dist[sel.item.id]?.[store.name_zh] ?? 0) > 0)
          .map(store => ({
            store: store.name_zh,
            product: `${batchName} ${sel.item.name}${sel.item.spec ? `（${sel.item.spec}）` : ''}`,
            quantity: `${dist[sel.item.id]?.[store.name_zh] ?? 0} ${sel.item.unit}`,
            needDate: shipDate || null,
            note,
            status: '待處理',
            source: 'LOPIA',
          }))
      )

      if (!rows.length) {
        setSubmitMsg({ ok: false, text: '沒有任何門市分配到箱數' })
        setSubmitting(false)
        return
      }

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
        setSelected([])
        setDist({})
        setStep(1)
        setRoundNum('')
        setShipDate('')
      } else {
        setSubmitMsg({ ok: false, text: `${rows.length} 筆中 ${ok} 筆成功，其餘失敗，請重試` })
      }
    } catch (e) {
      setSubmitMsg({ ok: false, text: e instanceof Error ? e.message : '送出失敗' })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Admin sync ────────────────────────────────────────────────────
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

  // 送出按鈕顯示筆數
  const orderCount = selected.flatMap(sel =>
    ORDER_STORES.filter(store => (dist[sel.item.id]?.[store.name_zh] ?? 0) > 0)
  ).length

  return (
    <div className="min-h-screen bg-gray-50">
      {showModal && (
        <PasswordModal
          onSuccess={() => { setAuthed(true); setShowModal(false) }}
          onCancel={() => setShowModal(false)}
        />
      )}

      {/* 頁頭 */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <div className="w-2 h-6 bg-lopia-red rounded-full" />
        <h1 className="text-base font-bold text-gray-800">庫存查詢 ／ 線上訂單</h1>
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

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

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

        {/* 步驟指示器 */}
        <div className="flex items-center">
          {([1, 2, 3] as const).map((s, i) => (
            <div key={s} className={`flex items-center ${i < 2 ? 'flex-1' : ''}`}>
              <div className="flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all
                  ${step > s ? 'bg-emerald-500 text-white' : step === s ? 'bg-lopia-red text-white' : 'bg-gray-200 text-gray-400'}`}>
                  {step > s ? '✓' : s}
                </div>
                <span className={`text-xs font-medium hidden sm:block
                  ${step === s ? 'text-lopia-red' : step > s ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {s === 1 ? '選商品' : s === 2 ? '分配門市' : '確認送出'}
                </span>
              </div>
              {i < 2 && (
                <div className={`flex-1 h-px mx-2 transition-colors ${step > s ? 'bg-emerald-400' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* ── Step 1：選商品 ────────────────────────────────────────── */}
        {step === 1 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-700">選擇商品，輸入此批次總箱數</h2>
              {authed && (
                <div className="flex gap-2">
                  <label className={`cursor-pointer text-xs px-2.5 py-1 rounded border font-medium
                    ${syncing ? 'opacity-40 bg-gray-50 border-gray-200 text-gray-400'
                              : 'bg-white border-gray-300 text-gray-600 hover:border-lopia-red hover:text-lopia-red'}`}>
                    {syncing ? '…' : '上傳 Excel'}
                    <input type="file" accept=".xlsx" className="hidden" onChange={handleUpload} disabled={syncing} />
                  </label>
                  <button
                    onClick={handleGmailSync}
                    disabled={syncing}
                    className={`text-xs px-2.5 py-1 rounded border font-medium
                      ${syncing ? 'opacity-40 bg-gray-50 border-gray-200 text-gray-400'
                                : 'bg-white border-gray-300 text-gray-600 hover:border-lopia-red hover:text-lopia-red'}`}>
                    Gmail 同步
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
              <p className="text-sm text-gray-400 text-center py-8">庫存資料尚未同步，請先上傳 Excel 或從 Gmail 同步</p>
            ) : (
              <div className="space-y-2">
                {items.map(item => {
                  const sel = selected.find(s => s.item.id === item.id)
                  const isSelected = !!sel
                  return (
                    <div
                      key={item.id}
                      onClick={() => item.stock > 0 && toggleProduct(item)}
                      className={`bg-white rounded-xl border shadow-sm transition-all
                        ${item.stock <= 0 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                        ${isSelected ? 'border-lopia-red ring-1 ring-lopia-red' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center
                          ${isSelected ? 'bg-lopia-red border-lopia-red' : 'border-gray-300'}`}>
                          {isSelected && <span className="text-white text-xs leading-none">✓</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 text-sm">{item.name}</p>
                          {item.spec && <p className="text-xs text-gray-400">{item.spec}</p>}
                        </div>
                        {item.temperature && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0
                            ${item.temperature === '冷藏品' ? 'bg-blue-50 text-blue-600'
                            : item.temperature === '冷凍品' ? 'bg-purple-50 text-purple-600'
                            : 'bg-green-50 text-green-600'}`}>
                            {item.temperature}
                          </span>
                        )}
                        <div className={`text-sm tabular-nums flex-shrink-0 ${stockColor(item.stock)}`}>
                          {item.stock} {item.unit}
                        </div>
                      </div>

                      {isSelected && (
                        <div
                          className="px-4 pb-3 flex items-center gap-2 border-t border-red-100"
                          onClick={e => e.stopPropagation()}
                        >
                          <span className="text-xs text-gray-500">此批次總箱數：</span>
                          <input
                            type="number"
                            min="1"
                            max={item.stock}
                            value={sel.totalBoxes}
                            onChange={e => updateTotal(item.id, Number(e.target.value))}
                            className="w-20 text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-lopia-red tabular-nums"
                          />
                          <span className="text-xs text-gray-400">（庫存 {item.stock} 箱）</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="pt-4 flex items-center justify-between">
              <span className="text-xs text-gray-400">已選 {selected.length} 項</span>
              <button
                disabled={selected.length === 0}
                onClick={goToStep2}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors
                  ${selected.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-lopia-red hover:bg-lopia-red-dark'}`}>
                下一步：分配門市 →
              </button>
            </div>
          </section>
        )}

        {/* ── Step 2：分配門市 ──────────────────────────────────────── */}
        {step === 2 && (
          <section>
            <h2 className="text-sm font-bold text-gray-700 mb-1">各門市分配箱數</h2>
            <p className="text-xs text-gray-400 mb-4">每個商品的各門市加總需等於總箱數才能繼續。不配送的門市填 0。</p>

            <div className="space-y-4">
              {selected.map(sel => {
                const done = allocated(sel.item.id)
                const remaining = sel.totalBoxes - done
                const isOk = remaining === 0
                const isOver = remaining < 0
                return (
                  <div
                    key={sel.item.id}
                    className={`bg-white rounded-xl border overflow-hidden shadow-sm
                      ${isOk ? 'border-emerald-300' : isOver ? 'border-red-300' : 'border-gray-200'}`}
                  >
                    <div className={`px-4 py-2.5 flex items-center justify-between
                      ${isOk ? 'bg-emerald-50' : isOver ? 'bg-red-50' : 'bg-gray-50'}`}>
                      <div>
                        <span className="text-sm font-semibold text-gray-800">{sel.item.name}</span>
                        {sel.item.spec && <span className="text-xs text-gray-400 ml-2">{sel.item.spec}</span>}
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                        ${isOk ? 'bg-emerald-100 text-emerald-700' : isOver ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {isOk
                          ? `✓ 共 ${sel.totalBoxes} 箱`
                          : isOver
                          ? `超出 ${Math.abs(remaining)} 箱`
                          : `剩餘 ${remaining} 箱`}
                      </span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {ORDER_STORES.map(store => (
                        <div key={store.id} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-sm text-gray-700 flex-1">{store.name_zh}</span>
                          {store.status === 'coming_soon' && (
                            <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">即將開幕</span>
                          )}
                          <input
                            type="number"
                            min="0"
                            value={dist[sel.item.id]?.[store.name_zh] ?? 0}
                            onChange={e => setBox(sel.item.id, store.name_zh, Number(e.target.value))}
                            className="w-16 text-sm text-right border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-lopia-red tabular-nums"
                          />
                          <span className="text-xs text-gray-400 w-4">{sel.item.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="pt-4 flex items-center justify-between">
              <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">
                ← 上一步
              </button>
              <button
                disabled={!step2Valid()}
                onClick={() => setStep(3)}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors
                  ${!step2Valid() ? 'bg-gray-300 cursor-not-allowed' : 'bg-lopia-red hover:bg-lopia-red-dark'}`}>
                下一步：確認送出 →
              </button>
            </div>
          </section>
        )}

        {/* ── Step 3：確認送出 ──────────────────────────────────────── */}
        {step === 3 && (
          <section>
            <h2 className="text-sm font-bold text-gray-700 mb-3">確認並送出</h2>

            {submitMsg && (
              <div className={`text-sm mb-4 px-4 py-3 rounded-lg
                ${submitMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {submitMsg.text}
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    出貨日期 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={shipDate}
                    onChange={e => setShipDate(e.target.value)}
                    required
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lopia-red"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">回数</label>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-gray-500 flex-shrink-0">第</span>
                    <input
                      type="number"
                      min="1"
                      value={roundNum}
                      onChange={e => setRoundNum(e.target.value)}
                      placeholder="11"
                      className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lopia-red"
                    />
                    <span className="text-sm text-gray-500 flex-shrink-0">回</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">批次名稱</label>
                <input
                  type="text"
                  value={batchName}
                  onChange={e => setBatchName(e.target.value)}
                  placeholder="蘋果11"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-lopia-red"
                />
              </div>
            </div>

            {/* 摘要表格 */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mt-4">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                <span className="text-xs font-semibold text-gray-600">訂單摘要</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-4 py-2">商品</th>
                    <th className="text-left px-4 py-2">門市</th>
                    <th className="text-right px-4 py-2">箱數</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selected.flatMap(sel =>
                    ORDER_STORES
                      .filter(store => (dist[sel.item.id]?.[store.name_zh] ?? 0) > 0)
                      .map(store => (
                        <tr key={`${sel.item.id}-${store.id}`} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-800">
                            {sel.item.name}
                            {sel.item.spec && (
                              <span className="text-gray-400 font-normal text-xs ml-1">{sel.item.spec}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-gray-600">{store.name_zh}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">
                            {dist[sel.item.id]?.[store.name_zh] ?? 0} {sel.item.unit}
                          </td>
                        </tr>
                      ))
                  )}
                  <tr className="bg-gray-50">
                    <td colSpan={2} className="px-4 py-2 text-xs text-gray-500 font-semibold">合計</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-lopia-red">
                      {selected.reduce((t, s) => t + s.totalBoxes, 0)} 箱
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="pt-4 flex items-center justify-between gap-3">
              <button onClick={() => setStep(2)} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">
                ← 上一步
              </button>
              <button
                disabled={!shipDate || submitting}
                onClick={handleSubmit}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors
                  ${!shipDate || submitting ? 'bg-gray-300 cursor-not-allowed' : 'bg-lopia-red hover:bg-lopia-red-dark'}`}>
                {submitting
                  ? '送出中…'
                  : `確認送出（${orderCount} 筆）`}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
