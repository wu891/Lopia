import { Lang } from '@/lib/i18n'

export type AnomalyType = '退回' | '銷毀'

const STYLES: Record<AnomalyType, { cls: string; zh: string; ja: string; icon: string }> = {
  '退回': {
    cls: 'bg-orange-50 text-orange-700 border-orange-200',
    zh: '退回',
    ja: '返品',
    icon: '↩',
  },
  '銷毀': {
    cls: 'bg-red-50 text-red-700 border-red-200',
    zh: '銷毀',
    ja: '廃棄',
    icon: '✕',
  },
}

interface Props {
  type: AnomalyType
  lang: Lang
  size?: 'sm' | 'xs'
}

export default function AnomalyBadge({ type, lang, size = 'sm' }: Props) {
  const s = STYLES[type]
  const label = lang === 'ja' ? s.ja : s.zh
  const sizeCls = size === 'xs' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[11px]'
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full border font-medium ${sizeCls} ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      <span>{label}</span>
    </span>
  )
}

// Helper: compute batch-level anomaly summary from items with anomaly type
export function getBatchAnomalies(items: Array<{ anomalyType?: AnomalyType | null }>): AnomalyType[] {
  const set = new Set<AnomalyType>()
  for (const it of items) {
    if (it.anomalyType === '退回') set.add('退回')
    if (it.anomalyType === '銷毀') set.add('銷毀')
  }
  // Return in fixed order
  const result: AnomalyType[] = []
  if (set.has('退回')) result.push('退回')
  if (set.has('銷毀')) result.push('銷毀')
  return result
}
