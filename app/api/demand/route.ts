import { NextRequest, NextResponse } from 'next/server'
import { getDemandItems, createDemandItem } from '@/lib/notion'
import { requireAuth, clampLen } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await getDemandItems()
    return NextResponse.json({ items })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch demand items' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const data = await req.json()
    const item = await createDemandItem({
      store: data.store,
      product: clampLen(data.product ?? '', 2000),
      quantity: clampLen(data.quantity ?? '', 2000),
      needDate: data.needDate || null,
      status: data.status || '待處理',
      note: clampLen(data.note ?? '', 2000),
      source: clampLen(data.source ?? '手動', 50),
    })
    return NextResponse.json({ item })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create demand item' }, { status: 500 })
  }
}
