'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Shipment, ShipmentRecord } from '@/lib/notion'

interface RoundGroup {
  roundNo: number
  date: string | null
  stores: { name: string; boxes: number }[]
  status: string | null
}

function groupRecordsByRound(records: ShipmentRecord[]): RoundGroup[] {
  const map = new Map<number, RoundGroup>()
  for (const r of records) {
    const key = r.round ?? 0
    if (!map.has(key)) map.set(key, { roundNo: key, date: r.date ?? null, stores: [], status: r.planStatus ?? null })
    map.get(key)!.stores.push({ name: r.store ?? '', boxes: r.boxes ?? 0 })
  }
  return Array.from(map.values()).sort((a, b) => a.roundNo - b.roundNo)
}

// ── Password Gate ──────────────────────────────────────────────────────────────

function PasswordGate({ onAuth }: { onAuth: () => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/portal-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      if (res.ok) {
        sessionStorage.setItem('lopia_portal_authed', '1')
        onAuth()
      } else {
        setError('密碼錯誤，請重試。')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-lopia-red rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-800">LOPIA 出貨單系統</h1>
          <p className="text-sm text-gray-400 mt-1">請輸入管理員密碼</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">存取密碼</label>
            <input
              type="password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="請輸入密碼"
              autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-lopia-red"
            />
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
          </div>
          <button
            type="submit"
            disabled={!pw || loading}
            className="w-full py-3 bg-lopia-red text-white font-semibold rounded-xl text-base disabled:opacity-40 active:opacity-80 transition-opacity"
          >
            {loading ? '驗證中...' : '進入'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Shipment Report (依 skill：彙總清單 + 純數字列 + 格式 Checklist) ──────────────

interface SummaryItem { name: string; boxSpec: string; total: number }
type ChecklistRec = Record<string, boolean | number>

function parseReportHeaders(res: Response): {
  summary: SummaryItem[]
  numbers: string
  checklist: ChecklistRec | null
} {
  const summaryRaw = res.headers.get('X-Summary') ?? ''
  const numbersRaw = res.headers.get('X-Numbers') ?? ''
  const checklistRaw = res.headers.get('X-Checklist') ?? ''
  let summary: SummaryItem[] = []
  let checklist: ChecklistRec | null = null
  try { if (summaryRaw) summary = JSON.parse(decodeURIComponent(summaryRaw)) } catch { /* noop */ }
  try { if (checklistRaw) checklist = JSON.parse(decodeURIComponent(checklistRaw)) } catch { /* noop */ }
  return { summary, numbers: numbersRaw ? decodeURIComponent(numbersRaw) : '', checklist }
}

function ShipmentReport({
  summary, numbers, checklist,
}: { summary: SummaryItem[]; numbers: string; checklist: ChecklistRec | null }) {
  return (
    <div className="space-y-2">
      {summary.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-emerald-700 mb-1.5">📦 本次出貨彙總</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-emerald-200">
                <th className="text-left pb-1 font-medium">商品名稱</th>
                <th className="text-right pb-1 font-medium pr-4">入數</th>
                <th className="text-right pb-1 font-medium">總箱數</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((item, i) => (
                <tr key={i} className="border-b border-emerald-100">
                  <td className="py-0.5 text-gray-700 truncate max-w-[220px]">{item.name}</td>
                  <td className="py-0.5 text-gray-500 text-right pr-4">{item.boxSpec}</td>
                  <td className={`py-0.5 text-right font-medium ${item.total === 0 ? 'text-gray-300' : 'text-gray-800'}`}>
                    {item.total} 箱
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="pt-1.5 font-semibold text-emerald-700">總計</td>
                <td className="pt-1.5 text-right font-bold text-emerald-700">
                  {summary.reduce((s, i) => s + i.total, 0)} 箱
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {numbers && (
        <details>
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
            純數字列（庫存管理貼上用）
          </summary>
          <pre className="mt-1 text-xs bg-white border border-emerald-100 rounded p-2 text-gray-600 select-all whitespace-pre">
{numbers}
          </pre>
        </details>
      )}
      {checklist && (
        <details>
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
            📋 格式確認
          </summary>
          <ul className="mt-1 text-xs bg-white border border-emerald-100 rounded p-2 space-y-0.5">
            {Object.entries(checklist).map(([k, v]) => (
              <li key={k} className="text-gray-600">
                {typeof v === 'boolean' ? (v ? '☑' : '☒') : '•'} {k}
                {typeof v === 'number' ? `：${v}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// ── Round Row ──────────────────────────────────────────────────────────────────

function RoundRow({
  round,
  batchId,
  batchName,
  supplierExcelId,
}: {
  round: RoundGroup
  batchId: string
  batchName: string
  supplierExcelId: string | null
}) {
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<{
    driveUrl: string; shipmentNo: string
    summary: SummaryItem[]; numbers: string; checklist: ChecklistRec | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/generate-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, roundNo: round.roundNo }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? '產生失敗')
        return
      }
      const blob = await res.blob()
      const driveUrl = res.headers.get('X-Drive-Url') ?? ''
      const shipmentNo = res.headers.get('X-Shipment-No') ?? ''
      const report = parseReportHeaders(res)
      // skill 命名：檔名已由 API 決定（Content-Disposition），UI 端沿用下載時的標準命名
      const productTag = batchName.replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${shipmentNo}_${productTag}_店鋪貨單.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      setResult({ driveUrl, shipmentNo, ...report })
    } catch {
      setError('網路錯誤，請稍後再試')
    } finally {
      setGenerating(false)
    }
  }

  const totalBoxes = round.stores.reduce((s, r) => s + r.boxes, 0)
  const dateStr = round.date?.slice(5).replace('-', '/') ?? '—'

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 rounded-lg transition-colors">
      <div className="w-7 h-7 rounded-full bg-lopia-red/10 text-lopia-red flex items-center justify-center text-xs font-bold shrink-0">
        {round.roundNo}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-700">{dateStr}</span>
          <span className="text-xs text-gray-400">{totalBoxes} 箱</span>
          <span className="text-xs text-gray-400 truncate hidden sm:inline">
            {round.stores.map(s => `${s.name}(${s.boxes})`).join('、')}
          </span>
        </div>
        {result && (
          <div className="mt-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-emerald-600 font-medium">✓ {result.shipmentNo} 已產生</span>
              {result.driveUrl && (
                <a href={result.driveUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline">
                  Drive 連結 →
                </a>
              )}
            </div>
            <div className="border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">
              <ShipmentReport summary={result.summary} numbers={result.numbers} checklist={result.checklist} />
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
      </div>
      {supplierExcelId ? (
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lopia-red text-white text-xs font-medium hover:bg-lopia-red-dark transition-colors disabled:opacity-50"
        >
          {generating ? (
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75"/>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          )}
          {generating ? '產生中...' : '產生出貨單'}
        </button>
      ) : (
        <span className="shrink-0 text-xs text-gray-300 italic">尚未上傳供應商Excel</span>
      )}
    </div>
  )
}

// ── Batch Card ─────────────────────────────────────────────────────────────────

function BatchCard({
  shipment,
  records,
  onRefresh,
}: {
  shipment: Shipment & { shippedBoxes?: number }
  records: ShipmentRecord[]
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const batchRecords = records.filter(r => r.batchId === shipment.id)
  const rounds = groupRecordsByRound(batchRecords)
  const arrivalStr = shipment.arrivalTW?.slice(5).replace('-', '/') ?? '—'

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadMsg(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('batch', shipment.ivName)
      form.append('docType', '供應商配送Excel')
      const upRes = await fetch('/api/upload', { method: 'POST', body: form })
      if (!upRes.ok) throw new Error('上傳失敗')
      const { fileId } = await upRes.json()
      const saveRes = await fetch('/api/shipments/supplier-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: shipment.id, fileId }),
      })
      if (!saveRes.ok) throw new Error('儲存失敗')
      setUploadMsg({ ok: true, text: '✓ 供應商 Excel 已更新' })
      onRefresh()
    } catch (err) {
      setUploadMsg({ ok: false, text: err instanceof Error ? err.message : '上傳失敗' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const DELIVERY_COLOR: Record<string, string> = {
    '待出貨': 'bg-gray-100 text-gray-500',
    '部分出貨': 'bg-amber-50 text-amber-600',
    '全數出貨': 'bg-emerald-50 text-emerald-600',
  }
  const badgeCls = shipment.deliveryStatus
    ? (DELIVERY_COLOR[shipment.deliveryStatus] ?? 'bg-gray-100 text-gray-500')
    : 'bg-gray-100 text-gray-400'

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors text-left"
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`text-gray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-800 text-sm">{shipment.ivName}</span>
            {shipment.supplier && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-500 border border-blue-100 shrink-0">
                {shipment.supplier}
              </span>
            )}
            {shipment.deliveryStatus && (
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${badgeCls}`}>
                {shipment.deliveryStatus}
              </span>
            )}
          </div>
          {shipment.productSummary && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{shipment.productSummary}</p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 text-xs text-gray-500">
          <span className="hidden sm:flex items-center gap-1 text-gray-400">
            <span className="text-[10px]">抵台</span>
            <span className="font-medium text-gray-600 ml-0.5">{arrivalStr}</span>
          </span>
          {rounds.length > 0 && (
            <span className="text-gray-400 text-[11px]">{rounds.length} 輪</span>
          )}
          {shipment.supplierExcelId ? (
            <span className="text-emerald-500" title="已上傳供應商Excel">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </span>
          ) : (
            <span className="text-gray-300" title="未上傳供應商Excel">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </span>
          )}
        </div>
      </button>

      {/* Expandable rounds */}
      <div className={`grid transition-all duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-gray-100 px-3 py-2 space-y-0.5">
            {rounds.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-2">尚無出貨計畫</p>
            ) : (
              rounds.map(round => (
                <RoundRow
                  key={round.roundNo}
                  round={round}
                  batchId={shipment.id}
                  batchName={shipment.ivName}
                  supplierExcelId={shipment.supplierExcelId}
                />
              ))
            )}
          </div>

          {/* Bottom bar: upload supplier Excel */}
          <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-end gap-3">
            {uploadMsg && (
              <span className={`text-xs ${uploadMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                {uploadMsg.text}
              </span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:border-lopia-red hover:text-lopia-red transition-colors disabled:opacity-40"
            >
              {uploading ? (
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                  <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75"/>
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              )}
              {uploading ? '上傳中...' : shipment.supplierExcelId ? '重新上傳供應商 Excel' : '上傳供應商 Excel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Store codes from skill definition ─────────────────────────────────────────

// 依 LOPIA 出貨單 SKILL 店鋪主檔（13 間）
const SKILL_STORES: { code: string; label: string }[] = [
  { code: '台中',     label: '台中' },
  { code: '桃園',     label: '桃園' },
  { code: '中和',     label: '中和' },
  { code: '新荘',     label: '新荘' },
  { code: '巨蛋',     label: '巨蛋' },
  { code: '南港',     label: '南港' },
  { code: 'IKEA',    label: 'IKEA' },
  { code: '夢時',     label: '夢時代' },
  { code: '台南',     label: '台南' },
  { code: 'MOP',     label: 'MOP' },
  { code: '漢神',     label: '台中漢神' },
  { code: '北門',     label: '北門' },
  { code: 'らら台中', label: 'らら台中' },
]

// ── Manual Generation Panel ────────────────────────────────────────────────────

function ManualGeneratePanel() {
  const [date, setDate] = useState('')
  const [roundNo, setRoundNo] = useState('')
  const [label, setLabel] = useState('')
  const [selectedStores, setSelectedStores] = useState<string[]>(SKILL_STORES.map(s => s.code))
  const [file, setFile] = useState<File | null>(null)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<{
    driveUrl: string; shipmentNo: string
    summary: SummaryItem[]; numbers: string; checklist: ChecklistRec | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function toggleStore(code: string) {
    setSelectedStores(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )
  }

  function toggleAll() {
    if (selectedStores.length === SKILL_STORES.length) setSelectedStores([])
    else setSelectedStores(SKILL_STORES.map(s => s.code))
  }

  async function handleGenerate() {
    if (!date || !roundNo || !file || selectedStores.length === 0) return
    setGenerating(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append('date', date)
      form.append('roundNo', roundNo)
      form.append('stores', JSON.stringify(selectedStores))
      form.append('label', label)
      form.append('file', file)

      const res = await fetch('/api/generate-order-free', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? '產生失敗')
        return
      }
      const blob = await res.blob()
      const driveUrl = res.headers.get('X-Drive-Url') ?? ''
      const shipmentNo = res.headers.get('X-Shipment-No') ?? ''
      const report = parseReportHeaders(res)

      // Trigger download — skill 命名格式
      const productTag = (label || `第${roundNo}回`).replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${shipmentNo}_${productTag}_店鋪貨單.xlsx`
      a.click()
      URL.revokeObjectURL(url)

      setResult({ driveUrl, shipmentNo, ...report })
    } catch {
      setError('網路錯誤，請稍後再試')
    } finally {
      setGenerating(false)
    }
  }

  const canGenerate = !!date && !!roundNo && !!file && selectedStores.length > 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800 text-sm">手動產生出貨單</h2>
        <p className="text-xs text-gray-400 mt-0.5">上傳供應商 Excel，選擇日期、回目與門市，一鍵產生出貨單</p>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Row 1: date + round + label */}
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">配送日期</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">回目數</label>
            <input
              type="number"
              min="1"
              value={roundNo}
              onChange={e => setRoundNo(e.target.value)}
              placeholder="例：5"
              className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-gray-500">批次名稱（選填，用於檔名）</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="例：CITY20260401"
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
            />
          </div>
        </div>

        {/* Row 2: store checkboxes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-500">門市</label>
            <button
              onClick={toggleAll}
              className="text-xs text-lopia-red hover:underline"
            >
              {selectedStores.length === SKILL_STORES.length ? '全消' : '全選'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {SKILL_STORES.map(s => (
              <button
                key={s.code}
                onClick={() => toggleStore(s.code)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                  selectedStores.includes(s.code)
                    ? 'bg-lopia-red text-white border-lopia-red'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-lopia-red hover:text-lopia-red'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 3: file upload */}
        <div>
          <label className="text-xs text-gray-500 block mb-2">供應商配送 Excel</label>
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:border-lopia-red hover:text-lopia-red transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              選擇 Excel 檔案
            </button>
            {file && (
              <span className="text-xs text-gray-500 truncate max-w-[200px]">{file.name}</span>
            )}
          </div>
        </div>

        {/* Generate button + error */}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end">
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || generating}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-lopia-red text-white text-sm font-medium hover:bg-lopia-red-dark transition-colors disabled:opacity-40"
          >
            {generating ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            )}
            {generating ? '產生中...' : '產生出貨單'}
          </button>
        </div>

        {/* Result + summary */}
        {result && (
          <div className="border border-emerald-200 bg-emerald-50 rounded-lg px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-emerald-700">✓ {result.shipmentNo} 已產生並下載</span>
              {result.driveUrl && (
                <a href={result.driveUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline">
                  Drive 連結 →
                </a>
              )}
            </div>

            <ShipmentReport summary={result.summary} numbers={result.numbers} checklist={result.checklist} />

          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [authed, setAuthed] = useState(false)
  const [tab, setTab] = useState<'notion' | 'manual'>('notion')
  const [shipments, setShipments] = useState<(Shipment & { shippedBoxes?: number })[]>([])
  const [records, setRecords] = useState<ShipmentRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'ready'>('all')

  useEffect(() => {
    if (sessionStorage.getItem('lopia_portal_authed') === '1') setAuthed(true)
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/shipments')
      const data = await res.json()
      setShipments(data.shipments ?? [])
      const recRes = await fetch('/api/records')
      const recData = await recRes.json()
      setRecords(recData.records ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authed) fetchData()
  }, [authed, fetchData])

  if (!authed) return <PasswordGate onAuth={() => { setAuthed(true) }} />

  const filtered = shipments
    .filter(s => {
      if (filter === 'pending') return s.deliveryStatus !== '全數出貨'
      if (filter === 'ready') return !!s.supplierExcelId
      return true
    })
    .filter(s => !search || s.ivName.toLowerCase().includes(search.toLowerCase()) || (s.productSummary ?? '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href="/" className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            <span className="text-xs hidden sm:inline">貨況系統</span>
          </a>

          <div className="flex items-center gap-2.5 flex-1">
            <div className="w-8 h-8 rounded-lg bg-lopia-red flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-gray-900 text-sm leading-tight">出貨單系統</h1>
              <p className="text-[10px] text-gray-400 leading-tight">選擇批次與輪次，一鍵產生出貨單</p>
            </div>
          </div>

          <button
            onClick={fetchData}
            disabled={loading || tab === 'manual'}
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

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {([['notion', '批次出貨'], ['manual', '手動產生']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'manual' ? (
          <ManualGeneratePanel />
        ) : (
          <>
            {/* Search + Filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜尋批次名稱或商品..."
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lopia-red bg-white"
                />
              </div>
              <div className="flex gap-2">
                {(['all', 'pending', 'ready'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                      filter === f
                        ? 'bg-lopia-red text-white'
                        : 'bg-white border border-gray-200 text-gray-600 hover:border-lopia-red hover:text-lopia-red'
                    }`}
                  >
                    {f === 'all' ? '全部' : f === 'pending' ? '未完成' : '可產生'}
                  </button>
                ))}
              </div>
            </div>

            {/* Batch list */}
            {loading ? (
              <div className="text-center py-16 text-gray-400 text-sm">載入中...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">
                {search ? '找不到符合的批次' : '沒有批次資料'}
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map(s => (
                  <BatchCard key={s.id} shipment={s} records={records} onRefresh={fetchData} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
