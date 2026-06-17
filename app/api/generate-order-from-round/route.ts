import { NextRequest, NextResponse } from 'next/server'
import { generateShipmentOrder, StoreOrder } from '@/lib/generateShipmentOrder'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// 接受已解析好的出貨資料（JSON），直接產出 Excel 下載
// 不需要重新上傳 Excel 或查 Notion，比 generate-order-free 更輕量
export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: '請先登入' }, { status: 401 })
  }
  try {
    const { storeOrders, shipmentNo, batchName } = await req.json() as {
      storeOrders: StoreOrder[]
      shipmentNo: string
      batchName: string
    }

    if (!storeOrders?.length || !shipmentNo) {
      return NextResponse.json({ error: '缺少必要欄位 (storeOrders, shipmentNo)' }, { status: 400 })
    }

    const excelBuffer = await generateShipmentOrder(storeOrders, shipmentNo, batchName ?? '', false)

    const productTag = (batchName ?? '').replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20)
    const fileName = `${shipmentNo}_${productTag}_店鋪貨單.xlsx`
    const buf = Buffer.from(excelBuffer)

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'X-Shipment-No': shipmentNo,
      },
    })
  } catch (err) {
    console.error('[generate-order-from-round]', err)
    return NextResponse.json(
      { error: `產生失敗: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}
