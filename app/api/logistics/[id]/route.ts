import { NextRequest, NextResponse } from 'next/server'
import { updateLogisticsEvent, DeliveryStatus } from '@/lib/notion'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { releaseDate, pickupLocation, estDelivery, actualDelivery, deliveryStatus, remarks } = body

    const event = await updateLogisticsEvent(params.id, {
      releaseDate,
      pickupLocation,
      estDelivery,
      actualDelivery,
      deliveryStatus: deliveryStatus as DeliveryStatus | undefined,
      remarks,
    })
    return NextResponse.json({ event })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update logistics event' }, { status: 500 })
  }
}
