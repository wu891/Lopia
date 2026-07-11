'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SummaryItem { name: string; boxSpec: string; total: number }
type ChecklistRec = Record<string, boolean | number>

interface DetectedStore { code: string; displayName: string }

interface GenerateResult {
  driveUrl: string
  shipmentNo: string
  summary: SummaryItem[]
  numbers: string
  checklist: ChecklistRec | null
}

// ── Store map (mirrors lib/parseDeliveryExcel.ts EXCEL_STORE_MAP) ─────────────
// Longer / more specific keys first to avoid substring false-matches

const EXCEL_STORE_MAP: Record<string, string> = {
  '台中漢神':    '台中漢神中港店',
  '漢神台中':    '台中漢神中港店',
  '漢神(台中)':  '台中漢神中港店',
  '高雄巨蛋':    '高雄漢神巨蛋店',
  '台北巨蛋':    '台北大巨蛋店',
  '大巨蛋':      '台北大巨蛋店',
  '夢時代':      '高雄夢時代店',
  '小北門':      '台南小北門店',
  'らら台中':    'LaLaport 台中店',
  '台中':        'LaLaport 台中店',
  '桃園':        '桃園春日店',
  '中和':        '新北中和環球店',
  '新荘':        '新莊宏匯店',
  '新莊':        '新莊宏匯店',
  '高雄':        '高雄漢神巨蛋店',
  '巨蛋':        '高雄漢神巨蛋店',
  '北蛋':        '台北大巨蛋店',
  '南港':        '南港 LaLaport 店',
  'IKEA':        'IKEA 台中南屯店',
  'イケア':      'IKEA 台中南屯店',
  '夢時':        '高雄夢時代店',
  '北門':        '台南小北門店',
  '台南':        '台南小北門店',
  'MOP':         '台南三井 Outlet 店',
  'mop':         '台南三井 Outlet 店',
  'MO':          '台南三井 Outlet 店',
  '漢神':        '台中漢神中港店',
  '中漢':        '台中漢神中港店',
}

function resolveStoreName(code: string): string {
  return EXCEL_STORE_MAP[code] ?? code
}

// ── Parse sheet names for a given round ───────────────────────────────────────

function detectStoresForRound(sheetNames: string[], round: number): DetectedStore[] {
  const seen = new Set<string>()
  const stores: DetectedStore[] = []
  for (const name of sheetNames) {
    const m = name.match(/^(\d+)回目(.+)$/)
    if (!m || parseInt(m[1]) !== round) continue
    const code = m[2].trim()
    const displayName = resolveStoreName(code)
    if (!seen.has(displayName)) {
      seen.add(displayName)
      stores.push({ code, displayName })
    }
  }
  return stores
}

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
                <th className="text-right pb-1.5 font-medium pr-4">規格</th>
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
  // File + analysis state
  const [file, setFile]               = useState<File | null>(null)
  const [sheetNames, setSheetNames]   = useState<string[]>([])
  const [detectedRounds, setRounds]   = useState<number[]>([])
  const [analyzing, setAnalyzing]     = useState(false)

  // Manual mode (when no 回目 pattern detected)
  const [manualMode, setManualMode]               = useState(false)
  const [allSheets, setAllSheets]                 = useState<string[]>([])
  const [selectedManualSheets, setManualSheets]   = useState<string[]>([])

  // Form state
  const [roundNo, setRoundNo]         = useState('')
  const [detectedStores, setStores]   = useState<DetectedStore[]>([])
  const [date, setDate]               = useState('')
  const [label, setLabel]             = useState('')

  // Tax state
  const [isTaxable, setIsTaxable]     = useState(false)

  // Process state
  const [generating, setGenerating]   = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [result, setResult]           = useState<GenerateResult | null>(null)

  const EXCLUDED_SHEETS = new Set(['彙整_商品總數', '請款単', '総数', '総量', '総計', 'summary'])

  // ── File upload: detect rounds and store all sheet names ──────────────────
    const [processedProductNames, setProcessedProductNames] = useState<Set<string>>(new Set())
  const handleFile = useCallback(async (f: File) => {
    setFile(f)
    setSheetNames([])
    setRounds([])
    setRoundNo('')
    setStores([])
    setManualMode(false)
    setAllSheets([])
    setManualSheets([])
    setResult(null)
    setError(null)
    setAnalyzing(true)
    try {
      const XLSX = await import('xlsx')
      const buf  = await f.arrayBuffer()
      const wb   = XLSX.read(buf, { type: 'array' })
      setSheetNames(wb.SheetNames)

      const rounds = new Set<number>()
      wb.SheetNames.forEach(name => {
        const m = name.match(/^(\d+)[回か]目/)
        if (m) rounds.add(parseInt(m[1]))
      })
      const sorted = Array.from(rounds).sort((a, b) => a - b)
      setRounds(sorted)

      if (sorted.length === 0) {
        // No round pattern detected — switch to manual sheet selection
        const filtered = wb.SheetNames.filter(n => {
          const b = n.trim()
          return !EXCLUDED_SHEETS.has(b) && !b.startsWith('出貨単_') && !b.startsWith('彙整')
        })
        setManualMode(true)
        setAllSheets(filtered)
      } else if (sorted.length === 1) {
        // Auto-select if only one round
        const r = sorted[0]
        setRoundNo(String(r))
        setStores(detectStoresForRound(wb.SheetNames, r))
      }
    } catch {
      // ignore — user can still proceed if server can parse
    } finally {
      setAnalyzing(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Round selection: instantly resolve stores ─────────────────────────────
  function selectRound(r: number) {
    setRoundNo(String(r))
    setStores(detectStoresForRound(sheetNames, r))
    setResult(null)
    setError(null)
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!file || !date) return
    if (manualMode && selectedManualSheets.length === 0) return
    if (!manualMode && (!roundNo || detectedStores.length === 0)) return

    setGenerating(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('date', date)
      form.append('label', label)
      form.append('isTaxable', isTaxable ? '1' : '0')

      if (manualMode) {
        form.append('manualSheets', JSON.stringify(selectedManualSheets))
      } else {
        form.append('roundNo', roundNo)
        form.append('stores', JSON.stringify(detectedStores.map(s => s.code)))
      }
              form.append('processedItems', JSON.stringify(Array.from(processedProductNames)))

      const res = await fetch('/api/generate-order-free', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? '產生失敗，請確認 Excel 格式')
        return
      }

      const blob      = await res.blob()
      const driveUrl  = res.headers.get('X-Drive-Url') ?? ''
      const shipmentNo = res.headers.get('X-Shipment-No') ?? ''

      let summary: SummaryItem[] = []
      let numbers = ''
      let checklist: ChecklistRec | null = null
      try { summary   = JSON.parse(atob(res.headers.get('X-Summary') ?? 'W10=')) } catch { /* noop */ }
      try { numbers   = atob(res.headers.get('X-Numbers') ?? '') } catch { /* noop */ }
      try { checklist = JSON.parse(atob(res.headers.get('X-Checklist') ?? 'bnVsbA==')) } catch { /* noop */ }

      // Auto-download
      const batchName = label || (manualMode ? '手動選頁' : `第${roundNo}回`)
      const productTag = batchName.replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20)
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

  const canGenerate = manualMode
    ? !!file && !!date && selectedManualSheets.length > 0
    : !!file && !!date && !!roundNo && detectedStores.length > 0

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

            {!manualMode && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">回目</label>
                <div className="flex items-center gap-1.5">
                  {detectedRounds.length > 0 ? (
                    detectedRounds.map(r => (
                      <button
                        key={r}
                        onClick={() => selectRound(r)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                          roundNo === String(r)
                            ? 'bg-lopia-red text-white border-lopia-red'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-lopia-red hover:text-lopia-red'
                        }`}
                      >
                        第 {r} 回
                      </button>
                    ))
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
            )}

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

          {/* Tax toggle */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isTaxable}
                onChange={e => setIsTaxable(e.target.checked)}
                className="w-4 h-4 accent-lopia-red shrink-0"
              />
              <span className="text-sm font-medium text-gray-800">
                加工品
                <span className="ml-2 inline-block bg-amber-100 text-amber-800 text-[11px] font-semibold px-2 py-0.5 rounded-full">加收 5% 營業稅</span>
              </span>
            </label>
            {isTaxable && (
              <p className="text-xs text-amber-700 mt-1.5 ml-6">產出的出貨單每張店鋪頁與總表將新增稅金列與含稅合計列</p>
            )}
          </div>

          {/* Auto-detected stores (normal mode) */}
          {!manualMode && detectedStores.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">
                偵測到門市
                <span className="ml-1.5 text-gray-400 font-normal">（{detectedStores.length} 間，依 Excel 自動帶入）</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {detectedStores.map(s => (
                  <span
                    key={s.code}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-lopia-red/8 text-lopia-red border border-lopia-red/20"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {s.displayName}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Manual sheet selection (when no 回目 pattern detected) */}
          {manualMode && allSheets.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2.5">
              <p className="text-xs font-semibold text-amber-700">
                此檔案未包含回目資訊，請勾選要抽取的分頁：
                <span className="ml-1.5 font-normal text-amber-600">（已選 {selectedManualSheets.length} / {allSheets.length} 頁）</span>
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {allSheets.map(sn => {
                  const checked = selectedManualSheets.includes(sn)
                  return (
                    <label
                      key={sn}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer border transition-colors ${
                        checked
                          ? 'bg-lopia-red/8 border-lopia-red/30 text-lopia-red font-medium'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          setManualSheets(prev =>
                            e.target.checked ? [...prev, sn] : prev.filter(s => s !== sn)
                          )
                        }}
                        className="w-3.5 h-3.5 accent-lopia-red shrink-0"
                      />
                      <span className="truncate">{sn}</span>
                    </label>
                  )
                })}
              </div>
              {allSheets.length > 1 && (
                <button
                  onClick={() =>
                    setManualSheets(
                      selectedManualSheets.length === allSheets.length ? [] : [...allSheets]
                    )
                  }
                  className="text-xs text-amber-600 hover:text-amber-800 font-medium hover:underline"
                >
                  {selectedManualSheets.length === allSheets.length ? '取消全選' : '全選'}
                </button>
              )}
            </div>
          )}

          {/* Preview */}
          {date && (manualMode || roundNo) && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500">
              預覽單號：<span className="font-mono font-semibold text-gray-700">S{yyyymmdd}XX</span>
              　配送日期：<span className="font-semibold text-gray-700">{displayDate}</span>
              {!manualMode && roundNo && <>　第 <span className="font-semibold text-gray-700">{roundNo}</span> 回目</>}
              {manualMode && <span className="ml-1 text-amber-600 font-medium">（手動選頁模式）</span>}
            </div>
          )}
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

// ── 優儲出貨單 Panel ──────────────────────────────────────────────────────────

type OutputType = 'store' | 'chuku' | 'both'

function YushuPanel() {
  const [kanriFile, setKanriFile]     = useState<File | null>(null)
  const [planFile, setPlanFile]       = useState<File | null>(null)
  const [availRounds, setAvailRounds] = useState<number[]>([])
  const [round, setRound]             = useState<number | null>(null)
  const [date, setDate]               = useState('')
  const [suffix, setSuffix]           = useState('01')
  const [batchLabel, setBatchLabel]   = useState('')
  const [outputType, setOutputType]   = useState<OutputType>('both')
  const [analyzing, setAnalyzing]     = useState(false)
  const [generating, setGenerating]   = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [done, setDone]               = useState<string[]>([])

  const kanriRef = useRef<HTMLInputElement>(null)
  const planRef  = useRef<HTMLInputElement>(null)

  async function handleKanri(f: File) {
    setKanriFile(f)
    setAvailRounds([])
    setRound(null)
    setAnalyzing(true)
    try {
      const XLSX = await import('xlsx')
      const buf  = await f.arrayBuffer()
      const wb   = XLSX.read(buf, { type: 'array' })
      const rounds: number[] = []
      for (const sn of wb.SheetNames) {
        const m = sn.match(/第(\d+)回出貨明細/)
        if (m) rounds.push(parseInt(m[1]))
      }
      const sorted = rounds.sort((a, b) => a - b)
      setAvailRounds(sorted)
      if (sorted.length === 1) setRound(sorted[0])
    } catch { /* ignore */ } finally {
      setAnalyzing(false)
    }
  }

  const canGenerate = !!kanriFile && !!planFile && round !== null && !!date && !!suffix && !!batchLabel

  async function handleGenerate() {
    if (!canGenerate) return
    setGenerating(true)
    setError(null)
    setDone([])
    try {
      const form = new FormData()
      form.append('kanriFile',  kanriFile!)
      form.append('planFile',   planFile!)
      form.append('round',      String(round))
      form.append('date',       date)
      form.append('suffix',     suffix)
      form.append('batchLabel', batchLabel)
      form.append('outputType', outputType)

      const res = await fetch('/api/generate-yushu-order', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? '產生失敗')
        return
      }

      if (outputType === 'both') {
        const json = await res.json()
        const files: [string, string][] = [
          [json.storeFile.name, json.storeFile.data],
          [json.chukuFile.name, json.chukuFile.data],
        ]
        const downloaded: string[] = []
        for (const [name, b64] of files) {
          const bytes  = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
          const blob   = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
          const url    = URL.createObjectURL(blob)
          const a      = document.createElement('a')
          a.href       = url
          a.download   = name
          a.click()
          URL.revokeObjectURL(url)
          downloaded.push(name)
          await new Promise(r => setTimeout(r, 300))
        }
        setDone(downloaded)
      } else {
        const blob = await res.blob()
        const cd   = res.headers.get('Content-Disposition') ?? ''
        const name = decodeURIComponent(cd.match(/filename\*=UTF-8''(.+)/)?.[1] ?? 'output.xlsx')
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = name
        a.click()
        URL.revokeObjectURL(url)
        setDone([name])
      }
    } catch {
      setError('網路錯誤，請稍後再試')
    } finally {
      setGenerating(false)
    }
  }

  function FileZone({ label, file, onFile, inputRef, accept }: {
    label: string; file: File | null
    onFile: (f: File) => void; inputRef: React.RefObject<HTMLInputElement>; accept: string
  }) {
    return (
      <div
        onClick={() => inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
          file ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-lopia-red hover:bg-gray-50'
        }`}
      >
        <input ref={inputRef} type="file" accept={accept} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
        {file ? (
          <>
            <p className="font-semibold text-emerald-700 text-sm">{file.name}</p>
            <p className="text-xs text-gray-400 mt-1">點擊重新選擇</p>
          </>
        ) : (
          <>
            <p className="font-semibold text-gray-600 text-sm">{label}</p>
            <p className="text-xs text-gray-400 mt-1">點擊或拖曳 .xlsx / .xls</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Step 1: Upload two files */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-lopia-red text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
          <h2 className="font-semibold text-gray-800 text-sm">上傳檔案</h2>
          {analyzing && <Spinner size={14} />}
        </div>
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-500 font-medium mb-1.5">庫存管理表</p>
            <FileZone label="上傳庫存管理表" file={kanriFile} onFile={handleKanri}
              inputRef={kanriRef} accept=".xlsx,.xls" />
            {availRounds.length > 0 && (
              <p className="text-xs text-emerald-600 mt-1.5">
                偵測到 {availRounds.length} 個回目：{availRounds.map(r => `第${r}回`).join('、')}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium mb-1.5">計画書（台湾ロピアりんごXX）</p>
            <FileZone label="上傳計画書" file={planFile} onFile={f => { setPlanFile(f); setError(null) }}
              inputRef={planRef} accept=".xlsx,.xls" />
          </div>
        </div>
      </div>

      {/* Step 2: Settings */}
      <div className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-opacity ${!kanriFile || !planFile ? 'opacity-40 pointer-events-none' : 'border-gray-200'}`}>
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-lopia-red text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
          <h2 className="font-semibold text-gray-800 text-sm">設定出貨資訊</h2>
        </div>
        <div className="px-5 py-4 space-y-4">

          {/* Round + Date */}
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">回目</label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {availRounds.length > 0 ? availRounds.map(r => (
                  <button key={r} onClick={() => setRound(r)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      round === r ? 'bg-lopia-red text-white border-lopia-red' : 'bg-white text-gray-600 border-gray-200 hover:border-lopia-red hover:text-lopia-red'
                    }`}>第 {r} 回</button>
                )) : (
                  <input type="number" min="1" value={round ?? ''} onChange={e => setRound(parseInt(e.target.value) || null)}
                    placeholder="例：3" className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red" />
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">配送日期</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red" />
            </div>
          </div>

          {/* Suffix + Batch label */}
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">出貨單號後兩碼</label>
              <input type="text" maxLength={2} value={suffix} onChange={e => setSuffix(e.target.value)}
                placeholder="01" className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red font-mono" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <label className="text-xs text-gray-500 font-medium">批次名稱（用於檔名）</label>
              <input type="text" value={batchLabel} onChange={e => setBatchLabel(e.target.value)}
                placeholder="例：蘋果10.3" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red" />
            </div>
          </div>

          {/* Preview */}
          {date && suffix && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500">
              單號預覽：<span className="font-mono font-semibold text-gray-700">S{date.replace(/-/g, '')}{suffix.padStart(2, '0')}</span>
              {batchLabel && <span className="ml-3">檔名：<span className="font-semibold text-gray-700">S..._{batchLabel}_店鋪貨單.xlsx</span></span>}
            </div>
          )}

          {/* Output type */}
          <div>
            <label className="text-xs text-gray-500 font-medium mb-2 block">產出選項</label>
            <div className="flex gap-2 flex-wrap">
              {([['both', '兩份都產出'], ['store', '僅店鋪貨單'], ['chuku', '僅優儲出庫單']] as [OutputType, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setOutputType(v)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    outputType === v ? 'bg-lopia-red text-white border-lopia-red' : 'bg-white text-gray-600 border-gray-200 hover:border-lopia-red hover:text-lopia-red'
                  }`}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Step 3: Generate */}
      <div className={`transition-opacity ${!canGenerate ? 'opacity-40 pointer-events-none' : ''}`}>
        {error && (
          <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">❌ {error}</div>
        )}
        <button onClick={handleGenerate} disabled={!canGenerate || generating}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-lopia-red text-white font-semibold rounded-xl text-base hover:bg-lopia-red-dark transition-colors disabled:opacity-50 shadow-sm">
          {generating ? <><Spinner size={18} /> 產生中…</> : <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            產生並下載 {outputType === 'both' ? '（兩份）' : ''}
          </>}
        </button>
      </div>

      {/* Result */}
      {done.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 space-y-2">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span className="text-sm font-bold text-emerald-700">已產生並下載</span>
          </div>
          {done.map(n => (
            <p key={n} className="text-xs text-emerald-600 font-mono ml-6">📄 {n}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 🍎 蘋果11 庫存出貨 Panel（v2：系統記住庫存、自動扣） ───────────────────────

interface Apple11Summary { store: string; name: string; bango: string; qty: number }
interface StockInfo { seeded: boolean; total: number; byVariety: Record<string, number>; items: { bango: string; name: string; qty: number }[]; error?: string }
interface DiffRow { bango: string; name: string; systemQty: number; warehouseQty: number; delta: number; kind: string }
interface Preview { mode: 'seed' | 'reconcile'; willSeed?: boolean; total?: number; byVariety?: Record<string, number>; diff?: { changedRows: DiffRow[]; systemTotal: number; warehouseTotal: number } }

function dlFile(name: string, b64: string) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob); const a = document.createElement('a')
  a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}

const VARIETY_ORDER = ['サンふじ', 'ぐんま名月', '有袋ふじ', 'シナノゴールド']

function Apple11Panel() {
  // 庫存
  const [stock, setStock] = useState<StockInfo | null>(null)
  const [loadingStock, setLoadingStock] = useState(true)

  // 對帳
  const [stockFile, setStockFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [reconErr, setReconErr] = useState<string | null>(null)
  const stockRef = useRef<HTMLInputElement>(null)

  // 出貨
  const [planFile, setPlanFile] = useState<File | null>(null)
  const [availRounds, setRounds] = useState<number[]>([])
  const [round, setRound] = useState<number | null>(null)
  const [date, setDate] = useState('')
  const [suffix, setSuffix] = useState('01')
  const [batchLabel, setBatch] = useState('')
  const [outputType, setOut] = useState<'both' | 'store' | 'chuku'>('both')
  const [force, setForce] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [generating, setGen] = useState(false)
  const [genErr, setGenErr] = useState<string | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [summary, setSummary] = useState<Apple11Summary[]>([])
  const [unknownStores, setUnknown] = useState<string[]>([])
  const [notionNote, setNotion] = useState('')
  const [remainTotal, setRemain] = useState<number | null>(null)
  const planRef = useRef<HTMLInputElement>(null)

  const loadStock = useCallback(async () => {
    setLoadingStock(true)
    try {
      const res = await fetch('/api/apple11/stock', { cache: 'no-store' })
      setStock(await res.json())
    } catch { setStock({ seeded: false, total: 0, byVariety: {}, items: [], error: '讀取庫存失敗' }) }
    finally { setLoadingStock(false) }
  }, [])

  useEffect(() => { loadStock() }, [loadStock])

  async function handleStock(f: File) {
    setStockFile(f); setReconErr(null); setPreview(null); setReconciling(true)
    try {
      const form = new FormData(); form.append('action', 'preview'); form.append('stockFile', f)
      const res = await fetch('/api/apple11/stock', { method: 'POST', body: form })
      const d = await res.json()
      if (!res.ok) { setReconErr(d.error ?? '對帳失敗'); return }
      setPreview(d)
    } catch { setReconErr('網路錯誤') } finally { setReconciling(false) }
  }

  async function commitStock() {
    if (!stockFile) return
    setCommitting(true); setReconErr(null)
    try {
      const form = new FormData(); form.append('action', 'commit'); form.append('stockFile', stockFile)
      const res = await fetch('/api/apple11/stock', { method: 'POST', body: form })
      const d = await res.json()
      if (!res.ok) { setReconErr(d.error ?? '寫入失敗'); return }
      setPreview(null); setStockFile(null)
      await loadStock()
    } catch { setReconErr('網路錯誤') } finally { setCommitting(false) }
  }

  async function handlePlan(f: File) {
    setPlanFile(f); setRounds([]); setRound(null); setGenErr(null); setAnalyzing(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', bookSheets: true })
      const set = new Set<number>()
      wb.SheetNames.forEach(n => { const m = n.trim().match(/^(\d+)回目/); if (m) set.add(parseInt(m[1])) })
      const sorted = Array.from(set).sort((a, b) => a - b)
      setRounds(sorted)
      if (sorted.length === 1) setRound(sorted[0])
    } catch { /* ignore */ } finally { setAnalyzing(false) }
  }

  const canGen = !!planFile && round !== null && !!date && !!suffix && !!stock?.seeded

  async function handleGenerate() {
    if (!canGen) return
    setGen(true); setGenErr(null); setDone([]); setSummary([]); setUnknown([]); setNotion(''); setRemain(null)
    try {
      const form = new FormData()
      form.append('planFile', planFile!); form.append('round', String(round)); form.append('date', date)
      form.append('suffix', suffix); form.append('batchLabel', batchLabel); form.append('outputType', outputType)
      if (force) form.append('force', '1')
      const res = await fetch('/api/apple11/generate', { method: 'POST', body: form })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setGenErr(d.error ?? '產生失敗'); return }
      if (outputType === 'both') {
        const json = await res.json()
        dlFile(json.storeFile.name, json.storeFile.data); dlFile(json.chukuFile.name, json.chukuFile.data)
        setDone([json.storeFile.name, json.chukuFile.name]); setSummary(json.summary ?? [])
        setUnknown(json.unknownStores ?? []); setNotion(json.notion?.note ?? ''); setRemain(json.remainTotal ?? null)
      } else {
        const blob = await res.blob()
        const cd = res.headers.get('Content-Disposition') ?? ''
        const name = decodeURIComponent(cd.match(/filename\*=UTF-8''(.+)/)?.[1] ?? 'output.xlsx')
        const url = URL.createObjectURL(blob); const a = document.createElement('a')
        a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); setDone([name])
      }
      setForce(false)
      await loadStock()  // 扣帳後刷新庫存
    } catch { setGenErr('網路錯誤，請稍後再試') } finally { setGen(false) }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* 目前庫存 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 text-sm">📦 目前系統庫存</h2>
          <button onClick={loadStock} className="text-xs text-gray-400 hover:text-lopia-red">{loadingStock ? '讀取中…' : '重新整理'}</button>
        </div>
        <div className="px-5 py-4">
          {loadingStock ? <p className="text-xs text-gray-400">讀取中…</p>
            : stock?.error ? <p className="text-xs text-red-600">⚠ {stock.error}</p>
            : !stock?.seeded ? <p className="text-xs text-amber-700">系統還沒有庫存。請在下方「更新庫存」上傳倉庫檔做初始化。</p>
            : (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <span className="font-bold text-emerald-700">總計 {stock.total} 箱</span>
                {VARIETY_ORDER.filter(v => stock.byVariety[v]).map(v => (
                  <span key={v} className="text-gray-600">{v}：<b>{stock.byVariety[v]}</b></span>
                ))}
              </div>
            )}
        </div>
      </div>

      {/* 更新庫存（對帳） */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">🔄 更新庫存（對帳）</h2>
          <p className="text-xs text-gray-400 mt-0.5">收到倉庫最新庫存就上傳，系統會比對差異、確認後以倉庫為準更新。</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div onClick={() => stockRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${stockFile ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-lopia-red hover:bg-gray-50'}`}>
            <input ref={stockRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleStock(f); e.target.value = '' }} />
            {stockFile ? <p className="font-semibold text-emerald-700 text-sm">{stockFile.name}</p>
              : <p className="font-semibold text-gray-600 text-sm">點擊上傳倉庫庫存檔（日商夢多）</p>}
            {reconciling && <p className="text-xs text-gray-400 mt-1">比對中…</p>}
          </div>
          {reconErr && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">❌ {reconErr}</div>}

          {preview?.mode === 'seed' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-2">
              <p className="text-sm font-semibold text-amber-800">首次初始化：將以這張當系統起始庫存</p>
              <p className="text-xs text-amber-700">總計 {preview.total} 箱　{VARIETY_ORDER.filter(v => preview.byVariety?.[v]).map(v => `${v} ${preview.byVariety![v]}`).join('、')}</p>
              <button onClick={commitStock} disabled={committing}
                className="px-4 py-2 bg-lopia-red text-white text-sm font-semibold rounded-lg disabled:opacity-50">{committing ? '寫入中…' : '確認初始化'}</button>
            </div>
          )}

          {preview?.mode === 'reconcile' && preview.diff && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-2">
              <p className="text-sm font-semibold text-amber-800">差異對照（系統 → 倉庫實際）</p>
              <p className="text-xs text-amber-700">系統現存 {preview.diff.systemTotal} 箱 → 倉庫實際 {preview.diff.warehouseTotal} 箱</p>
              {preview.diff.changedRows.length === 0 ? <p className="text-xs text-emerald-700">完全一致，無差異。</p> : (
                <ul className="text-xs space-y-0.5 max-h-52 overflow-auto font-mono">
                  {preview.diff.changedRows.map(r => (
                    <li key={r.bango} className={r.delta < 0 ? 'text-red-600' : r.delta > 0 ? 'text-blue-600' : 'text-gray-500'}>
                      {r.bango} {r.name}：{r.systemQty} → {r.warehouseQty}（{r.delta > 0 ? '+' : ''}{r.delta}）{r.kind === 'new' ? ' 新增' : r.kind === 'gone' ? ' 倉庫已無' : ''}
                    </li>
                  ))}
                </ul>
              )}
              <button onClick={commitStock} disabled={committing}
                className="px-4 py-2 bg-lopia-red text-white text-sm font-semibold rounded-lg disabled:opacity-50">{committing ? '更新中…' : '以倉庫為準，確認更新'}</button>
            </div>
          )}
        </div>
      </div>

      {/* 產生出貨 */}
      <div className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-opacity ${!stock?.seeded ? 'opacity-50' : 'border-gray-200'}`}>
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">🍎 產生出貨（自動扣庫存）</h2>
          <p className="text-xs text-gray-400 mt-0.5">只要上傳計画書、選回目與日期；系統用目前庫存分配品番、扣帳、產貨單。</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-xs text-gray-500 font-medium mb-1.5">計画書（台湾ロピアりんご11）</p>
            <div onClick={() => planRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${planFile ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-lopia-red hover:bg-gray-50'}`}>
              <input ref={planRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePlan(f); e.target.value = '' }} />
              {planFile ? <p className="font-semibold text-emerald-700 text-sm">{planFile.name}</p>
                : <p className="font-semibold text-gray-600 text-sm">點擊上傳計画書</p>}
              {analyzing && <p className="text-xs text-gray-400 mt-1">分析中…</p>}
            </div>
            {availRounds.length > 0 && <p className="text-xs text-emerald-600 mt-1.5">偵測到回目：{availRounds.map(r => `第${r}回`).join('、')}</p>}
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">回目</label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {availRounds.length > 0 ? availRounds.map(r => (
                  <button key={r} onClick={() => setRound(r)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${round === r ? 'bg-lopia-red text-white border-lopia-red' : 'bg-white text-gray-600 border-gray-200 hover:border-lopia-red hover:text-lopia-red'}`}>第 {r} 回</button>
                )) : <input type="number" min="1" value={round ?? ''} onChange={e => setRound(parseInt(e.target.value) || null)}
                    placeholder="例：3" className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red" />}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">配送日期</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">單號後兩碼</label>
              <input type="text" maxLength={2} value={suffix} onChange={e => setSuffix(e.target.value)}
                placeholder="01" className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red font-mono" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <label className="text-xs text-gray-500 font-medium">批次名稱（檔名用）</label>
              <input type="text" value={batchLabel} onChange={e => setBatch(e.target.value)}
                placeholder="例：第3回 / 蘋果11.3" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red" />
            </div>
          </div>

          {date && suffix && <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500">單號預覽：<span className="font-mono font-semibold text-gray-700">S{date.replace(/-/g, '')}{suffix.padStart(2, '0')}</span></div>}

          <div className="flex gap-2 flex-wrap">
            {([['both', '兩份都產出'], ['store', '僅店鋪貨單'], ['chuku', '僅出庫總單']] as ['both' | 'store' | 'chuku', string][]).map(([v, l]) => (
              <button key={v} onClick={() => setOut(v)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${outputType === v ? 'bg-lopia-red text-white border-lopia-red' : 'bg-white text-gray-600 border-gray-200 hover:border-lopia-red hover:text-lopia-red'}`}>{l}</button>
            ))}
          </div>

          {genErr && <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            ❌ {genErr}
            {genErr.includes('已經出過貨') && (
              <label className="flex items-center gap-1.5 mt-2 text-red-700 cursor-pointer">
                <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} className="w-3.5 h-3.5 accent-lopia-red" />
                我了解，強制重跑（會再扣一次庫存）
              </label>
            )}
          </div>}

          <button onClick={handleGenerate} disabled={!canGen || generating}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-lopia-red text-white font-semibold rounded-xl text-base hover:bg-lopia-red-dark transition-colors disabled:opacity-50 shadow-sm">
            {generating ? <><Spinner size={18} /> 產生中…</> : <>🍎 分配品番、扣庫存並產生貨單</>}
          </button>

          {done.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 space-y-2">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span className="text-sm font-bold text-emerald-700">已扣帳、產生並下載</span>
              </div>
              {done.map(n => <p key={n} className="text-xs text-emerald-600 font-mono ml-6">📄 {n}</p>)}
              {remainTotal !== null && <p className="text-xs text-gray-600 ml-6">扣帳後庫存剩餘：<b>{remainTotal}</b> 箱</p>}
              {notionNote && <p className="text-xs text-gray-500 ml-6">🗂 {notionNote}</p>}
              {unknownStores.length > 0 && <p className="text-xs text-amber-700 ml-6">⚠ 無法對應的店名（已略過）：{unknownStores.join('、')}</p>}
              {summary.length > 0 && (
                <details className="ml-6">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">分配明細（{summary.length} 行，品番）</summary>
                  <ul className="mt-2 text-xs text-gray-600 space-y-0.5 max-h-60 overflow-auto">
                    {summary.map((s, i) => <li key={i} className="font-mono">{s.store}　{s.bango}　{s.name}　×{s.qty}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 🍠 地瓜(茨城)＋大學芋 店鋪貨單 Panel（手動輸入版，AI讀圖之前的過渡方案）────────

interface DiguaGradeQty { L: number; M: number; S: number; '2S': number }
interface DiguaRow { id: string; label: string; grades: DiguaGradeQty; daigakuimo: number }

// 短標籤沿用 Colin 自己截圖裡的縮寫習慣，滑鼠移過去會顯示全名
const DIGUA_STORE_META: { id: string; short: string; full: string }[] = [
  { id: 'taichung-lalaport', short: '台', full: 'LaLaport 台中店' },
  { id: 'taoyuan-chunri', short: '桃', full: '桃園春日店' },
  { id: 'zhonghe-global', short: '中', full: '新北中和環球店' },
  { id: 'xinzhuang-honghui', short: '新', full: '新莊宏匯店' },
  { id: 'kaohsiung-hanshin-dome', short: '巨', full: '高雄漢神巨蛋店' },
  { id: 'nangang-lalaport', short: '南', full: '南港 LaLaport 店' },
  { id: 'taichung-ikea', short: 'I', full: 'IKEA 台中南屯店' },
  { id: 'kaohsiung-dream-times', short: '夢', full: '高雄夢時代店' },
  { id: 'tainan-xiaobei', short: '北', full: '台南小北門店' },
  { id: 'tainan-mitsui', short: 'M', full: '台南三井 Outlet 店' },
  { id: 'taichung-hanshin', short: '漢', full: '台中漢神中港店' },
]

const GRADE_LABELS: { key: keyof DiguaGradeQty; label: string }[] = [
  { key: 'L', label: 'L' }, { key: 'M', label: 'M' }, { key: 'S', label: 'S' }, { key: '2S', label: '2S' },
]

function emptyGrades(): DiguaGradeQty { return { L: 0, M: 0, S: 0, '2S': 0 } }

function DiguaPanel() {
  const [shipmentNo, setShipmentNo] = useState('')
  const [date, setDate] = useState('')
  const [rows, setRows] = useState<Record<string, DiguaRow>>(() =>
    Object.fromEntries(DIGUA_STORE_META.map(m => [m.id, { id: m.id, label: m.short, grades: emptyGrades(), daigakuimo: 0 }]))
  )
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  function setGrade(storeId: string, grade: keyof DiguaGradeQty, value: string) {
    const n = value === '' ? 0 : Math.max(0, parseInt(value) || 0)
    setRows(prev => ({ ...prev, [storeId]: { ...prev[storeId], grades: { ...prev[storeId].grades, [grade]: n } } }))
    setDone(null)
  }
  function setDgi(storeId: string, value: string) {
    const n = value === '' ? 0 : Math.max(0, parseInt(value) || 0)
    setRows(prev => ({ ...prev, [storeId]: { ...prev[storeId], daigakuimo: n } }))
    setDone(null)
  }

  const totalByCol = (col: keyof DiguaGradeQty | 'dgi') =>
    DIGUA_STORE_META.reduce((s, m) => s + (col === 'dgi' ? rows[m.id].daigakuimo : rows[m.id].grades[col]), 0)

  const hasAnyQty = DIGUA_STORE_META.some(m => {
    const r = rows[m.id]
    return r.grades.L + r.grades.M + r.grades.S + r.grades['2S'] + r.daigakuimo > 0
  })
  const canGenerate = !!shipmentNo && !!date && hasAnyQty

  async function handleGenerate() {
    if (!canGenerate) return
    setGenerating(true); setError(null); setDone(null)
    try {
      const storesPayload = DIGUA_STORE_META
        .map(m => rows[m.id])
        .filter(r => r.grades.L + r.grades.M + r.grades.S + r.grades['2S'] + r.daigakuimo > 0)
        .map(r => ({ storeId: r.id, grades: r.grades, daigakuimo: r.daigakuimo }))

      const res = await fetch('/api/generate-digua-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentNo, deliveryDate: date, stores: storesPayload }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? '產生失敗，請確認欄位')
        return
      }
      const blob = await res.blob()
      const name = `${shipmentNo}_茨城地瓜+大學芋_店鋪貨單.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
      setDone(name)
    } catch {
      setError('網路錯誤，請稍後再試')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
        目前是手動輸入版（先把「照文字規則手刻樣式格式跑掉」跟「借用店範本公式沒重算」兩個問題修好，用真實出貨單 S2026061801 逐格核對過）。
        上傳圖片讓 AI 自動讀數字的版本還沒接上，這裡先讓你手動打數字測試產出格式對不對。
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">🍠 地瓜(茨城)＋大學芋 店鋪貨單</h2>
          <p className="text-xs text-gray-400 mt-0.5">輸入出貨單號、配送日期，跟各店各規格箱數，產生 11 店分頁＋總表。</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">出貨單號</label>
              <input type="text" value={shipmentNo} onChange={e => setShipmentNo(e.target.value)}
                placeholder="例：S2026071801"
                className="w-40 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-lopia-red" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">配送日期</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="text-xs border-collapse min-w-[720px]">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold text-gray-600 border-b border-gray-200">規格</th>
                  {DIGUA_STORE_META.map(m => (
                    <th key={m.id} title={m.full} className="px-1 py-1.5 font-semibold text-gray-600 border-b border-gray-200 text-center w-14">{m.short}</th>
                  ))}
                  <th className="px-2 py-1.5 font-semibold text-gray-500 border-b border-gray-200 text-center w-16">合計</th>
                </tr>
              </thead>
              <tbody>
                {GRADE_LABELS.map(g => (
                  <tr key={g.key}>
                    <td className="px-2 py-1 font-medium text-gray-600 border-b border-gray-100">{g.label}</td>
                    {DIGUA_STORE_META.map(m => (
                      <td key={m.id} className="px-1 py-1 border-b border-gray-100">
                        <input type="number" min={0} value={rows[m.id].grades[g.key] || ''} onChange={e => setGrade(m.id, g.key, e.target.value)}
                          className="w-12 border border-gray-200 rounded px-1 py-1 text-center text-xs focus:outline-none focus:ring-2 focus:ring-lopia-red" />
                      </td>
                    ))}
                    <td className="px-2 py-1 text-center text-gray-400 border-b border-gray-100">{totalByCol(g.key) || ''}</td>
                  </tr>
                ))}
                <tr className="bg-amber-50/60">
                  <td className="px-2 py-1 font-medium text-amber-700 border-b border-gray-100">大學芋</td>
                  {DIGUA_STORE_META.map(m => (
                    <td key={m.id} className="px-1 py-1 border-b border-gray-100">
                      <input type="number" min={0} value={rows[m.id].daigakuimo || ''} onChange={e => setDgi(m.id, e.target.value)}
                        className="w-12 border border-amber-200 rounded px-1 py-1 text-center text-xs focus:outline-none focus:ring-2 focus:ring-lopia-red bg-white" />
                    </td>
                  ))}
                  <td className="px-2 py-1 text-center text-amber-600 border-b border-gray-100">{totalByCol('dgi') || ''}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {error && <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">❌ {error}</div>}

          <button onClick={handleGenerate} disabled={!canGenerate || generating}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-lopia-red text-white font-semibold rounded-xl text-base hover:bg-lopia-red-dark transition-colors disabled:opacity-50 shadow-sm">
            {generating ? <><Spinner size={18} /> 產生中…</> : <>🍠 產生店鋪貨單 Excel</>}
          </button>

          {done && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span className="text-sm font-bold text-emerald-700">已產生並下載</span>
              </div>
              <p className="text-xs text-emerald-600 font-mono ml-6 mt-1">📄 {done}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ShipmentGeneratorPage() {
  const [authed, setAuthed] = useState(false)
  const [tab, setTab]       = useState<'lopia' | 'yushu' | 'apple11'>('lopia')

  useEffect(() => {
    // 以伺服器 cookie 為準：sessionStorage 可能與 cookie 過期時間不同步
    fetch('/api/portal-auth', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d.ok) setAuthed(true) })
      .catch(() => {})
  }, [])

  if (!authed) return <PasswordGate onAuth={() => setAuthed(true)} />

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href="/" className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors shrink-0">
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
          <a href="/orders" className="flex items-center text-xs text-gray-500 hover:text-lopia-red transition-colors px-2.5 py-1.5 rounded-md hover:bg-lopia-red-light border border-gray-200 hover:border-lopia-red font-medium">
            出貨單系統
          </a>
        </div>

        {/* Tab bar */}
        <div className="max-w-2xl mx-auto px-4 flex border-t border-gray-100">
          {([['lopia', '📦 LOPIA 出貨單'], ['yushu', '🏭 優儲出貨單'], ['apple11', '🍎 蘋果11庫存出貨']] as ['lopia' | 'yushu' | 'apple11', string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? 'border-lopia-red text-lopia-red'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>{label}</button>
          ))}
        </div>
      </header>

      {tab === 'lopia' ? <GeneratorPanel /> : tab === 'yushu' ? <YushuPanel /> : <Apple11Panel />}
    </div>
  )
}
