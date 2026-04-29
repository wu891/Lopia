'use client'
import { useState } from 'react'
import { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

function formatDate(dateStr: string, lang: Lang) {
  const [y, m, d] = dateStr.split('-')
  return lang === 'ja' ? `${y}/${m}/${d}` : `${y}/${m}/${d}`
}

function daysFromNow(dateStr: string): number {
  const today = new Date(); today.setHours(0,0,0,0)
  const target = new Date(dateStr); target.setHours(0,0,0,0)
  return Math.ceil((target.getTime() - today.getTime()) / 86400000)
}

interface StoreBox { store: string; boxes: number }

function buildStoreBoxes(shipmentId: string, allRecords: ShipmentRecord[], dateFrom?: string, dateTo?: string): StoreBox[] {
  const map = new Map<string, number>()
  for (const r of allRecords) {
    if (r.batchId !== shipmentId) continue
    if (r.planStatus === '已取消') continue
    if (!r.store) continue
    if (dateFrom && dateTo && r.date && (r.date < dateFrom || r.date > dateTo)) continue
    map.set(r.store, (map.get(r.store) ?? 0) + (r.boxes ?? 0))
  }
  return Array.from(map.entries())
    .map(([store, boxes]) => ({ store, boxes }))
    .sort((a, b) => b.boxes - a.boxes)
}

function buildLineText(shipment: Shipment, storeBoxes: StoreBox[], lang: Lang, deliveryDate?: string | null): string {
  const dateStr = (deliveryDate ?? shipment.arrivalTW) ? formatDate((deliveryDate ?? shipment.arrivalTW)!, lang) : '—'
  const prefix = lang === 'ja' ? '【入荷予定】' : '【進貨預告】'
  const suffix = lang === 'ja' ? '到着予定' : '預計到貨'
  const totalBoxes = storeBoxes.reduce((s, sb) => s + sb.boxes, 0)
  const lines = [
    `${prefix}${dateStr} ${suffix}`,
    ...storeBoxes.map(sb => `・${sb.store}　${sb.boxes}箱`),
    lang === 'ja' ? `合計 ${totalBoxes}箱` : `合計 ${totalBoxes} 箱`,
  ]
  if (shipment.productSummary) {
    lines.splice(1, 0, `（${shipment.productSummary}）`)
  }
  return lines.join('\n')
}

export default function ArrivalPreview({
  shipments,
  allRecords,
  lang,
  dateFrom,
  dateTo,
}: {
  shipments: Shipment[]
  allRecords: ShipmentRecord[]
  lang: Lang
  dateFrom?: string
  dateTo?: string
}) {
  const T = t[lang]
  const [copiedId, setCopiedId] = useState<string | null>(null)

  function handleCopy(shipment: Shipment, storeBoxes: StoreBox[], deliveryDate: string | null) {
    const text = buildLineText(shipment, storeBoxes, lang, deliveryDate)
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(shipment.id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  if (shipments.length === 0) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-sm text-gray-400">{T.previewEmpty}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {shipments.map(s => {
        const storeBoxes = buildStoreBoxes(s.id, allRecords, dateFrom, dateTo)
        const totalBoxes = storeBoxes.reduce((sum, sb) => sum + sb.boxes, 0)
        // Use earliest upcoming delivery date from records; fall back to arrivalTW
        const earliestDelivery = allRecords
          .filter(r => r.batchId === s.id && r.date && r.planStatus !== '已取消' && (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo))
          .map(r => r.date as string)
          .sort()[0] ?? null
        const displayDate = earliestDelivery ?? s.arrivalTW
        const days = displayDate ? daysFromNow(displayDate) : null
        const isCopied = copiedId === s.id

        return (
          <div key={s.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/60">
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-[10px] font-medium text-lopia-red uppercase tracking-wide">{T.previewArrival}</span>
                  <span className="text-sm font-bold text-lopia-red-dark font-mono">
                    {displayDate ? formatDate(displayDate, lang) : '—'}
                  </span>
                </div>
                {days !== null && (
                  <span className="text-xs text-gray-400">
                    {lang === 'ja' ? `${days}日後` : `${days} 天後`}
                  </span>
                )}
              </div>
              {totalBoxes > 0 && (
                <span className="text-xs font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded-md px-2 py-0.5">
                  {T.previewTotalBoxes} {totalBoxes} 箱
                </span>
              )}
            </div>

            {/* Batch info */}
            <div className="px-4 py-2.5 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-800">{s.ivName}</p>
              {s.productSummary && (
                <p className="text-xs text-gray-400 mt-0.5">{s.productSummary}</p>
              )}
            </div>

            {/* Store pills */}
            {storeBoxes.length > 0 ? (
              <div className="px-4 py-3 flex flex-wrap gap-1.5">
                {storeBoxes.map(sb => (
                  <span key={sb.store}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700 font-medium">
                    {sb.store} <span className="font-bold">{sb.boxes}箱</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="px-4 py-3">
                <span className="text-xs text-gray-400">
                  {lang === 'ja' ? '出荷計画未登録' : '尚無出貨計畫'}
                </span>
              </div>
            )}

            {/* Footer: copy button */}
            <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {lang === 'ja' ? 'LINE送信用テキスト' : 'LINE 分享格式'}
              </span>
              <button
                onClick={() => handleCopy(s, storeBoxes, displayDate)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  isCopied
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {isCopied ? `✓ ${T.previewCopied}` : `📋 ${T.previewCopy}`}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
