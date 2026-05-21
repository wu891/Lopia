import { NextRequest, NextResponse } from 'next/server'
import { getBatchItems, createBatchItem } from '@/lib/notion'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  try {
    const batchId = req.nextUrl.searchParams.get('batchId') ?? undefined
    const items = await getBatchItems(batchId)
    return NextResponse.json({ items }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch batch items' }, { status: 500, headers: CORS })
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    if (!data.batchId || !data.productName) {
      return NextResponse.json({ error: 'Missing batchId or productName' }, { status: 400 })
    }
    const item = await createBatchItem(data)
    return NextResponse.json({ item }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create batch item' }, { status: 500, headers: CORS })
  }
}
