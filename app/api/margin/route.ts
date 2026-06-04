import { NextResponse } from 'next/server'
import { getShipments, getShipmentRecords, getFurikomiRecords } from '@/lib/notion'
import { computeAllMargins } from '@/lib/margin'

export const dynamic = 'force-dynamic' // 永遠抓最新資料

export async function GET() {
  try {
    const [shipments, records, furikomi] = await Promise.all([
      getShipments(),
      getShipmentRecords(),
      getFurikomiRecords(), // 全月份，供進貨成本預帶
    ])

    const batches = computeAllMargins(shipments, records, furikomi)

    return NextResponse.json({
      batches,
      lastUpdated: new Date().toISOString(),
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to compute margins' }, { status: 500 })
  }
}
