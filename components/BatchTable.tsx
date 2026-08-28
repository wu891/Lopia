'use client'
// ── 清單檢視（密表格）─────────────────────────────────────────
// 每列一個批次：批號/商品｜剩餘庫存｜狀態｜到港進度｜預計到港｜供應商
// 2026-08 改版：剩餘庫存從「狀態」欄底下的小字，升格成第二欄的大數字
//   （最常看的是「這批還剩幾箱沒出」，不是「什麼時候到港」）；
//   到港進度從 5 顆點的流水線改成一句白話（貨出口了必然會到，畫進度不影響決定）。
// 急件＝左緣 4px 紅條＋淡紅底；整列可點 → 批次明細頁
import { useRouter } from 'next/navigation'
import type { Shipment } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import { STATUS_LABEL } from '@/lib/kanban'
import { deriveStage, isUrgentBatch, etaInfo, fmtDateW, stageStatusText } from '@/lib/batchView'

/** 千分位（固定用 en-US，避免伺服器與瀏覽器算出不同結果） */
const n = (v: number) => v.toLocaleString('en-US')

// ── 剩餘庫存欄（第二欄）──────────────────────────────────────
// 顯示「240 / 653 箱」：剩餘粗黑大字、總數淡灰小字，一行寫完。
// 顏色三態：
//   綠＝已出 ≥ 90%（快出完了，可以準備關帳）
//   紅＝已到港但一箱都沒出（貨躺在倉庫沒動）
//   黑＝其餘正常情況
function RemainingCell({ s, today, lang }: { s: Shipment; today: string; lang: Lang }) {
  const T = t[lang]
  const total = s.totalBoxes

  // 入倉箱數沒填 → 沒有分母就算不出剩餘，不能顯示 NaN。
  // 已經有出貨計畫卻沒填 → 提醒去 Notion 補（箱數上限檢查也靠這個欄位）。
  if (total == null || total <= 0) {
    const planned = s.plannedBoxes ?? 0
    const closed = s.deliveryStatus === '全數出貨' || s.deliveryStatus === '退回/銷毀'
    return planned > 0 && !closed
      ? <span className="whitespace-nowrap text-[11px] font-bold text-amber-600">⚠ {T.noIntakeBoxes}</span>
      : <span className="text-[12px] text-[var(--mod-faint)]">—</span>
  }

  const shipped = s.shippedBoxes ?? 0
  const left = Math.max(total - shipped, 0)   // 超領時不顯示負數
  const arrived = !!s.arrivalTW && s.arrivalTW.slice(0, 10) <= today

  const color =
    shipped / total >= 0.9        ? 'text-[#2f8f56]'      // 綠：快出完
    : arrived && shipped === 0    ? 'text-[var(--mod-red)]' // 紅：到港了還沒動
    :                               'text-[var(--mod-ink)]'

  return (
    <div className="flex items-baseline gap-1 whitespace-nowrap">
      <span className={`font-mono text-[26px] font-extrabold leading-none ${color}`}>{n(left)}</span>
      <span className="font-mono text-[14px] font-semibold text-[#a5a2a0]">/ {n(total)}</span>
      <span className="text-[11px] text-[var(--mod-sub2)]">{T.boxes}</span>
    </div>
  )
}

function EtaCell({ s, today, lang }: { s: Shipment; today: string; lang: Lang }) {
  const T = t[lang]
  const info = etaInfo(s, today)
  if (info.kind === 'tbd') {
    return <span className="text-[12px] text-[var(--mod-faint)]">{T.etaTbd}</span>
  }
  if (info.kind === 'arrived') {
    return (
      <div className="flex flex-col leading-tight">
        <span className="text-[13px] font-bold text-[var(--mod-ink)] whitespace-nowrap">{T.etaArrived}</span>
        <span className="text-[11px] text-[var(--mod-faint)] whitespace-nowrap">
          {fmtDateW(s.arrivalTW, lang)} {T.etaArrivedIn}
        </span>
      </div>
    )
  }
  if (info.kind === 'today') {
    return <span className="text-[15px] font-extrabold text-[var(--mod-red)] whitespace-nowrap">{T.etaToday}</span>
  }
  const color = info.hot ? 'text-[var(--mod-red)]' : 'text-[var(--mod-ink)]'
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`font-mono text-[22px] font-extrabold leading-none ${color}`}>{info.days}</span>
      <span className={`text-[11px] font-bold ${color}`}>{T.dayUnit}</span>
      <span className="text-[11px] text-[var(--mod-sub2)]">{fmtDateW(s.arrivalTW, lang)}</span>
    </div>
  )
}

export default function BatchTable({
  shipments, lang, today,
}: {
  shipments: Shipment[]
  lang: Lang
  today: string
}) {
  const router = useRouter()
  const T = t[lang]

  return (
    <div className="overflow-x-auto border-2 border-[var(--mod-line)] bg-white">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-[var(--mod-line)]">
            {[T.thBatchProduct, T.thRemaining, T.thStatus, T.thProgress, T.thEta, T.thSupplier].map(h => (
              <th key={h} className="whitespace-nowrap px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[.06em] text-[var(--mod-sub)]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shipments.map(s => {
            const { stage, done, status } = deriveStage(s, today)
            const urgent = isUrgentBatch(s, today)
            return (
              <tr
                key={s.id}
                onClick={() => router.push(`/batch/${s.id}`)}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') router.push(`/batch/${s.id}`) }}
                className={`relative cursor-pointer border-b border-[var(--mod-hair)] transition-colors hover:bg-[var(--mod-red-bg)] ${
                  urgent ? 'bg-[var(--mod-red-bg2)]' : ''
                }`}
                style={urgent ? { boxShadow: 'inset 4px 0 0 var(--mod-red)' } : undefined}
              >
                <td className="px-3.5 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold tracking-[.04em] text-[var(--mod-faint)]">{s.ivName}</span>
                      {urgent && (
                        <span className="shrink-0 bg-[var(--mod-red)] px-1.5 py-0.5 text-[9px] font-bold text-white whitespace-nowrap">
                          {T.urgentTag}
                        </span>
                      )}
                    </div>
                    <span className="text-[14px] font-bold leading-snug text-[var(--mod-ink)]">
                      {s.productSummary || s.ivName}
                    </span>
                  </div>
                </td>
                <td className="px-3.5 py-2.5"><RemainingCell s={s} today={today} lang={lang} /></td>
                <td className="px-3.5 py-2.5">
                  <span className="whitespace-nowrap border border-[var(--mod-hair)] px-2 py-0.5 text-[11px] font-bold text-[var(--mod-sub)]">
                    {s.deliveryStatus ?? STATUS_LABEL[status][lang]}
                  </span>
                </td>
                <td className="px-3.5 py-2.5">
                  <span className="text-[13px] font-bold text-[var(--mod-ink)] whitespace-nowrap">
                    {stageStatusText(stage, done, lang)}
                  </span>
                </td>
                <td className="px-3.5 py-2.5"><EtaCell s={s} today={today} lang={lang} /></td>
                <td className="px-3.5 py-2.5">
                  <span className="text-[12px] font-semibold text-[var(--mod-sub)] whitespace-nowrap">{s.supplier ?? '—'}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
