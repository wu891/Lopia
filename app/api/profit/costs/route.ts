import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { updateShipmentCostV2 } from '@/lib/notion'

export const dynamic = 'force-dynamic'

// 批次成本三欄寫入（仕入原價JPY、關稅通關費、雜費）。
// 欄位傳 null = 清空該欄；沒傳的欄不動。
function parseCostField(v: unknown, name: string): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'number' || !isFinite(v) || v < 0) throw new Error(`${name} 必須是 0 以上的數字`)
  return v
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: '需要密碼' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 })
  }
  const { batchId, shiireJpy, tariffCustoms, miscFee } = (body ?? {}) as Record<string, unknown>
  if (typeof batchId !== 'string' || !batchId.trim()) {
    return NextResponse.json({ error: '缺 batchId' }, { status: 400 })
  }
  try {
    await updateShipmentCostV2(batchId.trim(), {
      shiireJpy: parseCostField(shiireJpy, '仕入原價JPY'),
      tariffCustoms: parseCostField(tariffCustoms, '關稅通關費'),
      miscFee: parseCostField(miscFee, '雜費'),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[profit/costs]', err)
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes('必須是') ? 400 : 500
    return NextResponse.json({ error: `寫入失敗：${msg}` }, { status })
  }
}
