import { NextRequest, NextResponse } from 'next/server'
import { saveDeliveryHistory } from '@/lib/deliveryHistoryNotion'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const data = await req.json()
    await saveDeliveryHistory(data)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[delivery-history]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
