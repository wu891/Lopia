import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { Readable } from 'stream'
import { requireAuth, sanitizeFilenamePart } from '@/lib/auth'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB

const ALLOWED_DOC_TYPES = new Set([
  'IV', 'PL', 'AWB', '檢疫證明', '通關文件', '供應商配送', '出貨單', '其他',
])

function getDriveClient() {
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    const auth = new google.auth.GoogleAuth({
          credentials: {
                  client_email: process.env.GOOGLE_CLIENT_EMAIL,
                  private_key: privateKey,
          },
          scopes: ['https://www.googleapis.com/auth/drive.file'],
    })
    return google.drive({ version: 'v3', auth })
}

export async function POST(req: NextRequest) {
    if (!(await requireAuth(['edit', 'portal']))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    try {
          const form    = await req.formData()
          const file    = form.get('file') as File | null
          const batchRaw   = form.get('batch') as string | null
          const docTypeRaw = form.get('docType') as string | null

      if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

      // Size check (defence in depth — Vercel also enforces a body-size limit)
      if (file.size > MAX_UPLOAD_BYTES) {
              return NextResponse.json({ error: 'File too large' }, { status: 413 })
      }

      const docType = docTypeRaw && ALLOWED_DOC_TYPES.has(docTypeRaw) ? docTypeRaw : '其他'
      const batch = sanitizeFilenamePart(batchRaw, 60)
      const safeOriginalName = sanitizeFilenamePart(file.name, 80) || 'file'

      // 供應商配送 Excel 不上傳到 Drive
      if (docType === '供應商配送') {
              return NextResponse.json({ ok: true, fileId: '', url: '' })
      }

      const drive = getDriveClient()
          const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID!

      // Upload file to Google Shared Drive
      const buffer = Buffer.from(await file.arrayBuffer())
          const uploaded = await drive.files.create({
                  supportsAllDrives: true,
                  requestBody: {
                            name: `[${docType}] ${safeOriginalName}`,
                            parents: [folderId],
                            description: `Batch: ${batch} | Type: ${docType}`,
                  },
                  media: {
                            mimeType: file.type || 'application/octet-stream',
                            body: Readable.from(buffer),
                  },
                  fields: 'id,name,webViewLink',
          })

      const fileId = uploaded.data.id!

      // Make file publicly readable (anyone with link)
      await drive.permissions.create({
              fileId,
              supportsAllDrives: true,
              requestBody: { role: 'reader', type: 'anyone' },
      })

      const url = `https://drive.google.com/file/d/${fileId}/view`

      return NextResponse.json({ url, fileId, filename: uploaded.data.name })
    } catch (err) {
          console.error('[upload]', err)
          return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }
}
