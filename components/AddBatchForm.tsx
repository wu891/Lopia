'use client'
import { useState, useRef } from 'react'
import { Lang } from '@/lib/i18n'
import PasswordModal, { isAuthed, logChange } from './PasswordModal'

interface Props {
  lang: Lang
  onBatchAdded: () => void
}

const DOC_TYPES = ['IV (Invoice)', 'PL (Packing List)', 'AWB', '檢疫證明', '其他']

interface AttachedFile {
  file: File
  docType: string
}

export default function AddBatchForm({ lang, onBatchAdded }: Props) {
  const [open, setOpen]             = useState(false)
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState('')
  const [success, setSuccess]       = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Form fields
  const [ivName, setIvName]                   = useState('')
  const [flightNo, setFlightNo]               = useState('')
  const [awbNo, setAwbNo]                     = useState('')
  const [departJP, setDepartJP]               = useState('')
  const [arrivalTW, setArrivalTW]             = useState('')
  const [totalBoxes, setTotalBoxes]           = useState('')
  const [productSummary, setProductSummary]   = useState('')
  const [remarks, setRemarks]                 = useState('')

  // Attached files
  const [attachedFiles, setAttachedFiles]     = useState<AttachedFile[]>([])
  const [pendingDocType, setPendingDocType]   = useState('')

  function handleFileAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !pendingDocType) return
    setAttachedFiles(prev => [...prev, { file, docType: pendingDocType }])
    setPendingDocType('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function removeFile(idx: number) {
    setAttachedFiles(prev => prev.filter((_, i) => i !== idx))
  }

  function reset() {
    setIvName(''); setFlightNo(''); setAwbNo('')
    setDepartJP(''); setArrivalTW('')
    setTotalBoxes(''); setProductSummary(''); setRemarks('')
    setAttachedFiles([]); setPendingDocType('')
    setSaveError(''); setSuccess(false)
  }

  function cancel() { reset(); setOpen(false) }

  // Called after auth is confirmed (or if already authed)
  async function doSave() {
    setSaving(true); setSaveError('')
    try {
      // 1. Create shipment in Notion
      const res = await fetch('/api/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ivName: ivName.trim(),
          flightNo:       flightNo       || undefined,
          awbNo:          awbNo          || undefined,
          departJP:       departJP       || undefined,
          arrivalTW:      arrivalTW      || undefined,
          totalBoxes:     totalBoxes     ? Number(totalBoxes) : undefined,
          productSummary: productSummary || undefined,
          remarks:        remarks        || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const { shipment } = await res.json()

      // 2. Upload attached files to Google Drive
      const uploadedNames: string[] = []
      for (const af of attachedFiles) {
        const form = new FormData()
        form.append('file', af.file)
        form.append('batch', shipment.id)
        form.append('docType', af.docType)
        const upRes = await fetch('/api/upload', { method: 'POST', body: form })
        if (upRes.ok) uploadedNames.push(`[${af.docType}] ${af.file.name}`)
      }

      // 3. Send Gmail notification
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchName:  ivName.trim(),
          flightNo:   flightNo   || null,
          awbNo:      awbNo      || null,
          departJP:   departJP   || null,
          arrivalTW:  arrivalTW  || null,
          totalBoxes: totalBoxes ? Number(totalBoxes) : null,
          fileNames:  uploadedNames,
        }),
      })

      // 4. Write change log
      await logChange(
        '新增批次',
        ivName.trim(),
        `班機: ${flightNo || '—'}, AWB: ${awbNo || '—'}, 抵台: ${arrivalTW || '—'}, 箱數: ${totalBoxes || '—'}`,
      )

      setSuccess(true)
      onBatchAdded()
      setTimeout(() => { reset(); setOpen(false) }, 1500)
    } catch (e) {
      setSaveError(`${lang === 'ja' ? '保存失敗：' : '儲存失敗：'}${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  function handleSaveClick() {
    if (!ivName.trim()) { setSaveError(lang === 'ja' ? 'バッチ名は必須です' : '請填寫批次名稱'); return }
    if (isAuthed()) {
      doSave()
    } else {
      setShowPassword(true)
    }
  }

  const isJa = lang === 'ja'
  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red bg-white"
  const labelCls = "text-xs text-gray-500 mb-1 block font-medium"

  return (
    <>
      {/* Trigger button — outlined style to reduce red density */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 min-h-[36px] bg-white text-lopia-red text-sm font-semibold rounded-lg border-[1.5px] border-lopia-red hover:bg-lopia-red-light transition-colors cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {isJa ? '新規バッチ登録' : '新增批次'}
      </button>

      {/* Password modal */}
      {showPassword && (
        <PasswordModal
          lang={lang}
          onSuccess={() => { setShowPassword(false); doSave() }}
          onCancel={() => setShowPassword(false)}
        />
      )}

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 pb-8 overflow-y-auto">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/40" onClick={cancel} />

          {/* Panel */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg z-10">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-xl">📦</span>
                <h2 className="font-bold text-gray-800 text-base">
                  {isJa ? '新規バッチ登録' : '新增批次'}
                </h2>
              </div>
              <button onClick={cancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="p-5 space-y-4">
              {success ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <span className="text-4xl">✅</span>
                  <p className="text-green-700 font-semibold">
                    {isJa ? '登録完了！' : '新增成功！'}
                  </p>
                </div>
              ) : (
                <>
                  {/* ── Required ── */}
                  <div>
                    <label className={labelCls}>
                      {isJa ? 'バッチ名（必須）' : '批次名稱（必填）'}
                    </label>
                    <input
                      type="text"
                      value={ivName}
                      onChange={e => setIvName(e.target.value)}
                      placeholder={isJa ? '例: CITY20260402' : '例: CITY20260402'}
                      className={inputCls}
                    />
                  </div>

                  {/* ── Row: flight + AWB ── */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{isJa ? '便名' : '班機號'}</label>
                      <input type="text" value={flightNo} onChange={e => setFlightNo(e.target.value)}
                        placeholder="CI 123" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{isJa ? 'AWB／船便番号' : 'AWB／船次號'}</label>
                      <input type="text" value={awbNo} onChange={e => setAwbNo(e.target.value)}
                        placeholder="123-45678901" className={inputCls} />
                    </div>
                  </div>

                  {/* ── Dates ── */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{isJa ? '日本出発日' : '日本出發日'}</label>
                      <input type="date" value={departJP} onChange={e => setDepartJP(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{isJa ? '台湾着' : '抵台日'}</label>
                      <input type="date" value={arrivalTW} onChange={e => setArrivalTW(e.target.value)} className={inputCls} />
                    </div>
                  </div>

                  {/* ── Boxes + summary ── */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>{isJa ? '総箱数' : '入倉箱數'}</label>
                      <input type="number" min={0} value={totalBoxes} onChange={e => setTotalBoxes(e.target.value)}
                        placeholder="0" className={inputCls} />
                    </div>
                    <div className="col-span-2">
                      <label className={labelCls}>{isJa ? '商品概要' : '商品摘要'}</label>
                      <input type="text" value={productSummary} onChange={e => setProductSummary(e.target.value)}
                        placeholder={isJa ? '例: りんご、みかん...' : '例: 蘋果、橘子...'} className={inputCls} />
                    </div>
                  </div>

                  {/* ── Remarks ── */}
                  <div>
                    <label className={labelCls}>{isJa ? '備考' : '備註'}</label>
                    <input type="text" value={remarks} onChange={e => setRemarks(e.target.value)} className={inputCls} />
                  </div>

                  {/* ── File upload section ── */}
                  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-600">
                      📎 {isJa ? '通関書類（任意）' : '通關文件（選填）'}
                    </p>
                    {attachedFiles.map((af, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-2.5 py-1.5">
                        <span className="text-xs text-gray-400">📄</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-700 truncate font-medium">{af.file.name}</p>
                          <p className="text-xs text-gray-400">{af.docType}</p>
                        </div>
                        <button onClick={() => removeFile(i)} className="text-gray-300 hover:text-red-400 text-sm">×</button>
                      </div>
                    ))}
                    <div className="flex gap-2 items-center">
                      <select
                        value={pendingDocType}
                        onChange={e => setPendingDocType(e.target.value)}
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-lopia-red bg-white"
                      >
                        <option value="">— {isJa ? '種別を選択' : '選文件類型'} —</option>
                        {DOC_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.doc,.docx"
                        className="hidden"
                        onChange={handleFileAdd}
                      />
                      <button
                        onClick={() => pendingDocType && fileRef.current?.click()}
                        disabled={!pendingDocType}
                        className="px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-medium rounded-lg hover:bg-blue-100 disabled:opacity-40 transition-colors whitespace-nowrap"
                      >
                        {isJa ? 'ファイル選択' : '選擇檔案'}
                      </button>
                    </div>
                  </div>

                  {/* Error */}
                  {saveError && (
                    <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                      ⚠ {saveError}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleSaveClick}
                      disabled={saving || !ivName.trim()}
                      className="flex-1 py-2.5 bg-lopia-red text-white text-sm font-semibold rounded-lg hover:bg-lopia-red-dark disabled:opacity-40 transition-colors"
                    >
                      {saving
                        ? (isJa ? '送信中...' : '送出中...')
                        : (isJa ? '登録する' : '確認新增')}
                    </button>
                    <button
                      onClick={cancel}
                      className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      {isJa ? 'キャンセル' : '取消'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
