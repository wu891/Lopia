'use client'
import { useRef, useState } from 'react'
import { ShipmentRecord } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'
import { STORES } from '@/lib/stores'
import { parseDeliveryExcel, ParsedDeliveryRound } from '@/lib/parseDeliveryExcel'

interface Props {
  batchId: string
  totalBoxes: number | null
  records: ShipmentRecord[]
  lang: Lang
  onRecordChange: () => void
}

interface StoreEntry { name: string; boxes: string }
interface RoundEntry { date: string; stores: StoreEntry[] }
interface EditRound  { roundNo: number; date: string; stores: StoreEntry[]; existingIds: string[] }

function emptyRound(): RoundEntry { return { date: '', stores: [] } }

interface RoundGroup {
  roundNo: number
  date: string | null
  stores: { name: string; boxes: number }[]
  totalBoxes: number
  ids: string[]
}

function groupByRound(records: ShipmentRecord[]): RoundGroup[] {
  const map = new Map<number, RoundGroup>()
  for (const r of records) {
    const key = r.round ?? 0
    if (!map.has(key)) map.set(key, { roundNo: key, date: r.date ?? null, stores: [], totalBoxes: 0, ids: [] })
    const g = map.get(key)!
    g.stores.push({ name: r.store ?? '', boxes: r.boxes ?? 0 })
    g.totalBoxes += r.boxes ?? 0
    g.ids.push(r.id)
  }
  return Array.from(map.values()).sort((a, b) => a.roundNo - b.roundNo)
}

export default function DeliveryPlan({ batchId, totalBoxes, records, lang, onRecordChange }: Props) {
  const T = t[lang]
  const fileRef = useRef<HTMLInputElement>(null)

  const [showForm, setShowForm]       = useState(false)
  const [editRound, setEditRound]     = useState<EditRound | null>(null)
  const [rounds, setRounds]           = useState<RoundEntry[]>(() => [emptyRound(), emptyRound(), emptyRound(), emptyRound()])
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState('')
  const [deletingRound, setDeletingRound] = useState<number | null>(null)
  // Which round row is expanded in the table
  const [expandedRound, setExpandedRound] = useState<number | null>(null)

  // Excel
  const [xlsParsing, setXlsParsing]   = useState(false)
  const [xlsResult, setXlsResult]     = useState<ParsedDeliveryRound[] | null>(null)
  const [xlsFileName, setXlsFileName] = useState('')
  const [xlsError, setXlsError]       = useState('')

  const batchRecords = records.filter(r => r.batchId === batchId).sort((a, b) => (a.round ?? 99) - (b.round ?? 99))
  const roundGroups  = groupByRound(batchRecords)
  const plannedTotal = batchRecords.reduce((s, r) => s + (r.boxes ?? 0), 0)
  const validationOk = totalBoxes != null && plannedTotal === totalBoxes

  const nextRoundNo  = roundGroups.length > 0 ? Math.max(...roundGroups.map(g => g.roundNo)) + 1 : 1
  const openStores   = STORES.filter(s => s.status === 'open')
  const sName        = (s: typeof STORES[0]) => lang === 'ja' ? s.name_ja : s.name_zh

  // ── Pre-save form summary (computed live from rounds state) ──
  const formStoreTotals: Record<string, { boxes: number; rounds: number }> = {}
  for (const r of rounds) {
    for (const s of r.stores) {
      const n = Number(s.boxes)
      if (n > 0) {
        if (!formStoreTotals[s.name]) formStoreTotals[s.name] = { boxes: 0, rounds: 0 }
        formStoreTotals[s.name].boxes  += n
        formStoreTotals[s.name].rounds += 1
      }
    }
  }
  const formTotal    = Object.values(formStoreTotals).reduce((a, b) => a + b.boxes, 0)
  const hasSummary   = formTotal > 0
  const formMatchOk  = totalBoxes != null && formTotal === totalBoxes
  const formMatchWarn= totalBoxes != null && formTotal > 0 && formTotal !== totalBoxes

  // ── Excel ────────────────────────────────────────────
  async function handleExcelFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setXlsError(''); setXlsResult(null); setXlsParsing(true); setXlsFileName(file.name)
    try {
      const parsed = await parseDeliveryExcel(await file.arrayBuffer())
      if (!parsed.length) { setXlsError(lang === 'ja' ? '回次データが見つかりません' : '找不到回次資料，請確認格式'); return }
      setXlsResult(parsed)
      setRounds(parsed.map(p => ({ date: '', stores: p.stores.map(s => ({ name: s.name, boxes: String(s.boxes) })) })))
    } catch { setXlsError(lang === 'ja' ? '解析に失敗しました' : '解析失敗，請確認檔案格式')
    } finally { setXlsParsing(false); if (fileRef.current) fileRef.current.value = '' }
  }

  function clearExcel() { setXlsResult(null); setXlsFileName(''); setXlsError(''); setRounds([emptyRound(), emptyRound(), emptyRound(), emptyRound()]) }

  // ── Add form helpers ─────────────────────────────────
  function startAdd() { setEditRound(null); clearExcel(); setShowForm(true) }
  function addRoundRow() { setRounds(prev => [...prev, emptyRound()]) }
  function updateRoundDate(idx: number, date: string) { setRounds(prev => prev.map((r, i) => i === idx ? { ...r, date } : r)) }
  function toggleRoundStore(idx: number, name: string) {
    setRounds(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const exists = r.stores.find(s => s.name === name)
      return { ...r, stores: exists ? r.stores.filter(s => s.name !== name) : [...r.stores, { name, boxes: '' }] }
    }))
  }
  function updateRoundStoreBoxes(idx: number, name: string, boxes: string) {
    setRounds(prev => prev.map((r, i) => i !== idx ? r : { ...r, stores: r.stores.map(s => s.name === name ? { ...s, boxes } : s) }))
  }

  // ── Edit helpers ─────────────────────────────────────
  function startEdit(group: RoundGroup) {
    setEditRound({ roundNo: group.roundNo, date: group.date ?? '', stores: group.stores.map(s => ({ name: s.name, boxes: String(s.boxes) })), existingIds: group.ids })
    setShowForm(true)
  }
  function toggleEditStore(name: string) {
    setEditRound(f => { if (!f) return f; const exists = f.stores.find(s => s.name === name); return { ...f, stores: exists ? f.stores.filter(s => s.name !== name) : [...f.stores, { name, boxes: '' }] } })
  }
  function updateEditStoreBoxes(name: string, boxes: string) {
    setEditRound(f => f ? { ...f, stores: f.stores.map(s => s.name === name ? { ...s, boxes } : s) } : f)
  }

  // ── Save ─────────────────────────────────────────────
  async function handleSave() {
    setSaving(true); setSaveError('')
    try {
      if (editRound) {
        await Promise.all(editRound.existingIds.map(id => fetch(`/api/records/${id}`, { method: 'DELETE' })))
        const res = await Promise.all(
          editRound.stores.filter(s => s.boxes && Number(s.boxes) > 0).map(s =>
            fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batchId, store: s.name, date: editRound.date, boxes: Number(s.boxes), round: editRound.roundNo }) })
          )
        )
        const err = (await Promise.all(res.map(async r => r.ok ? null : (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`))).find(Boolean)
        if (err) { setSaveError(`儲存失敗：${err}`); return }
      } else {
        const valid = rounds.filter(r => r.date && r.stores.some(s => s.boxes && Number(s.boxes) > 0))
        if (!valid.length) return
        let offset = 0
        for (const r of valid) {
          const res = await Promise.all(
            r.stores.filter(s => s.boxes && Number(s.boxes) > 0).map(s =>
              fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ batchId, store: s.name, date: r.date, boxes: Number(s.boxes), round: nextRoundNo + offset }) })
            )
          )
          const err = (await Promise.all(res.map(async r => r.ok ? null : (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`))).find(Boolean)
          if (err) { setSaveError(`第 ${nextRoundNo + offset} 次儲存失敗：${err}`); return }
          offset++
        }
      }
      cancelForm(); onRecordChange()
    } catch (e) { setSaveError(`網路錯誤：${e instanceof Error ? e.message : String(e)}`)
    } finally { setSaving(false) }
  }

  async function handleDeleteRound(group: RoundGroup) {
    if (!confirm(T.confirmDelete)) return
    setDeletingRound(group.roundNo)
    try { await Promise.all(group.ids.map(id => fetch(`/api/records/${id}`, { method: 'DELETE' }))); onRecordChange()
    } finally { setDeletingRound(null) }
  }

  function cancelForm() { setShowForm(false); setEditRound(null); setSaveError(''); clearExcel() }

  const addSaveDisabled  = saving || rounds.every(r => !r.date || !r.stores.some(s => s.boxes && Number(s.boxes) > 0))
  const editSaveDisabled = saving || !editRound?.date || !editRound?.stores.some(s => s.boxes && Number(s.boxes) > 0)

  // ── Store checklist ──────────────────────────────────
  function StoreChecklist({ selectedStores, onToggle, onBoxesChange }: {
    selectedStores: StoreEntry[]; onToggle: (n: string) => void; onBoxesChange: (n: string, b: string) => void
  }) {
    const sel = new Map(selectedStores.map(s => [s.name, s.boxes]))
    return (
      <div>
        <label className="text-xs text-gray-400 block mb-1.5">{T.store}</label>
        <div className="space-y-1.5">
          {openStores.map(s => {
            const name = sName(s); const checked = sel.has(name); const boxes = sel.get(name) ?? ''
            return (
              <div key={s.id} className="flex items-center gap-2 min-h-[24px]">
                <label className="flex items-center gap-1.5 cursor-pointer flex-1 min-w-0">
                  <input type="checkbox" checked={checked} onChange={() => onToggle(name)} className="w-3.5 h-3.5 rounded accent-lopia-red flex-shrink-0" />
                  <span className={`text-xs leading-tight truncate transition-colors ${checked ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{name}</span>
                </label>
                {checked && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input type="number" min={0} placeholder="0" value={boxes} onChange={e => onBoxesChange(name, e.target.value)}
                      className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-lopia-red" />
                    <span className="text-xs text-gray-400">{T.boxes}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Pre-save summary panel ───────────────────────────
  function FormSummary() {
    if (!hasSummary) return null
    const entries = Object.entries(formStoreTotals).sort((a, b) => b[1].boxes - a[1].boxes)
    return (
      <div className={`rounded-xl border p-3 space-y-2 ${
        formMatchOk   ? 'bg-green-50 border-green-200' :
        formMatchWarn ? 'bg-yellow-50 border-yellow-200' :
                        'bg-gray-50 border-gray-200'
      }`}>
        <p className="text-xs font-semibold text-gray-600">
          📦 {lang === 'ja' ? '入力済み合計' : '本次輸入總計'}
        </p>
        <div className="space-y-1">
          {entries.map(([name, { boxes, rounds: rCount }]) => (
            <div key={name} className="flex items-center justify-between text-xs">
              <span className="text-gray-600 truncate flex-1">{name}</span>
              <span className="text-gray-400 mx-2 flex-shrink-0">
                {rCount}{lang === 'ja' ? '回' : '輪'}
              </span>
              <span className="font-semibold text-gray-700 flex-shrink-0">{boxes}{T.boxes}</span>
            </div>
          ))}
        </div>
        <div className={`flex items-center justify-between pt-1.5 border-t text-xs font-semibold ${
          formMatchOk   ? 'border-green-200 text-green-700' :
          formMatchWarn ? 'border-yellow-200 text-yellow-700' :
                          'border-gray-200 text-gray-700'
        }`}>
          <span>{lang === 'ja' ? '合計' : '合計'}</span>
          <span className="flex items-center gap-1.5">
            {formMatchOk   && <span>✅</span>}
            {formMatchWarn && <span>⚠️</span>}
            {formTotal}{T.boxes}
            {totalBoxes != null && (
              <span className="font-normal text-gray-400">/ {totalBoxes}{T.boxes}</span>
            )}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 font-medium">{T.deliveryPlan}</p>
        <button onClick={startAdd} className="text-xs px-2 py-1 bg-lopia-red-light text-lopia-red rounded-lg hover:bg-red-100 font-medium transition-colors">
          + {T.addRound}
        </button>
      </div>

      {/* Validation badge */}
      {totalBoxes != null && (
        <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs ${
          roundGroups.length === 0 ? 'bg-gray-50 text-gray-400' : validationOk ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
        }`}>
          <span>{roundGroups.length === 0 ? T.planValidEmpty : validationOk ? T.planValidOk : T.planValidWarn}</span>
          {roundGroups.length > 0 && <span className="ml-auto text-xs opacity-70">{T.plannedBoxes}: {plannedTotal} / {totalBoxes} {T.boxes}</span>}
        </div>
      )}

      {/* ── Rounds table (collapsible) ── */}
      {roundGroups.length > 0 && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          {roundGroups.map((g, i) => {
            const isExpanded = expandedRound === g.roundNo
            return (
              <div key={g.roundNo} className={i > 0 ? 'border-t border-gray-100' : ''}>
                {/* Row header — click to expand */}
                <div
                  className={`flex items-center gap-2 px-2 py-2 cursor-pointer select-none transition-colors ${
                    isExpanded ? 'bg-red-50' : i % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/50 hover:bg-gray-100/50'
                  }`}
                  onClick={() => setExpandedRound(isExpanded ? null : g.roundNo)}
                >
                  {/* Chevron */}
                  <span className={`text-gray-400 text-xs transition-transform duration-150 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>

                  <span className="text-gray-500 font-medium text-xs whitespace-nowrap flex-shrink-0">
                    {T.roundNo}{g.roundNo}{T.roundSuffix}
                  </span>
                  <span className="text-gray-700 font-medium text-xs whitespace-nowrap flex-shrink-0">
                    {g.date ? new Date(g.date).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'zh-TW', { month: 'numeric', day: 'numeric' }) : '—'}
                  </span>

                  {/* Store chips (collapsed preview) */}
                  {!isExpanded && (
                    <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                      {g.stores.slice(0, 3).map(s => (
                        <span key={s.name} className="px-1.5 py-0.5 bg-red-50 text-lopia-red rounded text-xs leading-tight whitespace-nowrap">
                          {s.name} <span className="font-semibold">{s.boxes}{T.boxes}</span>
                        </span>
                      ))}
                      {g.stores.length > 3 && (
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs leading-tight">+{g.stores.length - 3}</span>
                      )}
                    </div>
                  )}
                  {isExpanded && <div className="flex-1" />}

                  <span className="text-gray-700 font-semibold text-xs whitespace-nowrap flex-shrink-0 ml-auto">
                    {g.totalBoxes}{T.boxes}
                  </span>
                  <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => startEdit(g)} className="text-gray-400 hover:text-lopia-red transition-colors text-xs">✏</button>
                    <button onClick={() => handleDeleteRound(g)} disabled={deletingRound === g.roundNo} className="text-gray-400 hover:text-red-500 transition-colors text-xs">
                      {deletingRound === g.roundNo ? '…' : '✕'}
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="bg-white border-t border-red-100 px-4 py-2.5 space-y-1.5">
                    {g.stores.map(s => (
                      <div key={s.name} className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">{s.name}</span>
                        <span className="font-semibold text-gray-800">{s.boxes}{T.boxes}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-gray-100 font-semibold text-gray-700">
                      <span>{lang === 'ja' ? '小計' : '小計'}</span>
                      <span>{g.totalBoxes}{T.boxes}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Footer total */}
          {roundGroups.length > 1 && (
            <div className="flex items-center justify-between px-2 py-1.5 bg-gray-50 border-t border-gray-200 text-xs">
              <span className="text-gray-400">{lang === 'ja' ? '全体合計' : '全部合計'} {roundGroups.length}{lang === 'ja' ? '回' : '輪'}</span>
              <span className="font-semibold text-gray-700">{plannedTotal}{T.boxes}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Form panel ── */}
      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-3">

          {/* Edit single round */}
          {editRound ? (
            <>
              <p className="text-xs font-semibold text-gray-700">{T.editRound}</p>
              <div className="border border-gray-200 rounded-lg bg-white p-2.5 space-y-2.5">
                <p className="text-xs font-semibold text-lopia-red">{T.roundNo}{editRound.roundNo}{T.roundSuffix}</p>
                <div>
                  <label className="text-xs text-gray-400 block mb-0.5">{T.deliveryDate}</label>
                  <input type="date" value={editRound.date} onChange={e => setEditRound(f => f ? { ...f, date: e.target.value } : f)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red" />
                </div>
                <StoreChecklist selectedStores={editRound.stores} onToggle={toggleEditStore} onBoxesChange={updateEditStoreBoxes} />
              </div>
            </>
          ) : (
            /* Add multiple rounds */
            <>
              {/* Excel bar */}
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-gray-700 flex-1">{T.addRound}</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelFile} />
                {xlsResult ? (
                  <div className="flex items-center gap-1.5">
                    <span className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded-lg text-xs font-medium">
                      ✓ {xlsResult.length}{lang === 'ja' ? '回次' : '個輪次'}
                    </span>
                    <button onClick={clearExcel} className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 transition-colors">
                      {lang === 'ja' ? '消去' : '清除'}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => fileRef.current?.click()} disabled={xlsParsing}
                    className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium transition-colors disabled:opacity-50">
                    {xlsParsing ? <><span className="animate-spin inline-block">⟳</span> {lang === 'ja' ? '解析中' : '解析中'}</> : <>📊 {lang === 'ja' ? 'Excel 読込' : 'Excel 帶入'}</>}
                  </button>
                )}
              </div>

              {xlsError && <p className="text-xs text-red-500 bg-red-50 px-2.5 py-1.5 rounded-lg">⚠ {xlsError}</p>}

              {xlsResult && xlsFileName && (
                <div className="px-2.5 py-1.5 bg-blue-50 border border-blue-100 rounded-lg">
                  <p className="text-xs text-blue-700 font-medium truncate">📊 {xlsFileName}</p>
                  <p className="text-xs text-blue-500 mt-0.5">
                    {xlsResult.length}{lang === 'ja' ? '回次' : '個輪次'} ／ {xlsResult.reduce((n, r) => n + r.stores.length, 0)}{lang === 'ja' ? '店舗分' : '間門市'}
                    {lang === 'ja' ? '読み込み完了 — 日付を入力してください' : '已帶入 — 請填寫各輪次出貨日期'}
                  </p>
                </div>
              )}

              {/* Round cards */}
              <div className="space-y-2.5">
                {rounds.map((round, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg bg-white p-2.5 space-y-2.5">
                    <p className="text-xs font-semibold text-lopia-red">{T.roundNo}{nextRoundNo + idx}{T.roundSuffix}</p>
                    <div>
                      <label className="text-xs text-gray-400 block mb-0.5">{T.deliveryDate}</label>
                      <input type="date" value={round.date} onChange={e => updateRoundDate(idx, e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red" />
                    </div>
                    <StoreChecklist selectedStores={round.stores}
                      onToggle={name => toggleRoundStore(idx, name)}
                      onBoxesChange={(name, boxes) => updateRoundStoreBoxes(idx, name, boxes)} />
                  </div>
                ))}
                <button onClick={addRoundRow}
                  className="w-full py-1.5 border border-dashed border-gray-300 rounded-lg text-xs text-gray-400 hover:border-lopia-red hover:text-lopia-red transition-colors">
                  + {lang === 'ja' ? '配送回を追加' : '增加輪次'}
                </button>
              </div>

              {/* ── Pre-save summary ── */}
              <FormSummary />
            </>
          )}

          {/* Save error */}
          {saveError && (
            <div className="px-2.5 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 font-medium">⚠ {saveError}</div>
          )}

          {/* Save / Cancel */}
          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} disabled={editRound ? editSaveDisabled : addSaveDisabled}
              className="flex-1 py-1.5 bg-lopia-red text-white text-xs font-medium rounded-lg hover:bg-lopia-red-dark disabled:opacity-40 transition-colors">
              {saving ? '...' : T.saveRound}
            </button>
            <button onClick={cancelForm} className="px-3 py-1.5 bg-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-300 transition-colors">
              {T.cancelEdit}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
