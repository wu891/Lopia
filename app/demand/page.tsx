'use client'
import { useState, useEffect, useCallback } from 'react'
import PasswordModal, { isAuthed } from '@/components/PasswordModal'
import { parseLine, STORE_NAMES } from '@/lib/parseDemandText'

interface DemandItem {
  id: string
  store: string
  product: string
  quantity: string
  needDate: string | null
  status: string
  note: string
  source: string
  rawMessage: string
  lineMessageId: string
}

type SortMode = 'time' | 'store' | 'product'

// ── 狀態顏色與切換規則 ────────────────────────────────────────────────────────
// 待確認：LINE自動解析進來、還沒看過的項目（顯眼的紫色標示）
// 待處理 → 已安排 → 已完成：點一下狀態色塊會依序循環切換
const STATUS_COLOR: Record<string, string> = {
  '待確認': 'bg-purple-500',
  '待處理': 'bg-red-500',
  '已安排': 'bg-amber-500',
  '已完成': 'bg-emerald-500',
}

const CONFIRM_FLOW = ['待處理', '已安排', '已完成']

function nextStatus(current: string): string {
  if (current === '待確認') return '待處理'
  const idx = CONFIRM_FLOW.indexOf(current)
  return CONFIRM_FLOW[(idx + 1) % CONFIRM_FLOW.length]
}

// 把 "YYYY-MM-DD" 轉成 "6/25 (四)" 這種好讀的格式
const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六']
function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY_LABEL[d.getDay()]})`
}

function sortItems(items: DemandItem[], mode: SortMode): DemandItem[] {
  const arr = [...items]
  if (mode === 'time') {
    arr.sort((a, b) => {
      if (!a.needDate && !b.needDate) return 0
      if (!a.needDate) return 1
      if (!b.needDate) return -1
      return a.needDate.localeCompare(b.needDate)
    })
  } else if (mode === 'store') {
    arr.sort((a, b) => {
      const s = (a.store || '').localeCompare(b.store || '', 'zh-Hant')
      return s !== 0 ? s : (a.needDate || '').localeCompare(b.needDate || '')
    })
  } else if (mode === 'product') {
    arr.sort((a, b) => {
      const s = (a.product || '').localeCompare(b.product || '', 'zh-Hant')
      return s !== 0 ? s : (a.needDate || '').localeCompare(b.needDate || '')
    })
  }
  return arr
}

// ── 單一項目（一般顯示 / 編輯模式） ────────────────────────────────────────────

interface EditForm {
  store: string
  product: string
  quantity: string
  needDate: string
  note: string
}

function ItemRow({
  item, editing, onStartEdit, onCancelEdit, onSave, onDelete, onCycleStatus,
}: {
  item: DemandItem
  editing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: (data: EditForm) => void
  onDelete: () => void
  onCycleStatus: () => void
}) {
  const [form, setForm] = useState<EditForm>({
    store: item.store, product: item.product, quantity: item.quantity,
    needDate: item.needDate ?? '', note: item.note,
  })

  useEffect(() => {
    if (editing) {
      setForm({ store: item.store, product: item.product, quantity: item.quantity, needDate: item.needDate ?? '', note: item.note })
    }
  }, [editing, item])

  const isPendingConfirm = item.status === '待確認'
  const cardCls = isPendingConfirm
    ? 'bg-purple-50 border-purple-200'
    : 'bg-white border-gray-200'

  if (editing) {
    return (
      <div className={`border rounded-xl p-3 mb-2 ${cardCls}`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">店鋪</label>
            <select
              value={form.store}
              onChange={e => setForm(f => ({ ...f, store: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red bg-white"
            >
              <option value="">（未填店鋪）</option>
              {STORE_NAMES.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">商品</label>
            <input
              type="text"
              value={form.product}
              onChange={e => setForm(f => ({ ...f, product: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">數量</label>
            <input
              type="text"
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">需要時間</label>
            <input
              type="date"
              value={form.needDate}
              onChange={e => setForm(f => ({ ...f, needDate: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="block text-[11px] text-gray-400 mb-1">備註</label>
            <input
              type="text"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-2.5">
          <button
            onClick={() => onSave(form)}
            className="px-3 py-1.5 rounded-lg bg-lopia-red text-white text-xs font-semibold hover:bg-lopia-red-dark transition-colors"
          >
            儲存
          </button>
          <button
            onClick={onCancelEdit}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`border rounded-xl p-3 mb-2 flex flex-wrap items-center gap-2.5 ${cardCls}`}>
      <button
        onClick={onCycleStatus}
        title="點擊切換處理狀態"
        className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold text-white whitespace-nowrap ${STATUS_COLOR[item.status] ?? 'bg-gray-400'}`}
      >
        {item.status}
      </button>

      <div className="flex-1 min-w-[200px] flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
        <span className="font-bold text-gray-800">{item.product || '（未填商品）'}</span>
        <span className="text-gray-400">{item.store || '（未填店鋪）'}</span>
        <span className="text-gray-600">{item.quantity || '（未填數量）'}</span>
        <span className="text-lopia-red font-semibold">{item.needDate ? formatDate(item.needDate) : '（未填時間）'}</span>
      </div>

      <div className="flex gap-1.5 shrink-0">
        <button onClick={onStartEdit} title="編輯" className="p-1.5 rounded-md hover:bg-gray-100 text-base leading-none">✏️</button>
        <button onClick={onDelete} title="刪除" className="p-1.5 rounded-md hover:bg-gray-100 text-base leading-none">🗑️</button>
      </div>

      {item.note && (
        <div className="w-full text-xs text-gray-400 pl-0.5">備註：{item.note}</div>
      )}

      {isPendingConfirm && item.rawMessage && (
        <div className="w-full text-xs text-purple-700 bg-white border border-purple-100 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap">
          <span className="font-semibold">LINE原始訊息：</span>{item.rawMessage}
        </div>
      )}
    </div>
  )
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function DemandPage() {
  const [items, setItems] = useState<DemandItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('time')
  const [pasteText, setPasteText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/demand', { cache: 'no-store' })
      if (!res.ok) throw new Error('讀取失敗')
      const data = await res.json()
      setItems(data.items ?? [])
    } catch {
      setError('讀取失敗，請重新整理看看')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  // 需要密碼的動作：已登入就直接做，沒登入先跳密碼框，成功後再執行
  function withAuth(action: () => void) {
    if (isAuthed()) {
      action()
    } else {
      setPendingAction(action)
      setShowPassword(true)
    }
  }

  async function createItem(data: Record<string, unknown>): Promise<DemandItem> {
    const res = await fetch('/api/demand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('新增失敗')
    const { item } = await res.json()
    return item as DemandItem
  }

  async function updateItem(id: string, data: Record<string, unknown>): Promise<DemandItem> {
    const res = await fetch(`/api/demand/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('更新失敗')
    const { item } = await res.json()
    return item as DemandItem
  }

  function handleExtract() {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length === 0) {
      setError('請先貼上 LOPIA 的訊息內容（一行一筆）')
      return
    }
    withAuth(async () => {
      setError(null)
      try {
        for (const line of lines) {
          const parsed = parseLine(line)
          if (!parsed) continue
          const item = await createItem({
            store: parsed.store || undefined,
            product: parsed.product,
            quantity: parsed.quantity,
            needDate: parsed.needDate || null,
            status: '待處理',
          })
          setItems(prev => [item, ...prev])
        }
        setPasteText('')
      } catch {
        setError('自動抓取失敗，請稍後再試')
      }
    })
  }

  function handleAddBlank() {
    withAuth(async () => {
      setError(null)
      try {
        const item = await createItem({ store: '', product: '', quantity: '', needDate: null, status: '待處理', note: '' })
        setItems(prev => [item, ...prev])
        setEditingId(item.id)
      } catch {
        setError('新增失敗，請稍後再試')
      }
    })
  }

  function handleCycleStatus(item: DemandItem) {
    withAuth(async () => {
      setError(null)
      try {
        const updated = await updateItem(item.id, { status: nextStatus(item.status) })
        setItems(prev => prev.map(i => (i.id === item.id ? updated : i)))
      } catch {
        setError('更新失敗，請稍後再試')
      }
    })
  }

  function handleSaveEdit(id: string, form: EditForm) {
    withAuth(async () => {
      setError(null)
      try {
        const updated = await updateItem(id, {
          store: form.store,
          product: form.product,
          quantity: form.quantity,
          needDate: form.needDate || null,
          note: form.note,
        })
        setItems(prev => prev.map(i => (i.id === id ? updated : i)))
        setEditingId(null)
      } catch {
        setError('更新失敗，請稍後再試')
      }
    })
  }

  function handleDelete(id: string) {
    if (!confirm('確定要刪除這筆需求嗎？')) return
    withAuth(async () => {
      setError(null)
      try {
        const res = await fetch(`/api/demand/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('刪除失敗')
        setItems(prev => prev.filter(i => i.id !== id))
      } catch {
        setError('刪除失敗，請稍後再試')
      }
    })
  }

  const pendingConfirmCount = items.filter(i => i.status === '待確認').length
  const sorted = sortItems(items, sortMode)

  let lastGroupKey: string | null = null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href="/" className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            <span className="text-xs hidden sm:inline">貨況系統</span>
          </a>
          <div className="flex items-center gap-2.5 flex-1">
            <div className="w-8 h-8 rounded-lg bg-lopia-red flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-gray-900 text-sm leading-tight">需求清單</h1>
              <p className="text-[10px] text-gray-400 leading-tight">把 LOPIA 的訊息整理成清單，自動辨識門市／商品／數量／日期</p>
            </div>
          </div>
          {pendingConfirmCount > 0 && (
            <span className="shrink-0 px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold">
              {pendingConfirmCount} 筆待確認
            </span>
          )}
          <button
            onClick={fetchItems}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-lopia-red transition-colors px-2.5 py-1.5 rounded-md hover:bg-lopia-red-light border border-gray-200 hover:border-lopia-red disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={loading ? 'animate-spin' : ''}>
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            重新整理
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* 貼訊息區 */}
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder={'把 LOPIA 給你的訊息貼進來，自動整理成清單（每行一筆）：\n南港LaLaport 草莓 30盒 6/25到貨\n桃園春日 葡萄 20箱 7月1日\n台中漢神中港 蘋果 9.4箱 明天'}
            className="w-full min-h-[90px] border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red resize-y"
          />
          <div className="flex gap-2 mt-2.5 flex-wrap">
            <button
              onClick={handleExtract}
              className="px-4 py-2 rounded-lg bg-lopia-red text-white text-sm font-semibold hover:bg-lopia-red-dark transition-colors"
            >
              🔍 自動抓取
            </button>
            <button
              onClick={handleAddBlank}
              className="px-4 py-2 rounded-lg border border-lopia-red text-lopia-red text-sm font-semibold hover:bg-lopia-red-light transition-colors"
            >
              ✏️ 手動新增一筆
            </button>
          </div>
        </section>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* 排序切換 */}
        <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
          <span>排序方式：</span>
          {([['time', '依時間'], ['store', '依店鋪'], ['product', '依商品']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortMode(key)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                sortMode === key
                  ? 'bg-lopia-red text-white border-lopia-red'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-lopia-red hover:text-lopia-red'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 清單 */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">載入中...</div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            目前還沒有任何需求，貼上訊息或手動新增一筆吧！
          </div>
        ) : (
          <div>
            {sorted.map(item => {
              let groupHeader: string | null = null
              if (sortMode === 'store') {
                const key = item.store || '（未填店鋪）'
                if (key !== lastGroupKey) { groupHeader = '店鋪：' + key; lastGroupKey = key }
              } else if (sortMode === 'product') {
                const key = item.product || '（未填商品）'
                if (key !== lastGroupKey) { groupHeader = '商品：' + key; lastGroupKey = key }
              }
              return (
                <div key={item.id}>
                  {groupHeader && (
                    <div className="text-xs font-bold text-gray-400 mt-4 mb-1.5 px-1 first:mt-0">{groupHeader}</div>
                  )}
                  <ItemRow
                    item={item}
                    editing={editingId === item.id}
                    onStartEdit={() => withAuth(() => setEditingId(item.id))}
                    onCancelEdit={() => setEditingId(null)}
                    onSave={form => handleSaveEdit(item.id, form)}
                    onDelete={() => handleDelete(item.id)}
                    onCycleStatus={() => handleCycleStatus(item)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </main>

      {showPassword && (
        <PasswordModal
          onSuccess={() => {
            setShowPassword(false)
            const action = pendingAction
            setPendingAction(null)
            action?.()
          }}
          onCancel={() => { setShowPassword(false); setPendingAction(null) }}
        />
      )}
    </div>
  )
}
