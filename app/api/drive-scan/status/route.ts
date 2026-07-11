/**
 * GET /api/drive-scan/status — 日程總表頁頂部的同步狀態。
 * 只回「最後一次掃描時間」與帳本檔案數（讀取用，不需 token；不外洩檔名內容）。
 */
import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'

export const dynamic = 'force-dynamic'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

export async function GET() {
  try {
    const DB = process.env.NOTION_DRIVE_SCAN_DB?.trim()
    if (!DB) return NextResponse.json({ lastScan: null, fileCount: 0 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await notion.databases.query({
      database_id: DB,
      sorts: [{ property: '最後掃描', direction: 'descending' }],
      page_size: 1,
    })
    const lastScan = res.results[0]?.properties?.['最後掃描']?.date?.start ?? null
    return NextResponse.json({ lastScan })
  } catch (err) {
    console.error('[drive-scan/status]', err)
    return NextResponse.json({ lastScan: null }, { status: 200 })
  }
}
