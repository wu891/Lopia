import { NextResponse } from 'next/server'
import { getShipments, getShipmentRecords, getFurikomiRecords, getExcelRows, getBatchPrices } from '@/lib/notion'
import { computeAllMargins } from '@/lib/margin'

export const dynamic = 'force-dynamic' // 永遠抓最新資料

export async function GET() {
  try {
    // 核心三來源缺一不可
    const [shipments, records, furikomi] = await Promise.all([
      getShipments(),
      getShipmentRecords(),
      getFurikomiRecords(), // 全月份，供進貨成本預帶
    ])

    // 營收推算的兩個輔助來源：任一讀不到就退回空，毛利頁照常顯示（只是少了自動帶入），絕不讓整頁掛掉
    const [excelRows, batchPrices] = await Promise.all([
      getExcelRows().catch(e => { console.error('getExcelRows failed:', e?.message ?? e); return [] }),
      getBatchPrices().catch(e => { console.error('getBatchPrices failed:', e?.message ?? e); return {} }),
    ])

    const batches = computeAllMargins(shipments, records, furikomi, excelRows, batchPrices)

    return NextResponse.json({
      batches,
      lastUpdated: new Date().toISOString(),
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to compute margins' }, { status: 500 })
  }
}
