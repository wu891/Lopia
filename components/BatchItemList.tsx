'use client'
import { useEffect, useState } from 'react'
import { BatchItem } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import PasswordModal, { isAuthed, logChange } from './PasswordModal'

interface Props {
  batchId: string
  lang: Lang
  parentTotalBoxes?: number | null
  parentShippedBoxes?: number
}

const STATUS_OPTS = ['待出貨', '部分出貨', '全數出貨', '退回/銷毀'] as const

const STATUS_STYLE: Record<string, string> = {
  '待出貨':    'bg-gray-100 text-gray-600 border-gray-200',
  '部分出貨':  'bg-amber-50 text-amber-700 border-amber-200',
  '全數出貨':  'bg-emerald-50 text-emerald-700 border-emerald-200',
  '退回/銷毀': 'bg-rose-50 text-rose-700 border-rose-200',
}

interface DraftItem {
  productName: string
  origin: string
  boxes: string
  shippedBoxes: string
  status: string
  remarks: string
}

const EMPTY_DRAFT: DraftItem = {
  productName: '',
  origin: '',
  boxes: '',
  shippedBoxes: '0',
  status: '待出貨',
  remarks: '',
}

// 從供應商 Excel 推算出來的品項（/api/batch-items/derived）
interface DerivedItem {
  productName: string
  boxes: number
  shippedBoxes: number
}

export default function BatchItemList({ batchId, lang, parentTotalBoxes = null, parentShippedBoxes = 0 }: Props) {
  const T = t[lang]
  const [items, setItems] = useState<BatchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftItem>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  // 從出貨計畫（供應商 Excel）推算出來的品項
  const [derived, setDerived] = useState<DerivedItem[]>([])
  const [hasExcel, setHasExcel] = useState(false)
  const [excelMissing, setExcelMissing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [itemsRes, derivedRes] = await Promise.all([
        fetch(`/api/batch-items?batchId=${batchId}`, { cache: 'no-store' }),
        fetch(`/api/batch-items/derived?batchId=${batchId}`, { cache: 'no-store' }),
      ])
      const itemsJson = await itemsRes.json()
      setItems(itemsJson.items ?? [])
      const derivedJson = await derivedRes.json().catch(() => ({}))
      setDerived(derivedJson.derived ?? [])
      setHasExcel(!!derivedJson.hasExcel)
      setExcelMissing(!!derivedJson.excelMissing)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [batchId])

  // 「已出貨」即時自動算：有供應商 Excel 時以推算值為準，否則用手動值
  const derivedMap = new Map(derived.map(d => [d.productName, d]))
  function liveShipped(it: BatchItem): number {
    if (hasExcel && derivedMap.has(it.productName)) return derivedMap.get(it.productName)!.shippedBoxes
    return it.shippedBoxes ?? 0
  }

  function withAuth(fn: () => void) {
    if (!isAuthed()) {
      setPendingAction(() => fn)
      setShowAuth(true)
      return
    }
    fn()
  }

  function startAdd() {
    withAuth(() => {
      setDraft(EMPTY_DRAFT)
      setEditingId(null)
      setAdding(true)
    })
  }

  function startEdit(it: BatchItem) {
    withAuth(() => {
      setDraft({
        productName: it.productName,
        origin: it.origin ?? '',
        boxes: it.boxes?.toString() ?? '',
        shippedBoxes: it.shippedBoxes?.toString() ?? '0',
        status: it.status ?? '待出貨',
        remarks: it.remarks ?? '',
      })
      setEditingId(it.id)
      setAdding(false)
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setAdding(false)
    setDraft(EMPTY_DRAFT)
  }

  async function save() {
    if (!draft.productName.trim()) return
    const payload = {
      productName: draft.productName.trim(),
      origin: draft.origin.trim() || undefined,
      boxes: draft.boxes ? Number(draft.boxes) : 0,
      shippedBoxes: draft.shippedBoxes ? Number(draft.shippedBoxes) : 0,
      status: draft.status,
      remarks: draft.remarks.trim(),
    }
    if (adding) {
      const res = await fetch('/api/batch-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, ...payload, sortOrder: items.length }),
      })
      if (res.ok) {
        await logChange('新增品項', batchId, payload.productName)
      }
    } else if (editingId) {
      const res = await fetch(`/api/batch-items/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        await logChange('編輯品項', editingId, payload.productName)
      }
    }
    cancelEdit()
    await load()
  }

  function remove(it: BatchItem) {
    withAuth(async () => {
      if (!confirm(`確定刪除「${it.productName}」?`)) return
      const res = await fetch(`/api/batch-items/${it.id}`, { method: 'DELETE' })
      if (res.ok) {
        await logChange('刪除品項', it.id, it.productName)
        await load()
      }
    })
  }

  // 從出貨計畫（供應商 Excel）帶入品名＋總箱：依品名 upsert，不刪除手動新增的品項
  function syncFromPlan() {
    withAuth(async () => {
      setSyncing(true); setSyncMsg(null)
      try {
        const res = await fetch(`/api/batch-items/derived?batchId=${batchId}`, { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setSyncMsg({ type: 'err', text: json.error ?? '同步失敗' })
          return
        }
        if (!json.hasExcel) {
          setSyncMsg({ type: 'err', text: lang === 'ja' ? '先に仕入先Excelをアップロードしてください' : '此批次尚未上傳供應商 Excel' })
          return
        }
        const list: DerivedItem[] = json.derived ?? []
        if (list.length === 0) {
          setSyncMsg({ type: 'err', text: lang === 'ja' ? '取り込める商品がありません' : '供應商 Excel 沒有可帶入的品項' })
          return
        }
        const byName = new Map(items.map(it => [it.productName, it]))
        let created = 0, updated = 0
        for (const d of list) {
          const existing = byName.get(d.productName)
          if (existing) {
            if ((existing.boxes ?? 0) !== d.boxes) {
              await fetch(`/api/batch-items/${existing.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ boxes: d.boxes }),
              })
              updated++
            }
          } else {
            await fetch('/api/batch-items', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batchId, productName: d.productName, boxes: d.boxes, shippedBoxes: 0, status: '待出貨', sortOrder: items.length + created }),
            })
            created++
          }
        }
        await logChange('同步品項明細', batchId, `從出貨計畫帶入 ${list.length} 品項（新增 ${created} / 更新 ${updated}）`)
        setSyncMsg({ type: 'ok', text: lang === 'ja' ? `同期完了：追加 ${created}・更新 ${updated}` : `已同步：新增 ${created}、更新 ${updated}` })
        await load()
      } catch {
        setSyncMsg({ type: 'err', text: lang === 'ja' ? '同期に失敗しました' : '同步失敗，請重試' })
      } finally {
        setSyncing(false)
      }
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <p className="text-xs text-gray-500">
          {lang === 'ja' ? '商品明細' : '品項明細'}
          {items.length > 0 && <span className="ml-1 text-gray-400">({items.length})</span>}
        </p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasExcel && (
            <button
              onClick={syncFromPlan}
              disabled={syncing}
              title={lang === 'ja' ? '配送計画（仕入先Excel）から商品名・箱数を取り込む' : '從出貨計畫（供應商 Excel）帶入品名與總箱'}
              className="text-xs px-2 py-1 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-100 font-medium transition-colors disabled:opacity-50"
            >
              {syncing
                ? <><span className="animate-spin inline-block">⟳</span> {lang === 'ja' ? '同期中...' : '同步中...'}</>
                : <>🔄 {lang === 'ja' ? '配送計画から取込' : '從出貨計畫同步'}</>}
            </button>
          )}
          <button
            onClick={startAdd}
            className="text-xs px-2 py-1 bg-lopia-red-light text-lopia-red rounded-lg hover:bg-red-100 font-medium transition-colors"
          >
            + {lang === 'ja' ? '商品追加' : '新增品項'}
          </button>
        </div>
      </div>

      {syncMsg && (
        <p className={`text-xs mb-1.5 px-2 py-1 rounded-lg ${syncMsg.type === 'ok' ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'}`}>
          {syncMsg.type === 'ok' ? '✓' : '⚠'} {syncMsg.text}
        </p>
      )}

      {excelMissing && (
        <p className="text-xs mb-1.5 px-2 py-1 rounded-lg text-amber-700 bg-amber-50 border border-amber-200">
          ⚠ {lang === 'ja'
            ? '仕入先Excelのリンクが無効です（Driveファイルなし）。配送計画から再アップロードすると出荷済が自動計算されます'
            : '供應商 Excel 連結已失效（Drive 檔案不存在），重新上傳出貨時程表後「已出貨」可恢復自動計算'}
        </p>
      )}

      {/* 對照列：品項加總 vs 母批次 */}
      {items.length > 0 && (parentTotalBoxes != null || parentShippedBoxes > 0) && (() => {
        const sumBoxes = items.reduce((s, it) => s + (it.boxes ?? 0), 0)
        const sumShipped = items.reduce((s, it) => s + liveShipped(it), 0)
        const totalOk = parentTotalBoxes == null || sumBoxes === parentTotalBoxes
        const shippedOk = sumShipped === parentShippedBoxes
        return (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5 text-[11px]">
            <span className={`px-1.5 py-0.5 rounded border ${totalOk ? 'bg-gray-50 text-gray-600 border-gray-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
              {lang === 'ja' ? '品目合計' : '品項總箱'}: {sumBoxes}
              {parentTotalBoxes != null && <> / {parentTotalBoxes} {totalOk ? '✓' : '⚠'}</>}
            </span>
            <span className={`px-1.5 py-0.5 rounded border ${shippedOk ? 'bg-gray-50 text-gray-600 border-gray-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
              {lang === 'ja' ? '出荷済合計' : '品項已出貨'}: {sumShipped} / {parentShippedBoxes} {shippedOk ? '✓' : '⚠'}
            </span>
            {(!totalOk || !shippedOk) && (
              <span className="text-amber-700">
                {lang === 'ja' ? '※ 親バッチと不一致' : '※ 與母批次不一致'}
              </span>
            )}
          </div>
        )
      })()}

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="px-3 py-2 text-xs text-gray-400">{T.loading}</div>
        ) : items.length === 0 && !adding ? (
          <div className="px-3 py-3 text-xs text-gray-400 text-center">
            {lang === 'ja' ? '商品明細はまだありません' : '尚無品項明細，點上方「+ 新增品項」開始'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">{lang === 'ja' ? '品名' : '品名'}</th>
                <th className="px-2 py-1.5 text-right font-medium">{T.boxes}</th>
                <th className="px-2 py-1.5 text-right font-medium">{T.shipped}</th>
                <th className="px-2 py-1.5 text-center font-medium">{T.deliveryStatus}</th>
                <th className="px-2 py-1.5 text-left font-medium">{lang === 'ja' ? '備考' : '備註'}</th>
                <th className="px-2 py-1.5 text-right font-medium w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(it => (
                editingId === it.id ? (
                  <EditRow key={it.id} draft={draft} setDraft={setDraft} onSave={save} onCancel={cancelEdit} lang={lang} autoShipped={hasExcel} />
                ) : (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="px-2 py-1.5 font-medium text-gray-800">{it.productName}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700">{it.boxes ?? 0}</td>
                    <td className={`px-2 py-1.5 text-right ${hasExcel && derivedMap.has(it.productName) ? 'text-blue-600' : 'text-gray-700'}`}>
                      {liveShipped(it)}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${STATUS_STYLE[it.status ?? '待出貨'] ?? STATUS_STYLE['待出貨']}`}>
                        {it.status ?? '待出貨'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-gray-500 max-w-[120px] truncate">
                      {it.remarks ? (
                        <span className="text-yellow-700 bg-yellow-50 px-1 py-0.5 rounded text-[10px]">{it.remarks}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(it)} className="text-gray-400 hover:text-lopia-red mr-2 cursor-pointer">✎</button>
                      <button onClick={() => remove(it)} className="text-gray-400 hover:text-red-500 cursor-pointer">✕</button>
                    </td>
                  </tr>
                )
              ))}
              {adding && (
                <EditRow draft={draft} setDraft={setDraft} onSave={save} onCancel={cancelEdit} lang={lang} autoShipped={hasExcel} />
              )}
            </tbody>
          </table>
        )}
      </div>

      {showAuth && (
        <PasswordModal
          lang={lang}
          onSuccess={() => {
            setShowAuth(false)
            const fn = pendingAction
            setPendingAction(null)
            fn?.()
          }}
          onCancel={() => { setShowAuth(false); setPendingAction(null) }}
        />
      )}
    </div>
  )
}

function EditRow({
  draft, setDraft, onSave, onCancel, lang, autoShipped,
}: {
  draft: DraftItem
  setDraft: (d: DraftItem) => void
  onSave: () => void
  onCancel: () => void
  lang: Lang
  autoShipped: boolean
}) {
  return (
    <tr className="bg-yellow-50">
      <td className="px-1 py-1">
        <input
          autoFocus
          value={draft.productName}
          onChange={e => setDraft({ ...draft, productName: e.target.value })}
          placeholder={lang === 'ja' ? '品名' : '品名'}
          className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-lopia-red"
        />
      </td>
      <td className="px-1 py-1">
        <input
          type="number" min="0"
          value={draft.boxes}
          onChange={e => setDraft({ ...draft, boxes: e.target.value })}
          className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-lopia-red"
        />
      </td>
      <td className="px-1 py-1 text-right">
        {autoShipped ? (
          <span className="text-[10px] text-gray-400" title={lang === 'ja' ? '出荷済は配送計画から自動計算' : '已出貨由出貨計畫自動計算'}>
            {lang === 'ja' ? '自動' : '自動'}
          </span>
        ) : (
          <input
            type="number" min="0"
            value={draft.shippedBoxes}
            onChange={e => setDraft({ ...draft, shippedBoxes: e.target.value })}
            className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-lopia-red"
          />
        )}
      </td>
      <td className="px-1 py-1">
        <select
          value={draft.status}
          onChange={e => setDraft({ ...draft, status: e.target.value })}
          className="border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-lopia-red"
        >
          {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="px-1 py-1">
        <input
          value={draft.remarks}
          onChange={e => setDraft({ ...draft, remarks: e.target.value })}
          placeholder={lang === 'ja' ? '備考...' : '備註...'}
          className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-lopia-red"
        />
      </td>
      <td className="px-1 py-1 text-right whitespace-nowrap">
        <button onClick={onSave} className="text-emerald-600 hover:text-emerald-700 mr-2 font-bold cursor-pointer">✓</button>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 cursor-pointer">✕</button>
      </td>
    </tr>
  )
}
