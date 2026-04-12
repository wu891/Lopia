'use client'
import { Lang, t } from '@/lib/i18n'

interface InventoryBarProps {
  total: number | null
  shipped: number   // completed rounds
  planned: number   // all non-cancelled planned boxes
  lang: Lang
}

const C = 163.36 // 2 × π × 26

export default function InventoryBar({ total, shipped, planned, lang }: InventoryBarProps) {
  const T = t[lang]
  if (!total) return null

  const shippedPct = Math.min(100, Math.round((shipped / total) * 100))
  const plannedPct = Math.min(100, Math.round((planned / total) * 100))
  const shippedDash = shippedPct / 100 * C
  const plannedDash = plannedPct / 100 * C

  return (
    <div className="flex items-center gap-4">
      {/* Donut ring */}
      <div className="relative w-16 h-16 flex-shrink-0">
        <svg viewBox="0 0 64 64" className="w-16 h-16" style={{ transform: 'rotate(-90deg)' }}>
          {/* Gray track */}
          <circle cx="32" cy="32" r="26" fill="none" stroke="#F3F4F6" strokeWidth="8" />
          {/* Planned overlay (light red) */}
          {plannedPct > 0 && (
            <circle
              cx="32" cy="32" r="26" fill="none"
              stroke="#FECACA" strokeWidth="8"
              strokeDasharray={`${plannedDash} ${C}`}
              strokeLinecap="butt"
            />
          )}
          {/* Shipped fill (brand red) */}
          {shippedPct > 0 && (
            <circle
              cx="32" cy="32" r="26" fill="none"
              stroke="#E8002D" strokeWidth="8"
              strokeDasharray={`${shippedDash} ${C}`}
              strokeLinecap="round"
            />
          )}
        </svg>
        {/* Center % label */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-sm font-bold leading-none"
            style={{ color: shippedPct > 0 ? '#E8002D' : '#9CA3AF' }}
          >
            {shippedPct}%
          </span>
        </div>
      </div>

      {/* Stats legend */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#E8002D' }} />
          <span className="text-xs text-gray-500 flex-1">{T.shipped}</span>
          <span className="text-xs font-semibold text-gray-800">{shipped.toLocaleString()} {T.boxes}</span>
        </div>
        {planned > 0 && planned !== shipped && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-200 flex-shrink-0" />
            <span className="text-xs text-gray-500 flex-1">{T.plannedBoxes}</span>
            <span className="text-xs font-semibold text-gray-800">{planned.toLocaleString()} {T.boxes}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-gray-200 flex-shrink-0" />
          <span className="text-xs text-gray-400 flex-1">{lang === 'ja' ? '合計' : '合計'}</span>
          <span className="text-xs text-gray-400">{total.toLocaleString()} {T.boxes}</span>
        </div>
      </div>
    </div>
  )
}
