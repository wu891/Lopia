import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()
    if (!process.env.EDIT_PASSWORD) {
      return NextResponse.json({ ok: false, error: '系統未設定密碼，請聯絡管理員' }, { status: 500 })
    }
    if (password === process.env.EDIT_PASSWORD) {
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: false, error: '密碼錯誤' }, { status: 401 })
  } catch {
    return NextResponse.json({ ok: false, error: '請求錯誤' }, { status: 400 })
  }
}
