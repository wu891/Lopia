import { NextRequest, NextResponse } from 'next/server'
import { getShipments, getShipmentRecords, createShipment } from '@/lib/notion'

export const dynamic = 'force-dynamic' // always fetch fresh from Notion

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    if (!data.ivName?.trim()) {
      return NextResponse.json({ error: 'Missing batch name' }, { status: 400, headers: CORS })
    }
    const shipment = await createShipment(data)
    return NextResponse.json({ shipment }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create shipment' }, { status: 500, headers: CORS })
  }
}

export async function GET() {
  try {
    const [shipments, records] = await Promise.all([getShipments(), getShipmentRecords()])

    // Aggregate shipped boxes per batch
    const shippedMap: Record<string, number> = {}
    for (const r of records) {
      if (r.batchId && r.boxes) {
        shippedMap[r.batchId] = (shippedMap[r.batchId] ?? 0) + r.boxes
      }
    }

    const enriched = shipments.map(s => ({
      ...s,
      shippedBoxes: shippedMap[s.id] ?? 0,
      remainingBoxes: s.totalBoxes != null
        ? Math.max(0, s.totalBoxes - (shippedMap[s.id] ?? 0))
        : null,
    }))

    return NextResponse.json({
      shipments: enriched,
      lastUpdated: new Date().toISOString(),
    }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500, headers: CORS })
  }
}
