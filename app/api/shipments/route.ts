import { NextRequest, NextResponse } from 'next/server'
import {
  getShipments, getShipmentRecords, createShipment,
  updateShipmentDeliveryStatus, logSystemChange, notionRetry,
} from '@/lib/notion'
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

    // 這次載入判定要自動改配送狀態的批次（收集起來，等下寫回 Notion）
    const autoFixes: { id: string; ivName: string; from: string | null; to: string }[] = []

    const enriched = shipments.map(s => {
      const planned = plannedMap[s.id] ?? 0
      const done = doneMap[s.id] ?? 0
      const total = s.totalBoxes ?? 0
      const allDone = planned > 0 && done >= planned
      const shipped =
        s.deliveryStatus === '全數出貨' ? total :
        allDone ? planned :
        done
      // 自動推進配送狀態：
      // 批次已有實際出貨紀錄（出貨日期已到、未取消），狀態卻還停在「未到／待出貨／空白」→ 一律變「部分出貨」。
      // 跟 Drive 掃描的自動推進（lib/driveScan/sync.ts）同一條規則；這裡是保險網，
      // 接住掃描沒跑到的路徑（手動建的出貨紀錄、計畫日已到但檔案還沒掃到）。
      // 只往前推、不往回改：部分出貨／全數出貨／退回銷毀維持原樣；未來的出貨計畫（日期還沒到）不算。
      const autoPartial = done > 0 && ['', '未到', '待出貨'].includes(s.deliveryStatus ?? '')
      // 自動關帳（2026-08-28 Colin 指示）：最後一批出完、而且數字剛好對得上 → 自動改「全數出貨」。
      // 條件故意抓「完全相等」，三個都要成立：
      //   1. 已出貨（出貨日已到、未取消）箱數 === 入倉箱數
      //   2. 沒有還沒到日期的出貨計畫掛著（計畫總數 === 已出貨）
      //   3. 現在還不是「全數出貨」
      // 超領（如蘋果一度 1147 > 1104）或少一箱都不關帳——那是數字有問題，要留在畫面上讓人看見。
      // 關帳後這批就不再參與 Drive 自動扣帳（isActiveBatch()），所以只在完全對上時才做。
      const autoClose = total > 0 && done === total && planned === done && s.deliveryStatus !== '全數出貨'
      if (autoClose) autoFixes.push({ id: s.id, ivName: s.ivName, from: s.deliveryStatus, to: '全數出貨' })
      else if (autoPartial) autoFixes.push({ id: s.id, ivName: s.ivName, from: s.deliveryStatus, to: '部分出貨' })
      const deliveryStatus = autoClose ? '全數出貨' : autoPartial ? '部分出貨' : s.deliveryStatus
      return {
        ...s,
        deliveryStatus,
        plannedBoxes: planned,
        shippedBoxes: shipped,
        remainingBoxes: total > 0 ? Math.max(0, total - shipped) : null,
      }
    })

    // 寫回 Notion：把上面判定的批次，Notion「配送狀態」欄位也一併改成判定後的狀態
    // （部分出貨＝2026-08-26 Colin 指示；全數出貨自動關帳＝2026-08-28 Colin 指示）。
    // 正常情況 0 筆（掃描系統早一步推進了），只有漏網批次出現時才會寫，寫完下次載入就不會再寫。
    // 放在回應前同步等待（serverless 回應後的背景工作可能被凍結）；單筆失敗只記 console 不擋回應，下次載入自動重試。
    for (const f of autoFixes) {
      try {
        await notionRetry(() => updateShipmentDeliveryStatus(f.id, f.to))
        // 修改紀錄留一筆可追（失敗只代表少一筆紀錄，狀態本身已改好，不重試）
        const why = f.to === '全數出貨' ? '已出貨箱數與入倉箱數相符，自動關帳' : '偵測到出貨紀錄'
        await logSystemChange('自動更新配送狀態', f.ivName, `${f.from || '（空白）'} → ${f.to}（${why}）`)
      } catch (e) {
        console.error('自動更新配送狀態失敗:', f.ivName, e)
      }
    }

    return NextResponse.json({
      shipments: enriched,
      lastUpdated: new Date().toISOString(),
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
