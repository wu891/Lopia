'use client'
import { Lang, t } from '@/lib/i18n'

interface InventoryBarProps {
  total: number | null
  shipped: number   // completed rounds
  planned: number   // all non-cancelled planned boxes
  lang: Lang
}

export default function InventoryBar({ total, shipped, planned, lang }: InventoryBarProps) {
  const T = t[lang]
  if (!total) return null

  const pct = Math.min(100, Math.round((shipped / total) * 100))
  const plannedPct = Math.min(100, Math.round((planned / total) * 100))

  return (
    <div className="space-y-1.5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600">{T.shipped}</span>
        <div className="flex gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-lopia-red" />
            {T.shipped} {shipped} {T.boxes}
          </span>
          {planned > 0 && planned !== shipped && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-red-200" />
              {T.plannedBoxes} {planned} {T.boxes}
            </span>
          )}
        </div>
      </div>

      {/* Track — 14px height, label embedded */}
      <div className="relative h-3.5 bg-gray-100 rounded-md overflow-hidden">
        {/* Shipped fill (gradient) */}
        {pct > 0 && (
          <div
            className="absolute left-0 top-0 h-full rounded-md flex items-center justify-end pr-1.5 transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, #E8002D 0%, #FF4D6D 100%)',
              minWidth: pct > 0 ? '28px' : '0',
            }}
          >
            <span className="text-[9px] font-bold text-white/90 leading-none whitespace-nowrap">
              {pct}%
            </span>
          </div>
        )}
        {/* Planned overlay */}
        {plannedPct > pct && (
          <div
            className="absolute top-0 h-full bg-red-200/60 transition-all duration-500"
            style={{ left: `${pct}%`, width: `${plannedPct - pct}%` }}
          />
        )}
        {/* 0% label */}
        {pct === 0 && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-gray-400 leading-none">
            0%
          </span>
        )}
        {/* Total label on right */}
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-gray-400 font-medium leading-none">
          {total.toLocaleString()} {T.boxes}
        </span>
      </div>
    </div>
  )
}
