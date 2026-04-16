'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SummaryItem { name: string; boxSpec: string; total: number }
type ChecklistRec = Record<string, boolean | number>

interface GenerateResult {
  driveUrl: string
  shipmentNo: string
  summary: SummaryItem[]
  numbers: string
  checklist: ChecklistRec | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SKILL_STORES: { code: string; label: string }[] = [
  { code: '台中',      label: '台中' },
  { code: '桃園',      label: '桃園' },
  { code: '中和',      label: '中和' },
  { code: '新荘',      label: '新荘' },
  { code: '巨蛋',      label: '巨蛋' },
  { code: '南港',      label: '南港' },
  { code: 'IKEA',     label: 'IKEA' },
  { code: '夢時',      label: '夢時代' },
  { code: '台南',      label: '台南' },
  { code: 'MOP',      label: 'MOP' },
  { code: '漢神',      label: '台中漢神' },
  { code: '北門',      label: '北門' },
  { code: 'らら台中',  label: 'らら台中' },
]

// ── Password Gate ─────────────────────────────────────────────────────────────

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
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-800">出貨單快速產生</h1>
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

// ── File Upload Zone ──────────────────────────────────────────────────────────

function UploadZone({
  file,
  onFile,
  detectedRounds,
}: {
  file: File | null
  onFile: (f: File) => void
  detectedRounds: number[]
}) {
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) onFile(f)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => ref.current?.click()}
      className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
        dragging
          ? 'border-lopia-red bg-lopia-red-light scale-[1.01]'
          : file
          ? 'border-emerald-300 bg-emerald-50'
          : 'border-gray-200 hover:border-lopia-red hover:bg-gray-50'
      }`}
    >
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }}
      />

      {file ? (
        <>
          <div className="w-12 h-12 bg-emerald-100 rounded-xl mx-auto mb-3 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <p className="font-semibold text-emerald-700 text-sm">{file.name}</p>
          {detectedRounds.length > 0 && (
            <p className="text-xs text-emerald-600 mt-1">
              偵測到 {detectedRounds.length} 個回目：{detectedRounds.map(r => `第 ${r} 回`).join('、')}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-2">點擊重新選擇</p>
        </>
      ) : (
        <>
          <div className="w-12 h-12 bg-gray-100 rounded-xl mx-auto mb-3 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <p className="font-semibold text-gray-600 text-sm">點擊或拖曳供應商配送 Excel</p>
          <p className="text-xs text-gray-400 mt-1">支援 .xlsx / .xls　工作表格式：N回目店名</p>
        </>
      )}
    </div>
  )
}

// ── Shipment Report ───────────────────────────────────────────────────────────

function ShipmentReport({ summary, numbers, checklist }: {
  summary: SummaryItem[]
  numbers: string
  checklist: ChecklistRec | null
}) {
  return (
    <div className="space-y-3">
      {summary.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-emerald-700 mb-2">📦 本次出貨彙總</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-emerald-200">
                <th className="text-left pb-1.5 font-medium">商品名稱</th>
                <th className="text-right pb-1.5 font-medium pr-4">入數</th>
                <th className="text-right pb-1.5 font-medium">總箱數</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((item, i) => (
                <tr key={i} className="border-b border-emerald-100">
                  <td className="py-1 text-gray-700">{item.name}</td>
                  <td className="py-1 text-gray-500 text-right pr-4">{item.boxSpec}</td>
                  <td className={`py-1 text-right font-semibold ${item.total === 0 ? 'text-gray-300' : 'text-gray-800'}`}>
                    {item.total} 箱
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="pt-2 font-bold text-emerald-700">總計</td>
                <td className="pt-2 text-right font-bold text-emerald-700">
                  {summary.reduce((s, i) => s + i.total, 0)} 箱
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {numbers && (
        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 list-none flex items-center gap-1">
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            純數字排列（庫存管理貼上用）
          </summary>
          <pre className="mt-2 text-xs bg-white border border-emerald-100 rounded-lg p-3 text-gray-600 select-all whitespace-pre font-mono leading-5">
{numbers}
          </pre>
        </details>
      )}

      {checklist && (
        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 list-none flex items-center gap-1">
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            📋 格式確認
          </summary>
          <ul className="mt-2 text-xs bg-white border border-emerald-100 rounded-lg p-3 space-y-1">
            {Object.entries(checklist).map(([k, v]) => (
              <li key={k} className="text-gray-600 flex items-center gap-1.5">
                <span className={typeof v === 'boolean' ? (v ? 'text-emerald-500' : 'text-red-400') : 'text-gray-400'}>
                  {typeof v === 'boolean' ? (v ? '☑' : '☒') : '•'}
                </span>
                {k}{typeof v === 'number' ? `：${v}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75"/>
    </svg>
  )
}

// ── Main Generator Panel ──────────────────────────────────────────────────────

function GeneratorPanel() {
  // Form state
  const [file, setFile]                 = useState<File | null>(null)
  const [detectedRounds, setDetected]   = useState<number[]>([])
  const [roundNo, setRoundNo]           = useState('')
  const [date, setDate]                 = useState('')
  const [label, setLabel]               = useState('')
  const [selectedStores, setStores]     = useState<string[]>(SKILL_STORES.map(s => s.code))

  // Process state
  const [analyzing, setAnalyzing]       = useState(false)
  const [generating, setGenerating]     = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [result, setResult]             = useState<GenerateResult | null>(null)

  // Auto-detect rounds when file changes
  const handleFile = useCallback(async (f: File) => {
    setFile(f)
    setDetected([])
    setRoundNo('')
    setResult(null)
    setError(null)
    setAnalyzing(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const rounds = new Set<number>()
      wb.SheetNames.forEach(name => {
        const m = name.match(/^(\d+)回目/)
        if (m) rounds.add(parseInt(m[1]))
      })
      const sorted = Array.from(rounds).sort((a, b) => a - b)
      setDetected(sorted)
      if (sorted.length === 1) setRoundNo(String(sorted[0]))
    } catch {
      // silently ignore, user can type manually
    } finally {
      setAnalyzing(false)
    }
  }, [])

  function toggleStore(code: string) {
    setStores(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])
  }
  function toggleAll() {
    setStores(prev => prev.length === SKILL_STORES.length ? [] : SKILL_STORES.map(s => s.code))
  }

  async function handleGenerate() {
    if (!file || !date || !roundNo || selectedStores.length === 0) return
    setGenerating(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('date', date)
      form.append('roundNo', roundNo)
      form.append('stores', JSON.stringify(selectedStores))
      form.append('label', label)

      const res = await fetch('/api/generate-order-free', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? '產生失敗，請確認回目數與 Excel 格式')
        return
      }

      const blob = await res.blob()
      const driveUrl    = res.headers.get('X-Drive-Url') ?? ''
      const shipmentNo  = res.headers.get('X-Shipment-No') ?? ''

      // Parse response headers
      let summary: SummaryItem[] = []
      let numbers = ''
      let checklist: ChecklistRec | null = null
      try { summary   = JSON.parse(decodeURIComponent(res.headers.get('X-Summary') ?? '[]')) } catch { /* noop */ }
      try { numbers   = decodeURIComponent(res.headers.get('X-Numbers') ?? '') } catch { /* noop */ }
      try { checklist = JSON.parse(decodeURIComponent(res.headers.get('X-Checklist') ?? 'null')) } catch { /* noop */ }

      // Auto-download
      const productTag = (label || `第${roundNo}回`).replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20)
      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href    = url
      a.download = `${shipmentNo}_${productTag}_店鋪貨單.xlsx`
      a.click()
      URL.revokeObjectURL(url)

      setResult({ driveUrl, shipmentNo, summary, numbers, checklist })
    } catch {
      setError('網路錯誤，請稍後再試')
    } finally {
      setGenerating(false)
    }
  }

  const canGenerate = !!file && !!date && !!roundNo && selectedStores.length > 0

  // Format date for display
  const displayDate = date ? date.replace(/-/g, '/') : ''
  const yyyymmdd    = date ? date.replace(/-/g, '') : ''

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Step 1: Upload */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-lopia-red text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
          <h2 className="font-semibold text-gray-800 text-sm">上傳供應商配送 Excel</h2>
          {analyzing && <Spinner size={14} />}
        </div>
        <div className="px-5 py-4">
          <UploadZone file={file} onFile={handleFile} detectedRounds={detectedRounds} />
        </div>
      </div>

      {/* Step 2: Settings */}
      <div className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-opacity ${!file ? 'opacity-50 pointer-events-none' : 'border-gray-200'}`}>
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-lopia-red text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
          <h2 className="font-semibold text-gray-800 text-sm">設定出貨資訊</h2>
        </div>
        <div className="px-5 py-4 space-y-4">

          {/* Date + Round + Label */}
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">配送日期</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">回目數</label>
              <div className="flex items-center gap-2">
                {/* Round pills (auto-detected) */}
                {detectedRounds.length > 0 ? (
                  <div className="flex gap-1.5">
                    {detectedRounds.map(r => (
                      <button
                        key={r}
                        onClick={() => setRoundNo(String(r))}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                          roundNo === String(r)
                            ? 'bg-lopia-red text-white border-lopia-red'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-lopia-red hover:text-lopia-red'
                        }`}
                      >
                        第 {r} 回
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="number"
                    min="1"
                    value={roundNo}
                    onChange={e => setRoundNo(e.target.value)}
                    placeholder="例：5"
                    className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
                  />
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
              <label className="text-xs text-gray-500 font-medium">批次名稱（選填，用於檔名）</label>
              <input
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="例：CITY20260401"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
              />
            </div>
          </div>

          {/* Preview */}
          {date && roundNo && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500">
              預覽單號：<span className="font-mono font-semibold text-gray-700">S{yyyymmdd}XX</span>
              　配送日期：<span className="font-semibold text-gray-700">{displayDate}</span>
              　第 <span className="font-semibold text-gray-700">{roundNo}</span> 回目
            </div>
          )}

          {/* Store selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 font-medium">門市選擇</label>
              <button onClick={toggleAll} className="text-xs text-lopia-red hover:underline font-medium">
                {selectedStores.length === SKILL_STORES.length ? '全消' : '全選'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {SKILL_STORES.map(s => (
                <button
                  key={s.code}
                  onClick={() => toggleStore(s.code)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                    selectedStores.includes(s.code)
                      ? 'bg-lopia-red text-white border-lopia-red'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-lopia-red hover:text-lopia-red'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {selectedStores.length > 0 && (
              <p className="mt-1.5 text-xs text-gray-400">{selectedStores.length} 間門市已選擇</p>
            )}
          </div>
        </div>
      </div>

      {/* Step 3: Generate */}
      <div className={`transition-opacity ${!canGenerate ? 'opacity-40 pointer-events-none' : ''}`}>
        {error && (
          <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            ❌ {error}
          </div>
        )}
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || generating}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-lopia-red text-white font-semibold rounded-xl text-base hover:bg-lopia-red-dark transition-colors disabled:opacity-50 shadow-sm"
        >
          {generating ? (
            <><Spinner size={18} /> 產生中…</>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              產生並下載出貨單 Excel
            </>
          )}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span className="text-sm font-bold text-emerald-700">{result.shipmentNo} 已產生並下載</span>
            </div>
            <div className="flex items-center gap-3">
              {result.driveUrl && (
                <a
                  href={result.driveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 hover:underline"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                  Drive 連結
                </a>
              )}
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="text-xs text-emerald-600 hover:text-emerald-800 font-medium hover:underline"
              >
                重新下載
              </button>
            </div>
          </div>
          <ShipmentReport summary={result.summary} numbers={result.numbers} checklist={result.checklist} />
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ShipmentGeneratorPage() {
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem('lopia_portal_authed') === '1') setAuthed(true)
  }, [])

  if (!authed) return <PasswordGate onAuth={() => setAuthed(true)} />

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <a
            href="/"
            className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            <span className="text-xs hidden sm:inline">貨況系統</span>
          </a>

          <div className="flex items-center gap-2.5 flex-1">
            <div className="w-8 h-8 rounded-lg bg-lopia-red flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-gray-900 text-sm leading-tight">出貨單快速產生</h1>
              <p className="text-xs text-gray-400">上傳 Excel，自動生成各店鋪出貨單 + 總表</p>
            </div>
          </div>

          <a
            href="/orders"
            className="flex items-center text-xs text-gray-500 hover:text-lopia-red transition-colors px-2.5 py-1.5 rounded-md hover:bg-lopia-red-light border border-gray-200 hover:border-lopia-red font-medium"
          >
            出貨單系統
          </a>
        </div>
      </header>

      <GeneratorPanel />
    </div>
  )
}
