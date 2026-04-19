import { NextRequest, NextResponse } from 'next/server'
import { getFurikomiRecords, createFurikomiRecord } from '@/lib/notion'

export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get('month') ?? undefined
    const records = await getFurikomiRecords(month)
    return NextResponse.json({ records }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch furikomi records' }, { status: 500, headers: CORS })
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    if (!data.batchId || !data.targetMonth || data.originalCost == null) {
      return NextResponse.json({ error: 'Missing required fields: batchId, targetMonth, originalCost' }, { status: 400, headers: CORS })
    }
    const name = `${data.batchIVName ?? data.batchId}-${data.targetMonth}`
    const record = await createFurikomiRecord({
      name,
      batchId: data.batchId,
      targetMonth: data.targetMonth,
      originalCost: Number(data.originalCost),
      fumigationFee: data.fumigationFee != null ? Number(data.fumigationFee) : undefined,
      pesticideFee: data.pesticideFee != null ? Number(data.pesticideFee) : undefined,
    })
    return NextResponse.json({ record }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create furikomi record' }, { status: 500, headers: CORS })
  }
}
