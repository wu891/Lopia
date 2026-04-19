'use client'
import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/Header'
import PasswordModal, { isAuthed, markAuthed, logChange } from '@/components/PasswordModal'
import { FurikomiRecord, Shipment, ShipmentRecord } from '@/lib/notion'

function getDefaultMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtYen(n: number): string {
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

// ── Derived row calculations ──────────────────────────────────────────────────

interface RowData {
  rec: FurikomiRecord
  batch: Shipment | undefined
  totalBoxes: number
  monthlyBoxes: number
  remainingBoxes: number
  soldCost: number
  transferAmount: number
}

function deriveRow(rec: FurikomiRecord, shipments: Shipment[], allRecords: ShipmentRecord[], month: string): RowData {
  const batch = shipments.find(s => s.id === rec.batchId)
  const totalBoxes = batch?.totalBoxes ?? 0

  const monthlyBoxes = allRecords
    .filter(r => r.batchId === rec.batchId && r.date?.startsWith(month) && r.planStatus !== '已取消')
    .reduce((sum, r) => sum + (r.boxes ?? 0), 0)

  const allShipped = allRecords
    .filter(r => r.batchId === rec.batchId && r.planStatus !== '已取消')
    .reduce((sum, r) => sum + (r.boxes ?? 0), 0)

  const remainingBoxes = Math.max(0, totalBoxes - allShipped)

  const soldCost = totalBoxes > 0 ? (rec.originalCost ?? 0) * (monthlyBoxes / totalBoxes) : 0
  const transferAmount = soldCost - (rec.fumigationFee ?? 0) - (rec.pesticideFee ?? 0)

  return { rec, batch, totalBoxes, monthlyBoxes, remainingBoxes, soldCost, transferAmount }
}

// ── Add Modal ─────────────────────────────────────────────────────────────────

interface AddModalProps {
  shipments: Shipment[]
  targetMonth: string
  onSave: (data: { batchId: string; batchIVName: string; originalCost: number; fumigationFee?: number; pesticideFee?: number }) => Promise<void>
  onClose: () => void
}

function AddModal({ shipments, targetMonth, onSave, onClose }: AddModalProps) {
  const [batchId, setBatchId] = useState('')
  const [originalCost, setOriginalCost] = useState('')
  const [fumigationFee, setFumigationFee] = useState('')
  const [pesticideFee, setPesticideFee] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectedBatch = shipments.find(s => s.id === batchId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!batchId || !originalCost) { setError('請選擇批次並填入原価合計'); return }
    setSaving(true)
    setError('')
    try {
      await onSave({
        batchId,
        batchIVName: selectedBatch?.ivName ?? batchId,
        originalCost: Number(originalCost),
        fumigationFee: fumigationFee ? Number(fumigationFee) : undefined,
        pesticideFee: pesticideFee ? Number(pesticideFee) : undefined,
      })
      onClose()
    } catch {
      setError('儲存失敗，請重試')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-gray-900 text-base">新增批次 — {targetMonth}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">批次 <span className="text-red-500">*</span></label>
            <select
              value={batchId}
              onChange={e => setBatchId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red/30 focus:border-lopia-red"
            >
              <option value="">— 選擇批次 —</option>
              {shipments.map(s => (
                <option key={s.id} value={s.id}>{s.ivName}{s.productSummary ? `（${s.productSummary}）` : ''}</option>
              ))}
            </select>
            {selectedBatch && (
              <p className="text-xs text-gray-400 mt-1">入倉：{selectedBatch.totalBoxes ?? '—'} 箱　{selectedBatch.warehouseIn ?? ''}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">原価合計（JPY）<span className="text-red-500">*</span></label>
            <input
              type="number" min="0" step="1"
              value={originalCost} onChange={e => setOriginalCost(e.target.value)}
              placeholder="例：250000"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red/30 focus:border-lopia-red"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">燻煙費（JPY）</label>
              <input
                type="number" min="0" step="1"
                value={fumigationFee} onChange={e => setFumigationFee(e.target.value)}
                placeholder="無則留空"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red/30 focus:border-lopia-red"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">農薬検査費（JPY）</label>
              <input
                type="number" min="0" step="1"
                value={pesticideFee} onChange={e => setPesticideFee(e.target.value)}
                placeholder="無則留空"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red/30 focus:border-lopia-red"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              取消
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-2 rounded-lg bg-lopia-red text-white text-sm font-medium hover:bg-lopia-red-dark transition-colors disabled:opacity-60">
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Inline fee edit ───────────────────────────────────────────────────────────

interface FeeInputProps {
  value: number | null
  onSave: (v: number | null) => void
}

function FeeInput({ value, onSave }: FeeInputProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-right w-full hover:text-lopia-red transition-colors cursor-pointer"
        title="點擊編輯"
      >
        {value != null ? fmtYen(value) : <span className="text-gray-300">—</span>}
      </button>
    )
  }

  return (
    <input
      autoFocus
      type="number" min="0" step="1"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { onSave(draft ? Number(draft) : null); setEditing(false) }}
      onKeyDown={e => { if (e.key === 'Enter') { onSave(draft ? Number(draft) : null); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
      className="w-full border border-lopia-red rounded px-1 py-0.5 text-xs text-right focus:outline-none"
    />
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FurikomiPage() {
  const [lang, setLang] = useState<'zh' | 'ja'>('zh')
  const [month, setMonth] = useState(getDefaultMonth)

  const [furikomiRecords, setFurikomiRecords] = useState<FurikomiRecord[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [allRecords, setAllRecords] = useState<ShipmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchData = useCallback(async (m: string) => {
    setLoading(true)
    setError(null)
    try {
      const [fRes, sRes, rRes] = await Promise.all([
        fetch(`/api/furikomi?month=${m}`, { cache: 'no-store' }),
        fetch('/api/shipments', { cache: 'no-store' }),
        fetch('/api/records', { cache: 'no-store' }),
      ])
      if (!fRes.ok || !sRes.ok || !rRes.ok) throw new Error('fetch failed')
      const [fData, sData, rData] = await Promise.all([fRes.json(), sRes.json(), rRes.json()])
      setFurikomiRecords(fData.records)
      setShipments(sData.shipments)
      setAllRecords(rData.records)
    } catch {
      setError('資料載入失敗，請重試')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(month) }, [fetchData, month])

  function requireAuth(fn: () => void) {
    if (isAuthed()) { fn() } else { setPendingAction(() => fn); setShowPassword(true) }
  }

  async function handleAdd(data: { batchId: string; batchIVName: string; originalCost: number; fumigationFee?: number; pesticideFee?: number }) {
    await fetch('/api/furikomi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, targetMonth: month }),
    })
    await logChange('新增振込批次', data.batchIVName, `${month} 原価¥${data.originalCost}`)
    await fetchData(month)
  }

  async function handleDelete(rec: FurikomiRecord) {
    if (!confirm(`確定刪除「${rec.name}」？`)) return
    requireAuth(async () => {
      await fetch(`/api/furikomi/${rec.id}`, { method: 'DELETE' })
      await logChange('刪除振込批次', rec.name, month)
      await fetchData(month)
    })
  }

  async function handleFeeUpdate(rec: FurikomiRecord, field: 'fumigationFee' | 'pesticideFee', value: number | null) {
    requireAuth(async () => {
      await fetch(`/api/furikomi/${rec.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      await logChange('更新振込費用', rec.name, `${field}=${value}`)
      setFurikomiRecords(prev => prev.map(r => r.id === rec.id ? { ...r, [field]: value } : r))
    })
  }

  const rows = furikomiRecords.map(rec => deriveRow(rec, shipments, allRecords, month))
  const totalTransfer = rows.reduce((sum, r) => sum + r.transferAmount, 0)

  function buildCopyText(): string {
    const [y, mo] = month.split('-')
    const lines = [
      `${y}年${mo}月 振込明細`,
      '─────────────────────────',
    ]
    for (const r of rows) {
      const ivName = r.batch?.ivName ?? r.rec.name
      const product = r.batch?.productSummary ?? ''
      lines.push(`${ivName}${product ? `（${product}）` : ''}`)
      lines.push(`  本月出貨：${r.monthlyBoxes}箱 / ${r.totalBoxes}箱`)
      lines.push(`  已售原価：${fmtYen(r.soldCost)}`)
      if (r.rec.fumigationFee) lines.push(`  燻煙費：${fmtYen(r.rec.fumigationFee)}`)
      if (r.rec.pesticideFee) lines.push(`  農薬検査費：${fmtYen(r.rec.pesticideFee)}`)
      lines.push(`  本月應匯：${fmtYen(r.transferAmount)}`)
      lines.push('')
    }
    lines.push('─────────────────────────')
    lines.push(`合計應匯：${fmtYen(totalTransfer)}`)
    return lines.join('\n')
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(buildCopyText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const [y, mo] = month.split('-')
  const monthLabel = `${y}年${mo}月`

  return (
    <div className="min-h-screen bg-gray-50">
      <Header lang={lang} setLang={setLang} lastUpdated={null} onRefresh={() => fetchData(month)} />

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

      {showAdd && (
        <AddModal
          shipments={shipments}
          targetMonth={month}
          onSave={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Page header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <a href="/" className="text-xs text-gray-400 hover:text-lopia-red transition-colors">← 返回主頁</a>
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-1 py-1 shadow-sm">
              <button onClick={() => setMonth(prevMonth)} className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-500">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <span className="text-sm font-semibold text-gray-800 px-2">{monthLabel} 振込明細</span>
              <button onClick={() => setMonth(nextMonth)} className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-500">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </div>

          <button
            onClick={() => requireAuth(() => setShowAdd(true))}
            className="flex items-center gap-1.5 bg-lopia-red text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-lopia-red-dark transition-colors shadow-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            新增批次
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">載入中…</div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <p className="text-red-500 text-sm">{error}</p>
            <button onClick={() => fetchData(month)} className="text-xs text-lopia-red underline">重試</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col items-center py-16 gap-3">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <p className="text-gray-400 text-sm">{monthLabel} 尚無振込明細</p>
            <button
              onClick={() => requireAuth(() => setShowAdd(true))}
              className="text-xs text-lopia-red underline"
            >新增第一筆批次</button>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 font-medium">
                      <th className="text-left px-4 py-3">IV 番号</th>
                      <th className="text-left px-4 py-3">商品</th>
                      <th className="text-right px-4 py-3">入倉箱</th>
                      <th className="text-right px-4 py-3">本月出貨</th>
                      <th className="text-right px-4 py-3">庫存剩餘</th>
                      <th className="text-right px-4 py-3">原価合計</th>
                      <th className="text-right px-4 py-3">已售原価</th>
                      <th className="text-right px-4 py-3">燻煙費</th>
                      <th className="text-right px-4 py-3">農薬費</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-700">本月應匯</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.rec.id} className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">
                          {r.batch?.ivName ?? r.rec.name}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs max-w-[140px] truncate">
                          {r.batch?.productSummary ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{r.totalBoxes > 0 ? r.totalBoxes : '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={r.monthlyBoxes > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}>
                            {r.monthlyBoxes}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={r.remainingBoxes === 0 ? 'text-green-600 font-medium' : r.remainingBoxes <= (r.totalBoxes * 0.2) ? 'text-orange-500 font-medium' : 'text-gray-700'}>
                            {r.remainingBoxes}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {r.rec.originalCost != null ? fmtYen(r.rec.originalCost) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-blue-700 font-medium">
                          {r.monthlyBoxes > 0 ? fmtYen(r.soldCost) : <span className="text-gray-300">¥0</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-orange-600 w-28">
                          <FeeInput
                            value={r.rec.fumigationFee}
                            onSave={v => handleFeeUpdate(r.rec, 'fumigationFee', v)}
                          />
                        </td>
                        <td className="px-4 py-3 text-right text-orange-600 w-28">
                          <FeeInput
                            value={r.rec.pesticideFee}
                            onSave={v => handleFeeUpdate(r.rec, 'pesticideFee', v)}
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                          {fmtYen(r.transferAmount)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDelete(r.rec)}
                            className="text-gray-300 hover:text-red-400 transition-colors"
                            title="刪除"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary footer */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">本月合計應匯 City Seika</p>
                <p className="text-2xl font-bold text-gray-900">{fmtYen(totalTransfer)}</p>
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:border-lopia-red hover:text-lopia-red transition-colors"
              >
                {copied ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    已複製
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    複製明細文字
                  </>
                )}
              </button>
            </div>

            {/* Legend */}
            <p className="text-xs text-gray-400 mt-3 text-center">
              庫存剩餘：
              <span className="text-green-600 font-medium">綠色</span>=全數售完
              <span className="text-orange-500 font-medium">橙色</span>=剩餘≤20%
              燻煙費／農薬費欄位可點擊直接編輯
            </p>
          </>
        )}
      </div>
    </div>
  )
}
