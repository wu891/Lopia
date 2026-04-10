import { NextRequest, NextResponse } from 'next/server'
import { createShipmentRecord } from '@/lib/notion'
import { ParsedEntry } from '@/lib/parseSchedule'

export async function POST(req: NextRequest) {
  try {
    const { entries, batchId } = await req.json() as {
      entries: ParsedEntry[]
      batchId: string
    }

    if (!entries?.length || !batchId) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 })
    }

    // Create one shipment record per entry that has a qty or store
    const toCreate = entries.filter(e => e.store || e.qty)

    await Promise.all(toCreate.map((e, i) =>
      createShipmentRecord({
        shipmentNo: `${e.product}${e.batch}-${e.date}-${String(i+1).padStart(2,'0')}`,
        batchId,
        store: e.store || '未指定',
        date: e.date,
        boxes: e.qty ?? 0,
        remarks: [e.subBatch ? `Sub: ${e.subBatch}` : '', e.note].filter(Boolean).join(' '),
      })
    ))

    return NextResponse.json({ created: toCreate.length })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}
