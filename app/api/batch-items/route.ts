import { NextRequest, NextResponse } from 'next/server'
import { getBatchItems, createBatchItem } from '@/lib/notion'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const batchId = req.nextUrl.searchParams.get('batchId') ?? undefined
    const items = await getBatchItems(batchId)
    return NextResponse.json({ items })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch batch items' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const data = await req.json()
    if (!data.batchId || !data.productName) {
      return NextResponse.json({ error: 'Missing batchId or productName' }, { status: 400 })
    }
    const item = await createBatchItem(data)
    return NextResponse.json({ item })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create batch item' }, { status: 500 })
  }
}
