import { NextRequest, NextResponse } from 'next/server'
import {
  buildAuthCookie, CLEAR_COOKIE, requireAuth,
  safePasswordCompare, isRateLimited, recordAuthFail, clearAuthFails,
} from '@/lib/auth'

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

// GET：回報目前 cookie 是否仍有編輯權（前端用來確認登入狀態）
export async function GET() {
  return NextResponse.json({ ok: await requireAuth('edit') })
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    if (isRateLimited(ip)) {
      return NextResponse.json({ ok: false, error: '嘗試次數過多，請 10 分鐘後再試' }, { status: 429 })
    }
    const { password } = await req.json()
    if (!process.env.EDIT_PASSWORD) {
      return NextResponse.json({ ok: false, error: '系統未設定密碼，請聯絡管理員' }, { status: 500 })
    }
    if (!safePasswordCompare(password, process.env.EDIT_PASSWORD)) {
      recordAuthFail(ip)
      return NextResponse.json({ ok: false, error: '密碼錯誤' }, { status: 401 })
    }
    clearAuthFails(ip)
    const cookie = buildAuthCookie('edit')
    if (!cookie) {
      return NextResponse.json({ ok: false, error: '系統設定錯誤' }, { status: 500 })
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set(cookie.name, cookie.value, cookie.options)
    return res
  } catch {
    return NextResponse.json({ ok: false, error: '請求錯誤' }, { status: 400 })
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(CLEAR_COOKIE.name, CLEAR_COOKIE.value, CLEAR_COOKIE.options)
  return res
}
