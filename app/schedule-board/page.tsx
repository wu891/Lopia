'use client'
// ── 出貨日程總表（樞紐：列＝門市、欄＝出貨日期、格＝箱數）────
// 資料來源＝出貨紀錄 DB（Drive 機器人自動寫入的同一份），兩處呈現不另存
// 格子可點 → 對應批次明細＋高亮該門市；最近一個日期欄紅底
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Shipment, ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import { todayTaipei } from '@/lib/kanban'

interface Cell {
  boxes: number
  batchId: string | null   // 格子點擊要跳的批次（多批次時取箱數最多的）
}

export default function ScheduleBoard() {
  const router = useRouter()
  const [lang, setLang] = useState<Lang>('zh')
  const [records, setRecords] = useState<ShipmentRecord[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [batchFilter, setBatchFilter] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<'recent' | 'all'>('recent')  // 近期＝最近7天起

  const T = t[lang]
  const today = todayTaipei()

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [rRes, sRes, stRes] = await Promise.all([
        fetch('/api/records', { cache: 'no-store' }),
        fetch('/api/shipments', { cache: 'no-store' }),
        fetch('/api/drive-scan/status', { cache: 'no-store' }),
      ])
      const rJson = await rRes.json()
      const sJson = await sRes.json()
      const stJson = await stRes.json().catch(() => ({ lastScan: null }))
      setRecords((rJson.records as ShipmentRecord[]).filter(r => r.date && r.store && r.planStatus !== '已取消'))
      setShipments(sJson.shipments as Shipment[])
      setLastScan(stJson.lastScan ?? null)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // 批次篩選晶片：只列有出貨紀錄的批次（用商品摘要當顯示名）
  const batchIds = Array.from(new Set(records.map(r => r.batchId).filter(Boolean))) as string[]
  const batchChips = batchIds
    .map(id => {
      const s = shipments.find(x => x.id === id)
      return { id, label: s ? (s.productSummary || s.ivName) : id.slice(0, 6) }
    })
    .sort((a, b) => a.label.localeCompare(b.label))

  // 近期＝最近 7 天起（含未來）；全部＝完整歷史
  const recentFrom = new Date(new Date(today).getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const shown = records.filter(r =>
    (!batchFilter || r.batchId === batchFilter) &&
    (dateRange === 'all' || (r.date as string) >= recentFrom)
  )

  // 樞紐：列＝門市、欄＝日期
  const dates = Array.from(new Set(shown.map(r => r.date as string))).sort()
  const stores = Array.from(new Set(shown.map(r => r.store as string)))
    .sort((a, b) => a.localeCompare(b, 'zh-TW'))

  const cellMap = new Map<string, Cell>()          // `${store}|${date}` → Cell
  const perBatchInCell = new Map<string, Map<string, number>>()
  for (const r of shown) {
    const key = `${r.store}|${r.date}`
    const cur = cellMap.get(key) ?? { boxes: 0, batchId: null }
    cur.boxes += r.boxes ?? 0
    cellMap.set(key, cur)
    // 記每批次在此格的量，最後挑最大的當點擊目標
    const bm = perBatchInCell.get(key) ?? new Map()
    if (r.batchId) bm.set(r.batchId, (bm.get(r.batchId) ?? 0) + (r.boxes ?? 0))
    perBatchInCell.set(key, bm)
  }
  for (const [key, cell] of cellMap) {
    const bm = perBatchInCell.get(key)
    if (bm && bm.size > 0) {
      cell.batchId = [...bm.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }
  }

  const rowTotal = (store: string) => dates.reduce((sum, d) => sum + (cellMap.get(`${store}|${d}`)?.boxes ?? 0), 0)
  const colTotal = (date: string) => stores.reduce((sum, s) => sum + (cellMap.get(`${s}|${date}`)?.boxes ?? 0), 0)
  const grandTotal = dates.reduce((sum, d) => sum + colTotal(d), 0)

  // 最近一個日期欄：今天以後最近的；沒有未來日期就取最後一欄
  const nearestDate = dates.find(d => d >= today) ?? dates[dates.length - 1]

  const lastScanText = lastScan
    ? new Date(lastScan).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })
    : null

  return (
    <div className="modernist min-h-screen">
      {/* 頂部列 */}
      <div className="border-b-2 border-[var(--mod-line)] bg-white">
        <div className="mx-auto flex max-w-[1420px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <a href="/" className="text-xs font-bold text-[var(--mod-sub)] hover:text-[var(--mod-red-dark)] whitespace-nowrap">
              ← {T.backHome}
            </a>
            <span className="text-[15px] font-extrabold text-[var(--mod-ink)] whitespace-nowrap">{T.sbTitle}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex border border-[var(--mod-hair)]">
              <button onClick={() => setLang('zh')} className={lang === 'zh' ? 'bg-[var(--mod-ink)] px-3 py-1.5 text-xs font-bold text-white whitespace-nowrap cursor-pointer' : 'px-3 py-1.5 text-xs font-semibold text-[var(--mod-sub2)] whitespace-nowrap cursor-pointer'}>中文</button>
              <button onClick={() => setLang('ja')} className={lang === 'ja' ? 'bg-[var(--mod-ink)] px-3 py-1.5 text-xs font-bold text-white whitespace-nowrap cursor-pointer' : 'px-3 py-1.5 text-xs font-semibold text-[var(--mod-sub2)] whitespace-nowrap cursor-pointer'}>日本語</button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1420px] flex-col gap-4 px-4 pb-12 pt-5 sm:px-6">
        {/* 同步狀態列 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-[var(--mod-line)] bg-white px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2.5 text-[12px]">
            <span className="flex items-center gap-1.5 whitespace-nowrap font-bold text-[var(--mod-ink)]">
              <span className="h-[8px] w-[8px] bg-[#2f8f56] animate-lp-pulse" />
              {T.sbAutoSync}
            </span>
            <span className="text-[var(--mod-sub2)] whitespace-nowrap">{T.sbSource}</span>
            {lastScanText && (
              <span className="font-mono text-[var(--mod-sub2)] whitespace-nowrap">{T.sbLastWrite} {lastScanText}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a href="/shipment-generator" className="text-[11px] font-semibold text-[var(--mod-sub2)] underline hover:text-[var(--mod-red-dark)] whitespace-nowrap">
              {T.sbManual}
            </a>
            <button
              onClick={fetchData}
              className="border border-[var(--mod-hair)] px-3 py-1.5 text-xs font-bold text-[var(--mod-sub)] transition-colors hover:bg-[var(--mod-red-bg)] whitespace-nowrap cursor-pointer"
            >
              {T.refresh}
            </button>
          </div>
        </div>

        {/* 日期範圍 ＋ 批次篩選晶片 */}
        {batchChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="mr-2 flex border border-[var(--mod-hair)] bg-white">
              <button
                onClick={() => setDateRange('recent')}
                className={dateRange === 'recent'
                  ? 'bg-[var(--mod-ink)] px-2.5 py-1 text-[11px] font-bold text-white whitespace-nowrap cursor-pointer'
                  : 'px-2.5 py-1 text-[11px] font-semibold text-[var(--mod-sub)] whitespace-nowrap cursor-pointer'}
              >
                {lang === 'ja' ? '直近' : '近期'}
              </button>
              <button
                onClick={() => setDateRange('all')}
                className={dateRange === 'all'
                  ? 'bg-[var(--mod-ink)] px-2.5 py-1 text-[11px] font-bold text-white whitespace-nowrap cursor-pointer'
                  : 'px-2.5 py-1 text-[11px] font-semibold text-[var(--mod-sub)] whitespace-nowrap cursor-pointer'}
              >
                {T.sbAll}
              </button>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[.08em] text-[var(--mod-faint)] whitespace-nowrap">{T.sbFilterBatch}</span>
            <button
              onClick={() => setBatchFilter(null)}
              className={!batchFilter
                ? 'bg-[var(--mod-ink)] px-2.5 py-1 text-[11px] font-bold text-white whitespace-nowrap cursor-pointer'
                : 'border border-[var(--mod-hair)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--mod-sub)] hover:bg-[var(--mod-red-bg)] whitespace-nowrap cursor-pointer'}
            >
              {T.sbAll}
            </button>
            {batchChips.map(c => (
              <button
                key={c.id}
                onClick={() => setBatchFilter(batchFilter === c.id ? null : c.id)}
                className={batchFilter === c.id
                  ? 'bg-[var(--mod-red)] px-2.5 py-1 text-[11px] font-bold text-white whitespace-nowrap cursor-pointer'
                  : 'border border-[var(--mod-hair)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--mod-sub)] hover:bg-[var(--mod-red-bg)] whitespace-nowrap cursor-pointer'}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {/* 樞紐總表 */}
        {loading ? (
          <div className="flex h-48 items-center justify-center border-2 border-[var(--mod-line)] bg-white">
            <p className="text-sm text-[var(--mod-faint)]">{T.loading}</p>
          </div>
        ) : dates.length === 0 ? (
          <div className="flex h-48 items-center justify-center border-2 border-[var(--mod-line)] bg-white">
            <p className="text-sm text-[var(--mod-faint)]">{T.sbEmpty}</p>
          </div>
        ) : (
          <div className="overflow-x-auto border-2 border-[var(--mod-line)] bg-white">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-[var(--mod-line)]">
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-white px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[.06em] text-[var(--mod-sub)]">
                    {T.thStore}
                  </th>
                  {dates.map(d => (
                    <th
                      key={d}
                      className={`whitespace-nowrap px-3 py-2.5 text-center font-mono text-[11px] font-bold ${
                        d === nearestDate ? 'bg-[var(--mod-red)] text-white' : 'text-[var(--mod-sub)]'
                      }`}
                    >
                      {d.slice(5).replace('-', '/')}
                    </th>
                  ))}
                  <th className="whitespace-nowrap border-l-2 border-[var(--mod-line)] px-3.5 py-2.5 text-right text-[11px] font-bold uppercase tracking-[.06em] text-[var(--mod-ink)]">
                    {T.sbRowTotal}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stores.map(store => (
                  <tr key={store} className="border-b border-[var(--mod-hair)]">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3.5 py-2 text-[12px] font-bold text-[var(--mod-ink)]">
                      {store}
                    </td>
                    {dates.map(d => {
                      const cell = cellMap.get(`${store}|${d}`)
                      if (!cell || cell.boxes === 0) {
                        return <td key={d} className={`px-3 py-2 text-center text-[12px] text-[#d5d3d1] ${d === nearestDate ? 'bg-[var(--mod-red-bg)]' : ''}`}>·</td>
                      }
                      return (
                        <td key={d} className={`p-0 text-center ${d === nearestDate ? 'bg-[var(--mod-red-bg)]' : ''}`}>
                          <button
                            onClick={() => cell.batchId && router.push(`/batch/${cell.batchId}?store=${encodeURIComponent(store)}`)}
                            className="w-full px-3 py-2 font-mono text-[13px] font-bold text-[var(--mod-ink)] transition-colors hover:bg-[var(--mod-red)] hover:text-white cursor-pointer"
                            title={T.sbHint}
                          >
                            {cell.boxes.toLocaleString()}
                          </button>
                        </td>
                      )
                    })}
                    <td className="whitespace-nowrap border-l-2 border-[var(--mod-line)] px-3.5 py-2 text-right font-mono text-[13px] font-extrabold text-[var(--mod-ink)]">
                      {rowTotal(store).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--mod-line)]">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[.06em] text-[var(--mod-ink)]">
                    {T.sbDayTotal}
                  </td>
                  {dates.map(d => (
                    <td key={d} className={`whitespace-nowrap px-3 py-2.5 text-center font-mono text-[13px] font-extrabold text-[var(--mod-ink)] ${d === nearestDate ? 'bg-[var(--mod-red-bg)]' : ''}`}>
                      {colTotal(d).toLocaleString()}
                    </td>
                  ))}
                  <td className="whitespace-nowrap border-l-2 border-[var(--mod-line)] bg-[var(--mod-ink)] px-3.5 py-2.5 text-right font-mono text-[14px] font-extrabold text-white">
                    {grandTotal.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="text-[11px] text-[var(--mod-faint)]">{T.sbHint}</p>
      </div>
    </div>
  )
}
