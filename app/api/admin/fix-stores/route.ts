// ONE-TIME migration: rename "北蛋" → "台北大巨蛋店" across all shipment records
// Protected by EDIT_PASSWORD. Delete this file after use.
import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'

export const dynamic = 'force-dynamic'

const CORRECTIONS: Record<string, string> = {
  '北蛋': '台北大巨蛋店',
}

export async function POST(req: NextRequest) {
  // Simple auth guard
  const { password } = await req.json().catch(() => ({ password: '' }))
  if (password !== process.env.EDIT_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const notion = new Client({ auth: process.env.NOTION_API_KEY })
  const DB_ID = process.env.NOTION_SHIPMENT_RECORDS_DB!

  const fixed: { id: string; title: string; old: string; new: string }[] = []
  let cursor: string | undefined

  do {
    const res = await notion.databases.query({
      database_id: DB_ID,
      start_cursor: cursor,
      page_size: 100,
    })

    for (const page of res.results as Parameters<typeof notion.pages.update>[0]['properties'] extends never ? never : any[]) {
      const store = page.properties['出貨門市']?.select?.name as string | undefined
      if (store && CORRECTIONS[store]) {
        await notion.pages.update({
          page_id: page.id,
          properties: {
            '出貨門市': { select: { name: CORRECTIONS[store] } },
          },
        })
        fixed.push({
          id: page.id,
          title: page.properties['出貨單號']?.title?.[0]?.plain_text ?? page.id,
          old: store,
          new: CORRECTIONS[store],
        })
      }
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)

  return NextResponse.json({ fixed, count: fixed.length })
}
