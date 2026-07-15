import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { computeMonthlyMargin } from '@/lib/monthlyMargin/computeMonthlyMargin'

export const dynamic = 'force-dynamic' // 永遠現場重算，不快取

// 整頁都要密碼才能看（比 /margin 更嚴格——這裡有進貨成本、供應商金額）
export async function GET(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: '需要密碼' }, { status: 401 })
  }

  const monthParam = req.nextUrl.searchParams.get('month') // 格式 YYYY-MM
  const m = monthParam?.match(/^(\d{4})-(\d{1,2})$/)
  const now = new Date()
  // 沒帶月份參數就預設「上個月」
  const defaultDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const year = m ? Number(m[1]) : defaultDate.getUTCFullYear()
  const month = m ? Number(m[2]) : defaultDate.getUTCMonth() + 1
  if (month < 1 || month > 12) {
    return NextResponse.json({ error: 'month 參數格式錯誤，應為 YYYY-MM' }, { status: 400 })
  }

  try {
    const result = await computeMonthlyMargin(year, month)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[monthly-margin]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `計算失敗：${msg}` }, { status: 500 })
  }
}
