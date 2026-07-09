'use client'
// ── 主畫面（2026-07 看板改版，設計 #2a）──────────────────────
// 版型由上到下：頂部列 → KPI 指標列 → 工具列 → 內容（看板/卡片/月曆/門市/預告）
// 視覺規格照 design_handoff_kanban_dashboard/README.md
import { useEffect, useState, useCallback, useRef } from 'react'
import { Shipment, ShipmentRecord, LogisticsEvent } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import { deriveKanban, isUrgent, daysUntil, computeKpis, todayTaipei } from '@/lib/kanban'
import { TOOLS } from '@/components/Header'
import ShipmentCard from '@/components/ShipmentCard'
import KanbanBoard from '@/components/KanbanBoard'
import StoreList from '@/components/StoreList'
import AddBatchForm from '@/components/AddBatchForm'
import CalendarView from '@/components/CalendarView'
import ArrivalPreview from '@/components/ArrivalPreview'

// 檢視模式：看板（預設）/ 卡片 / 月曆；門市與進貨預告也併進同一組切換
type View = 'kanban' | 'card' | 'calendar' | 'stores' | 'preview'

// ── 月份分組卡片列表（卡片檢視用）────────────────────────────
function MonthGroupedList({
  shipments, lang, allRecords, onRecordChange,
}: {
  shipments: Shipment[]
  lang: Lang
  allRecords: ShipmentRecord[]
  onRecordChange: () => void
}) {
  const groups: { monthKey: string; label: string; items: Shipment[] }[] = []
  for (const s of shipments) {
    let monthKey = 'no-date'
    let label = lang === 'ja' ? '日付なし' : '未定日期'
    if (s.arrivalTW) {
      const [y, m] = s.arrivalTW.split('-').map(Number)
      monthKey = `${y}-${String(m).padStart(2, '0')}`
      label = lang === 'ja' ? `${y}年${m}月` : `${y} 年 ${m} 月`
    }
    const existing = groups.find(g => g.monthKey === monthKey)
    if (existing) existing.items.push(s)
    else groups.push({ monthKey, label, items: [s] })
  }

  return (
    <div>
      {groups.map(group => (
        <div key={group.monthKey} className="mb-6">
          <div className="sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-2 border-b border-[#e6e4de] bg-[#f4f3ef] px-4 py-2">
            <span className="text-sm font-bold text-[#3a3a38]">{group.label}</span>
            <span className="font-mono text-xs font-normal text-[#a8a69d]">{group.items.length}</span>
          </div>
          <div className="space-y-4">
            {group.items.map(s => (
              <ShipmentCard
                key={s.id}
                shipment={s}
                lang={lang}
                allRecords={allRecords}
                onRecordChange={onRecordChange}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 業務工具下拉選單（沿用 Header 的工具清單，換成看板配色）──
function ToolsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-[#eae8e2] bg-white px-3 py-[9px] text-xs font-medium text-[#7d7b73] transition-colors hover:text-[#26251f] cursor-pointer"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
        </svg>
        業務工具
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-40 overflow-hidden rounded-lg border border-[#eae8e2] bg-white shadow-lg">
          {TOOLS.map(tool => (
            <a
              key={tool.href}
              href={tool.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-[#7d7b73] transition-colors hover:bg-[#fdecef] hover:text-[#e4002b]"
            >
              <span className="text-[#a8a69d]">{tool.icon}</span>
              {tool.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ── KPI 指標卡 ───────────────────────────────────────────────
function KpiCard({
  labelZh, labelJa, value, badge, warn,
}: {
  labelZh: string
  labelJa: string
  value: number
  badge?: { text: string; tone: 'green' | 'amber' | 'gray' } | null
  warn?: boolean
}) {
  const badgeCls =
    badge?.tone === 'green' ? 'rounded-md bg-[#e7f6ec] px-2 py-1 text-[11px] font-bold text-[#1a7f3c]' :
    badge?.tone === 'amber' ? 'rounded-md bg-[#fef1e0] px-2 py-1 text-[11px] font-bold text-[#b45309]' :
    'text-[11px] font-semibold text-[#8f8d84]'
  return (
    <div
      className="flex items-center justify-between rounded-[14px] border bg-white px-[18px] py-4"
      style={{ borderColor: warn ? '#f2e2cd' : '#eae8e2' }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[#8f8d84]">
          {labelZh} <span className="text-[#bcbab2]">{labelJa}</span>
        </span>
        <span className="font-mono text-[30px] font-bold leading-none text-[#26251f]">{value}</span>
      </div>
      {badge && <span className={badgeCls}>{badge.text}</span>}
    </div>
  )
}

interface ApiData {
  shipments: Shipment[]
  lastUpdated: string
}

interface RecordsData {
  records: ShipmentRecord[]
}

interface LogisticsData {
  events: LogisticsEvent[]
}

export default function Home() {
  const [lang, setLang] = useState<Lang>('zh')
  const [data, setData] = useState<ApiData | null>(null)
  const [recordsData, setRecordsData] = useState<RecordsData | null>(null)
  const [logisticsData, setLogisticsData] = useState<LogisticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [view, setView] = useState<View>('kanban')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'urgent'>('all')

  const T = t[lang]
  const today = todayTaipei()

  const fetchData = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const [shipmentsRes, recordsRes, logisticsRes] = await Promise.all([
        fetch('/api/shipments', { cache: 'no-store' }),
        fetch('/api/records',   { cache: 'no-store' }),
        fetch('/api/logistics', { cache: 'no-store' }),
      ])
      if (!shipmentsRes.ok || !recordsRes.ok || !logisticsRes.ok) {
        throw new Error('API returned error status')
      }
      const [shipmentsJson, recordsJson, logisticsJson] = await Promise.all([
        shipmentsRes.json(),
        recordsRes.json(),
        logisticsRes.json(),
      ])
      setData(shipmentsJson)
      setRecordsData(recordsJson)
      setLogisticsData(logisticsJson)
    } catch (e) {
      console.error(e)
      setFetchError('資料載入失敗，請重新整理頁面')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchData])

  const allRecords = recordsData?.records ?? []
  const shipments = data?.shipments ?? []
  const kpis = computeKpis(shipments, today)

  // 搜尋（批次/商品/供應商/班機/AWB）＋ 急件篩選
  const filtered = shipments
    .filter(s => {
      const q = search.toLowerCase()
      const matchSearch = !search ||
        s.ivName.toLowerCase().includes(q) ||
        (s.productSummary ?? '').toLowerCase().includes(q) ||
        (s.supplier ?? '').toLowerCase().includes(q) ||
        (s.flightNo ?? '').toLowerCase().includes(q) ||
        (s.awbNo ?? '').toLowerCase().includes(q)
      if (!matchSearch) return false
      if (filter === 'urgent') {
        const { status } = deriveKanban(s, today)
        return isUrgent(status, daysUntil(s.arrivalTW, today))
      }
      return true
    })
    .sort((a, b) => {
      // 新到舊：最近抵台的批次排最上面，未定日期沉底（卡片檢視用；看板欄內另有排序）
      if (!a.arrivalTW && !b.arrivalTW) return 0
      if (!a.arrivalTW) return 1
      if (!b.arrivalTW) return -1
      return new Date(b.arrivalTW).getTime() - new Date(a.arrivalTW).getTime()
    })

  // 更新時間膠囊文字（HH:MM 更新）
  const updatedText = data?.lastUpdated
    ? `${new Date(data.lastUpdated).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })} ${T.updatedSuffix}`
    : null

  const viewBtn = (active: boolean) =>
    active
      ? 'rounded-lg bg-[#26251f] px-4 py-2 text-[13px] font-bold text-white cursor-pointer'
      : 'rounded-lg border border-[#eae8e2] bg-white px-4 py-2 text-[13px] font-medium text-[#7d7b73] hover:text-[#26251f] transition-colors cursor-pointer'

  const filterBtn = (active: boolean) =>
    active
      ? 'rounded-md bg-[#fdecef] px-3.5 py-1.5 text-xs font-bold text-[#e4002b] cursor-pointer'
      : 'rounded-md px-3.5 py-1.5 text-xs font-medium text-[#7d7b73] hover:text-[#26251f] transition-colors cursor-pointer'

  return (
    <div className="min-h-screen bg-[#e9e8e4] px-3 py-4 sm:px-6 sm:py-8">
      <div
        className="mx-auto max-w-[1420px] overflow-hidden rounded-[20px] border border-[#dedcd6] bg-[#f4f3ef]"
        style={{ boxShadow: '0 24px 60px -30px rgba(0,0,0,.4)' }}
      >
        {/* ── 頂部列 ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edece8] bg-white px-4 py-[18px] sm:px-[30px]">
          <div className="flex items-center gap-4">
            <div className="font-tc text-[23px] font-black tracking-[-0.02em] text-[#e4002b]">LOPIA</div>
            <div className="h-7 w-px bg-[#e6e4de]" />
            <div className="flex flex-col">
              <span className="text-base font-bold text-[#26251f]">商品動態 · 進口貨況追蹤</span>
              <span className="text-[11px] text-[#9a988f]">Import Tracker · 商品入荷トラッキング</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {/* 語言切換膠囊 */}
            <div className="flex rounded-lg bg-[#f1f0ec] p-[3px]">
              <button
                onClick={() => setLang('zh')}
                className={lang === 'zh'
                  ? 'rounded-md bg-white px-[13px] py-1.5 text-xs font-bold text-[#26251f] shadow-[0_1px_2px_rgba(0,0,0,.06)] cursor-pointer'
                  : 'px-[13px] py-1.5 text-xs font-medium text-[#9a988f] cursor-pointer'}
              >
                中文
              </button>
              <button
                onClick={() => setLang('ja')}
                className={lang === 'ja'
                  ? 'rounded-md bg-white px-[13px] py-1.5 text-xs font-bold text-[#26251f] shadow-[0_1px_2px_rgba(0,0,0,.06)] cursor-pointer'
                  : 'px-[13px] py-1.5 text-xs font-medium text-[#9a988f] cursor-pointer'}
              >
                日本語
              </button>
            </div>

            {/* 更新狀態膠囊（綠點脈動） */}
            {updatedText && (
              <div className="flex items-center gap-[7px] rounded-lg bg-[#e7f6ec] px-3 py-[7px]">
                <span className="h-[7px] w-[7px] rounded-full bg-[#1a7f3c] animate-lp-pulse" />
                <span className="font-mono text-[11px] font-semibold text-[#1a7f3c]">{updatedText}</span>
              </div>
            )}

            <ToolsMenu />
            <AddBatchForm lang={lang} onBatchAdded={fetchData} variant="solid" />
          </div>
        </div>

        {/* ── 內容區 ── */}
        <div className="flex flex-col gap-5 px-4 pb-[30px] pt-[22px] sm:px-[30px]">
          {/* KPI 指標列 */}
          <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
            <KpiCard
              labelZh="進行中批次" labelJa="進行中"
              value={kpis.ongoing}
              badge={kpis.newThisWeek > 0 ? { text: `+${kpis.newThisWeek}`, tone: 'green' } : null}
            />
            <KpiCard
              labelZh="本週到港" labelJa="今週入港"
              value={kpis.arrivalsThisWeek}
              badge={kpis.nearestArrival ? { text: kpis.nearestArrival, tone: 'gray' } : null}
            />
            <KpiCard
              labelZh="通關中" labelJa="通関中"
              value={kpis.customsCount}
              badge={kpis.customsAttention > 0 ? { text: `留意 ${kpis.customsAttention}`, tone: 'amber' } : null}
              warn={kpis.customsAttention > 0}
            />
            <KpiCard
              labelZh="本月完成" labelJa="今月完了"
              value={kpis.doneThisMonth}
              badge={kpis.monthDonePct !== null ? { text: `${kpis.monthDonePct}%`, tone: 'gray' } : null}
            />
          </div>

          {/* 工具列：檢視切換／搜尋＋急件篩選 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setView('card')} className={viewBtn(view === 'card')}>{T.cardView}</button>
              <button onClick={() => setView('kanban')} className={viewBtn(view === 'kanban')}>{T.kanbanView}</button>
              <button onClick={() => setView('calendar')} className={viewBtn(view === 'calendar')}>{T.calendarView}</button>
              <div className="mx-1.5 h-6 w-px bg-[#dedcd6]" />
              <button onClick={() => setView('stores')} className={viewBtn(view === 'stores')}>{T.stores}</button>
              <button onClick={() => setView('preview')} className={viewBtn(view === 'preview')}>{T.previewTab}</button>
            </div>

            {(view === 'kanban' || view === 'card') && (
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative w-[230px]">
                  <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#c8c6be]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={T.searchKanban}
                    className="w-full rounded-[9px] border border-[#eae8e2] bg-white py-2 pl-8 pr-3 text-xs text-[#26251f] placeholder-[#bcbab2] focus:outline-none focus:ring-2 focus:ring-[#e4002b]"
                  />
                </div>
                <div className="flex gap-1.5 rounded-[9px] border border-[#eae8e2] bg-white p-[3px]">
                  <button onClick={() => setFilter('all')} className={filterBtn(filter === 'all')}>{T.filterAll}</button>
                  <button onClick={() => setFilter('urgent')} className={filterBtn(filter === 'urgent')}>{T.filterUrgent}</button>
                </div>
              </div>
            )}
          </div>

          {/* 背景更新失敗：保留舊資料，只顯示提示橫幅 */}
          {fetchError && data && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-700">更新失敗，目前顯示的是稍早的資料</p>
              <button onClick={() => fetchData()} className="shrink-0 text-xs font-medium text-amber-700 underline hover:text-amber-900">
                重試
              </button>
            </div>
          )}

          {/* 內容：載入 → 錯誤 → 各檢視 */}
          {fetchError && !data ? (
            <div className="flex h-48 items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="text-sm font-medium text-red-500">{fetchError}</p>
                <button onClick={() => fetchData()} className="rounded-lg bg-[#e4002b] px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#b8001f]">
                  重新載入
                </button>
              </div>
            </div>
          ) : loading && !data ? (
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex flex-col gap-3 rounded-2xl bg-[#efeee9] px-3 py-3.5">
                  <div className="h-4 w-24 animate-pulse rounded bg-[#e2e0da]" />
                  {[1, 2].map(j => (
                    <div key={j} className="animate-pulse rounded-[14px] border border-[#eae8e2] bg-white p-4">
                      <div className="mb-3 h-3 w-20 rounded bg-gray-200" />
                      <div className="mb-3 h-4 w-32 rounded bg-gray-200" />
                      <div className="h-[5px] rounded-full bg-gray-200" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : view === 'kanban' ? (
            filtered.length === 0 ? (
              <div className="flex h-48 items-center justify-center">
                <p className="text-sm text-[#a8a69d]">{T.noData}</p>
              </div>
            ) : (
              <KanbanBoard shipments={filtered} lang={lang} today={today} />
            )
          ) : view === 'card' ? (
            filtered.length === 0 ? (
              <div className="flex h-48 items-center justify-center">
                <p className="text-sm text-[#a8a69d]">{T.noData}</p>
              </div>
            ) : (
              <MonthGroupedList
                shipments={filtered}
                lang={lang}
                allRecords={allRecords}
                onRecordChange={fetchData}
              />
            )
          ) : view === 'calendar' ? (
            <CalendarView
              shipments={shipments}
              lang={lang}
              logisticsEvents={logisticsData?.events ?? []}
              records={allRecords}
              onRefresh={fetchData}
            />
          ) : view === 'stores' ? (
            <StoreList
              lang={lang}
              allRecords={allRecords}
              shipments={shipments}
            />
          ) : (() => {
            // 進貨預告：未來 14 天有出貨計畫的批次
            const in14Days = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
            const batchIdsWithUpcoming = new Set(
              allRecords
                .filter(r => r.batchId && r.date && r.date >= today && r.date <= in14Days && r.planStatus !== '已取消')
                .map(r => r.batchId as string)
            )
            const upcoming = shipments
              .filter(s => batchIdsWithUpcoming.has(s.id))
              .sort((a, b) => {
                const aMin = allRecords.filter(r => r.batchId === a.id && r.date && r.date >= today && r.planStatus !== '已取消').map(r => r.date as string).sort()[0] ?? ''
                const bMin = allRecords.filter(r => r.batchId === b.id && r.date && r.date >= today && r.planStatus !== '已取消').map(r => r.date as string).sort()[0] ?? ''
                return aMin.localeCompare(bMin)
              })
            return (
              <ArrivalPreview
                shipments={upcoming}
                allRecords={allRecords}
                lang={lang}
                dateFrom={today}
                dateTo={in14Days}
              />
            )
          })()}
        </div>
      </div>

      <footer className="py-5 text-center">
        <p className="text-xs text-[#9a988f]">
          LOPIA Taiwan Import Tracker · {T.autoRefresh}
        </p>
      </footer>
    </div>
  )
}
