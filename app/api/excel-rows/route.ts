import { NextRequest, NextResponse } from 'next/server'
import { getExcelRows, saveExcelRows } from '@/lib/notion'
import { requireAuth } from '@/lib/auth'

export async function GET() {
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
