import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const batch = form.get('batch') as string
    const docType = form.get('docType') as string

    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const filename = `lopia/${batch}/${docType}/${Date.now()}-${file.name}`
    const blob = await put(filename, file, { access: 'public' })

    return NextResponse.json({ url: blob.url, filename: blob.pathname })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
