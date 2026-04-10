'use client'
import { Shipment } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

const STATUS_COLORS: Record<string, string> = {
  '不需要': 'bg-gray-100 text-gray-400',
  '申請中': 'bg-gray-100 text-gray-600',
  '進行中': 'bg-yellow-100 text-yellow-700',
  '合格':   'bg-green-100 text-green-700',
  '不合格': 'bg-red-100 text-red-700',
}

function addDays(dateStr: string | null, days: number): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

interface Props { shipment: Shipment; lang: Lang }

export default function InspectionStatus({ shipment, lang }: Props) {
  const T = t[lang]

  const inspections = [
    {
      label: T.radiationTest,
      value: shipment.radiationTest,
      days: 2,
      daysLabel: T.inspDays2,
    },
    {
      label: T.pesticideTest,
      value: shipment.pesticideTest,
      days: 3,
      daysLabel: T.inspDays3,
    },
    {
      label: T.fumigationStatus,
      value: shipment.fumigation === '無需' ? '不需要'
           : shipment.fumigation === '進行中' ? '進行中'
           : shipment.fumigation === '完成' ? '合格'
           : null,
      days: 1,
      daysLabel: '',
    },
  ]

  // If all are null or 不需要, don't show the section
  const hasAny = inspections.some(i => i.value && i.value !== '不需要')
  if (!hasAny) return null

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-gray-400 font-medium">{T.inspectionTitle}</p>
      <div className="flex flex-wrap gap-2">
        {inspections.map(item => {
          if (!item.value || item.value === '不需要') return null
          const colorCls = STATUS_COLORS[item.value] ?? 'bg-gray-100 text-gray-500'
          const showEst = (item.value === '進行中') && shipment.warehouseIn
          const estDate = showEst ? addDays(shipment.warehouseIn, item.days) : null
          return (
            <div key={item.label}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${colorCls} border-current border-opacity-20`}>
              <span>{item.label}</span>
              <span className="opacity-70">{item.daysLabel}</span>
              {item.value === '進行中' && (
                <span className="animate-pulse ml-0.5">●</span>
              )}
              {estDate && (
                <span className="opacity-60 text-xs">→ {T.estComplete} {estDate}</span>
              )}
              {item.value === '合格' && <span>✓</span>}
              {item.value === '不合格' && <span>✗</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
