import { NextRequest, NextResponse } from 'next/server'
import { getExcelRows, saveExcelRows } from '@/lib/notion'
import { requireAuth } from '@/lib/auth'
import { canSeeMoney } from '@/lib/apiToken'

// 寫 Notion 要逐筆建立多列，拉高函式逾時上限（前端已改成「一張單一批」依序送，單批通常 < 45 列）
export const maxDuration = 60

// GET：每一張出貨單每一行的單價與金額 → 2026-09-13 起要編輯密碼或通行碼（之前任何人打開網址就看得到）
export async function GET(req: NextRequest) {
  if (!(await canSeeMoney(req))) {
    return NextResponse.json({ error: '需要密碼或 Bearer token' }, { status: 401 })
  }
  try {
    const rows = await getExcelRows()
    return NextResponse.json({ rows })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ rows: [] }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { rows, shipmentNos } = await req.json()

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
    }

    await saveExcelRows(rows, Array.isArray(shipmentNos) ? shipmentNos : [])
    return NextResponse.json({ ok: true, count: rows.length })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to save rows' }, { status: 500 })
  }
}
