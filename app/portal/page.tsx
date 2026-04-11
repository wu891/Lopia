'use client'
import { useState, useEffect, useCallback } from 'react'
import { Shipment, ShipmentRecord, LogisticsEvent } from '@/lib/notion'
import { STORES } from '@/lib/stores'

type Tab = 'customs' | 'freight'

interface BatchWithRecords extends Shipment {
  records: ShipmentRecord[]
}

interface RoundGroup {
  roundNo: number
  date: string | null
  stores: { name: string; boxes: number }[]
}

interface StoreDelivery {
  store: string
  boxes: number
  estDelivery: string
  delivered: boolean
  existingEventId: string | null
  photoUrl: string | null
  photoUploading: boolean
}

// 台灣時區今日日期 YYYY-MM-DD
function getTodayTW(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

function groupRecordsByRound(records: ShipmentRecord[]): RoundGroup[] {
  const map = new Map<number, RoundGroup>()
  for (const r of records) {
    const key = r.round ?? 0
    if (!map.has(key)) map.set(key, { roundNo: key, date: r.date ?? null, stores: [] })
    map.get(key)!.stores.push({ name: r.store ?? '', boxes: r.boxes ?? 0 })
  }
  return Array.from(map.values()).sort((a, b) => a.roundNo - b.roundNo)
}

function generateEventNo(batchName: string, type: '通關' | 'R', round?: number, store?: string) {
  const d = new Date()
  const ts = `${d.getMonth() + 1}${d.getDate()}${d.getHours()}${d.getMinutes()}`
  if (type === '通關') return `CLR-${batchName.slice(0, 8)}-${ts}`
  return `DLV-${batchName.slice(0, 6)}-R${round}-${(store ?? '').slice(0, 4)}-${ts}`
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
            <span className="text-white text-2xl font-bold">L</span>
          </div>
          <h1 className="text-xl font-bold text-gray-800">LOPIA 物流通報</h1>
          <p className="text-sm text-gray-400 mt-1">業者專用填報頁面</p>
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

// ── Customs Section ────────────────────────────────────────────────────────────

function CustomsSection({ batches }: { batches: Shipment[] }) {
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [pickupLocation, setPickupLocation] = useState('')
  const [remarks, setRemarks] = useState('')
  const [needsFumigation, setNeedsFumigation] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Show batches that haven't fully cleared yet
  const activeBatches = batches.filter(b =>
    !b.actualClearance || b.deliveryStatus === '未到'
  )

  const selectedBatch = batches.find(b => b.id === selectedBatchId) ?? null

  function handleBatchChange(id: string) {
    setSelectedBatchId(id)
    // 預填煙燻狀態：若 Notion 上已有申請中 / 進行中，預設勾選
    const batch = batches.find(b => b.id === id)
    const existing = batch?.fumigation ?? ''
    setNeedsFumigation(['申請中', '進行中', '完成'].includes(existing))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedBatchId || !releaseDate) return
    setSaving(true)
    setError('')
    const batch = batches.find(b => b.id === selectedBatchId)
    try {
      // 1. 建立通關放貨事件
      const res = await fetch('/api/logistics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventNo: generateEventNo(batch?.ivName ?? 'BATCH', '通關'),
          eventType: '通關放貨',
          batchId: selectedBatchId,
          releaseDate,
          pickupLocation,
          deliveryStatus: '待配送',
          remarks,
        }),
      })
      if (!res.ok) throw new Error('Failed')

      // 2. 更新 Notion 批次頁的燻蒸狀態
      await fetch(`/api/shipments/${selectedBatchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fumigation: needsFumigation ? '申請中' : '不需要' }),
      })

      setSaved(true)
      setReleaseDate('')
      setPickupLocation('')
      setRemarks('')
      setSelectedBatchId('')
      setNeedsFumigation(false)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('送出失敗，請重試。')
    } finally {
      setSaving(false)
    }
  }

  // 檢驗狀態顏色
  function inspColor(val: string | null) {
    if (!val) return 'text-gray-300'
    if (['進行中', '申請中'].includes(val)) return 'text-yellow-600'
    if (['合格', '完成', '不需要'].includes(val)) return 'text-green-600'
    if (['不合格'].includes(val)) return 'text-red-500'
    return 'text-gray-600'
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <p className="text-sm text-gray-500">通關完成後，請填寫以下放貨資訊，讓貨運業者安排取貨。</p>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">選擇批次 *</label>
        <select
          value={selectedBatchId}
          onChange={e => handleBatchChange(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-lopia-red"
          required
        >
          <option value="">— 請選擇批次 —</option>
          {activeBatches.map(b => (
            <option key={b.id} value={b.id}>
              {b.ivName}{b.arrivalTW ? ` (抵台 ${b.arrivalTW})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* ── 檢驗資訊（選批次後顯示） */}
      {selectedBatch && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">檢驗狀態</p>

          {/* 農藥 / 輻射 (read-only from Notion) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-lg border border-gray-100 px-3 py-2.5">
              <p className="text-[10px] text-gray-400 mb-0.5">🧪 農藥檢驗</p>
              <p className={`text-sm font-semibold ${inspColor(selectedBatch.pesticideTest)}`}>
                {selectedBatch.pesticideTest ?? '尚無資料'}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 px-3 py-2.5">
              <p className="text-[10px] text-gray-400 mb-0.5">☢️ 輻射檢驗</p>
              <p className={`text-sm font-semibold ${inspColor(selectedBatch.radiationTest)}`}>
                {selectedBatch.radiationTest ?? '尚無資料'}
              </p>
            </div>
          </div>

          {/* 煙燻處理 checkbox */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div className="relative">
              <input
                type="checkbox"
                checked={needsFumigation}
                onChange={e => setNeedsFumigation(e.target.checked)}
                className="sr-only"
              />
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                needsFumigation ? 'bg-lopia-red border-lopia-red' : 'bg-white border-gray-300'
              }`}>
                {needsFumigation && (
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">需要煙燻處理</p>
              <p className="text-xs text-gray-400">勾選後將更新 Notion 批次頁的燻蒸狀態為「申請中」</p>
            </div>
          </label>
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">放貨日期 *</label>
        <input
          type="date"
          value={releaseDate}
          onChange={e => setReleaseDate(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-lopia-red"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">取貨地點</label>
        <input
          type="text"
          value={pickupLocation}
          onChange={e => setPickupLocation(e.target.value)}
          placeholder="例：優儲倉庫 台中市..."
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-lopia-red"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">備註</label>
        <textarea
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          placeholder="任何需要告知的資訊..."
          rows={3}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-lopia-red resize-none"
        />
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button
        type="submit"
        disabled={saving || !selectedBatchId || !releaseDate}
        className="w-full py-4 bg-lopia-red text-white font-bold rounded-xl text-base disabled:opacity-40 active:opacity-80 transition-opacity"
      >
        {saved ? '✓ 已送出' : saving ? '送出中...' : '送出放貨通知'}
      </button>
    </form>
  )
}

// ── Freight Section ────────────────────────────────────────────────────────────

function FreightSection({
  batches,
  allRecords,
  existingEvents,
  onRefresh,
}: {
  batches: Shipment[]
  allRecords: ShipmentRecord[]
  existingEvents: LogisticsEvent[]
  onRefresh: () => void
}) {
  const todayTW = getTodayTW()

  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [selectedRound, setSelectedRound] = useState<number | null>(null)
  const [storeDeliveries, setStoreDeliveries] = useState<StoreDelivery[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // 只顯示「今日（台灣時區）有排程輪次」的批次
  const todayBatches = batches.filter(b => {
    const recs = allRecords.filter(r => r.batchId === b.id)
    return groupRecordsByRound(recs).some(r => r.date === todayTW)
  })

  const batchRecords = allRecords.filter(r => r.batchId === selectedBatchId)
  const rounds = groupRecordsByRound(batchRecords)

  // Rebuild store list when batch/round changes
  useEffect(() => {
    if (!selectedBatchId || selectedRound == null) {
      setStoreDeliveries([])
      return
    }
    const roundGroup = rounds.find(r => r.roundNo === selectedRound)
    if (!roundGroup) return

    const deliveries: StoreDelivery[] = roundGroup.stores.map(s => {
      const existing = existingEvents.find(e =>
        e.batchId === selectedBatchId &&
        e.round === selectedRound &&
        e.store === s.name &&
        e.eventType === '配送'
      )
      return {
        store: s.name,
        boxes: s.boxes,
        estDelivery: existing?.estDelivery ?? '',
        delivered: existing?.deliveryStatus === '已送達',
        existingEventId: existing?.id ?? null,
        photoUrl: null,
        photoUploading: false,
      }
    })
    setStoreDeliveries(deliveries)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId, selectedRound, existingEvents])

  function updateStore<K extends keyof StoreDelivery>(idx: number, field: K, value: StoreDelivery[K]) {
    setStoreDeliveries(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  // 上傳簽收照至 Google Drive
  async function handlePhotoUpload(idx: number, file: File) {
    const batch = batches.find(b => b.id === selectedBatchId)
    updateStore(idx, 'photoUploading', true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('batch', batch?.ivName ?? 'BATCH')
      form.append('docType', `簽收照_R${selectedRound}_${storeDeliveries[idx].store}`)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error('upload failed')
      const json = await res.json()
      updateStore(idx, 'photoUrl', json.url ?? null)
    } catch {
      alert('照片上傳失敗，請重試。')
    } finally {
      updateStore(idx, 'photoUploading', false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedBatchId || selectedRound == null) return
    setSaving(true)
    setError('')
    const batch = batches.find(b => b.id === selectedBatchId)

    try {
      await Promise.all(storeDeliveries.map(async (s) => {
        const payload = {
          estDelivery: s.estDelivery || undefined,
          actualDelivery: s.delivered ? (s.estDelivery || todayTW) : undefined,
          deliveryStatus: s.delivered ? '已送達' : s.estDelivery ? '配送中' : '待配送',
          remarks: s.photoUrl ? `簽收照：${s.photoUrl}` : undefined,
        }

        if (s.existingEventId) {
          await fetch(`/api/logistics/${s.existingEventId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        } else {
          await fetch('/api/logistics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventNo: generateEventNo(batch?.ivName ?? 'BATCH', 'R', selectedRound, s.store),
              eventType: '配送',
              batchId: selectedBatchId,
              store: s.store,
              round: selectedRound,
              ...payload,
            }),
          })
        }
      }))

      setSaved(true)
      onRefresh()
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('送出失敗，請重試。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <p className="text-sm text-gray-500">
        依當日（台灣時區）出貨排程自動篩選，逐店填寫配送狀態並上傳簽收照。
      </p>

      {/* ── Batch selector（今日有排程輪次的批次） */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          選擇批次 *
          <span className="ml-2 text-xs font-normal text-gray-400">僅顯示今日（{todayTW}）有排程輪次的批次</span>
        </label>
        {todayBatches.length === 0 ? (
          <div className="w-full border border-dashed border-gray-200 rounded-xl px-4 py-4 text-sm text-gray-400 text-center bg-gray-50">
            今日無待出貨批次
          </div>
        ) : (
          <select
            value={selectedBatchId}
            onChange={e => { setSelectedBatchId(e.target.value); setSelectedRound(null) }}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-lopia-red"
            required
          >
            <option value="">— 請選擇批次 —</option>
            {todayBatches.map(b => (
              <option key={b.id} value={b.id}>{b.ivName}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Round selector（今日輪次可點，其他 disabled） */}
      {selectedBatchId && rounds.length > 0 && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">選擇輪次 *</label>
          <div className="flex flex-wrap gap-2">
            {rounds.map(r => {
              const isToday = r.date === todayTW
              const isSelected = selectedRound === r.roundNo
              return (
                <button
                  key={r.roundNo}
                  type="button"
                  disabled={!isToday}
                  onClick={() => isToday && setSelectedRound(r.roundNo)}
                  title={isToday ? '' : `出貨日 ${r.date ?? '未設定'}，非今日不可選`}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all
                    ${isSelected
                      ? 'bg-lopia-red text-white border-lopia-red'
                      : isToday
                        ? 'bg-white text-gray-700 border-gray-300 active:bg-gray-50'
                        : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                    }`}
                >
                  第{r.roundNo}次
                  {r.date ? (
                    <span className={`ml-1 text-xs font-normal ${
                      isSelected ? 'text-red-100' : isToday ? 'text-lopia-red' : 'text-gray-300'
                    }`}>
                      {r.date.slice(5)}
                    </span>
                  ) : (
                    <span className="ml-1 text-xs font-normal text-gray-300">未設定</span>
                  )}
                  {isToday && !isSelected && (
                    <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-lopia-red align-middle" />
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-gray-400 mt-2">🔴 紅點 = 今日可出貨輪次；其餘輪次為不同日期，不可選取</p>
        </div>
      )}

      {/* ── Per-store delivery status */}
      {storeDeliveries.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-700">各門市配送狀態</p>
          {storeDeliveries.map((s, i) => (
            <div
              key={s.store}
              className={`border rounded-xl p-4 space-y-3 transition-colors ${
                s.delivered ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
              }`}
            >
              {/* Store header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{s.store}</p>
                  <p className="text-xs text-gray-400">{s.boxes} 箱</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateStore(i, 'delivered', !s.delivered)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    s.delivered ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {s.delivered ? '✓ 已送達' : '未送達'}
                </button>
              </div>

              {/* Est. delivery date */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">預計送達日期</label>
                <input
                  type="date"
                  value={s.estDelivery}
                  onChange={e => updateStore(i, 'estDelivery', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
                />
              </div>

              {/* ── Photo upload */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">簽收照</label>
                {s.photoUrl ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600 font-medium">✓ 已上傳</span>
                    <a
                      href={s.photoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 underline underline-offset-2"
                    >
                      檢視照片
                    </a>
                    <button
                      type="button"
                      onClick={() => updateStore(i, 'photoUrl', null)}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                    >
                      重新上傳
                    </button>
                  </div>
                ) : s.photoUploading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <div className="w-4 h-4 border-2 border-gray-300 border-t-lopia-red rounded-full animate-spin" />
                    上傳中...
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-2 cursor-pointer
                    px-4 py-2 rounded-lg border border-dashed border-gray-300
                    text-sm text-gray-500 hover:border-lopia-red hover:text-lopia-red
                    transition-colors bg-white active:bg-gray-50">
                    <span>📷</span>
                    <span>上傳出貨單簽收照</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handlePhotoUpload(i, file)
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {storeDeliveries.length > 0 && (
        <button
          type="submit"
          disabled={saving}
          className="w-full py-4 bg-lopia-red text-white font-bold rounded-xl text-base disabled:opacity-40 active:opacity-80 transition-opacity"
        >
          {saved ? '✓ 已儲存' : saving ? '儲存中...' : '儲存配送狀態'}
        </button>
      )}
    </form>
  )
}

// ── Main Portal Page ──────────────────────────────────────────────────────────

export default function PortalPage() {
  const [authed, setAuthed] = useState(false)
  const [tab, setTab] = useState<Tab>('customs')
  const [batches, setBatches] = useState<Shipment[]>([])
  const [allRecords, setAllRecords] = useState<ShipmentRecord[]>([])
  const [events, setEvents] = useState<LogisticsEvent[]>([])
  const [loading, setLoading] = useState(true)

  // Check session auth on mount
  useEffect(() => {
    if (sessionStorage.getItem('lopia_portal_authed') === '1') setAuthed(true)
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [shipmentsRes, recordsRes, eventsRes] = await Promise.all([
        fetch('/api/shipments', { cache: 'no-store' }),
        fetch('/api/records',   { cache: 'no-store' }),
        fetch('/api/logistics', { cache: 'no-store' }),
      ])
      const [s, r, e] = await Promise.all([
        shipmentsRes.json(),
        recordsRes.json(),
        eventsRes.json(),
      ])
      setBatches(s.shipments ?? [])
      setAllRecords(r.records ?? [])
      setEvents(e.events ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authed) fetchData()
  }, [authed, fetchData])

  if (!authed) return <PasswordGate onAuth={() => setAuthed(true)} />

  const openStoreNames = STORES.filter(s => s.status === 'open').map(s => s.name_zh)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-lopia-red rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">L</span>
          </div>
          <div>
            <h1 className="font-bold text-gray-800 text-sm leading-tight">LOPIA 物流通報</h1>
            <p className="text-xs text-gray-400">業者專用</p>
          </div>
          <button
            onClick={() => { sessionStorage.removeItem('lopia_portal_authed'); setAuthed(false) }}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600"
          >
            登出
          </button>
        </div>

        {/* Tab bar */}
        <div className="max-w-lg mx-auto px-4 pb-2 flex gap-1">
          <button
            onClick={() => setTab('customs')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === 'customs' ? 'bg-lopia-red text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            📋 通關回報
          </button>
          <button
            onClick={() => setTab('freight')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === 'freight' ? 'bg-lopia-red text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            🚚 配送回報
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-5">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-lopia-red border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === 'customs' ? (
          <CustomsSection batches={batches} />
        ) : (
          <FreightSection
            batches={batches}
            allRecords={allRecords}
            existingEvents={events}
            onRefresh={fetchData}
          />
        )}
      </div>
    </div>
  )
}
