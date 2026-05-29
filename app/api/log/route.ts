import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireAuth, clampLen } from '@/lib/auth'

const notion = new Client({ auth: process.env.NOTION_API_KEY })
const LOG_DB = process.env.NOTION_CHANGE_LOG_DB!

const MAX_FIELD_LEN = 2000 // Notion rich_text 上限是 2000 chars

export async function POST(req: NextRequest) {
  if (!(await requireAuth(['edit', 'portal']))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { action, target, detail } = await req.json()

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip') ??
      '未知'

    await notion.pages.create({
      parent: { database_id: LOG_DB },
      properties: {
        '動作':   { title:     [{ text: { content: clampLen(action, 200) } }] },
        '對象':   { rich_text: [{ text: { content: clampLen(target, 200) } }] },
        '詳細內容': { rich_text: [{ text: { content: clampLen(detail, MAX_FIELD_LEN) } }] },
        'IP':     { rich_text: [{ text: { content: clampLen(ip, 100) } }] },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Log write error:', e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
