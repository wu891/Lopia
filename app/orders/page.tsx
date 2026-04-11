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
  const [result, setResult] = useState<{ driveUrl: string; shipmentNo: string } | null>(null)
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
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${shipmentNo} LOPIA_${batchName}_店鋪貨單.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      setResult({ driveUrl, shipmentNo })
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
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-emerald-600 font-medium">✓ {result.shipmentNo} 已產生</span>
            {result.driveUrl && (
              <a href={result.driveUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline">
                Drive 連結 →
              </a>
            )}
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

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [authed, setAuthed] = useState(false)
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
      // Get records separately for round grouping
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

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
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
      </main>
    </div>
  )
}
