'use client'
// ── 清單檢視（密表格）─────────────────────────────────────────
// 每列一個批次：批號/商品｜到港進度(5顆點)｜預計到港(倒數)｜供應商｜狀態
// 急件＝左緣 4px 紅條＋淡紅底；整列可點 → 批次明細頁
import { useRouter } from 'next/navigation'
import type { Shipment } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import { STATUS_LABEL } from '@/lib/kanban'
import { STAGES, deriveStage, isUrgentBatch, etaInfo, fmtDateW } from '@/lib/batchView'

function Stepper({ stage, done }: { stage: number; done: boolean }) {
  return (
    <div className="flex items-center gap-[5px]">
      {STAGES.map((_, i) => {
        const cls = done || i < stage
          ? 'h-[7px] w-[7px] bg-[#201e1d]'                       // 已完成＝深黑
          : i === stage
            ? 'h-[9px] w-[9px] bg-[var(--mod-red)]'              // 目前＝紅（略大）
            : 'h-[7px] w-[7px] bg-[#d5d3d1]'                     // 未到＝淺灰
        return <span key={i} className={`inline-block shrink-0 ${cls}`} />
      })}
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
            {[T.thBatchProduct, T.thProgress, T.thEta, T.thSupplier, T.thStatus].map(h => (
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
            const stageName = done ? STAGES[4][lang] : STAGES[stage][lang]
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
                <td className="px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5 whitespace-nowrap">
                    <Stepper stage={stage} done={done} />
                    <span className="text-[11px] font-semibold text-[var(--mod-sub)]">{stageName}</span>
                  </div>
                </td>
                <td className="px-3.5 py-2.5"><EtaCell s={s} today={today} lang={lang} /></td>
                <td className="px-3.5 py-2.5">
                  <span className="text-[12px] font-semibold text-[var(--mod-sub)] whitespace-nowrap">{s.supplier ?? '—'}</span>
                </td>
                <td className="px-3.5 py-2.5">
                  <span className="whitespace-nowrap border border-[var(--mod-hair)] px-2 py-0.5 text-[11px] font-bold text-[var(--mod-sub)]">
                    {s.deliveryStatus ?? STATUS_LABEL[status][lang]}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
