import { NextRequest, NextResponse } from 'next/server'
import { getShipments, getShipmentRecords, createShipment } from '@/lib/notion'
import { requireAuth } from '@/lib/auth'
import { todayTaipei } from '@/lib/kanban'

export const dynamic = 'force-dynamic' // always fetch fresh from Notion

export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const data = await req.json()
    if (!data.ivName?.trim()) {
      return NextResponse.json({ error: 'Missing batch name' }, { status: 400 })
    }
    const shipment = await createShipment(data)
    return NextResponse.json({ shipment })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create shipment' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const [shipments, records] = await Promise.all([getShipments(), getShipmentRecords()])

    // Aggregate per batch: planned (non-cancelled) and done (date <= today and non-cancelled)
    // 「今天」用台灣時區：之前用 UTC，台灣凌晨 0~8 點會被當成前一天，當天的出貨暫時不算數
    const today = todayTaipei()
    const plannedMap: Record<string, number> = {}
    const doneMap: Record<string, number> = {}
    for (const r of records) {
      if (!r.batchId || !r.boxes) continue
      if (r.planStatus !== '已取消') {
        plannedMap[r.batchId] = (plannedMap[r.batchId] ?? 0) + r.boxes
        if (r.date && r.date <= today) {
          doneMap[r.batchId] = (doneMap[r.batchId] ?? 0) + r.boxes
        }
      }
    }

    const enriched = shipments.map(s => {
      const planned = plannedMap[s.id] ?? 0
      const done = doneMap[s.id] ?? 0
      const total = s.totalBoxes ?? 0
      const allDone = planned > 0 && done >= planned
      const shipped =
        s.deliveryStatus === '全數出貨' ? total :
        allDone ? planned :
        done
      // 自動推進配送狀態（只改網站顯示，不寫回 Notion）：
      // 批次已有實際出貨紀錄（出貨日期已到、未取消），狀態卻還停在「未到／待出貨／空白」→ 一律顯示「部分出貨」。
      // 跟 Drive 掃描的自動推進（lib/driveScan/sync.ts）同一條規則；這裡是顯示層保險網，
      // 接住掃描沒跑到的路徑（手動建的出貨紀錄、計畫日已到但檔案還沒掃到）。
      // 只往前推、不往回改：部分出貨／全數出貨／退回銷毀維持原樣；未來的出貨計畫（日期還沒到）不算。
      const deliveryStatus =
        done > 0 && ['', '未到', '待出貨'].includes(s.deliveryStatus ?? '')
          ? '部分出貨'
          : s.deliveryStatus
      return {
        ...s,
        deliveryStatus,
        plannedBoxes: planned,
        shippedBoxes: shipped,
        remainingBoxes: total > 0 ? Math.max(0, total - shipped) : null,
      }
    })

    return NextResponse.json({
      shipments: enriched,
      lastUpdated: new Date().toISOString(),
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
