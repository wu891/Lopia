import { NextRequest, NextResponse } from 'next/server'
import {
  getLogisticsEvents,
  createLogisticsEvent,
  LogisticsEventType,
  DeliveryStatus,
} from '@/lib/notion'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const events = await getLogisticsEvents()
    return NextResponse.json({ events })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch logistics events' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      eventNo, eventType, batchId, store, round,
      releaseDate, pickupLocation, estDelivery,
      actualDelivery, deliveryStatus, remarks,
    } = body

    if (!eventNo || !eventType || !batchId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const event = await createLogisticsEvent({
      eventNo,
      eventType: eventType as LogisticsEventType,
      batchId,
      store,
      round,
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
    return NextResponse.json({ error: 'Failed to create logistics event' }, { status: 500 })
  }
}
