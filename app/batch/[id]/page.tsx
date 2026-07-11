'use client'
// ── 批次明細頁（Modernist 改版）──────────────────────────────
// 頂部：批號＋商品＋急件＋狀態 chips｜右側大倒數
// 中段：垂直時間軸（5 關）｜批次資訊
// 底部：門市配送清單（有出貨紀錄才顯示）— 狀態徽章可點循環，寫回 Notion
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import type { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import { todayTaipei, STATUS_LABEL } from '@/lib/kanban'
import { STAGES, deriveStage, stageDates, isUrgentBatch, etaInfo, fmtDateW } from '@/lib/batchView'
import DeliveryPlan from '@/components/DeliveryPlan'

function BatchDetail() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const highlightStore = searchParams.get('store')
  const [lang, setLang] = useState<Lang>('zh')
  const [shipment, setShipment] = useState<Shipment | null>(null)
  const [records, setRecords] = useState<ShipmentRecord[]>([])         // 顯示用（排除已取消）
  const [allBatchRecords, setAllBatchRecords] = useState<ShipmentRecord[]>([])  // DeliveryPlan 編輯用（含已取消）
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const T = t[lang]
  const today = todayTaipei()

  const fetchData = useCallback(async () => {
    try {
      const [sRes, rRes] = await Promise.all([
        fetch('/api/shipments', { cache: 'no-store' }),
        fetch('/api/records', { cache: 'no-store' }),
      ])
      const sJson = await sRes.json()
      const rJson = await rRes.json()
      const found = (sJson.shipments as Shipment[]).find(x => x.id === params.id)
      if (!found) { setNotFound(true); return }
      setShipment(found)
      const batchRecords = (rJson.records as ShipmentRecord[]).filter(r => r.batchId === params.id)
      setAllBatchRecords(batchRecords)
      setRecords(batchRecords.filter(r => r.planStatus !== '已取消'))
    } catch (e) {
      console.error(e)
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return (
      <div className="modernist flex min-h-screen items-center justify-center">
        <p className="text-sm text-[var(--mod-faint)]">{T.loading}</p>
      </div>
    )
  }
  if (notFound || !shipment) {
    return (
      <div className="modernist flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm font-semibold text-[var(--mod-sub)]">{T.notFound}</p>
        <a href="/" className="border-2 border-[var(--mod-red)] px-4 py-2 text-sm font-bold text-[var(--mod-red-dark)] hover:bg-[var(--mod-red-bg)]">
          {T.backHome}
        </a>
      </div>
    )
  }

  const s = shipment
  const { stage, done, status } = deriveStage(s, today)
  const urgent = isUrgentBatch(s, today)
  const info = etaInfo(s, today)
  const dates = stageDates(s)
  const transport = s.transportMode === '空運' ? T.airFreight : s.transportMode === '海運' ? T.seaFreight : s.transportMode
  const vessel = s.flightNo ?? s.awbNo

  // 門市配送：店 × 出貨日 迷你樞紐表（這裡都是已出貨的單，不做狀態）
  const dated = records.filter(r => r.date && r.store)
  const shipDates = Array.from(new Set(dated.map(r => r.date as string))).sort()
  const shipStores = Array.from(new Set(dated.map(r => r.store as string))).sort((a, b) => a.localeCompare(b, 'zh-TW'))
  const cellBoxes = new Map<string, number>()   // `${store}|${date}` → 箱數
  for (const r of dated) {
    const key = `${r.store}|${r.date}`
    cellBoxes.set(key, (cellBoxes.get(key) ?? 0) + (r.boxes ?? 0))
  }
  const rowTotal = (store: string) => shipDates.reduce((sum, d) => sum + (cellBoxes.get(`${store}|${d}`) ?? 0), 0)
  const colTotal = (d: string) => shipStores.reduce((sum, st) => sum + (cellBoxes.get(`${st}|${d}`) ?? 0), 0)
  const totalBoxes = dated.reduce((sum, r) => sum + (r.boxes ?? 0), 0)   // 跟表格同一份資料，總計才會對得上
  // 最近一次出貨欄：今天以後最近的；沒有未來日期就取最後一欄
  const nearestShipDate = shipDates.find(d => d >= today) ?? shipDates[shipDates.length - 1]

  return (
    <div className="modernist min-h-screen">
      {/* 頂部列 */}
      <div className="border-b-2 border-[var(--mod-line)] bg-white">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <a href="/" className="text-xs font-bold text-[var(--mod-sub)] hover:text-[var(--mod-red-dark)] whitespace-nowrap">
            ← {T.backHome}
          </a>
          <div className="flex border border-[var(--mod-hair)]">
            <button onClick={() => setLang('zh')} className={lang === 'zh' ? 'bg-[var(--mod-ink)] px-3 py-1.5 text-xs font-bold text-white whitespace-nowrap cursor-pointer' : 'px-3 py-1.5 text-xs font-semibold text-[var(--mod-sub2)] whitespace-nowrap cursor-pointer'}>中文</button>
            <button onClick={() => setLang('ja')} className={lang === 'ja' ? 'bg-[var(--mod-ink)] px-3 py-1.5 text-xs font-bold text-white whitespace-nowrap cursor-pointer' : 'px-3 py-1.5 text-xs font-semibold text-[var(--mod-sub2)] whitespace-nowrap cursor-pointer'}>日本語</button>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 pb-12 pt-5 sm:px-6">
        {/* 標題區 + 到港倒數 */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-2 border-[var(--mod-line)] bg-white p-5">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[12px] font-semibold tracking-[.04em] text-[var(--mod-faint)]">{s.ivName}</span>
              {urgent && <span className="bg-[var(--mod-red)] px-2 py-0.5 text-[10px] font-bold text-white whitespace-nowrap">{T.urgentTag}</span>}
            </div>
            <h1 className="text-[22px] font-extrabold leading-tight text-[var(--mod-ink)]">
              {s.productSummary || s.ivName}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="border border-[var(--mod-hair)] px-2 py-0.5 text-[11px] font-bold text-[var(--mod-sub)] whitespace-nowrap">
                {s.deliveryStatus ?? STATUS_LABEL[status][lang]}
              </span>
              <span className="border border-[var(--mod-hair)] px-2 py-0.5 text-[11px] font-bold text-[var(--mod-sub)] whitespace-nowrap">
                {done ? STAGES[4][lang] : STAGES[stage][lang]}
              </span>
            </div>
          </div>

          {/* 到港倒數大字 */}
          <div className={`flex min-w-[160px] flex-col items-center gap-1 px-6 py-4 ${
            info.hot ? 'border-2 border-[var(--mod-red)] bg-[var(--mod-red-bg)]' : 'border-2 border-[var(--mod-line)]'
          }`}>
            <span className={`text-[10px] font-bold uppercase tracking-[.08em] whitespace-nowrap ${info.hot ? 'text-[var(--mod-red-dark)]' : 'text-[var(--mod-sub2)]'}`}>
              {info.kind === 'arrived' ? T.etaArrived : T.etaCountdown}
            </span>
            {info.kind === 'countdown' && (
              <div className="flex items-baseline gap-1">
                <span className={`font-mono text-[40px] font-extrabold leading-none ${info.hot ? 'text-[var(--mod-red)]' : 'text-[var(--mod-ink)]'}`}>{info.days}</span>
                <span className={`text-[13px] font-bold ${info.hot ? 'text-[var(--mod-red)]' : 'text-[var(--mod-ink)]'}`}>{T.dayUnit}</span>
              </div>
            )}
            {info.kind === 'today' && (
              <span className="text-[20px] font-extrabold text-[var(--mod-red)] whitespace-nowrap">{T.etaToday}</span>
            )}
            {info.kind === 'arrived' && (
              <span className="text-[16px] font-extrabold text-[var(--mod-ink)] whitespace-nowrap">
                {status === 'customs' ? T.inCustomsNow : fmtDateW(s.arrivalTW, lang)}
              </span>
            )}
            {info.kind === 'tbd' && (
              <span className="text-[16px] font-extrabold text-[var(--mod-sub2)] whitespace-nowrap">{T.etaTbd}</span>
            )}
            <span className="text-[11px] text-[var(--mod-faint)] whitespace-nowrap">{fmtDateW(s.arrivalTW, lang)}</span>
          </div>
        </div>

        {/* 中段：時間軸（左）＋ 批次資訊（右） */}
        <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
          {/* 垂直時間軸（5 關） */}
          <div className="border-2 border-[var(--mod-line)] bg-white p-5">
            <h2 className="mb-4 border-b-2 border-[var(--mod-line)] pb-2 text-[13px] font-extrabold uppercase tracking-[.06em] text-[var(--mod-ink)]">
              {T.thProgress}
            </h2>
            <div className="flex flex-col">
              {STAGES.map((st, i) => {
                const isDone = done || i < stage
                const isCurrent = !done && i === stage
                const date = dates[i]
                // 通關關卡：沒有實際出關日時顯示預計出關日
                const showDate = i === 3 && !date && s.estClearance
                  ? `${T.estClearance} ${fmtDateW(s.estClearance, lang)}`
                  : date ? fmtDateW(date, lang) : '—'
                const note = i === 1 ? [transport, vessel].filter(Boolean).join(' · ') : null
                return (
                  <div key={st.key} className="flex gap-3.5">
                    {/* 節點＋連接線 */}
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-0.5 h-[13px] w-[13px] shrink-0 ${
                          isDone ? 'bg-[var(--mod-ink)]'
                          : isCurrent ? 'bg-[var(--mod-red)] mod-glow'
                          : 'border-2 border-[#c9c7c5] bg-white'
                        }`}
                      />
                      {i < STAGES.length - 1 && (
                        <span className={`w-[2px] flex-1 ${isDone ? 'bg-[var(--mod-ink)]' : 'bg-[var(--mod-hair)]'}`} style={{ minHeight: 28 }} />
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 pb-5">
                      <span className={`text-[13px] font-bold whitespace-nowrap ${isCurrent ? 'text-[var(--mod-red-dark)]' : isDone ? 'text-[var(--mod-ink)]' : 'text-[var(--mod-faint)]'}`}>
                        {st[lang]}
                      </span>
                      <span className="text-[12px] text-[var(--mod-sub2)] whitespace-nowrap">{showDate}</span>
                      {note && <span className="font-mono text-[11px] text-[var(--mod-faint)]">{note}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 批次資訊 */}
          <div className="border-2 border-[var(--mod-line)] bg-white p-5">
            <h2 className="mb-4 border-b-2 border-[var(--mod-line)] pb-2 text-[13px] font-extrabold uppercase tracking-[.06em] text-[var(--mod-ink)]">
              {T.batchInfo}
            </h2>
            <dl className="flex flex-col">
              {[
                [T.supplier, s.supplier],
                [T.infoTransport, transport],
                [T.infoVessel, vessel],
                [T.warehouse, s.warehouse],
                [T.infoQty, s.totalBoxes != null ? `${s.totalBoxes.toLocaleString()} ${T.boxes}` : null],
                [T.remarks, s.remarks],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between gap-4 border-b border-[var(--mod-hair)] py-2.5 last:border-b-0">
                  <dt className="shrink-0 text-[12px] font-bold text-[var(--mod-sub2)] whitespace-nowrap">{label}</dt>
                  <dd className="text-right text-[12px] font-semibold text-[var(--mod-ink)]">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* 門市配送（有出貨紀錄才顯示；只列已出貨的單，不做狀態） */}
        {dated.length > 0 && (
          <div className="border-2 border-[var(--mod-line)] bg-white p-5">
            <h2 className="mb-4 border-b-2 border-[var(--mod-line)] pb-2 text-[13px] font-extrabold uppercase tracking-[.06em] text-[var(--mod-ink)]">
              {T.storeDeliveryTitle}
            </h2>
            {/* 總覽：合計箱數／出貨次數／門市數 */}
            <div className="mb-4 grid grid-cols-3 gap-2.5">
              <div className="flex flex-col gap-0.5 border border-[var(--mod-hair)] px-3 py-2.5">
                <span className="text-[10px] font-bold text-[var(--mod-sub2)] whitespace-nowrap">{T.sumOrdered}</span>
                <span className="font-mono text-[20px] font-extrabold text-[var(--mod-ink)]">{totalBoxes.toLocaleString()}</span>
              </div>
              <div className="flex flex-col gap-0.5 border border-[var(--mod-hair)] px-3 py-2.5">
                <span className="text-[10px] font-bold text-[var(--mod-sub2)] whitespace-nowrap">{T.sumTimes}</span>
                <span className="font-mono text-[20px] font-extrabold text-[var(--mod-ink)]">{shipDates.length}</span>
              </div>
              <div className="flex flex-col gap-0.5 border border-[var(--mod-hair)] px-3 py-2.5">
                <span className="text-[10px] font-bold text-[var(--mod-sub2)] whitespace-nowrap">{T.sumStoreCount}</span>
                <span className="font-mono text-[20px] font-extrabold text-[var(--mod-ink)]">{shipStores.length}</span>
              </div>
            </div>

            {/* 迷你樞紐表：列＝門市、欄＝出貨日、格＝箱數 */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b-2 border-[var(--mod-line)]">
                    <th className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[.06em] text-[var(--mod-sub)]">{T.thStore}</th>
                    {shipDates.map(d => (
                      <th
                        key={d}
                        className={`whitespace-nowrap px-2.5 py-2 text-center font-mono text-[11px] font-bold ${
                          d === nearestShipDate ? 'bg-[var(--mod-red)] text-white' : 'text-[var(--mod-sub)]'
                        }`}
                      >
                        {d.slice(5).replace('-', '/')}
                      </th>
                    ))}
                    <th className="whitespace-nowrap border-l-2 border-[var(--mod-line)] px-3 py-2 text-right text-[11px] font-bold uppercase tracking-[.06em] text-[var(--mod-ink)]">{T.sbRowTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {shipStores.map(store => {
                    const highlighted = highlightStore === store
                    return (
                      <tr
                        key={store}
                        className={`border-b border-[var(--mod-hair)] ${highlighted ? 'bg-[var(--mod-red-bg2)]' : ''}`}
                        style={highlighted ? { boxShadow: 'inset 4px 0 0 var(--mod-red)' } : undefined}
                      >
                        <td className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2 text-[12px] font-bold text-[var(--mod-ink)] ${highlighted ? 'bg-[var(--mod-red-bg2)]' : 'bg-white'}`}>
                          {store}
                        </td>
                        {shipDates.map(d => {
                          const boxes = cellBoxes.get(`${store}|${d}`)
                          return (
                            <td key={d} className={`whitespace-nowrap px-2.5 py-2 text-center font-mono text-[12px] font-bold ${
                              d === nearestShipDate ? 'bg-[var(--mod-red-bg)]' : ''
                            } ${boxes ? 'text-[var(--mod-ink)]' : 'text-[#d5d3d1]'}`}>
                              {boxes ? boxes.toLocaleString() : '·'}
                            </td>
                          )
                        })}
                        <td className="whitespace-nowrap border-l-2 border-[var(--mod-line)] px-3 py-2 text-right font-mono text-[12px] font-extrabold text-[var(--mod-ink)]">
                          {rowTotal(store).toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--mod-line)]">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[.06em] text-[var(--mod-ink)]">{T.sbDayTotal}</td>
                    {shipDates.map(d => (
                      <td key={d} className={`whitespace-nowrap px-2.5 py-2 text-center font-mono text-[12px] font-extrabold text-[var(--mod-ink)] ${d === nearestShipDate ? 'bg-[var(--mod-red-bg)]' : ''}`}>
                        {colTotal(d).toLocaleString()}
                      </td>
                    ))}
                    <td className="whitespace-nowrap border-l-2 border-[var(--mod-line)] bg-[var(--mod-ink)] px-3 py-2 text-right font-mono text-[13px] font-extrabold text-white">
                      {totalBoxes.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 出貨計畫編輯（新增輪次／Excel 帶入／時程表更新）— 沿用原元件 */}
      <div className="mx-auto max-w-[1100px] px-4 pb-12 sm:px-6">
        <div className="border-2 border-[var(--mod-line)] bg-white p-5">
          <DeliveryPlan
            batchId={s.id}
            batchName={s.ivName}
            totalBoxes={s.totalBoxes}
            records={allBatchRecords}
            lang={lang}
            supplierExcelId={s.supplierExcelId}
            onRecordChange={fetchData}
          />
        </div>
      </div>

    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="modernist flex min-h-screen items-center justify-center"><p className="text-sm text-[#8a8785]">…</p></div>}>
      <BatchDetail />
    </Suspense>
  )
}
