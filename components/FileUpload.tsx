'use client'
import { useState, useRef } from 'react'
import { Shipment } from '@/lib/notion'
import { Lang, t } from '@/lib/i18n'

const DOC_TYPES = ['IV (Invoice)', 'PL (Packing List)', 'AWB', '檢疫證明', '其他']
const DOC_TYPES_JA = ['IV (Invoice)', 'PL (Packing List)', 'AWB', '検疫証明', 'その他']

interface Props {
  lang: Lang
  shipments: Shipment[]
}

interface UploadedFile {
  name: string
  batch: string
  docType: string
  url: string
  uploadedAt: string
}

export default function FileUpload({ lang, shipments }: Props) {
  const T = t[lang]
  const fileRef = useRef<HTMLInputElement>(null)
  const [batch, setBatch] = useState('')
  const [docType, setDocType] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [error, setError] = useState('')

  const docTypes = lang === 'ja' ? DOC_TYPES_JA : DOC_TYPES

  async function handleUpload() {
    const file = fileRef.current?.files?.[0]
    if (!file || !batch || !docType) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('batch', batch)
      form.append('docType', docType)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      const batchName = shipments.find(s => s.id === batch)?.ivName ?? batch
      setUploadedFiles(prev => [{
        name: file.name,
        batch: batchName,
        docType,
        url: data.url,
        uploadedAt: new Date().toLocaleString(lang === 'ja' ? 'ja-JP' : 'zh-TW'),
      }, ...prev])
      if (fileRef.current) fileRef.current.value = ''
    } catch {
      setError(lang === 'ja' ? 'アップロードに失敗しました' : '上傳失敗，請再試')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <span className="text-lopia-red text-lg">📎</span>
        <h2 className="font-bold text-gray-800">{T.uploadDocs}</h2>
      </div>

      <div className="p-4 space-y-3">
        {/* Batch select */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">{T.selectBatch}</label>
          <select
            value={batch}
            onChange={e => setBatch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
          >
            <option value="">— {T.selectBatch} —</option>
            {shipments.map(s => (
              <option key={s.id} value={s.id}>{s.ivName}</option>
            ))}
          </select>
        </div>

        {/* Doc type */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">{T.selectDocType}</label>
          <select
            value={docType}
            onChange={e => setDocType(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lopia-red"
          >
            <option value="">— {T.selectDocType} —</option>
            {docTypes.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* File input */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">{T.chooseFile}</label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.doc,.docx"
            className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-lopia-red-light file:text-lopia-red file:text-xs file:font-medium hover:file:bg-red-100 cursor-pointer"
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          onClick={handleUpload}
          disabled={!batch || !docType || uploading}
          className="w-full py-2 bg-lopia-red text-white text-sm font-medium rounded-lg hover:bg-lopia-red-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {uploading ? (lang === 'ja' ? 'アップロード中...' : '上傳中...') : T.uploadBtn}
        </button>

        {/* Uploaded files list */}
        {uploadedFiles.length > 0 && (
          <div className="space-y-2 mt-2">
            <p className="text-xs font-medium text-gray-500">{lang === 'ja' ? 'アップロード済み' : '已上傳'}</p>
            {uploadedFiles.map((f, i) => (
              <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group">
                <span className="text-gray-400 text-sm">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{f.name}</p>
                  <p className="text-xs text-gray-400">{f.batch} · {f.docType} · {f.uploadedAt}</p>
                </div>
                <span className="text-xs text-lopia-red opacity-0 group-hover:opacity-100">↗</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
