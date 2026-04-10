import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { Readable } from 'stream'

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
  try {
    const form    = await req.formData()
    const file    = form.get('file') as File | null
    const batch   = form.get('batch') as string
    const docType = form.get('docType') as string

    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const drive = getDriveClient()
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID!

    // Upload file to Google Shared Drive
    const buffer = Buffer.from(await file.arrayBuffer())
    const uploaded = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `[${docType}] ${file.name}`,
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
