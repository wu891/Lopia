import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()
    if (password === process.env.LOGISTICS_PASSWORD) {
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: false }, { status: 401 })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
