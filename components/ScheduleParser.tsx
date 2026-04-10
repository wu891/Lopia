'use client'
import { useState } from 'react'
import { parseSchedule, ParsedEntry } from '@/lib/parseSchedule'
import { Shipment } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

const SAMPLE = `りんご9更新スケジュール
全部で5回
3/15、9.1台南MOP＋北門　１５
3/17～20台南MOP毎日配送　１７　１８　１９　２０
3/21-9.1※北門抜き
3/28-9.2
4/4、9.3
4/8、9.4台中漢神納品開始
※漢神
4/10 150箱
4/11 50
4/17、9.5`

interface Props {
  lang: Lang
  shipments: Shipment[]
}

export default function ScheduleParser({ lang, shipments }: Props) {
  const T = t[lang]
  const [text, setText] = useState('')
  const [result, setResult] = useState<ReturnType<typeof parseSchedule> | null>(null)
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState('')

  function handleParse() {
    const r = parseSchedule(text)
    setResult(r)
    setImportDone(false)
  }

  async function handleImport() {
    if (!result || !selectedBatch) return
    setImporting(true)
    try {
      await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: result.entries, batchId: selectedBatch }),
      })
      setImportDone(true)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <span className="text-lopia-red text-lg">📋</span>
        <h2 className="font-bold text-gray-800">{T.scheduleParser}</h2>
      </div>

      <div className="p-4 space-y-3">
        {/* Hint */}
        <p className="text-xs text-gray-400">
          {lang === 'ja'
            ? '平山さんのスケジュールをそのまま貼り付けてください。自動で解析します。'
            : '直接貼上平山先生的出貨排程文字，系統會自動解析。'}
        </p>

        {/* Textarea */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={T.pasteHint}
          rows={8}
          className="w-full border border-gray-200 rounded-lg p-3 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-lopia-red focus:border-transparent"
        />

        <div className="flex gap-2">
          <button
            onClick={() => setText(SAMPLE)}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            {lang === 'ja' ? 'サンプルを使う' : '使用範例文字'}
          </button>
          <button
            onClick={handleParse}
            disabled={!text.trim()}
            className="ml-auto px-4 py-2 bg-lopia-red text-white text-sm font-medium rounded-lg hover:bg-lopia-red-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {T.parseBtn}
          </button>
        </div>

        {/* Parsed result */}
        {result && result.entries.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-800 text-sm">{T.parsedResult}</h3>
                <p className="text-xs text-gray-400">
                  {lang === 'ja'
                    ? `${result.product}${result.batch} — ${result.entries.length}件`
                    : `${result.product}${result.batch} — 共 ${result.entries.length} 筆`}
                </p>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">{T.deliveryDate}</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">{T.productBatch}</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">{T.store}</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">{T.qty}</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">{T.note}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.entries.map((e: ParsedEntry, i: number) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 font-medium text-gray-700">{e.date}</td>
                      <td className="px-3 py-2 text-gray-600">{e.product}{e.batch}{e.subBatch ? `.${e.subBatch.split('.')[1]}` : ''}</td>
                      <td className="px-3 py-2 text-gray-600">{e.store || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{e.qty != null ? `${e.qty}箱` : '—'}</td>
                      <td className="px-3 py-2 text-gray-400">{e.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Import section */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-gray-700">{T.selectBatch}</p>
              <select
                value={selectedBatch}
                onChange={e => setSelectedBatch(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
              >
                <option value="">— {T.selectBatch} —</option>
                {shipments.map(s => (
                  <option key={s.id} value={s.id}>{s.ivName}</option>
                ))}
              </select>
              <button
                onClick={handleImport}
                disabled={!selectedBatch || importing || importDone}
                className="w-full py-2 bg-lopia-red text-white text-sm font-medium rounded-lg hover:bg-lopia-red-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {importDone
                  ? (lang === 'ja' ? '✓ 取込完了' : '✓ 已匯入')
                  : importing
                    ? (lang === 'ja' ? '取込中...' : '匯入中...')
                    : T.importToNotion}
              </button>
            </div>
          </div>
        )}

        {result && result.entries.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">
            {lang === 'ja' ? '解析できるデータがありません' : '無法解析，請確認格式'}
          </p>
        )}
      </div>
    </div>
  )
}
