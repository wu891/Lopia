import { NextRequest, NextResponse } from 'next/server'
import { updateBatchItem, deleteBatchItem } from '@/lib/notion'
import { requireAuth } from '@/lib/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { id } = await params
    const data = await req.json()
    const item = await updateBatchItem(id, data)
    return NextResponse.json({ item })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update batch item' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { id } = await params
    await deleteBatchItem(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to delete batch item' }, { status: 500 })
  }
}
