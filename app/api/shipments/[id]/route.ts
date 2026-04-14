import { NextRequest, NextResponse } from 'next/server'
import { updateShipmentInspection, updateShipmentDeliveryStatus } from '@/lib/notion'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const body = await req.json()
    const { fumigation, pesticideTest, radiationTest, deliveryStatus } = body

    if (deliveryStatus !== undefined) {
      await updateShipmentDeliveryStatus(id, deliveryStatus)
    }

    await updateShipmentInspection(id, {
      ...(fumigation    !== undefined ? { fumigation }    : {}),
      ...(pesticideTest !== undefined ? { pesticideTest } : {}),
      ...(radiationTest !== undefined ? { radiationTest } : {}),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update shipment' }, { status: 500 })
  }
}
