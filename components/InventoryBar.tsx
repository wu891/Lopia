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
  const remaining = Math.max(0, total - shipped)
  const pct = Math.min(100, Math.round((shipped / total) * 100))
  const plannedPct = Math.min(100, Math.round((planned / total) * 100))

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{T.shipped}: <strong className="text-gray-800">{shipped}</strong> {T.boxes}</span>
        <span>{T.remaining}: <strong className="text-gray-800">{remaining}</strong> {T.boxes}</span>
        <span className="text-gray-400">{T.totalBoxes}: {total}</span>
      </div>
      {/* Stacked bar: completed (red) + planned (light red) */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
        <div className="h-full bg-lopia-red rounded-l-full transition-all duration-500" style={{ width: `${pct}%` }} />
        {plannedPct > pct && (
          <div className="h-full bg-red-200 transition-all duration-500" style={{ width: `${plannedPct - pct}%` }} />
        )}
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>{pct}% {T.shipped}</span>
        {planned > 0 && planned !== shipped && (
          <span className="text-red-300">{T.plannedBoxes}: {planned} {T.boxes}</span>
        )}
      </div>
    </div>
  )
}
