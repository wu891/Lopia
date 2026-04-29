'use client'
import { useState } from 'react'
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
  const [chaseStatus, setChaseStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')

  const docs = [
    { label: T.iv,            ready: shipment.ivDoc },
    { label: T.pl,            ready: shipment.plDoc },
    { label: T.awb,           ready: shipment.awbDoc },
    { label: T.quarantineCert,ready: shipment.quarantineCert },
  ]

  const missingDocs = docs.filter(d => !d.ready).map(d => d.label)
  const hasMissingDoc = missingDocs.length > 0

  const daysUntilDepart = shipment.departJP
    ? Math.ceil((new Date(shipment.departJP).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
    : null

  const isUrgent = daysUntilDepart !== null && daysUntilDepart <= 2 && daysUntilDepart >= 0 && hasMissingDoc

  async function handleChase() {
    setChaseStatus('sending')
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'chase',
          batchName: shipment.ivName,
          missingDocs,
          departJP: shipment.departJP,
        }),
      })
      if (!res.ok) throw new Error('failed')
      setChaseStatus('ok')
      setTimeout(() => setChaseStatus('idle'), 3000)
    } catch {
      setChaseStatus('error')
      setTimeout(() => setChaseStatus('idle'), 3000)
    }
  }

  return (
    <div>
      {isUrgent && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 mb-1.5 rounded-lg bg-orange-50 border border-orange-200">
          <span className="text-xs font-medium text-orange-800 flex items-center gap-1">
            <span>⚠️</span>
            <span>
              {lang === 'ja'
                ? `出発まで${daysUntilDepart}日 — ${missingDocs.join('・')} 未提出`
                : `出發前 ${daysUntilDepart} 天 — ${missingDocs.join('、')} 未齊`}
            </span>
          </span>
          {chaseStatus === 'idle' && (
            <button
              onClick={handleChase}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer"
            >
              📨 {T.chaseBtn}
            </button>
          )}
          {chaseStatus === 'sending' && (
            <span className="shrink-0 text-xs text-orange-600 font-medium">{T.chaseSending}</span>
          )}
          {chaseStatus === 'ok' && (
            <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-md">
              ✓ {T.chaseOk}
            </span>
          )}
          {chaseStatus === 'error' && (
            <span className="shrink-0 text-xs text-red-500 font-medium">{T.chaseError}</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {docs.map(doc => (
          <span key={doc.label}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${
              doc.ready
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : isUrgent
                ? 'bg-orange-50 border-orange-200 text-orange-700'
                : 'bg-gray-50 border-gray-200 text-gray-400'
            }`}>
            {doc.ready
              ? <CheckIcon />
              : <span className={`w-1.5 h-1.5 rounded-full inline-block ${isUrgent ? 'bg-orange-400' : 'bg-gray-300'}`} />
            }
            {doc.label}
          </span>
        ))}
      </div>
    </div>
  )
}
