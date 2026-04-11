'use client'
import { Shipment } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

function CheckIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

export default function DocumentStatus({ shipment, lang }: { shipment: Shipment; lang: Lang }) {
  const T = t[lang]
  const docs = [
    { label: T.iv,            ready: shipment.ivDoc },
    { label: T.pl,            ready: shipment.plDoc },
    { label: T.awb,           ready: shipment.awbDoc },
    { label: T.quarantineCert,ready: shipment.quarantineCert },
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {docs.map(doc => (
        <span key={doc.label}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${
            doc.ready
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-gray-50 border-gray-200 text-gray-400'
          }`}>
          {doc.ready
            ? <CheckIcon />
            : <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />
          }
          {doc.label}
        </span>
      ))}
    </div>
  )
}
