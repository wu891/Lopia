'use client'
import { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import TimelineProgress from './TimelineProgress'
import DocumentStatus from './DocumentStatus'
import InventoryBar from './InventoryBar'
import InspectionStatus from './InspectionStatus'
import DeliveryPlan from './DeliveryPlan'

interface ShipmentCardProps {
  shipment: Shipment
  lang: Lang
  allRecords: ShipmentRecord[]
  onRecordChange: () => void
}

const QUARANTINE_COLORS: Record<string, string> = {
  '合格': 'bg-green-100 text-green-700',
  '需燻蒸': 'bg-red-100 text-red-700',
  '進行中': 'bg-yellow-100 text-yellow-700',
  '未到': 'bg-gray-100 text-gray-500',
}

const DELIVERY_COLORS: Record<string, string> = {
  '待出貨': 'bg-gray-100 text-gray-600',
  '部分出貨': 'bg-yellow-100 text-yellow-700',
  '全數出貨': 'bg-green-100 text-green-700',
}

function StatusBadge({ value, colorMap }: { value: string | null; colorMap: Record<string, string> }) {
  if (!value) return null
  const cls = colorMap[value] ?? 'bg-gray-100 text-gray-500'
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{value}</span>
}

export default function ShipmentCard({ shipment, lang, allRecords, onRecordChange }: ShipmentCardProps) {
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
      {/* Card header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-2 border-b border-gray-100">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-base truncate">{shipment.ivName}</h3>
          {shipment.productSummary && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{shipment.productSummary}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1 ml-2 shrink-0">
          {shipment.supplier && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100">
              {shipment.supplier}
            </span>
          )}
          <StatusBadge value={shipment.deliveryStatus} colorMap={DELIVERY_COLORS} />
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Timeline */}
        <TimelineProgress shipment={shipment} lang={lang} />

        {/* Details row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
          {shipment.flightNo && (
            <div><span className="text-gray-400">{T.flightNo}：</span><span className="text-gray-700">{shipment.flightNo}</span></div>
          )}
          {shipment.awbNo && (
            <div><span className="text-gray-400">{T.awbNo}：</span><span className="text-gray-700">{shipment.awbNo}</span></div>
          )}
          {shipment.warehouse && (
            <div><span className="text-gray-400">{T.warehouse}：</span><span className="text-gray-700">{shipment.warehouse}</span></div>
          )}
        </div>

        {/* Quarantine badge */}
        {shipment.quarantine && shipment.quarantine !== '合格' && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-400">{T.quarantine}：</span>
            <StatusBadge value={shipment.quarantine} colorMap={QUARANTINE_COLORS} />
          </div>
        )}

        {/* Inspection status (radiation / pesticide / fumigation) */}
        <InspectionStatus shipment={shipment} lang={lang} />

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
          totalBoxes={shipment.totalBoxes}
          records={allRecords}
          lang={lang}
          onRecordChange={onRecordChange}
        />

        {/* Documents */}
        <div>
          <p className="text-xs text-gray-400 mb-1">{T.documents}</p>
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
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-right">
        <span className="text-xs text-gray-300">
          {T.lastUpdated}: {new Date(shipment.lastEdited).toLocaleString(lang === 'ja' ? 'ja-JP' : 'zh-TW')}
        </span>
      </div>
    </div>
  )
}
