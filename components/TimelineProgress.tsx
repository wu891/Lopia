'use client'
import { Shipment } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

function getActiveStep(s: Shipment): number {
  if (s.warehouseIn) return 4
  if (s.actualClearance) return 3
  if (s.arrivalTW) return 2
  if (s.departJP) return 1
  return 0
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

function InspItem({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  const isActive = value === '進行中' || value === '申請中'
  return (
    <span className="flex items-center gap-1 text-xs text-gray-500">
      <span className="text-gray-400">{label}：</span>
      <span className={`font-medium ${isActive ? 'text-yellow-600 animate-pulse' : 'text-gray-700'}`}>
        {value}
      </span>
    </span>
  )
}

export default function TimelineProgress({ shipment, lang }: { shipment: Shipment; lang: Lang }) {
  const T = t[lang]
  const active = getActiveStep(shipment)

  const steps = [
    { label: T.departJP,     date: shipment.departJP },
    { label: T.arrivalTW,    date: shipment.arrivalTW },
    { label: T.estClearance, date: shipment.actualClearance || shipment.estClearance },
    { label: T.warehouseIn,  date: shipment.warehouseIn },
  ]

  const fumigationDisplay =
    shipment.fumigation === '無需'   ? '無需' :
    shipment.fumigation === '進行中' ? '進行中' :
    shipment.fumigation === '完成'   ? '完成' :
    shipment.fumigation ?? null

  const inspItems = [
    { label: T.radiationTest,    value: shipment.radiationTest },
    { label: T.pesticideTest,    value: shipment.pesticideTest },
    { label: T.fumigationStatus, value: fumigationDisplay },
  ]

  const hasInspection = inspItems.some(i => i.value != null)

  return (
    <div className="space-y-2">
      {/* Timeline */}
      <div className="flex items-start w-full">
        {steps.map((step, i) => {
          const done    = i < active
          const current = i === active - 1
          const pending = !done && !current
          const isLast  = i === steps.length - 1

          return (
            <div key={i} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                {/* Dot */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0
                  ${done
                    ? 'bg-lopia-red border-2 border-lopia-red'
                    : current
                      ? 'bg-white border-2 border-lopia-red'
                      : 'bg-white border-2 border-gray-300'
                  }`}>
                  {done && <CheckIcon />}
                  {current && <span className="w-2.5 h-2.5 rounded-full bg-lopia-red block" />}
                </div>
                {/* Label + date */}
                <div className="text-center mt-1.5">
                  <div className={`text-xs font-medium leading-tight ${
                    done || current ? 'text-gray-800' : 'text-gray-400'
                  }`}>
                    {step.label}
                  </div>
                  <div className={`text-xs mt-0.5 font-medium ${
                    done || current ? 'text-lopia-red' : 'text-gray-300'
                  }`}>
                    {fmtDate(step.date)}
                  </div>
                </div>
              </div>
              {/* Connector */}
              {!isLast && (
                <div className={`h-0.5 flex-1 mb-7 ${done ? 'bg-lopia-red' : 'bg-gray-200'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Inspection row */}
      {hasInspection && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 pt-1.5 border-t border-gray-100">
          {inspItems.map(item => (
            <InspItem key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      )}
    </div>
  )
}
