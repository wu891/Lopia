import { NextRequest, NextResponse } from 'next/server'
import { updateFurikomiRecord, deleteFurikomiRecord } from '@/lib/notion'

export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const data = await req.json()
    const record = await updateFurikomiRecord(id, {
      ...(data.originalCost != null ? { originalCost: Number(data.originalCost) } : {}),
      ...('fumigationFee' in data ? { fumigationFee: data.fumigationFee != null ? Number(data.fumigationFee) : null } : {}),
      ...('pesticideFee' in data ? { pesticideFee: data.pesticideFee != null ? Number(data.pesticideFee) : null } : {}),
    })
    return NextResponse.json({ record }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update furikomi record' }, { status: 500, headers: CORS })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteFurikomiRecord(id)
    return NextResponse.json({ ok: true }, { headers: CORS })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to delete furikomi record' }, { status: 500, headers: CORS })
  }
}
