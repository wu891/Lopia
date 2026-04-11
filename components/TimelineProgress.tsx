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

/** 計算距今幾天（台灣時區） */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }))
  const target = new Date(dateStr)
  const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return diff
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
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

  // Progress % for bottom track: based on completed steps
  const trackPct = Math.round((Math.min(active, steps.length) / steps.length) * 100)

  // Countdown for the current active step
  const activeStep = steps[active - 1] ?? null
  const countdown = activeStep ? daysUntil(activeStep.date) : null

  const fumigationDisplay =
    shipment.fumigation === '無需'   ? '無需' :
    shipment.fumigation === '進行中' ? '進行中' :
    shipment.fumigation === '完成'   ? '完成' :
    shipment.fumigation ?? null

  const inspItems = [
    { label: T.radiationTest,    value: shipment.radiationTest },
    { label: T.pesticideTest,    value: shipment.pesticideTest },
    { label: T.fumigationStatus, value: fumigationDisplay },
  ].filter(i => i.value != null)

  return (
    <div className="space-y-3">
      {/* ── Timeline ── */}
      <div className="relative pb-4">
        {/* Bottom progress track */}
        <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${trackPct}%`,
              background: 'linear-gradient(90deg, #E8002D 0%, #FF4D6D 100%)',
            }}
          />
        </div>

        {/* Steps */}
        <div className="flex justify-between">
          {steps.map((step, i) => {
            const done    = i < active
            const current = i === active - 1
            const pending = !done && !current

            // Countdown bubble: show only on the next upcoming step
            const isNextStep = i === active && active < steps.length
            const nextDays = isNextStep ? daysUntil(step.date) : null

            return (
              <div key={i} className="flex flex-col items-center flex-1">
                {/* Dot area */}
                <div className="relative mb-2">
                  {/* Countdown bubble on next step */}
                  {isNextStep && nextDays !== null && nextDays >= 0 && nextDays <= 14 && (
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap">
                      <div className="bg-lopia-red text-white text-[10px] font-bold px-2 py-0.5 rounded-full leading-tight">
                        {nextDays === 0 ? '今天' : `還有 ${nextDays} 天`}
                      </div>
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-lopia-red mx-auto" />
                    </div>
                  )}

                  {/* Dot */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center
                    ${done
                      ? 'bg-lopia-red shadow-[0_2px_8px_rgba(232,0,45,0.35)]'
                      : current
                        ? 'bg-white border-2 border-lopia-red animate-[pulse-ring_2s_ease_infinite]'
                        : 'bg-white border-2 border-gray-200'
                    }`}
                    style={current ? {
                      boxShadow: '0 0 0 5px rgba(232,0,45,0.12), 0 0 16px rgba(232,0,45,0.25)',
                      animation: 'pulse-ring 2s ease infinite',
                    } : undefined}
                  >
                    {done && <CheckIcon />}
                    {current && <span className="w-2.5 h-2.5 rounded-full bg-lopia-red block" />}
                  </div>
                </div>

                {/* Label + date */}
                <div className="text-center">
                  <div className={`text-[11px] font-medium leading-tight ${
                    done ? 'text-gray-700' : current ? 'text-lopia-red font-semibold' : 'text-gray-400'
                  }`}>
                    {step.label}
                  </div>
                  <div className={`text-[11px] font-semibold mt-0.5 ${
                    done || current ? 'text-lopia-red' : 'text-gray-300'
                  }`}>
                    {fmtDate(step.date)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Inspection badges ── */}
      {inspItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {inspItems.map(item => {
            const isActive = item.value === '進行中' || item.value === '申請中'
            const isOk     = item.value === '無需' || item.value === '合格' || item.value === '完成'
            return (
              <span
                key={item.label}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                  isOk
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : isActive
                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : 'bg-gray-50 border-gray-200 text-gray-500'
                }`}
              >
                {isOk ? (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : isActive ? (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                ) : null}
                {item.label}：{item.value}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
