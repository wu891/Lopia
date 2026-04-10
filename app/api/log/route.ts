import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_API_KEY })
const LOG_DB = process.env.NOTION_CHANGE_LOG_DB!

export async function POST(req: NextRequest) {
  try {
    const { action, target, detail } = await req.json()

    // Get client IP
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip') ??
      '未知'

    await notion.pages.create({
      parent: { database_id: LOG_DB },
      properties: {
        '動作':   { title:     [{ text: { content: String(action  ?? '') } }] },
        '對象':   { rich_text: [{ text: { content: String(target  ?? '') } }] },
        '詳細內容': { rich_text: [{ text: { content: String(detail  ?? '') } }] },
        'IP':     { rich_text: [{ text: { content: String(ip) } }] },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Log write error:', e)
    // Don't fail the user's action just because logging failed
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
