import { NextRequest, NextResponse } from 'next/server'
import { updateFurikomiRecord, deleteFurikomiRecord } from '@/lib/notion'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { id } = await params
    const data = await req.json()
    const record = await updateFurikomiRecord(id, {
      ...(data.originalCost != null ? { originalCost: Number(data.originalCost) } : {}),
      ...('fumigationFee' in data ? { fumigationFee: data.fumigationFee != null ? Number(data.fumigationFee) : null } : {}),
      ...('pesticideFee' in data ? { pesticideFee: data.pesticideFee != null ? Number(data.pesticideFee) : null } : {}),
    })
    return NextResponse.json({ record })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update furikomi record' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { id } = await params
    await deleteFurikomiRecord(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to delete furikomi record' }, { status: 500 })
  }
}
