import { NextRequest, NextResponse } from 'next/server'
import { getExcelRows, saveExcelRows } from '@/lib/notion'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET() {
  try {
    const rows = await getExcelRows()
    return NextResponse.json({ rows }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ rows: [] }, { status: 500, headers: CORS })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { rows, shipmentNos } = await req.json()

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400, headers: CORS })
    }

    await saveExcelRows(rows, Array.isArray(shipmentNos) ? shipmentNos : [])
    return NextResponse.json({ ok: true, count: rows.length }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to save rows' }, { status: 500, headers: CORS })
  }
}
