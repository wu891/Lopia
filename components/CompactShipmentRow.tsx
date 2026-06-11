'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import TimelineProgress from './TimelineProgress'
import DocumentStatus from './DocumentStatus'
import InventoryBar from './InventoryBar'
import DeliveryPlan from './DeliveryPlan'
import PasswordModal, { isAuthed, logChange } from './PasswordModal'
import BatchItemList from './BatchItemList'

const STATUS_OPTIONS = ['待出貨', '部分出貨', '全數出貨', '退回/銷毀'] as const

const DELIVERY_BADGE: Record<string, { dot: string; cls: string }> = {
  '待出貨':    { dot: 'bg-gray-400',    cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  '部分出貨':  { dot: 'bg-amber-400',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  '全數出貨':  { dot: 'bg-emerald-500', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  '退回/銷毀': { dot: 'bg-rose-500',    cls: 'bg-rose-50 text-rose-700 border-rose-200' },
}

function EditableStatusBadge({
  value,
  shipmentId,
  lang,
  onUpdated,
}: {
  value: string | null
  shipmentId: string
  lang: Lang
  onUpdated: () => void
}) {
  const [current, setCurrent] = useState(value)
  const [open, setOpen] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 })
  const ref = useRef<HTMLDivElement>(null)

  // prop 更新時同步 local state
  useEffect(() => { setCurrent(value) }, [value])

  // 計算 dropdown 位置（fixed 定位需要每次算）
  const updatePos = useCallback(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setDropdownPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open, updatePos])

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!isAuthed()) { setShowAuth(true); return }
    if (!open) updatePos()
    setOpen(o => !o)
  }

  async function handleSelect(status: string) {
    if (status === current) { setOpen(false); return }
    setOpen(false)
    setSaving(true)
    try {
      await fetch(`/api/shipments/${shipmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryStatus: status }),
      })
      await logChange('更新配送狀態', shipmentId, `${current ?? '—'} → ${status}`)
      setCurrent(status)
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  const style = DELIVERY_BADGE[current ?? ''] ?? { dot: 'bg-gray-400', cls: 'bg-gray-100 text-gray-500 border-gray-200' }

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={handleClick}
          disabled={saving}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap transition-opacity hover:opacity-75 cursor-pointer disabled:opacity-40 ${style.cls}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
          {current ?? '—'}
          <svg className="w-2 h-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* 用 portal 概念：fixed 定位，位置動態計算 */}
      {open && (
        <div
          className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden min-w-[120px]"
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
        >
          {STATUS_OPTIONS.map(opt => {
            const s = DELIVERY_BADGE[opt]
            const isCurrent = opt === current
            return (
              <button
                key={opt}
                onClick={(e) => { e.stopPropagation(); handleSelect(opt) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-gray-50 ${isCurrent ? 'font-semibold' : 'text-gray-700'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                {opt}
                {isCurrent && <span className="ml-auto text-lopia-red">✓</span>}
              </button>
            )
          })}
        </div>
      )}

      {showAuth && (
        <PasswordModal
          lang={lang}
          onSuccess={() => { setShowAuth(false); setOpen(true) }}
          onCancel={() => setShowAuth(false)}
        />
      )}
    </>
  )
}

// 備註可編輯元件（精簡模式用）
function EditableRemarks({
  shipmentId,
  initialValue,
  lang,
  onUpdated,
}: {
  shipmentId: string
  initialValue: string | null
  lang: Lang
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialValue ?? '')
  const [saving, setSaving] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // prop 更新時同步（不覆蓋編輯中的內容）
  useEffect(() => { if (!editing) setValue(initialValue ?? '') }, [initialValue, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation()
    if (!isAuthed()) { setShowAuth(true); return }
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await fetch(`/api/shipments/${shipmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remarks: value }),
      })
      await logChange('更新備註', shipmentId, value || '(清空)')
      setEditing(false)
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setValue(initialValue ?? ''); setEditing(false) }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() }
  }

  if (editing) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2" onClick={e => e.stopPropagation()}>
        <textarea
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={lang === 'ja' ? '備考を入力...' : '輸入備註...'}
          className="w-full bg-transparent text-xs text-yellow-800 resize-none focus:outline-none"
        />
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={() => { setValue(initialValue ?? ''); setEditing(false) }} className="text-xs text-gray-400 hover:text-gray-600">取消</button>
          <button onClick={handleSave} disabled={saving} className="text-xs text-emerald-600 font-semibold hover:text-emerald-700 disabled:opacity-50">
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={handleEdit}
      className={`group cursor-pointer rounded-lg px-3 py-1.5 transition-colors ${value ? 'bg-yellow-50 border border-yellow-100 hover:border-yellow-300' : 'bg-gray-50 border border-dashed border-gray-200 hover:border-gray-400'}`}
    >
      {value ? (
        <p className="text-xs text-yellow-800 group-hover:text-yellow-900">{value}</p>
      ) : (
        <p className="text-xs text-gray-400 group-hover:text-gray-500">
          {lang === 'ja' ? '備考を追加...' : '點此新增備註...'}
        </p>
      )}
      {showAuth && (
        <PasswordModal
          lang={lang}
          onSuccess={() => { setShowAuth(false); setEditing(true) }}
          onCancel={() => setShowAuth(false)}
        />
      )}
    </div>
  )
}

interface Props {
  shipment: Shipment
  lang: Lang
  allRecords: ShipmentRecord[]
  onRecordChange: () => void
}

export default function CompactShipmentRow({ shipment, lang, allRecords, onRecordChange }: Props) {
  const [open, setOpen] = useState(false)
  const T = t[lang]

  const shippedBoxes = shipment.shippedBoxes ?? 0
  const plannedBoxes = shipment.plannedBoxes ?? 0
  const total = shipment.totalBoxes ?? 0
  const shippedPct = total > 0 ? Math.min(100, Math.round((shippedBoxes / total) * 100)) : 0
  const plannedPct = total > 0 ? Math.min(100, Math.round((plannedBoxes / total) * 100)) : 0

  // 異常批次凸顯（收合列即可見，僅用現有 Notion 欄位；與 AnomalyBadge 的退回/銷毀不同）
  const warnings: { key: string; label: string; tone: 'red' | 'amber' }[] = []
  if ((shipment.quarantine ?? '').includes('不合格')) warnings.push({ key: 'quarantine', label: lang === 'ja' ? '検疫不合格' : '檢疫不合格', tone: 'red' })
  if (shipment.radiationTest === '不合格') warnings.push({ key: 'rad', label: lang === 'ja' ? '放射線不合格' : '輻射不合格', tone: 'red' })
  if (shipment.pesticideTest === '不合格') warnings.push({ key: 'pest', label: lang === 'ja' ? '農薬不合格' : '農藥不合格', tone: 'red' })
  if (shipment.fumigation === '需燻蒸' || shipment.fumigation === '燻蒸必要') warnings.push({ key: 'fum', label: lang === 'ja' ? '燻蒸必要' : '需燻蒸', tone: 'amber' })
  if (shipment.totalBoxes != null && plannedBoxes > 0 && plannedBoxes !== shipment.totalBoxes) warnings.push({ key: 'box', label: lang === 'ja' ? '箱数不一致' : '箱數不符', tone: 'amber' })

  const arrivalStr = shipment.arrivalTW?.slice(5).replace('-', '/') ?? '—'
  const clearanceStr = shipment.actualClearance?.slice(5).replace('-', '/') ?? '—'

  return (
    <div>
      {/* ── Compact row ── */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => e.key === 'Enter' && setOpen(o => !o)}
        className="flex items-center gap-3 px-4 py-3 min-h-[52px] hover:bg-gray-50 transition-colors cursor-pointer select-none"
      >
        {/* Chevron */}
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`text-gray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        {/* Name + summary */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-gray-800 text-sm truncate">{shipment.ivName}</span>
            {shipment.supplier && (
              <span className="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-500 border border-blue-100 shrink-0">
                {shipment.supplier}
              </span>
            )}
            {warnings.map(w => (
              <span
                key={w.key}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0 ${
                  w.tone === 'red'
                    ? 'bg-red-50 text-red-600 border-red-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {w.tone === 'red' ? (
                    <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>
                  ) : (
                    <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>
                  )}
                </svg>
                {w.label}
              </span>
            ))}
          </div>
          {shipment.productSummary && (
            <p className="text-[11px] text-gray-500 truncate mt-0.5 hidden sm:block">{shipment.productSummary}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-0.5 sm:hidden">
            {arrivalStr !== '—' && <>抵台 {arrivalStr}</>}
            {arrivalStr !== '—' && clearanceStr !== '—' && <span className="mx-1">·</span>}
            {clearanceStr !== '—' && <>出關 {clearanceStr}</>}
          </p>
        </div>

        {/* Key dates + boxes + status badge */}
        <div className="flex items-center gap-3 shrink-0 text-xs text-gray-500">
          <div className="hidden md:flex items-center gap-0.5">
            <span className="text-gray-500 text-[10px]">抵台</span>
            <span className="font-medium text-gray-700 ml-0.5">{arrivalStr}</span>
          </div>
          <div className="hidden md:flex items-center gap-0.5">
            <span className="text-gray-500 text-[10px]">出關</span>
            <span className={`font-medium ml-0.5 ${shipment.actualClearance ? 'text-gray-700' : 'text-gray-300'}`}>{clearanceStr}</span>
          </div>
          {shipment.totalBoxes != null && (
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              {total > 0 && (
                <div
                  className="hidden sm:block w-12 h-1.5 rounded-full bg-gray-100 overflow-hidden relative"
                  title={`${T.shipped} ${shippedBoxes} / ${T.plannedBoxes} ${plannedBoxes} / ${total} ${T.boxes}`}
                >
                  <span className="absolute inset-y-0 left-0 bg-red-200 rounded-full" style={{ width: `${plannedPct}%` }} />
                  <span className="absolute inset-y-0 left-0 bg-lopia-red rounded-full" style={{ width: `${shippedPct}%` }} />
                </div>
              )}
              <span className="text-gray-500 text-xs font-medium">
                {shipment.totalBoxes}<span className="text-gray-400 text-[10px] ml-0.5">{T.boxes}</span>
              </span>
            </div>
          )}
          <EditableStatusBadge
            value={shipment.deliveryStatus}
            shipmentId={shipment.id}
            lang={lang}
            onUpdated={onRecordChange}
          />
        </div>
      </div>

      {/* ── Expandable detail ── */}
      <div
        className="transition-all duration-200 ease-out"
        style={{
          maxHeight: open ? '9999px' : '0px',
          overflow: open ? 'visible' : 'hidden',
        }}
      >
        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/60 space-y-3">
          {/* Mobile-only dates */}
          <div className="flex gap-4 sm:hidden text-xs text-gray-500">
            <span><span className="text-gray-400">抵台</span> <span className="font-medium text-gray-700">{arrivalStr}</span></span>
            <span><span className="text-gray-400">出關</span> <span className={`font-medium ${shipment.actualClearance ? 'text-gray-700' : 'text-gray-300'}`}>{clearanceStr}</span></span>
          </div>

          {shipment.productSummary && (
            <p className="text-xs text-gray-500 sm:hidden">{shipment.productSummary}</p>
          )}

          <TimelineProgress shipment={shipment} lang={lang} />

          {/* Meta */}
          {(shipment.flightNo || shipment.awbNo || shipment.warehouse) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
              {shipment.flightNo && (
                <div className="flex flex-col">
                  <span className="text-xs text-gray-400">{T.flightNo}</span>
                  <span className="text-xs font-medium text-gray-700">{shipment.flightNo}</span>
                </div>
              )}
              {shipment.awbNo && (
                <div className="flex flex-col">
                  <span className="text-xs text-gray-400">{T.awbNo}</span>
                  <span className="text-xs font-medium text-gray-700">{shipment.awbNo}</span>
                </div>
              )}
              {shipment.warehouse && (
                <div className="flex flex-col">
                  <span className="text-xs text-gray-400">{T.warehouse}</span>
                  <span className="text-xs font-medium text-lopia-red">{shipment.warehouse}</span>
                </div>
              )}
            </div>
          )}

          <InventoryBar
            total={shipment.totalBoxes}
            shipped={shippedBoxes}
            planned={plannedBoxes}
            lang={lang}
          />

          <BatchItemList batchId={shipment.id} lang={lang} parentTotalBoxes={shipment.totalBoxes} parentShippedBoxes={shippedBoxes} />

          <DeliveryPlan
            batchId={shipment.id}
            batchName={shipment.ivName}
            totalBoxes={shipment.totalBoxes}
            records={allRecords}
            lang={lang}
            supplierExcelId={shipment.supplierExcelId}
            onRecordChange={onRecordChange}
          />

          <div>
            <p className="text-xs text-gray-500 mb-1.5">{T.documents}</p>
            <DocumentStatus shipment={shipment} lang={lang} />
          </div>

          {/* 備註 - 可編輯 */}
          <div>
            <p className="text-xs text-gray-500 mb-1">{lang === 'ja' ? '備考' : '備註'}</p>
            <EditableRemarks
              shipmentId={shipment.id}
              initialValue={shipment.remarks}
              lang={lang}
              onUpdated={onRecordChange}
            />
          </div>

          <div className="text-right">
            <span className="text-xs text-gray-500">
              {T.lastUpdated}: {new Date(shipment.lastEdited).toLocaleString(lang === 'ja' ? 'ja-JP' : 'zh-TW')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
