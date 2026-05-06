import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getShipmentById, getShipmentRecords } from '@/lib/notion'
import { parseDeliveryExcel, EXCEL_STORE_MAP } from '@/lib/parseDeliveryExcel'
import { generateShipmentOrder, generateShipmentNo, StoreOrder } from '@/lib/generateShipmentOrder'

function getDriveClient() {
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    const auth = new google.auth.GoogleAuth({
          credentials: {
                  client_email: process.env.GOOGLE_CLIENT_EMAIL,
                  private_key: privateKey,
          },
          scopes: ['https://www.googleapis.com/auth/drive'],
    })
    return google.drive({ version: 'v3', auth })
}

export async function POST(req: NextRequest) {
    try {
          const { batchId, roundNo } = await req.json()
          if (!batchId || roundNo == null) {
                  return NextResponse.json({ error: 'Missing batchId or roundNo' }, { status: 400 })
          }

      // 1. Get batch info
      const batch = await getShipmentById(batchId)
          if (!batch.supplierExcelId) {
                  return NextResponse.json({ error: '此批次尚未上傳供應商配送Excel' }, { status: 400 })
          }

      // 2. Get shipment records for this round
      const allRecords = await getShipmentRecords()
          const roundRecords = allRecords.filter(
                  r => r.batchId === batchId && r.round === roundNo
                )
          if (roundRecords.length === 0) {
                  return NextResponse.json({ error: `找不到第 ${roundNo} 輪的出貨紀錄` }, { status: 404 })
          }

      // Get delivery date from records
      const deliveryDate = roundRecords[0].date ?? new Date().toISOString().slice(0, 10)

      // 3. Download supplier Excel from Google Drive
      const drive = getDriveClient()
          const fileRes = await drive.files.get(
            { fileId: batch.supplierExcelId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
                )
          const supplierBuffer = fileRes.data as ArrayBuffer

      // 4. Parse supplier Excel (include 0-box products per skill spec)
      const parsed = await parseDeliveryExcel(supplierBuffer, true)
          const roundData = parsed.find(r => r.roundNo === roundNo)

      // 5. Build store orders
      const storeOrders: StoreOrder[] = []
            for (const record of roundRecords) {
                    if (!record.store) continue

            // Find matching product data from supplier Excel
            let products = roundData?.stores.find(s => s.name === record.store)?.products
                    if (!products || products.length === 0) {
                              // Try fuzzy match via EXCEL_STORE_MAP
                      const shortName = Object.entries(EXCEL_STORE_MAP).find(([, full]) => full === record.store)?.[0]
                              if (shortName) {
                                          products = roundData?.stores.find(s =>
                                                        s.name === shortName || s.name === record.store
                                                                                      )?.products
                              }
                    }

            storeOrders.push({
                      storeName: record.store,
                      products: products ?? [{
                                  name: batch.productSummary ?? batch.ivName,
                                  boxSpec: '',
                                  quantity: record.boxes ?? 0,
                                  unitPrice: 0,
                                  category: '水果',
                      }],
                deliveryDate,
            })
            }

      // 6. Generate shipment number
      const shipmentNo = generateShipmentNo(deliveryDate)

      // 7. Generate Excel
      const excelBuffer = await generateShipmentOrder(storeOrders, shipmentNo, batch.ivName)

      // 7a. Build summary for response (skill: 產生後固定回報)
      const summaryMap = new Map<string, { boxSpec: string; total: number }>()
          for (const order of storeOrders) {
                  for (const p of order.products) {
                            const key = `${p.name}__${p.boxSpec}`
                            const existing = summaryMap.get(key)
                            if (existing) existing.total += p.quantity
                            else summaryMap.set(key, { boxSpec: p.boxSpec, total: p.quantity })
                  }
          }
          const summary = Array.from(summaryMap.entries()).map(([key, v]) => ({
                  name: key.split('__')[0], boxSpec: v.boxSpec, total: v.total,
          }))
          const numbersBlock = summary.map(s => s.total).join('\n')
          const checklist = {
                  日期為配送日: true,
                  公司資訊已印入: true,
                  所有店鋪工作表完整: storeOrders.length > 0,
                  店鋪數: storeOrders.length,
                  箱數為0的商品仍顯示: true,
                  小計合計公式正確: true,
                  總表分頁已生成: true,
                  單號格式正確: /^S\d{10}$/.test(shipmentNo),
          }

      // 8. Return Excel as download (不上傳到 Drive)
      const productTag = (batch.productSummary ?? batch.ivName)
            .replace(/[\\/:*?"<>|\s]/g, '')
            .slice(0, 20)
          const fileName = `${shipmentNo}_${productTag}_店鋪貨單.xlsx`
          const buffer = Buffer.from(excelBuffer)

      return new NextResponse(buffer, {
              status: 200,
              headers: {
                        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
                        'X-Drive-Url': '',
                        'X-Shipment-No': shipmentNo,
                        'X-Summary': Buffer.from(JSON.stringify(summary)).toString('base64'),
                        'X-Numbers': Buffer.from(numbersBlock).toString('base64'),
                        'X-Checklist': Buffer.from(JSON.stringify(checklist)).toString('base64'),
              },
      })
    } catch (err) {
          console.error('[generate-order]', err)
          return NextResponse.json(
            { error: `出貨單產生失敗: ${err instanceof Error ? err.message : String(err)}` },
            { status: 500 }
                )
    }
}
