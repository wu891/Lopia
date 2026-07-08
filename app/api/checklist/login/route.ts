import { NextRequest, NextResponse } from 'next/server'
import { verifyPin, buildWhoCookie, CLEAR_WHO_COOKIE, requireWho, pinsConfigured } from '@/lib/checklistAuth'
import { personName } from '@/lib/checklist'
import { isRateLimited, recordAuthFail, clearAuthFails } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

// GET：回報目前登入者是誰（前端進頁面時確認登入狀態）
export async function GET() {
  const who = await requireWho()
  return NextResponse.json({
    who,
    name: who ? personName(who) : null,
    configured: pinsConfigured(),
  })
}

// POST { person, pin } → 驗 PIN → 設身分 cookie
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    if (isRateLimited(ip)) {
      return NextResponse.json({ ok: false, error: '嘗試次數過多，請 10 分鐘後再試' }, { status: 429 })
    }
    if (!pinsConfigured()) {
      return NextResponse.json({ ok: false, error: '系統尚未設定 PIN，請聯絡管理員' }, { status: 500 })
    }
    const { person, pin } = await req.json()
    const verified = verifyPin(person, pin)
    if (!verified) {
      recordAuthFail(ip)
      return NextResponse.json({ ok: false, error: 'PIN 錯誤或人員不正確' }, { status: 401 })
    }
    clearAuthFails(ip)
    const cookie = buildWhoCookie(verified)
    const res = NextResponse.json({ ok: true, who: verified, name: personName(verified) })
    res.cookies.set(cookie.name, cookie.value, cookie.options)
    return res
  } catch {
    return NextResponse.json({ ok: false, error: '請求錯誤' }, { status: 400 })
  }
}

// DELETE：登出
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(CLEAR_WHO_COOKIE.name, CLEAR_WHO_COOKIE.value, CLEAR_WHO_COOKIE.options)
  return res
}
