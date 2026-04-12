'use client'
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

// dot color + bg/text for each status value
const DELIVERY_BADGE: Record<string, { dot: string; cls: string }> = {
  '待出貨':  { dot: 'bg-gray-400',   cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  '部分出貨':{ dot: 'bg-amber-400',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  '全數出貨':{ dot: 'bg-emerald-500',cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
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

export default function ShipmentCard({ shipment, lang, allRecords, onRecordChange }: ShipmentCardProps) {
  const T = t[lang]

  const batchRecords = allRecords.filter(r => r.batchId === shipment.id)
  const plannedBoxes = batchRecords
    .filter(r => r.planStatus !== '已取消')
    .reduce((s, r) => s + (r.boxes ?? 0), 0)
  const shippedBoxes = shipment.deliveryStatus === '全數出貨'
    ? plannedBoxes
    : batchRecords
        .filter(r => r.planStatus === '已完成')
        .reduce((s, r) => s + (r.boxes ?? 0), 0)

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
          <StatusBadge value={shipment.deliveryStatus} />
        </div>
      </div>

      {/* Timeline */}
      <div className="px-5 pb-3">
        <TimelineProgress shipment={shipment} lang={lang} />
      </div>

      {/* Meta section — gray bg */}
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
            <span className="text-xs font-medium text-lopia-red">{shipment.warehouse}</span>
          </div>
        )}
      </div>

      <div className="px-5 py-3 space-y-3">
        {/* Inventory bar */}
        <InventoryBar
          total={shipment.totalBoxes}
          shipped={shippedBoxes}
          planned={plannedBoxes}
          lang={lang}
        />

        {/* Delivery plan */}
        <DeliveryPlan
          batchId={shipment.id}
          batchName={shipment.ivName}
          totalBoxes={shipment.totalBoxes}
          records={allRecords}
          lang={lang}
          supplierExcelId={shipment.supplierExcelId}
          onRecordChange={onRecordChange}
        />

        {/* Documents */}
        <div>
          <p className="text-xs text-gray-500 mb-1.5">{T.documents}</p>
          <DocumentStatus shipment={shipment} lang={lang} />
        </div>

        {/* Remarks */}
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
  )
}
