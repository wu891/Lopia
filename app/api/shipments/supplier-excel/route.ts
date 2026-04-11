import { NextRequest, NextResponse } from 'next/server'
import { updateBatchSupplierExcel } from '@/lib/notion'

export async function POST(req: NextRequest) {
  try {
    const { batchId, fileId } = await req.json()
    if (!batchId || !fileId) {
      return NextResponse.json({ error: 'Missing batchId or fileId' }, { status: 400 })
    }
    await updateBatchSupplierExcel(batchId, fileId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[supplier-excel]', err)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}
