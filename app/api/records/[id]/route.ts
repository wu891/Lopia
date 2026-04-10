import { NextRequest, NextResponse } from 'next/server'
import { updateShipmentRecord, deleteShipmentRecord } from '@/lib/notion'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const data = await req.json()
    const record = await updateShipmentRecord(id, data)
    return NextResponse.json({ record })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteShipmentRecord(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 })
  }
}
