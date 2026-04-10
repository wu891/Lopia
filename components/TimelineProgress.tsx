'use client'
import { Shipment } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

const STEPS = ['departJP', 'arrivalTW', 'estClearance', 'warehouseIn'] as const

function getActiveStep(s: Shipment): number {
  if (s.warehouseIn) return 4
  if (s.actualClearance) return 3
  if (s.arrivalTW) return 2
  if (s.departJP) return 1
  return 0
}

function fmtDate(d: string | null, lang: Lang): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (lang === 'ja') return `${dt.getMonth()+1}/${dt.getDate()}`
  return `${dt.getMonth()+1}/${dt.getDate()}`
}

export default function TimelineProgress({ shipment, lang }: { shipment: Shipment; lang: Lang }) {
  const T = t[lang]
  const active = getActiveStep(shipment)

  const steps = [
    { label: T.departJP, date: shipment.departJP },
    { label: T.arrivalTW, date: shipment.arrivalTW },
    { label: T.estClearance, date: shipment.actualClearance || shipment.estClearance },
    { label: T.warehouseIn, date: shipment.warehouseIn },
  ]

  return (
    <div className="flex items-start gap-0 w-full">
      {steps.map((step, i) => {
        const done = i < active
        const current = i === active - 1
        const isLast = i === steps.length - 1
        return (
          <div key={i} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs
                ${done || current
                  ? 'bg-lopia-red border-lopia-red text-white'
                  : 'bg-white border-gray-300 text-gray-400'}`}>
                {done || current ? '✓' : ''}
              </div>
              <div className="text-center mt-1">
                <div className={`text-xs font-medium ${done || current ? 'text-gray-700' : 'text-gray-400'}`}>
                  {step.label}
                </div>
                <div className={`text-xs ${done || current ? 'text-lopia-red' : 'text-gray-300'}`}>
                  {fmtDate(step.date, lang)}
                </div>
              </div>
            </div>
            {!isLast && (
              <div className={`h-0.5 flex-1 mb-5 ${done ? 'bg-lopia-red' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
