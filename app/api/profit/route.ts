import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getShipments, getShipmentRecords, getMonthlyLogistics, getExcelRows, getBatchPrices } from '@/lib/notion'
import { computeLiveMargins } from '@/lib/liveMargin'

export const dynamic = 'force-dynamic' // 永遠現場重算

// 批次即時毛利：整頁密碼保護（有進貨成本與供應商金額）
export async function GET() {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: '需要密碼' }, { status: 401 })
  }
  try {
    const [shipments, records, logistics] = await Promise.all([
      getShipments(),
      getShipmentRecords(),
      getMonthlyLogistics(),
    ])
    // 營收推算的輔助來源：讀不到就退回空，頁面照常顯示（只是少了自動帶入）
    const [excelRows, batchPrices] = await Promise.all([
      getExcelRows().catch(e => { console.error('getExcelRows failed:', e?.message ?? e); return [] }),
      getBatchPrices().catch(e => { console.error('getBatchPrices failed:', e?.message ?? e); return {} }),
    ])
    const result = computeLiveMargins(shipments, records, logistics, excelRows, batchPrices)
    return NextResponse.json({ ...result, lastUpdated: new Date().toISOString() })
  } catch (err) {
    console.error('[profit]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `計算失敗：${msg}` }, { status: 500 })
  }
}
