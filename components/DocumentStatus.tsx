'use client'
import { Shipment } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

export default function DocumentStatus({ shipment, lang }: { shipment: Shipment; lang: Lang }) {
  const T = t[lang]
  const docs = [
    { label: T.iv, ready: shipment.ivDoc },
    { label: T.pl, ready: shipment.plDoc },
    { label: T.awb, ready: shipment.awbDoc },
    { label: T.quarantineCert, ready: shipment.quarantineCert },
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {docs.map(doc => (
        <span key={doc.label}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border
            ${doc.ready
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
          <span>{doc.ready ? '✓' : '·'}</span>
          {doc.label}
        </span>
      ))}
    </div>
  )
}
