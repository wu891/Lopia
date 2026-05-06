'use client'
import { useState } from 'react'
import { fillShippingOrder, downloadWorkbook } from '@/lib/fillShippingOrder'

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
              <path d="M12 2a7 7 0 0 1 7 7v1h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V9a7 7 0 0 1 7-7z"/>
              <circle cx="12" cy="16" r="1.5"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-800">優儲出貨單</h1>
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

// ── File Drop Zone ────────────────────────────────────────────────────────────

function FileDropZone({
  label,
  accept,
  file,
  onFile,
}: {
  label: string
  accept: string
  file: File | null
  onFile: (f: File) => void
}) {
  const [dragging, setDragging] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`relative border-2 border-dashed rounded-xl px-5 py-6 text-center transition-colors cursor-pointer
        ${dragging ? 'border-lopia-red bg-lopia-red-light' : 'border-gray-200 hover:border-lopia-red hover:bg-lopia-red-light'}`}
    >
      <input
        type="file"
        accept={accept}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]) }}
      />
      <div className="flex flex-col items-center gap-2 pointer-events-none">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={file ? 'text-lopia-red' : 'text-gray-300'}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p className="text-xs font-medium text-gray-600">{label}</p>
        {file
          ? <p className="text-xs text-lopia-red font-semibold truncate max-w-full">{file.name}</p>
          : <p className="text-xs text-gray-400">點擊或拖曳上傳</p>
        }
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

function MainPanel() {
  const [shippingFile, setShippingFile] = useState<File | null>(null)
  const [inventoryFile, setInventoryFile] = useState<File | null>(null)
  const [round, setRound] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleFill() {
    if (!shippingFile || !inventoryFile || !round) return
    setLoading(true)
    setDone(false)
    try {
      const [shippingBuf, inventoryBuf] = await Promise.all([
        shippingFile.arrayBuffer(),
        inventoryFile.arrayBuffer(),
      ])
      const wb = fillShippingOrder(shippingBuf, inventoryBuf, parseInt(round))
      const stem = shippingFile.name.replace(/\.xlsx?$/i, '')
      downloadWorkbook(wb, `${stem}_第${round}回.xlsx`)
      setDone(true)
    } catch (e) {
      alert('錯誤：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }

  const canRun = !!shippingFile && !!inventoryFile && !!round

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 bg-lopia-red rounded-lg flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">優儲出貨單</h1>
              <p className="text-xs text-gray-400">從庫存管理表填入蘋果等級名稱</p>
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">

          <FileDropZone
            label="店鋪貨單範本（S2026xxxxxx）"
            accept=".xlsx,.xls"
            file={shippingFile}
            onFile={setShippingFile}
          />

          <FileDropZone
            label="庫存管理表"
            accept=".xlsx,.xls"
            file={inventoryFile}
            onFile={setInventoryFile}
          />

          {/* Round number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">第幾回</label>
            <input
              type="number"
              value={round}
              onChange={e => { setRound(e.target.value); setDone(false) }}
              placeholder="例：5"
              min={1}
              max={20}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-lopia-red"
            />
          </div>

          {/* Action */}
          <button
            onClick={handleFill}
            disabled={!canRun || loading}
            className="w-full py-3 bg-lopia-red text-white font-semibold rounded-xl text-base disabled:opacity-40 active:opacity-80 transition-opacity flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                處理中...
              </>
            ) : '填入等級並下載'}
          </button>

          {done && (
            <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded-xl px-4 py-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              已完成，檔案已下載。
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="mt-5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-amber-700">注意事項</p>
          <ul className="text-xs text-amber-600 space-y-0.5 list-disc list-inside">
            <li>庫存管理表需有「庫存管理表」和「第N回出貨明細」分頁</li>
            <li>出貨明細表頭 A欄=「門市」、B欄=「番号」</li>
            <li>B欄入數必須是純數字（28、36），不能是「28房」</li>
            <li>台北大巨蛋店依單價 ≤ 1500 自動判斷特価區段</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function YushoShippingPage() {
  const [authed, setAuthed] = useState(
    typeof window !== 'undefined' && sessionStorage.getItem('lopia_portal_authed') === '1'
  )

  if (!authed) return <PasswordGate onAuth={() => setAuthed(true)} />
  return <MainPanel />
}
