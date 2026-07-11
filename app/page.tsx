'use client'
// ── 主畫面（2026-07 Modernist 改版：以「哪批快到港」為核心）────
// 版型由上到下：頂部列 → 統計卡 4 張 → 工具列（檢視｜篩選）→ 內容
// 設計 token 見 globals.css 的 .modernist（紅 #ec3013、圓角 0、Archivo）
import { useEffect, useState, useCallback, useRef } from 'react'
import { Shipment, ShipmentRecord, LogisticsEvent } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import { computeKpis, todayTaipei, deriveKanban } from '@/lib/kanban'
import { isUrgentBatch, sortByEtaAsc } from '@/lib/batchView'
import { TOOLS } from '@/components/Header'
import BatchTable from '@/components/BatchTable'
import KanbanBoard from '@/components/KanbanBoard'
import StoreList from '@/components/StoreList'
import AddBatchForm from '@/components/AddBatchForm'
import CalendarView from '@/components/CalendarView'
import ArrivalPreview from '@/components/ArrivalPreview'

// 檢視模式：清單（預設）/ 看板 / 月曆 / 門市 / 進貨預告
type View = 'list' | 'kanban' | 'calendar' | 'stores' | 'preview'

// ── 業務工具下拉選單 ─────────────────────────────────────────
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
        className="flex items-center gap-1.5 border border-[var(--mod-hair)] bg-white px-3 py-2 text-xs font-semibold text-[var(--mod-sub)] transition-colors hover:bg-[var(--mod-red-bg)] whitespace-nowrap cursor-pointer"
      >
        業務工具
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-44 border border-[var(--mod-line)] bg-white shadow-lg">
          {TOOLS.map(tool => (
            <a
              key={tool.href}
              href={tool.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 border-b border-[var(--mod-hair)] px-3.5 py-2.5 text-xs font-semibold text-[var(--mod-sub)] transition-colors last:border-b-0 hover:bg-[var(--mod-red-bg)] hover:text-[var(--mod-red-dark)]"
            >
              <span className="text-[var(--mod-faint)]">{tool.icon}</span>
              {tool.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 統計卡（標籤 → 數字 → 一行輔助說明，格式統一）──────────
function StatCard({
  label, value, sub, hero,
}: {
  label: string
  value: number
  sub: string
  hero?: boolean       // 「本週到港」主角卡：紅框＋淡紅底
}) {
  return (
    <div
      className={`flex flex-col gap-1 px-4 py-3.5 ${
        hero
          ? 'border-2 border-[var(--mod-red)] bg-[var(--mod-red-bg)]'
          : 'border border-[var(--mod-hair)] bg-white'
      }`}
    >
      <span className={`text-[11px] font-bold uppercase tracking-[.06em] whitespace-nowrap ${hero ? 'text-[var(--mod-red-dark)]' : 'text-[var(--mod-sub2)]'}`}>
        {label}
      </span>
      <span className={`font-mono text-[32px] font-extrabold leading-none ${hero ? 'text-[var(--mod-red)]' : 'text-[var(--mod-ink)]'}`}>
        {value}
      </span>
      <span className="text-[11px] text-[var(--mod-faint)] whitespace-nowrap">{sub}</span>
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
  const [view, setView] = useState<View>('list')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'urgent'>('all')
  const [listSub, setListSub] = useState<'active' | 'done'>('active')

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
  const urgentTotal = shipments.filter(s => isUrgentBatch(s, today)).length
  const monthArrived = shipments.filter(s => s.arrivalTW?.slice(0, 7) === today.slice(0, 7)).length

  // 搜尋（批次/商品/供應商/班機/AWB）＋ 急件篩選
  const filtered = shipments.filter(s => {
    const q = search.toLowerCase()
    const matchSearch = !search ||
      s.ivName.toLowerCase().includes(q) ||
      (s.productSummary ?? '').toLowerCase().includes(q) ||
      (s.supplier ?? '').toLowerCase().includes(q) ||
      (s.flightNo ?? '').toLowerCase().includes(q) ||
      (s.awbNo ?? '').toLowerCase().includes(q)
    if (!matchSearch) return false
    if (filter === 'urgent') return isUrgentBatch(s, today)
    return true
  })

  // 清單檢視：進行中（ETA 升冪，快到的在最上）／已完成（新到舊）
  const listActive = sortByEtaAsc(filtered.filter(s => deriveKanban(s, today).status !== 'done'), today)
  const listDone = filtered
    .filter(s => deriveKanban(s, today).status === 'done')
    .sort((a, b) => (b.arrivalTW ?? '').localeCompare(a.arrivalTW ?? ''))
  const listShown = listSub === 'done' ? listDone : listActive

  const updatedText = data?.lastUpdated
    ? `${new Date(data.lastUpdated).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })} ${T.updatedSuffix}`
    : null

  const viewBtn = (active: boolean) =>
    active
      ? 'bg-[var(--mod-ink)] px-3.5 py-2 text-[12px] font-bold text-white whitespace-nowrap cursor-pointer'
      : 'px-3.5 py-2 text-[12px] font-semibold text-[var(--mod-sub)] hover:bg-[var(--mod-red-bg)] transition-colors whitespace-nowrap cursor-pointer'

  const filterBtn = (active: boolean) =>
    active
      ? 'bg-[var(--mod-red)] px-3 py-1.5 text-xs font-bold text-white whitespace-nowrap cursor-pointer'
      : 'px-3 py-1.5 text-xs font-semibold text-[var(--mod-sub)] hover:bg-[var(--mod-red-bg)] transition-colors whitespace-nowrap cursor-pointer'

  const subBtn = (active: boolean) =>
    active
      ? 'border-b-2 border-[var(--mod-red)] px-2 py-1 text-xs font-bold text-[var(--mod-ink)] whitespace-nowrap cursor-pointer'
      : 'border-b-2 border-transparent px-2 py-1 text-xs font-semibold text-[var(--mod-sub2)] hover:text-[var(--mod-ink)] transition-colors whitespace-nowrap cursor-pointer'

  return (
    <div className="modernist min-h-screen">
      {/* ── 頂部列 ── */}
      <div className="border-b-2 border-[var(--mod-line)] bg-white">
        <div className="mx-auto flex max-w-[1420px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3.5">
            <div className="bg-[var(--mod-red)] px-2.5 py-1 text-[18px] font-extrabold tracking-[-0.02em] text-white">LOPIA</div>
            <div className="flex flex-col">
              <span className="text-[15px] font-extrabold text-[var(--mod-ink)]">商品動態 · 進口貨況追蹤</span>
              <span className="text-[10px] text-[var(--mod-faint)]">Import Tracker · 商品入荷トラッキング</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 語言切換 */}
            <div className="flex border border-[var(--mod-hair)]">
              <button
                onClick={() => setLang('zh')}
                className={lang === 'zh'
                  ? 'bg-[var(--mod-ink)] px-3 py-1.5 text-xs font-bold text-white whitespace-nowrap cursor-pointer'
                  : 'px-3 py-1.5 text-xs font-semibold text-[var(--mod-sub2)] whitespace-nowrap cursor-pointer'}
              >
                中文
              </button>
              <button
                onClick={() => setLang('ja')}
                className={lang === 'ja'
                  ? 'bg-[var(--mod-ink)] px-3 py-1.5 text-xs font-bold text-white whitespace-nowrap cursor-pointer'
                  : 'px-3 py-1.5 text-xs font-semibold text-[var(--mod-sub2)] whitespace-nowrap cursor-pointer'}
              >
                日本語
              </button>
            </div>

            {updatedText && (
              <span className="border border-[var(--mod-hair)] px-2.5 py-1.5 font-mono text-[11px] font-semibold text-[var(--mod-sub2)] whitespace-nowrap">
                {updatedText}
              </span>
            )}

            {/* 匯入日程表（獨立入口） */}
            <a
              href="/schedule-board"
              className="border-2 border-[var(--mod-red)] px-3 py-1.5 text-xs font-bold text-[var(--mod-red-dark)] transition-colors hover:bg-[var(--mod-red-bg)] whitespace-nowrap"
            >
              {T.importSchedule}
            </a>

            <ToolsMenu />
            <AddBatchForm lang={lang} onBatchAdded={fetchData} variant="solid" />
          </div>
        </div>
      </div>

      {/* ── 內容區 ── */}
      <div className="mx-auto flex max-w-[1420px] flex-col gap-4 px-4 pb-10 pt-5 sm:px-6">
        {/* 統計卡 4 張（本週到港＝主角） */}
        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
          <StatCard
            label={T.statOngoing}
            value={kpis.ongoing}
            sub={`${T.statOngoingSub} ${urgentTotal} ${T.unitItem}`}
          />
          <StatCard
            hero
            label={T.statArrivalsWeek}
            value={kpis.arrivalsThisWeek}
            sub={kpis.nearestArrival ? `${T.statArrivalsWeekSub} ${kpis.nearestArrival}` : '—'}
          />
          <StatCard
            label={T.statCustoms2}
            value={kpis.customsCount}
            sub={`${T.statCustomsSub} ${kpis.customsAttention} ${T.unitItem}`}
          />
          <StatCard
            label={T.statDoneMonth}
            value={kpis.doneThisMonth}
            sub={`${T.statDoneMonthSub} ${monthArrived} ${T.unitBatch}`}
          />
        </div>

        {/* 工具列：檢視（左）｜篩選（右），視覺分開 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--mod-line)] pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[.08em] text-[var(--mod-faint)] whitespace-nowrap">{T.viewLabel}</span>
            <div className="flex border border-[var(--mod-hair)] bg-white">
              <button onClick={() => setView('list')} className={viewBtn(view === 'list')}>{T.viewList}</button>
              <button onClick={() => setView('kanban')} className={viewBtn(view === 'kanban')}>{T.kanbanView}</button>
              <button onClick={() => setView('calendar')} className={viewBtn(view === 'calendar')}>{T.calendarView}</button>
              <button onClick={() => setView('stores')} className={viewBtn(view === 'stores')}>{T.stores}</button>
              <button onClick={() => setView('preview')} className={viewBtn(view === 'preview')}>{T.previewTab}</button>
            </div>
          </div>

          {(view === 'list' || view === 'kanban') && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={T.searchKanban}
                className="w-[200px] border border-[var(--mod-hair)] bg-white px-3 py-2 text-xs text-[var(--mod-ink)] placeholder-[var(--mod-faint)] focus:outline-none"
              />
              <span className="text-[10px] font-bold uppercase tracking-[.08em] text-[var(--mod-faint)] whitespace-nowrap">{T.filterLabel}</span>
              <div className="flex border border-[var(--mod-hair)] bg-white">
                <button onClick={() => setFilter('all')} className={filterBtn(filter === 'all')}>{T.filterAll}</button>
                <button onClick={() => setFilter('urgent')} className={filterBtn(filter === 'urgent')}>
                  {T.filterUrgent} {urgentTotal > 0 && <span className="font-mono">{urgentTotal}</span>}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 背景更新失敗：保留舊資料，只顯示提示 */}
        {fetchError && data && (
          <div className="flex items-center justify-between gap-2 border-2 border-[var(--mod-red)] bg-[var(--mod-red-bg)] px-3 py-2">
            <p className="text-xs font-semibold text-[var(--mod-red-dark)]">更新失敗，目前顯示的是稍早的資料</p>
            <button onClick={() => fetchData()} className="shrink-0 text-xs font-bold text-[var(--mod-red-dark)] underline">
              重試
            </button>
          </div>
        )}

        {/* 內容：載入 → 錯誤 → 各檢視 */}
        {fetchError && !data ? (
          <div className="flex h-48 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm font-semibold text-[var(--mod-red-dark)]">{fetchError}</p>
              <button onClick={() => fetchData()} className="bg-[var(--mod-red)] px-4 py-2 text-sm font-bold text-white">
                重新載入
              </button>
            </div>
          </div>
        ) : loading && !data ? (
          <div className="border-2 border-[var(--mod-line)] bg-white">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-4 border-b border-[var(--mod-hair)] px-4 py-3">
                <div className="h-4 w-32 animate-pulse bg-[#e8e6e4]" />
                <div className="h-4 w-20 animate-pulse bg-[#efedec]" />
                <div className="h-4 flex-1 animate-pulse bg-[#f3f2f2]" />
              </div>
            ))}
          </div>
        ) : view === 'list' ? (
          <div className="flex flex-col gap-3">
            {/* 次層：進行中 N ／ 已完成 N */}
            <div className="flex gap-2">
              <button onClick={() => setListSub('active')} className={subBtn(listSub === 'active')}>
                {T.filterActive} <span className="font-mono">{listActive.length}</span>
              </button>
              <button onClick={() => setListSub('done')} className={subBtn(listSub === 'done')}>
                {T.filterDone} <span className="font-mono">{listDone.length}</span>
              </button>
            </div>
            {listShown.length === 0 ? (
              <div className="flex h-40 items-center justify-center border-2 border-[var(--mod-line)] bg-white">
                <p className="text-sm text-[var(--mod-faint)]">{T.noData}</p>
              </div>
            ) : (
              <BatchTable shipments={listShown} lang={lang} today={today} />
            )}
          </div>
        ) : view === 'kanban' ? (
          filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center border-2 border-[var(--mod-line)] bg-white">
              <p className="text-sm text-[var(--mod-faint)]">{T.noData}</p>
            </div>
          ) : (
            <KanbanBoard shipments={filtered} lang={lang} today={today} />
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

      <footer className="border-t border-[var(--mod-hair)] py-5 text-center">
        <p className="text-xs text-[var(--mod-faint)]">
          LOPIA Taiwan Import Tracker · {T.autoRefresh}
        </p>
      </footer>
    </div>
  )
}
