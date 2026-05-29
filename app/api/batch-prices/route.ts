import { NextRequest, NextResponse } from 'next/server'
import { getBatchPrices, saveBatchPrices } from '@/lib/notion'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const prices = await getBatchPrices()
    return NextResponse.json({ prices })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch batch prices' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { prices } = await req.json()
    if (!prices || typeof prices !== 'object') {
      return NextResponse.json({ error: 'Invalid prices data' }, { status: 400 })
    }
    await saveBatchPrices(prices)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to save batch prices' }, { status: 500 })
  }
}
