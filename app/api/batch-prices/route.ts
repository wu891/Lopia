import { NextRequest, NextResponse } from 'next/server'
import { getBatchPrices, saveBatchPrices } from '@/lib/notion'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET() {
  try {
    const prices = await getBatchPrices()
    return NextResponse.json({ prices }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch batch prices' }, { status: 500, headers: CORS })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prices } = await req.json()
    if (!prices || typeof prices !== 'object') {
      return NextResponse.json({ error: 'Invalid prices data' }, { status: 400 })
    }
    await saveBatchPrices(prices)
    return NextResponse.json({ ok: true }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to save batch prices' }, { status: 500, headers: CORS })
  }
}
