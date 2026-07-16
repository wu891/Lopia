import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { saveMarginMatch } from '@/lib/notion'

export const dynamic = 'force-dynamic'

// 月結毛利「待指定」選單選了批次後，直接寫進 Notion「月結毛利批次配對」，
// 不寫回現金流表（2026-07 決策：現金流表出荷票欄格式常年混亂，改存這裡）。
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
  const { sNo, invoice, note } = (body ?? {}) as { sNo?: unknown; invoice?: unknown; note?: unknown }
  if (typeof sNo !== 'string' || !sNo.trim() || typeof invoice !== 'string' || !invoice.trim()) {
    return NextResponse.json({ error: '缺 sNo 或 invoice' }, { status: 400 })
  }

  try {
    await saveMarginMatch(sNo.trim(), invoice.trim(), typeof note === 'string' ? note.trim() : undefined)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[monthly-margin/match]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `寫入失敗：${msg}` }, { status: 500 })
  }
}
