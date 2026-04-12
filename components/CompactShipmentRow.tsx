'use client'
import { useState } from 'react'
import { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import TimelineProgress from './TimelineProgress'
import DocumentStatus from './DocumentStatus'
import InventoryBar from './InventoryBar'
import DeliveryPlan from './DeliveryPlan'

const DELIVERY_BADGE: Record<string, { dot: string; cls: string }> = {
  '待出貨':   { dot: 'bg-gray-400',    cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  '部分出貨': { dot: 'bg-amber-400',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  '全數出貨': { dot: 'bg-emerald-500', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return null
  const style = DELIVERY_BADGE[value] ?? { dot: 'bg-gray-400', cls: 'bg-gray-100 text-gray-500 border-gray-200' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${style.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
      {value}
    </span>
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

  const batchRecords = allRecords.filter(r => r.batchId === shipment.id)
  const shippedBoxes = batchRecords
    .filter(r => r.planStatus === '已完成')
    .reduce((s, r) => s + (r.boxes ?? 0), 0)
  const plannedBoxes = batchRecords
    .filter(r => r.planStatus !== '已取消')
    .reduce((s, r) => s + (r.boxes ?? 0), 0)

  const arrivalStr = shipment.arrivalTW?.slice(5).replace('-', '/') ?? '—'
  const clearanceStr = shipment.actualClearance?.slice(5).replace('-', '/') ?? '—'

  return (
    <div>
      {/* ── Compact row ── */}
      <div
        role="button"
        tabIndex={0}
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
          </div>
          {shipment.productSummary && (
            <p className="text-[11px] text-gray-500 truncate mt-0.5 hidden sm:block">{shipment.productSummary}</p>
          )}
          {/* Mobile-only: show key dates below name when collapsed */}
          <p className="text-[10px] text-gray-400 mt-0.5 sm:hidden">
            {arrivalStr !== '—' && <>抵台 {arrivalStr}</>}
            {arrivalStr !== '—' && clearanceStr !== '—' && <span className="mx-1">·</span>}
            {clearanceStr !== '—' && <>出關 {clearanceStr}</>}
          </p>
        </div>

        {/* Key dates + boxes — right side */}
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
            <span className="text-gray-500 text-xs font-medium whitespace-nowrap">
              {shipment.totalBoxes}<span className="text-gray-400 text-[10px] ml-0.5">箱</span>
            </span>
          )}
          <StatusBadge value={shipment.deliveryStatus} />
        </div>
      </div>

      {/* ── Expandable detail ── */}
      <div className={`grid transition-all duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/60 space-y-3">
            {/* Mobile-only dates */}
            <div className="flex gap-4 sm:hidden text-xs text-gray-500">
              <span><span className="text-gray-400">抵台</span> <span className="font-medium text-gray-700">{arrivalStr}</span></span>
              <span><span className="text-gray-400">出關</span> <span className={`font-medium ${shipment.actualClearance ? 'text-gray-700' : 'text-gray-300'}`}>{clearanceStr}</span></span>
            </div>

            {/* Product summary on mobile */}
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

            {shipment.remarks && (
              <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-1.5">
                <p className="text-xs text-yellow-800">{shipment.remarks}</p>
              </div>
            )}

            <div className="text-right">
              <span className="text-xs text-gray-300">
                {T.lastUpdated}: {new Date(shipment.lastEdited).toLocaleString(lang === 'ja' ? 'ja-JP' : 'zh-TW')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
