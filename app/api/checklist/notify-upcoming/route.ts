import { NextRequest, NextResponse } from 'next/server'
import { runUpcomingReminder } from '@/lib/checklistReminder'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET：Vercel Cron 觸發（每天 09:00 台灣＝01:00 UTC）。用 CRON_SECRET 驗證。
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runUpcomingReminder())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[checklist upcoming reminder cron]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST：手動測試觸發（需主站編輯密碼）。方便不等排程就先發一則看看格式。
export async function POST() {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: '請先用編輯密碼登入主站' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runUpcomingReminder())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[checklist upcoming reminder manual]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
