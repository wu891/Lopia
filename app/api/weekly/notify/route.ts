import { NextRequest, NextResponse } from 'next/server'
import { getWeeklyRows, weekRange, isWeeklyConfigured } from '@/lib/weekly'
import { pushToGroup, lineNotifyConfigured } from '@/lib/lineNotify'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const CHECKLIST_URL = 'https://lopia-status.vercel.app/checklist'
const WEEKLY_URL = `${CHECKLIST_URL}?tab=weekly`
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'] // 日文星期（TMJ AI 群組訊息一律日文）

function fmtMD(iso: string | null): string {
  if (!iso) return '未定日'
  const d = new Date(iso + 'T00:00:00Z')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY[d.getUTCDay()]})`
}

// 組出週一要推播的訊息文字
async function buildMessage(): Promise<string> {
  const range = weekRange(0)
  const rows = await getWeeklyRows(range)
  const head = `【今週の出荷予定】${fmtMD(range.from)}〜${fmtMD(range.to)}`
  if (rows.length === 0) {
    return `${head}\n\n（今週の出荷予定はまだ登録されていません。川越さん、登録をお願いします）\n\n▶ チェックリスト：${WEEKLY_URL}`
  }
  const lines = rows.map(r => {
    let s = `■ ${fmtMD(r.deliveryDate)} ${r.product}`
    if (r.stores) s += `\n　店舗：${r.stores}`
    if (r.note) s += `\n　数量：${r.note}`
    if (r.checklistCreated) s += `\n　✅ チェックリスト作成済み`
    return s
  })
  return `${head}\n\n${lines.join('\n\n')}\n\n▶ チェックリスト：${WEEKLY_URL}`
}

// 共用：組訊息 → 推播；回傳結果（含訊息文字，方便測試時檢視）
async function run() {
  if (!isWeeklyConfigured()) {
    return { ok: false, reason: '尚未設定 NOTION_WEEKLY_DB', message: null as string | null, pushed: false }
  }
  const message = await buildMessage()
  const pushed = await pushToGroup(message)
  return { ok: true, lineConfigured: lineNotifyConfigured(), pushed, message }
}

// GET：Vercel Cron 觸發（週一 09:00 台灣＝01:00 UTC）。用 CRON_SECRET 驗證。
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await run())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[weekly notify cron]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST：手動測試觸發（需主站編輯密碼）。方便不等週一就先發一則看看格式。
export async function POST() {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: '請先用編輯密碼登入主站' }, { status: 401 })
  }
  try {
    return NextResponse.json(await run())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[weekly notify manual]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
