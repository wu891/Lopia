import { NextRequest, NextResponse } from 'next/server'
import { createShipmentRecord, getShipmentRecords } from '@/lib/notion'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET() {
  try {
    const records = await getShipmentRecords()
    return NextResponse.json({ records }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch records' }, { status: 500, headers: CORS })
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const { batchId, store, date, boxes, round, planStatus, remarks } = data

    if (!batchId || !store || !date || boxes == null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const roundNum = round ?? 1
    const shipmentNo = `${batchId.slice(0, 8)}-R${String(roundNum).padStart(2, '0')}-${Date.now().toString(36).toUpperCase()}`

    const record = await createShipmentRecord({
      shipmentNo,
      batchId,
      store,
      date,
      boxes: Number(boxes),
      round: roundNum,
      planStatus: planStatus ?? '計畫中',
      remarks,
    })

    return NextResponse.json({ record })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })
  }
}
