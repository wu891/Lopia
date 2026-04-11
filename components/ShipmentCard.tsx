'use client'
import { useState } from 'react'
import { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import TimelineProgress from './TimelineProgress'
import DocumentStatus from './DocumentStatus'
import InventoryBar from './InventoryBar'
import DeliveryPlan from './DeliveryPlan'

interface ShipmentCardProps {
  shipment: Shipment
  lang: Lang
  allRecords: ShipmentRecord[]
  onRecordChange: () => void
}

const DELIVERY_BADGE: Record<string, { dot: string; cls: string }> = {
  '待出貨':  { dot: 'bg-gray-400',    cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  '部分出貨':{ dot: 'bg-amber-400',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  '全數出貨':{ dot: 'bg-emerald-500', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return null
  const style = DELIVERY_BADGE[value] ?? { dot: 'bg-gray-400', cls: 'bg-gray-100 text-gray-500 border-gray-200' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${style.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
      {value}
    </span>
  )
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

function getActiveStep(s: Shipment): number {
  if (s.warehouseIn) return 4
  if (s.actualClearance) return 3
  if (s.arrivalTW) return 2
  if (s.departJP) return 1
  return 0
}

/** 收合狀態的迷你 4 步驟 timeline（只有圓點 + 日期，無文字）*/
function MiniTimeline({ shipment }: { shipment: Shipment }) {
  const active = getActiveStep(shipment)
  const steps = [
    shipment.departJP,
    shipment.arrivalTW,
    shipment.actualClearance || shipment.estClearance,
    shipment.warehouseIn,
  ]

  return (
    <div className="flex items-center flex-1 min-w-0">
      {steps.map((date, i) => {
        const done    = i < active
        const current = i === active - 1
        const isLast  = i === steps.length - 1
        return (
          <div key={i} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-4 h-4 rounded-full shrink-0 flex items-center justify-center
                ${done
                  ? 'bg-lopia-red'
                  : current
                    ? 'bg-white border-2 border-lopia-red'
                    : 'bg-white border-2 border-gray-300'
                }`}>
                {done && (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
                {current && <span className="w-1.5 h-1.5 rounded-full bg-lopia-red block" />}
              </div>
              <span className={`text-[10px] mt-0.5 leading-none ${
                done || current ? 'text-lopia-red font-medium' : 'text-gray-300'
              }`}>
                {fmtDate(date)}
              </span>
            </div>
            {!isLast && (
              <div className={`h-px flex-1 mb-4 ${done ? 'bg-lopia-red' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function ShipmentCard({ shipment, lang, allRecords, onRecordChange }: ShipmentCardProps) {
  const [open, setOpen] = useState(false)
  const T = t[lang]

  const batchRecords = allRecords.filter(r => r.batchId === shipment.id)
  const shippedBoxes = batchRecords
    .filter(r => r.planStatus === '已完成')
    .reduce((s, r) => s + (r.boxes ?? 0), 0)
  const plannedBoxes = batchRecords
    .filter(r => r.planStatus !== '已取消')
    .reduce((s, r) => s + (r.boxes ?? 0), 0)

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden">

      {/* ── Collapsed row (always visible) ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {/* Chevron */}
        <svg
          className={`shrink-0 text-gray-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>

        {/* ID + product name */}
        <div className="w-36 shrink-0">
          <div className="font-bold text-gray-900 text-sm leading-tight truncate">{shipment.ivName}</div>
          {shipment.productSummary && (
            <div className="text-xs text-gray-400 truncate mt-0.5">{shipment.productSummary}</div>
          )}
        </div>

        {/* Mini timeline */}
        <MiniTimeline shipment={shipment} />

        {/* Badges */}
        <div className="flex gap-1.5 shrink-0 items-center">
          {shipment.supplier && (
            <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100">
              {shipment.supplier}
            </span>
          )}
          <StatusBadge value={shipment.deliveryStatus} />
        </div>
      </div>

      {/* ── Expanded content ── */}
      {open && (
        <div className="border-t border-gray-100">
          {/* Full timeline */}
          <div className="px-5 pt-4 pb-3">
            <TimelineProgress shipment={shipment} lang={lang} />
          </div>

          {/* Meta section */}
          {(shipment.flightNo || shipment.awbNo || shipment.warehouse) && (
            <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
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

          <div className="px-5 py-3 space-y-3">
            <InventoryBar
              total={shipment.totalBoxes}
              shipped={shippedBoxes}
              planned={plannedBoxes}
              lang={lang}
            />
            <DeliveryPlan
              batchId={shipment.id}
              totalBoxes={shipment.totalBoxes}
              records={allRecords}
              lang={lang}
              onRecordChange={onRecordChange}
            />
            <div>
              <p className="text-xs text-gray-400 mb-1.5">{T.documents}</p>
              <DocumentStatus shipment={shipment} lang={lang} />
            </div>
            {shipment.remarks && (
              <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-1.5">
                <p className="text-xs text-yellow-800">{shipment.remarks}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-2 bg-gray-50 border-t border-gray-100 text-right">
            <span className="text-xs text-gray-300">
              {T.lastUpdated}: {new Date(shipment.lastEdited).toLocaleString(lang === 'ja' ? 'ja-JP' : 'zh-TW')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
