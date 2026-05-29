import { NextRequest, NextResponse } from 'next/server'
import { getShipments, getShipmentRecords, createShipment } from '@/lib/notion'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic' // always fetch fresh from Notion

export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const data = await req.json()
    if (!data.ivName?.trim()) {
      return NextResponse.json({ error: 'Missing batch name' }, { status: 400 })
    }
    const shipment = await createShipment(data)
    return NextResponse.json({ shipment })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create shipment' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const [shipments, records] = await Promise.all([getShipments(), getShipmentRecords()])

    // Aggregate per batch: planned (non-cancelled) and done (date <= today and non-cancelled)
    const today = new Date().toISOString().slice(0, 10)
    const plannedMap: Record<string, number> = {}
    const doneMap: Record<string, number> = {}
    for (const r of records) {
      if (!r.batchId || !r.boxes) continue
      if (r.planStatus !== '已取消') {
        plannedMap[r.batchId] = (plannedMap[r.batchId] ?? 0) + r.boxes
        if (r.date && r.date <= today) {
          doneMap[r.batchId] = (doneMap[r.batchId] ?? 0) + r.boxes
        }
      }
    }

    const enriched = shipments.map(s => {
      const planned = plannedMap[s.id] ?? 0
      const done = doneMap[s.id] ?? 0
      const total = s.totalBoxes ?? 0
      const allDone = planned > 0 && done >= planned
      const shipped =
        s.deliveryStatus === '全數出貨' ? total :
        allDone ? planned :
        done
      return {
        ...s,
        plannedBoxes: planned,
        shippedBoxes: shipped,
        remainingBoxes: total > 0 ? Math.max(0, total - shipped) : null,
      }
    })

    return NextResponse.json({
      shipments: enriched,
      lastUpdated: new Date().toISOString(),
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
