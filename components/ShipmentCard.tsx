'use client'
import { useState, useRef, useEffect } from 'react'
import { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import TimelineProgress from './TimelineProgress'
import DocumentStatus from './DocumentStatus'
import InventoryBar from './InventoryBar'
import DeliveryPlan from './DeliveryPlan'
import PasswordModal, { isAuthed, logChange } from './PasswordModal'
import BatchItemList from './BatchItemList'

interface ShipmentCardProps {
  shipment: Shipment
  lang: Lang
  allRecords: ShipmentRecord[]
  onRecordChange: () => void
}

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
  const ref = useRef<HTMLDivElement>(null)

  // prop 更新時同步 local state
  useEffect(() => { setCurrent(value) }, [value])

  // click-outside 關閉
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!isAuthed()) { setShowAuth(true); return }
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
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border transition-opacity hover:opacity-75 cursor-pointer disabled:opacity-40 ${style.cls}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
          {current ?? '—'}
          <svg className="w-2.5 h-2.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden min-w-[120px]">
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
      </div>

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

// 備註欄可編輯元件
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
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
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

export default function ShipmentCard({ shipment, lang, allRecords, onRecordChange }: ShipmentCardProps) {
  const T = t[lang]

  const plannedBoxes = shipment.plannedBoxes ?? 0
  const shippedBoxes = shipment.shippedBoxes ?? 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {/* Card header */}
      <div className="flex items-start justify-between px-5 pt-4 pb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-base truncate leading-tight">{shipment.ivName}</h3>
          {shipment.productSummary && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{shipment.productSummary}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 ml-3 shrink-0 items-center">
          {shipment.supplier && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100">
              {shipment.supplier}
            </span>
          )}
          <EditableStatusBadge
            value={shipment.deliveryStatus}
            shipmentId={shipment.id}
            lang={lang}
            onUpdated={onRecordChange}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="px-5 pb-3">
        <TimelineProgress shipment={shipment} lang={lang} />
      </div>

      {/* Meta section */}
      <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
        {shipment.flightNo && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">{T.flightNo}</span>
            <span className="text-xs font-medium text-gray-700">{shipment.flightNo}</span>
          </div>
        )}
        {shipment.awbNo && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">{T.awbNo}</span>
            <span className="text-xs font-medium text-gray-700">{shipment.awbNo}</span>
          </div>
        )}
        {shipment.warehouse && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">{T.warehouse}</span>
            <span className="text-xs font-medium text-gray-700">{shipment.warehouse}</span>
          </div>
        )}
        {shipment.transportMode && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">{T.transportMode}</span>
            <span className="text-xs font-medium text-gray-700">
              {shipment.transportMode}{shipment.fclLcl ? ` · ${shipment.fclLcl}` : ''}
            </span>
          </div>
        )}
        {shipment.transportMode && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">{T.customsBroker}</span>
            <span className="text-xs font-medium text-gray-700">
              {shipment.transportMode === '空運' ? '日通' : '台灣航空'}
            </span>
          </div>
        )}
      </div>

      <div className="px-5 py-3 space-y-3">
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
      </div>

      {/* Footer */}
      <div className="px-5 py-2 bg-gray-50 border-t border-gray-100 text-right">
        <span className="text-xs text-gray-500">
          {T.lastUpdated}: {new Date(shipment.lastEdited).toLocaleString(lang === 'ja' ? 'ja-JP' : 'zh-TW')}
        </span>
      </div>
    </div>
  )
}
