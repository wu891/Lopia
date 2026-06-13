import { NextRequest, NextResponse } from 'next/server'
import { updateDemandItem, deleteDemandItem } from '@/lib/notion'
import { requireAuth, clampLen } from '@/lib/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { id } = await params
    const data = await req.json()
    const update: Parameters<typeof updateDemandItem>[1] = {}
    if (data.store !== undefined) update.store = data.store
    if (data.product !== undefined) update.product = clampLen(data.product, 2000)
    if (data.quantity !== undefined) update.quantity = clampLen(data.quantity, 2000)
    if (data.needDate !== undefined) update.needDate = data.needDate || null
    if (data.status !== undefined) update.status = data.status
    if (data.note !== undefined) update.note = clampLen(data.note, 2000)

    const item = await updateDemandItem(id, update)
    return NextResponse.json({ item })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update demand item' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { id } = await params
    await deleteDemandItem(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to delete demand item' }, { status: 500 })
  }
}
