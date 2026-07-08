'use client'
/**
 * 三重檢查體制 — 出貨檢查清單頁（RWD，手機／電腦皆可用）
 * 每張出貨單一份清單；每人用 PIN 登入；上一層沒勾完下一層鎖住；可退回、可（蔡さん）代理。
 */
import { useState, useEffect, useCallback } from 'react'
import {
  PEOPLE, LAYERS, LAST_LAYER_ID, personName,
  currentLayerId, isCompleted, isLayerUnlocked, isLayerComplete, canCheck, stageLabel,
  type PersonId, type ChecklistState,
} from '@/lib/checklistModel'

interface Checklist {
  id: string
  shipmentNo: string
  deliveryDate: string | null
  stage: string
  completed: boolean
  state: ChecklistState
  lastEdited: string
}

interface ShipmentRecord {
  shipmentNo: string
  date: string | null
  store: string | null
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']
function fmtDate(iso: string | null): string {
  if (!iso) return '未填配送日'
  const d = new Date(iso + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY[d.getDay()]})`
}

// 依配送日算「倒數紅黃燈」：逾期/今天=紅、明天=黃、其餘=綠、沒填=灰
function light(deliveryDate: string | null): { color: string; label: string } {
  if (!deliveryDate) return { color: 'bg-gray-300 text-gray-700', label: '未定配送日' }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(deliveryDate + 'T00:00:00')
  const days = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { color: 'bg-red-600 text-white', label: `逾期 ${-days} 天` }
  if (days === 0) return { color: 'bg-red-500 text-white', label: '今天配送' }
  if (days === 1) return { color: 'bg-amber-500 text-white', label: '明天配送' }
  return { color: 'bg-emerald-500 text-white', label: `還有 ${days} 天` }
}

// 這張單現在是不是「輪到我處理」
function isMyTurn(state: ChecklistState, who: PersonId | null): boolean {
  if (!who || isCompleted(state)) return false
  const cur = currentLayerId(state)
  const layer = LAYERS.find(l => l.id === cur)
  if (!layer) return false
  return layer.items.some(it => !state.checks[it.key]?.checked && canCheck(state, it.key, who).ok)
}

export default function ChecklistPage() {
  const [who, setWho] = useState<PersonId | null>(null)
  const [configured, setConfigured] = useState(true)
  const [pinsReady, setPinsReady] = useState(true)
  const [items, setItems] = useState<Checklist[]>([])
  const [records, setRecords] = useState<ShipmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: 'err' | 'ok'; msg: string } | null>(null)

  const flash = (type: 'err' | 'ok', msg: string) => {
    setBanner({ type, msg })
    setTimeout(() => setBanner(null), 4000)
  }

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [clRes, recRes] = await Promise.all([
        fetch('/api/checklist', { cache: 'no-store' }),
        fetch('/api/records', { cache: 'no-store' }),
      ])
      const cl = await clRes.json()
      setConfigured(cl.configured !== false)
      setItems(cl.items ?? [])
      const rec = await recRes.json()
      setRecords(rec.records ?? [])
    } catch {
      flash('err', '讀取失敗，請重新整理')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch('/api/checklist/login', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setWho(d.who ?? null); setPinsReady(d.configured !== false) })
      .catch(() => {})
    loadAll()
  }, [loadAll])

  // 漏建提醒：出貨紀錄裡有 S 單號、但還沒建檢查清單的
  const existingNos = new Set(items.map(i => i.shipmentNo))
  const missing = (() => {
    const byNo = new Map<string, string | null>() // shipmentNo → 最早日期
    for (const r of records) {
      if (!r.shipmentNo || !r.shipmentNo.startsWith('S')) continue
      if (existingNos.has(r.shipmentNo)) continue
      const prev = byNo.get(r.shipmentNo)
      if (prev === undefined) byNo.set(r.shipmentNo, r.date)
      else if (r.date && (!prev || r.date < prev)) byNo.set(r.shipmentNo, r.date)
    }
    return [...byNo.entries()]
      .map(([shipmentNo, date]) => ({ shipmentNo, date }))
      .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  })()

  async function refreshOne(id: string) {
    const res = await fetch(`/api/checklist/${id}`, { cache: 'no-store' })
    if (res.ok) {
      const d = await res.json()
      setItems(prev => prev.map(it => (it.id === id ? d.item : it)))
    }
  }

  if (loading && items.length === 0) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">載入中…</div>
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 頂欄 */}
      <header className="sticky top-0 z-20 bg-[#1a2744] text-white px-4 py-3 flex items-center gap-3 shadow">
        <div className="flex-1">
          <div className="text-[11px] tracking-widest text-white/50">TMJ × LOPIA</div>
          <div className="font-bold leading-tight">出貨三重檢查</div>
        </div>
        {who ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 rounded bg-white/10">{personName(who)}</span>
            <button
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs"
              onClick={async () => { await fetch('/api/checklist/login', { method: 'DELETE' }); setWho(null) }}
            >登出</button>
          </div>
        ) : null}
      </header>

      {banner && (
        <div className={`px-4 py-2 text-sm text-white ${banner.type === 'err' ? 'bg-red-600' : 'bg-emerald-600'}`}>
          {banner.msg}
        </div>
      )}

      <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4">
        {!configured ? (
          <SetupPanel flash={flash} onDone={loadAll} />
        ) : !who ? (
          <LoginPanel pinsReady={pinsReady} onLogin={setWho} flash={flash} />
        ) : (
          <>
            <MissingBanner missing={missing} onCreate={loadAll} flash={flash} />
            <CreateForm onCreated={loadAll} flash={flash} prefill={missing[0]?.shipmentNo} />
            <ChecklistList
              items={items}
              who={who}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              onChanged={refreshOne}
              flash={flash}
            />
          </>
        )}
      </main>
    </div>
  )
}

// ── 登入 ──────────────────────────────────────────────────────────────────
function LoginPanel({ pinsReady, onLogin, flash }: {
  pinsReady: boolean
  onLogin: (p: PersonId) => void
  flash: (t: 'err' | 'ok', m: string) => void
}) {
  const [person, setPerson] = useState<PersonId | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!person || !pin) return
    setBusy(true)
    try {
      const res = await fetch('/api/checklist/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person, pin }),
      })
      const d = await res.json()
      if (d.ok) { onLogin(d.who); flash('ok', `${d.name} 已登入`) }
      else flash('err', d.error ?? '登入失敗')
    } catch {
      flash('err', '登入失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-sm">
      <div className="font-bold text-slate-800 mb-1">請先選擇你是誰並輸入 PIN</div>
      {!pinsReady && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
          系統尚未設定各人 PIN（CHECKLIST_PINS），暫時無法登入。
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 my-3">
        {PEOPLE.map(p => (
          <button
            key={p.id}
            onClick={() => setPerson(p.id)}
            className={`py-3 rounded-lg text-sm font-semibold border transition
              ${person === p.id ? 'bg-[#2563a8] text-white border-[#2563a8]' : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-[#2563a8]'}`}
          >{p.name}</button>
        ))}
      </div>
      <input
        type="password" inputMode="numeric" placeholder="輸入 PIN"
        value={pin} onChange={e => setPin(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        className="w-full border border-slate-300 rounded-lg px-3 py-3 text-base mb-3"
      />
      <button
        disabled={!person || !pin || busy}
        onClick={submit}
        className="w-full py-3 rounded-lg bg-[#1a2744] text-white font-bold disabled:opacity-40"
      >{busy ? '登入中…' : '登入'}</button>
    </div>
  )
}

// ── 一次性建置（尚未設定資料庫時顯示）────────────────────────────────────────
function SetupPanel({ flash, onDone }: {
  flash: (t: 'err' | 'ok', m: string) => void
  onDone: () => void
}) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [dbId, setDbId] = useState<string | null>(null)

  async function run() {
    if (!pw) return
    setBusy(true)
    try {
      // 先用編輯密碼登入主站（設定 edit cookie），再呼叫建置端點
      const a = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      const ad = await a.json()
      if (!ad.ok) { flash('err', ad.error ?? '編輯密碼錯誤'); return }

      const s = await fetch('/api/checklist/setup', { method: 'POST' })
      const sd = await s.json()
      if (s.ok && sd.databaseId) { setDbId(sd.databaseId); flash('ok', '資料庫已建立') }
      else if (sd.alreadyConfigured) { flash('ok', '已設定，重新整理即可'); onDone() }
      else flash('err', sd.error ?? '建立失敗')
    } catch {
      flash('err', '建立失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-sm">
      <div className="font-bold text-slate-800 mb-1">第一次使用：建立檢查清單資料庫</div>
      <p className="text-sm text-slate-500 leading-relaxed mb-3">
        系統還沒接上 Notion 資料庫。輸入<b>主站編輯密碼</b>後按下方按鈕，會自動幫你建好資料庫並顯示一組 ID。
      </p>
      {!dbId ? (
        <>
          <input
            type="password" placeholder="輸入主站編輯密碼"
            value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') run() }}
            className="w-full border border-slate-300 rounded-lg px-3 py-3 text-base mb-3"
          />
          <button disabled={!pw || busy} onClick={run}
            className="w-full py-3 rounded-lg bg-[#1a2744] text-white font-bold disabled:opacity-40">
            {busy ? '建立中…' : '建立資料庫'}
          </button>
        </>
      ) : (
        <div className="rounded-lg bg-emerald-50 border border-emerald-300 p-3 text-sm text-emerald-800">
          <div className="font-bold mb-1">✅ 資料庫已建立！接下來請到 Vercel 設定環境變數：</div>
          <div className="font-mono text-xs bg-white border border-emerald-200 rounded p-2 my-2 break-all">
            NOTION_CHECKLIST_DB = {dbId}
          </div>
          <div>再設 <span className="font-mono">CHECKLIST_PINS</span>（各人 PIN），重新部署後即可使用。</div>
        </div>
      )}
    </div>
  )
}

// ── 漏建提醒 ────────────────────────────────────────────────────────────────
function MissingBanner({ missing, onCreate, flash }: {
  missing: { shipmentNo: string; date: string | null }[]
  onCreate: () => void
  flash: (t: 'err' | 'ok', m: string) => void
}) {
  if (missing.length === 0) return null
  async function quickCreate(shipmentNo: string, date: string | null) {
    const res = await fetch('/api/checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipmentNo, deliveryDate: date }),
    })
    const d = await res.json()
    if (res.ok) { flash('ok', `已建立 ${shipmentNo} 的檢查清單`); onCreate() }
    else flash('err', d.error ?? '建立失敗')
  }
  return (
    <div className="rounded-lg bg-red-50 border border-red-300 p-3 mb-4">
      <div className="text-sm font-bold text-red-700 mb-2">
        ⚠ 有 {missing.length} 張出貨單還沒建檢查清單
      </div>
      <div className="flex flex-wrap gap-2">
        {missing.map(m => (
          <button
            key={m.shipmentNo}
            onClick={() => quickCreate(m.shipmentNo, m.date)}
            className="text-xs bg-white border border-red-300 text-red-700 rounded px-2 py-1 hover:bg-red-100"
            title="點一下就幫這張建清單"
          >
            + {m.shipmentNo} <span className="text-red-400">{fmtDate(m.date)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 新增清單 ────────────────────────────────────────────────────────────────
function CreateForm({ onCreated, flash, prefill }: {
  onCreated: () => void
  flash: (t: 'err' | 'ok', m: string) => void
  prefill?: string
}) {
  const [open, setOpen] = useState(false)
  const [shipmentNo, setShipmentNo] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (prefill && !shipmentNo) setShipmentNo(prefill) }, [prefill, shipmentNo])

  async function submit() {
    if (!shipmentNo.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentNo: shipmentNo.trim(), deliveryDate: date || null }),
      })
      const d = await res.json()
      if (res.ok) { flash('ok', `已建立 ${shipmentNo.trim()}`); setShipmentNo(''); setDate(''); setOpen(false); onCreated() }
      else flash('err', d.error ?? '建立失敗')
    } catch {
      flash('err', '建立失敗')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full mb-4 py-2.5 rounded-lg border-2 border-dashed border-slate-300 text-slate-500 text-sm hover:border-[#2563a8] hover:text-[#2563a8]">
        ＋ 新增一張檢查清單（輸入 S 單號）
      </button>
    )
  }
  return (
    <div className="rounded-lg bg-white border border-slate-200 p-3 mb-4 shadow-sm">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          placeholder="出貨單號 例：S2026070801"
          value={shipmentNo} onChange={e => setShipmentNo(e.target.value)}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2.5 text-base"
        />
        <input
          type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2.5 text-base"
          title="配送日期"
        />
      </div>
      <div className="flex gap-2 mt-2">
        <button disabled={busy || !shipmentNo.trim()} onClick={submit}
          className="flex-1 py-2.5 rounded-lg bg-[#1a2744] text-white font-bold disabled:opacity-40">
          {busy ? '建立中…' : '建立'}
        </button>
        <button onClick={() => setOpen(false)} className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-600">取消</button>
      </div>
    </div>
  )
}

// ── 清單列表 ────────────────────────────────────────────────────────────────
function ChecklistList({ items, who, expandedId, setExpandedId, onChanged, flash }: {
  items: Checklist[]
  who: PersonId
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  onChanged: (id: string) => void
  flash: (t: 'err' | 'ok', m: string) => void
}) {
  if (items.length === 0) {
    return <div className="text-center text-slate-400 py-10 text-sm">目前沒有檢查清單。用上方按鈕新增一張。</div>
  }
  return (
    <div className="space-y-3">
      {items.map(item => (
        <ChecklistCard
          key={item.id}
          item={item}
          who={who}
          expanded={expandedId === item.id}
          onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
          onChanged={onChanged}
          flash={flash}
        />
      ))}
    </div>
  )
}

function ChecklistCard({ item, who, expanded, onToggle, onChanged, flash }: {
  item: Checklist
  who: PersonId
  expanded: boolean
  onToggle: () => void
  onChanged: (id: string) => void
  flash: (t: 'err' | 'ok', m: string) => void
}) {
  const state = item.state
  const cur = currentLayerId(state)
  const lit = light(item.deliveryDate)
  const myTurn = isMyTurn(state, who)
  const doneLayers = LAYERS.filter(l => isLayerComplete(state, l.id)).length

  return (
    <div className={`rounded-xl bg-white border shadow-sm overflow-hidden
      ${myTurn ? 'border-[#2563a8] ring-2 ring-[#2563a8]/20' : 'border-slate-200'}`}>
      {/* 卡片頭 */}
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-slate-800 truncate">{item.shipmentNo}</span>
            {myTurn && <span className="text-[10px] bg-[#2563a8] text-white px-1.5 py-0.5 rounded-full whitespace-nowrap">輪到你</span>}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{fmtDate(item.deliveryDate)}</div>
        </div>
        <span className={`text-[11px] px-2 py-1 rounded-full whitespace-nowrap ${lit.color}`}>{lit.label}</span>
        <div className="text-right">
          <div className={`text-xs font-semibold ${item.completed ? 'text-emerald-600' : 'text-slate-600'}`}>
            {item.completed ? '✅ 已完結' : stageLabel(state)}
          </div>
          <div className="text-[10px] text-slate-400">{doneLayers}/{LAST_LAYER_ID} 層完成</div>
        </div>
        <span className="text-slate-300 text-sm">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-3 sm:px-4 py-3 bg-slate-50/50">
          {LAYERS.map(layer => {
            const unlocked = isLayerUnlocked(state, layer.id)
            const complete = isLayerComplete(state, layer.id)
            const active = cur === layer.id
            return (
              <div key={layer.id} className="mb-3 last:mb-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-xs font-bold ${complete ? 'text-emerald-600' : active ? 'text-[#2563a8]' : 'text-slate-400'}`}>
                    {complete ? '✅' : active ? '▶' : unlocked ? '' : '🔒'} {layer.title}
                  </span>
                  <span className="text-[11px] text-slate-400">{layer.who}</span>
                </div>
                <div className="space-y-1">
                  {layer.items.map(it => (
                    <ItemCheckbox
                      key={it.key}
                      checklistId={item.id}
                      baseLastEdited={item.lastEdited}
                      itemKey={it.key}
                      label={it.label}
                      mark={state.checks[it.key]}
                      allowed={canCheck(state, it.key, who)}
                      locked={!unlocked}
                      onChanged={onChanged}
                      flash={flash}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {/* 退回 + 退回紀錄 */}
          <RejectBox checklistId={item.id} baseLastEdited={item.lastEdited} maxLayer={Math.min(cur, LAST_LAYER_ID)} onChanged={onChanged} flash={flash} />
          {state.rejections.length > 0 && (
            <div className="mt-3 border-t border-slate-200 pt-2">
              <div className="text-[11px] font-bold text-slate-500 mb-1">退回紀錄</div>
              {state.rejections.slice().reverse().map((r, i) => (
                <div key={i} className="text-[11px] text-slate-500 leading-relaxed">
                  ↩ {personName(r.by)} 退回到第 {r.toLayer} 層 — {r.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ItemCheckbox({ checklistId, baseLastEdited, itemKey, label, mark, allowed, locked, onChanged, flash }: {
  checklistId: string
  baseLastEdited: string
  itemKey: string
  label: string
  mark?: { checked: boolean; by?: string; proxyFor?: string }
  allowed: { ok: boolean; proxy: boolean; reason?: string }
  locked: boolean
  onChanged: (id: string) => void
  flash: (t: 'err' | 'ok', m: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const checked = mark?.checked === true

  async function toggle() {
    if (busy) return
    if (!checked && !allowed.ok) { flash('err', allowed.reason ?? '無法勾選'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/checklist/${checklistId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', itemKey, checked: !checked, baseLastEdited }),
      })
      const d = await res.json()
      if (res.status === 409) { flash('err', d.error ?? '已被更新，請再點一次'); onChanged(checklistId) }
      else if (!res.ok) flash('err', d.error ?? '操作失敗')
      else onChanged(checklistId)
    } catch {
      flash('err', '操作失敗')
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || (!checked && (locked || !allowed.ok))
  return (
    <button
      onClick={toggle}
      disabled={disabled}
      className={`w-full flex items-start gap-2 text-left px-2.5 py-2 rounded-lg border text-sm transition
        ${checked ? 'bg-emerald-50 border-emerald-300' : locked ? 'bg-slate-100 border-slate-200 opacity-60' : 'bg-white border-slate-200'}
        ${disabled && !checked ? 'cursor-not-allowed' : 'hover:border-[#2563a8]'}`}
    >
      <span className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center text-[10px] flex-shrink-0
        ${checked ? 'bg-emerald-500 text-white' : 'border-2 border-slate-300'}`}>
        {checked ? '✓' : ''}
      </span>
      <span className="flex-1">
        <span className={checked ? 'text-slate-500 line-through' : 'text-slate-700'}>{label}</span>
        {checked && mark?.by && (
          <span className="block text-[10px] text-slate-400">
            {personName(mark.by)}{mark.proxyFor ? `（代 ${personName(mark.proxyFor)}）` : ''}
          </span>
        )}
      </span>
    </button>
  )
}

function RejectBox({ checklistId, baseLastEdited, maxLayer, onChanged, flash }: {
  checklistId: string
  baseLastEdited: string
  maxLayer: number
  onChanged: (id: string) => void
  flash: (t: 'err' | 'ok', m: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [toLayer, setToLayer] = useState(1)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!reason.trim()) { flash('err', '退回一定要寫原因'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/checklist/${checklistId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', toLayer, reason: reason.trim(), baseLastEdited }),
      })
      const d = await res.json()
      if (res.status === 409) { flash('err', d.error ?? '已被更新，請重開此單再退回'); setOpen(false); onChanged(checklistId) }
      else if (!res.ok) flash('err', d.error ?? '退回失敗')
      else { flash('ok', '已退回'); setReason(''); setOpen(false); onChanged(checklistId) }
    } catch {
      flash('err', '退回失敗')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mt-2 text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50">
        ↩ 發現問題，退回
      </button>
    )
  }
  return (
    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
      <div className="text-xs font-bold text-red-700 mb-1.5">退回並說明原因</div>
      <label className="text-[11px] text-slate-600 block mb-1">退回到哪一層</label>
      <select value={toLayer} onChange={e => setToLayer(Number(e.target.value))}
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mb-2 bg-white">
        {LAYERS.filter(l => l.id <= maxLayer).map(l => (
          <option key={l.id} value={l.id}>第 {l.id} 層：{l.title}</option>
        ))}
      </select>
      <textarea
        placeholder="為什麼退回？（例：台中數量不對，應為 10 箱）"
        value={reason} onChange={e => setReason(e.target.value)}
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mb-2 bg-white" rows={2}
      />
      <div className="flex gap-2">
        <button disabled={busy || !reason.trim()} onClick={submit}
          className="flex-1 py-1.5 rounded bg-red-600 text-white text-sm font-bold disabled:opacity-40">
          {busy ? '退回中…' : '確認退回'}
        </button>
        <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded border border-slate-300 text-slate-600 text-sm">取消</button>
      </div>
    </div>
  )
}
