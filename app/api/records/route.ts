import { NextRequest, NextResponse } from 'next/server'
import { createShipmentRecord, getShipmentRecords } from '@/lib/notion'
import { requireAuth } from '@/lib/auth'
import { canSeeMoney } from '@/lib/apiToken'
import { generateShipmentNo } from '@/lib/generateShipmentOrder'

// 主頁「有網址就能看」，但出貨「金額」不該跟著公開。沒登入／沒通行碼 → amount 一律回 null（箱數、日期、店名照舊）。
export async function GET(req: NextRequest) {
  try {
    const [records, showMoney] = await Promise.all([getShipmentRecords(), canSeeMoney(req)])
    return NextResponse.json({ records: showMoney ? records : records.map(r => ({ ...r, amount: null })) })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch records' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const data = await req.json()
    const { batchId, store, date, boxes, round, planStatus, remarks, amount, shipmentNo: customNo } = data

    if (!batchId || !store || boxes == null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const roundNum = round ?? 1
    // 統一 shipmentNo 格式：與 generate-order/generate-order-free 一致為 S{YYYYMMDD}{NN}
    // 若 client 沒指定也沒指定 date，退回到「批次+輪次+timestamp」格式以保證唯一
    const shipmentNo = customNo
      || (date ? generateShipmentNo(date, roundNum) : null)
      || `${batchId.slice(0, 8)}-R${String(roundNum).padStart(2, '0')}-${Date.now().toString(36).toUpperCase()}`

    const record = await createShipmentRecord({
      shipmentNo,
      batchId,
      store,
      date: date || null,
      boxes: Number(boxes),
      amount: amount != null ? Number(amount) : undefined,
      round: roundNum,
      planStatus: planStatus ?? '計畫中',
      remarks,
    })

    return NextResponse.json({ record })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })
  }
}
