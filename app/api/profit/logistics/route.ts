import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { saveMonthlyLogistics } from '@/lib/notion'

export const dynamic = 'force-dynamic'

// 月度物流費用寫入（三義／優儲當月總額，台幣）。同月份已有紀錄就更新。
function parseFeeField(v: unknown, name: string): number | null | undefined {
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
  const { month, sanyi, yuchu, note } = (body ?? {}) as Record<string, unknown>
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month.trim())) {
    return NextResponse.json({ error: 'month 格式錯誤，應為 YYYY-MM' }, { status: 400 })
  }
  try {
    await saveMonthlyLogistics(month.trim(), {
      sanyi: parseFeeField(sanyi, '三義費用'),
      yuchu: parseFeeField(yuchu, '優儲費用'),
      ...(typeof note === 'string' ? { note: note.trim() } : {}),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[profit/logistics]', err)
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes('必須是') ? 400 : 500
    return NextResponse.json({ error: `寫入失敗：${msg}` }, { status })
  }
}
