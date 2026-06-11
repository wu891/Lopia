import { NextRequest, NextResponse } from 'next/server'
import { buildAuthCookie, CLEAR_COOKIE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()
    if (!process.env.EDIT_PASSWORD) {
      return NextResponse.json({ ok: false, error: '系統未設定密碼，請聯絡管理員' }, { status: 500 })
    }
    if (password !== process.env.EDIT_PASSWORD) {
      return NextResponse.json({ ok: false, error: '密碼錯誤' }, { status: 401 })
    }
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
