'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Header from '@/components/Header'
import PasswordModal, { isAuthed, markAuthed, logChange } from '@/components/PasswordModal'
import type { BatchMargin, RevenueSource } from '@/lib/margin'

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}
function pct(r: number): string {
  return (r * 100).toFixed(1) + '%'
}
function recDateRange(b: BatchMargin): string {
  const ds = b.rows.map(r => r.record.date).filter(Boolean).sort() as string[]
  if (ds.length === 0) return b.batch.warehouseIn ?? b.batch.arrivalTW ?? ''
  const a = ds[0]!.slice(5), z = ds[ds.length - 1]!.slice(5)
  return a === z ? a : `${a}–${z}`
}

// ── 成本編輯面板 ───────────────────────────────────────────────────────────────
interface CostEditorProps {
  b: BatchMargin
  onSave: (data: {
    importCost: number; freightCost: number; storageCost: number
    costCurrency: string; taxMode: string
  }) => Promise<void>
  onClose: () => void
}
function CostEditor({ b, onSave, onClose }: CostEditorProps) {
  const prefillImport = Math.round(b.importCostFull * (b.currency === 'JPY' ? 4.5 : 1))
  const [importCost, setImportCost] = useState(String(prefillImport || ''))
  const [freight, setFreight] = useState(b.batch.freightCost != null ? String(b.batch.freightCost) : '')
  const [storage, setStorage] = useState(b.batch.storageCost != null ? String(b.batch.storageCost) : '')
  const [currency, setCurrency] = useState(b.currency)
  const [taxMode, setTaxMode] = useState(b.taxMode)
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    try {
      await onSave({
        importCost: Number(importCost) || 0,
        freightCost: Number(freight) || 0,
        storageCost: Number(storage) || 0,
        costCurrency: currency,
        taxMode,
      })
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'num mt-1 w-full px-2.5 py-1.5 rounded-md border border-gray-200 text-sm focus:border-lopia-red focus:outline-none'

  return (
    <div className="px-5 py-4 bg-gray-50 border-b border-gray-100">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <label className="text-[11px] text-gray-400">進貨成本（未稅）</label>
          <input value={importCost} onChange={e => setImportCost(e.target.value)} inputMode="numeric" className={inputCls} />
          <p className="text-[10px] mt-0.5 text-emerald-600">
            {b.costSource === 'furikomi' ? '↳ 已自振込明細帶入，可覆蓋'
              : b.costSource === 'manual' ? '↳ 手動設定值'
              : '↳ 振込明細無資料，請手動輸入'}
          </p>
        </div>
        <div>
          <label className="text-[11px] text-gray-400">運費</label>
          <input value={freight} onChange={e => setFreight(e.target.value)} inputMode="numeric" className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-gray-400">倉儲費</label>
          <input value={storage} onChange={e => setStorage(e.target.value)} inputMode="numeric" className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-gray-400">幣別</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} className={inputCls + ' bg-white'}>
            <option value="TWD">TWD</option>
            <option value="JPY">JPY（1:4.5）</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-400">課稅</label>
          <select value={taxMode} onChange={e => setTaxMode(e.target.value)} className={inputCls + ' bg-white'}>
            <option value="免稅">免稅</option>
            <option value="5%">5%（加工品）</option>
          </select>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={submit} disabled={saving}
          className="text-xs bg-lopia-red text-white px-4 py-1.5 rounded-md font-medium disabled:opacity-50">
          {saving ? '儲存中…' : '儲存'}
        </button>
        <button onClick={onClose} className="text-xs text-gray-500 px-4 py-1.5 rounded-md border border-gray-200">取消</button>
      </div>
    </div>
  )
}

// ── 主頁 ───────────────────────────────────────────────────────────────────────
export default function MarginPage() {
  const [lang, setLang] = useState<'zh' | 'ja'>('zh')
  const [batches, setBatches] = useState<BatchMargin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editingRecId, setEditingRecId] = useState<string | null>(null)

  const [showPassword, setShowPassword] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/margin', { cache: 'no-store' })
      if (!res.ok) throw new Error('fetch failed')
      const data = await res.json()
      setBatches(data.batches as BatchMargin[])
      setLastUpdated(data.lastUpdated ?? null)
    } catch {
      setError('資料載入失敗，請重試')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function requireAuth(fn: () => void) {
    if (isAuthed()) { fn() } else { setPendingAction(() => fn); setShowPassword(true) }
  }

  // 只顯示有出貨的批次，毛利低→高排序（虧損/薄利在前，最該關注）
  const shown = useMemo(
    () => batches.filter(b => b.shippedBoxes > 0).sort((a, b) => a.marginRate - b.marginRate),
    [batches],
  )

  // 整體合計
  const totals = useMemo(() => {
    const t = shown.reduce((acc, b) => ({
      boxes: acc.boxes + b.shippedBoxes,
      revenue: acc.revenue + b.revenue,
      imp: acc.imp + b.allocImport,
      log: acc.log + b.allocLogistics,
      margin: acc.margin + b.margin,
    }), { boxes: 0, revenue: 0, imp: 0, log: 0, margin: 0 })
    return { ...t, rate: t.revenue > 0 ? t.margin / t.revenue : 0 }
  }, [shown])

  const selected = useMemo(
    () => shown.find(b => b.batch.id === selectedId) ?? shown[0] ?? null,
    [shown, selectedId],
  )

  async function saveCost(b: BatchMargin, data: {
    importCost: number; freightCost: number; storageCost: number; costCurrency: string; taxMode: string
  }) {
    const res = await fetch(`/api/shipments/${b.batch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) { alert('儲存失敗，請確認權限或欄位'); return }
    await logChange('更新批次成本', b.batch.ivName, `進貨${data.importCost} 運${data.freightCost} 倉${data.storageCost} ${data.costCurrency}/${data.taxMode}`)
    setEditing(false)
    await fetchData()
  }

  function beginEditAmount(recId: string) {
    requireAuth(() => setEditingRecId(recId))
  }

  async function saveAmount(recId: string, amount: number) {
    const res = await fetch(`/api/records/${recId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })
    if (!res.ok) { alert('儲存失敗，請確認權限'); return }
    await logChange('補出貨營收', recId.slice(0, 8), String(amount))
    setEditingRecId(null)
    await fetchData()
  }

  const [writingBack, setWritingBack] = useState(false)

  // 一鍵寫回：把本批「金額尚空、但已由對帳/批價推算出」的列，寫進 Notion 金額欄
  async function writebackBatch(b: BatchMargin) {
    const targets = b.rows.filter(
      r => r.record.amount == null && r.derivedAmount != null &&
        (r.revenueSource === 'excel' || r.revenueSource === 'batchPrice'),
    )
    if (targets.length === 0) return
    if (!confirm(`將把 ${targets.length} 筆推算營收寫回 Notion（僅寫目前金額為空的列，手動填過的不動）。確定？`)) return
    setWritingBack(true)
    let ok = 0, fail = 0
    try {
      for (const r of targets) {
        const amount = Math.round(r.derivedAmount as number)
        const res = await fetch(`/api/records/${r.record.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount }),
        })
        if (res.ok) ok++; else fail++
      }
      await logChange('一鍵寫回營收', b.batch.ivName, `成功${ok} 失敗${fail}（共${targets.length}）`)
      await fetchData()
      if (fail > 0) alert(`完成：成功 ${ok} 筆，失敗 ${fail} 筆（請確認權限）`)
    } finally {
      setWritingBack(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header lang={lang} setLang={setLang} lastUpdated={lastUpdated} onRefresh={fetchData} />

      {showPassword && (
        <PasswordModal
          lang={lang}
          onSuccess={() => {
            markAuthed()
            setShowPassword(false)
            if (pendingAction) { pendingAction(); setPendingAction(null) }
          }}
          onCancel={() => { setShowPassword(false); setPendingAction(null) }}
        />
      )}

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* 標題 */}
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="font-heading text-2xl font-bold text-gray-900">毛利系統</h2>
            <p className="text-sm text-gray-500 mt-0.5">每批進口 → 展開每一次出貨的毛利。營收取自出貨紀錄，成本＝進貨＋運費＋倉儲（按箱數分攤）。</p>
          </div>
        </div>

        {loading && <div className="text-center py-20 text-gray-400 text-sm">載入中…</div>}
        {error && !loading && (
          <div className="text-center py-20">
            <p className="text-gray-500 text-sm">{error}</p>
            <button onClick={fetchData} className="mt-3 text-xs bg-lopia-red text-white px-4 py-1.5 rounded-md">重試</button>
          </div>
        )}
        {!loading && !error && shown.length === 0 && (
          <div className="text-center py-20 text-gray-400 text-sm">目前沒有已出貨的批次。</div>
        )}

        {!loading && !error && shown.length > 0 && (
          <>
            {/* 整體合計 */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
              <Stat label="出貨箱數" value={`${fmt(totals.boxes)} 箱`} />
              <Stat label="營收（未稅）" value={fmt(totals.revenue)} />
              <Stat label="進貨成本" value={fmt(totals.imp)} />
              <Stat label="運費＋倉儲" value={fmt(totals.log)} />
              <div className={`rounded-xl border p-3.5 ${totals.margin < 0 ? 'bg-lopia-red-light border-lopia-red/30' : 'bg-emerald-50 border-emerald-200'}`}>
                <p className={`text-[11px] ${totals.margin < 0 ? 'text-lopia-red-dark' : 'text-emerald-700'}`}>總毛利 / 毛利率</p>
                <p className={`num text-xl font-bold mt-0.5 ${totals.margin < 0 ? 'text-lopia-red-dark' : 'text-emerald-700'}`}>
                  {totals.margin >= 0 ? '+' : ''}{fmt(totals.margin)} <span className="text-sm">· {pct(totals.rate)}</span>
                </p>
              </div>
            </div>

            {/* 批次卡片 */}
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">各批次毛利（點選展開出貨明細）</label>
            <div className="mt-1.5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 mb-6">
              {shown.map(b => {
                const loss = b.margin < 0
                const active = selected?.batch.id === b.batch.id
                return (
                  <button key={b.batch.id} onClick={() => { setSelectedId(b.batch.id); setEditing(false) }}
                    className={`text-left rounded-xl p-3 transition relative border-2
                      ${active ? 'border-lopia-red shadow-md ring-2 ring-lopia-red/15 bg-white'
                        : loss ? 'border-lopia-red bg-lopia-red-light'
                        : 'border-gray-200 bg-white hover:border-lopia-red'}`}>
                    {loss && <span className="absolute -top-2 -right-2 text-[10px] bg-lopia-red text-white px-1.5 py-0.5 rounded-full font-bold">虧損</span>}
                    <p className="text-xs text-gray-500 truncate">{recDateRange(b)} · {b.batch.ivName}</p>
                    <p className={`num text-sm font-bold mt-1 ${loss ? 'text-lopia-red' : 'text-gray-900'}`}>
                      {b.margin >= 0 ? '+' : ''}{fmt(b.margin)}
                    </p>
                    <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full ${loss ? 'bg-lopia-red' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, Math.abs(b.marginRate) * 100 * 4)}%` }} />
                    </div>
                    <p className={`num text-[11px] font-medium mt-1 ${loss ? 'text-lopia-red' : 'text-emerald-600'}`}>{pct(b.marginRate)}</p>
                  </button>
                )
              })}
            </div>

            {/* 選中批次明細 */}
            {selected && <BatchDetail key={selected.batch.id} b={selected} editing={editing}
              onEdit={() => requireAuth(() => setEditing(true))}
              onCloseEdit={() => setEditing(false)}
              onSave={(d) => saveCost(selected, d)}
              editingRecId={editingRecId}
              onBeginEditAmount={beginEditAmount}
              onSaveAmount={saveAmount}
              onCancelEditAmount={() => setEditingRecId(null)}
              writingBack={writingBack}
              onWriteback={() => requireAuth(() => writebackBatch(selected))} />}
          </>
        )}

        <p className="text-center text-[11px] text-gray-300 mt-6">毛利系統 · 進貨成本未填時自振込明細預帶 · JPY 以 1:4.5 換算 · 加工品營收 ÷1.05 取未稅</p>
      </main>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="num text-xl font-bold text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}

function BatchDetail({ b, editing, onEdit, onCloseEdit, onSave, editingRecId, onBeginEditAmount, onSaveAmount, onCancelEditAmount, writingBack, onWriteback }: {
  b: BatchMargin; editing: boolean; onEdit: () => void; onCloseEdit: () => void
  onSave: (d: { importCost: number; freightCost: number; storageCost: number; costCurrency: string; taxMode: string }) => Promise<void>
  editingRecId: string | null
  onBeginEditAmount: (recId: string) => void
  onSaveAmount: (recId: string, amount: number) => Promise<void>
  onCancelEditAmount: () => void
  writingBack: boolean
  onWriteback: () => void
}) {
  const loss = b.margin < 0
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* 標題列 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-bold text-gray-900 truncate">
            {b.batch.ivName}
            <span className="text-gray-400 font-normal text-sm"> · {fmt(b.shippedBoxes)}/{fmt(b.totalBoxes)} 箱已出</span>
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {b.batch.supplier ? `供應商：${b.batch.supplier} · ` : ''}{b.currency} · {b.taxMode}
            {b.costSource === 'none' && <span className="text-amber-600"> · ⚠ 尚未設定進貨成本</span>}
            {b.missingPrice > 0 && <span className="text-amber-600"> · ⚠ {b.missingPrice} 筆抓不到單價（去對帳單補）</span>}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {b.pendingWriteback > 0 && (
            <button onClick={onWriteback} disabled={writingBack}
              className="flex items-center gap-1.5 text-xs bg-lopia-red text-white px-3 py-1.5 rounded-md font-medium hover:bg-lopia-red-dark disabled:opacity-50"
              title="把對帳/批價推算出的營收，寫進 Notion 出貨紀錄的金額欄（僅寫目前為空的列）">
              {writingBack ? '寫回中…' : `一鍵寫回 ${b.pendingWriteback} 筆營收`}
            </button>
          )}
          <button onClick={onEdit}
            className="flex items-center gap-1.5 text-xs text-lopia-red border border-lopia-red px-3 py-1.5 rounded-md font-medium hover:bg-lopia-red-light">
            編輯本批成本
          </button>
        </div>
      </div>

      {editing && <CostEditor b={b} onSave={onSave} onClose={onCloseEdit} />}

      {/* 摘要卡 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-gray-100">
        <SumCell label="營收（未稅）" value={fmt(b.revenue)} />
        <SumCell label="進貨成本（分攤）" value={fmt(b.allocImport)} />
        <SumCell label="運費＋倉儲（分攤）" value={fmt(b.allocLogistics)} />
        <SumCell label="毛利" value={`${b.margin >= 0 ? '+' : ''}${fmt(b.margin)}`} tone={loss ? 'loss' : 'good'} />
        <div className={`p-4 ${loss ? 'bg-lopia-red-light' : 'bg-emerald-50'}`}>
          <p className={`text-[11px] ${loss ? 'text-lopia-red-dark' : 'text-emerald-700'}`}>毛利率</p>
          <p className={`num text-lg font-bold mt-1 ${loss ? 'text-lopia-red' : 'text-emerald-700'}`}>{pct(b.marginRate)}</p>
        </div>
      </div>

      {/* 出貨明細表 */}
      <div className="px-5 pt-4 pb-1">
        <p className="text-xs font-semibold text-gray-500">出貨明細（共 {b.rows.length} 筆 · {fmt(b.shippedBoxes)} 箱）</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 border-b border-gray-100">
              <th className="text-left font-medium px-5 py-2">出貨日</th>
              <th className="text-left font-medium px-3 py-2">門市</th>
              <th className="text-right font-medium px-3 py-2">箱數</th>
              <th className="text-right font-medium px-3 py-2">營收</th>
              <th className="text-right font-medium px-3 py-2">分攤進貨</th>
              <th className="text-right font-medium px-3 py-2">分攤物流</th>
              <th className="text-right font-medium px-3 py-2">毛利</th>
              <th className="text-right font-medium px-5 py-2">毛利率</th>
            </tr>
          </thead>
          <tbody className="num">
            {b.rows.map((r, i) => {
              const rl = r.margin < 0
              return (
                <tr key={r.record.id} className={`border-b border-gray-50 hover:bg-gray-50 ${i === b.rows.length - 1 ? 'border-b-0' : ''}`}>
                  <td className="px-5 py-2.5 text-gray-600">{r.record.date?.slice(5) ?? '—'}{r.isFuture && <span className="ml-1 text-[10px] text-amber-500">預定</span>}</td>
                  <td className="px-3 py-2.5 font-sans">{r.record.store ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right">{fmt(r.boxes)}</td>
                  <RevenueCell
                    rawAmount={r.record.amount}
                    display={r.revenue}
                    source={r.revenueSource}
                    editing={editingRecId === r.record.id}
                    onBegin={() => onBeginEditAmount(r.record.id)}
                    onSave={(v) => onSaveAmount(r.record.id, v)}
                    onCancel={onCancelEditAmount} />
                  <td className="px-3 py-2.5 text-right text-gray-400">{fmt(r.allocImport)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{fmt(r.allocLogistics)}</td>
                  <td className={`px-3 py-2.5 text-right font-semibold ${rl ? 'text-lopia-red' : 'text-emerald-600'}`}>{r.margin >= 0 ? '+' : ''}{fmt(r.margin)}</td>
                  <td className={`px-5 py-2.5 text-right ${rl ? 'text-lopia-red' : 'text-emerald-600'}`}>{pct(r.marginRate)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-bold border-t-2 border-gray-200 num">
              <td className="px-5 py-2.5" colSpan={2}>合計</td>
              <td className="px-3 py-2.5 text-right">{fmt(b.shippedBoxes)}</td>
              <td className="px-3 py-2.5 text-right">{fmt(b.revenue)}</td>
              <td className="px-3 py-2.5 text-right text-gray-500">{fmt(b.allocImport)}</td>
              <td className="px-3 py-2.5 text-right text-gray-500">{fmt(b.allocLogistics)}</td>
              <td className={`px-3 py-2.5 text-right ${loss ? 'text-lopia-red' : 'text-emerald-600'}`}>{b.margin >= 0 ? '+' : ''}{fmt(b.margin)}</td>
              <td className={`px-5 py-2.5 text-right ${loss ? 'text-lopia-red' : 'text-emerald-600'}`}>{pct(b.marginRate)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-5 py-3 text-[11px] text-gray-400 border-t border-gray-100">
        分攤進貨 = 進貨成本 × (該次箱數 / {fmt(b.totalBoxes)})　·　分攤物流 = (運費+倉儲) × (該次箱數 / {fmt(b.totalBoxes)})
      </div>
    </div>
  )
}

const SOURCE_TAG: Record<string, { label: string; cls: string; title: string }> = {
  manual:     { label: '手動', cls: 'text-gray-400',    title: '手動填寫的營收' },
  excel:      { label: '對帳', cls: 'text-emerald-500', title: '由對帳明細推算（箱數×單價），尚未寫回 Notion' },
  batchPrice: { label: '批價', cls: 'text-sky-500',     title: '由批次單價推算（箱數×單價），尚未寫回 Notion' },
}

function RevenueCell({ rawAmount, display, source, editing, onBegin, onSave, onCancel }: {
  rawAmount: number | null; display: number; source: RevenueSource; editing: boolean
  onBegin: () => void; onSave: (v: number) => Promise<void>; onCancel: () => void
}) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (editing) setDraft(rawAmount ? String(Math.round(rawAmount)) : '') }, [editing, rawAmount])

  if (editing) {
    return (
      <td className="px-3 py-2.5 text-right">
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} inputMode="numeric"
          disabled={saving}
          onBlur={onCancel}
          onKeyDown={async e => {
            if (e.key === 'Enter') { setSaving(true); await onSave(Number(draft) || 0); setSaving(false) }
            else if (e.key === 'Escape') onCancel()
          }}
          className="num w-24 px-1.5 py-0.5 rounded border border-lopia-red text-right text-sm focus:outline-none" />
      </td>
    )
  }
  // 推算值（對帳/批價）尚未寫回，以斜體點狀底線提示「點擊可寫入」
  const derived = source === 'excel' || source === 'batchPrice'
  const tag = SOURCE_TAG[source]
  return (
    <td className="px-3 py-2.5 text-right cursor-pointer hover:bg-lopia-red-light" title="點擊補/改營收" onMouseDown={e => { e.preventDefault(); onBegin() }}>
      {display > 0 ? (
        <span className="inline-flex items-center gap-1 justify-end">
          <span className={derived ? 'italic text-gray-600' : ''}>{fmt(display)}</span>
          {tag && <span className={`text-[9px] ${tag.cls}`} title={tag.title}>{tag.label}</span>}
        </span>
      ) : <span className="text-gray-300">＋補</span>}
    </td>
  )
}

function SumCell({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'loss' }) {
  const color = tone === 'loss' ? 'text-lopia-red' : tone === 'good' ? 'text-emerald-600' : 'text-gray-900'
  return (
    <div className="bg-white p-4">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className={`num text-lg font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}
