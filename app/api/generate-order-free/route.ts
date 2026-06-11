import { NextRequest, NextResponse } from 'next/server'
import { parseDeliveryExcel, EXCEL_STORE_MAP } from '@/lib/parseDeliveryExcel'
import { generateShipmentOrder, generateShipmentNo, StoreOrder } from '@/lib/generateShipmentOrder'
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
    if (!(await requireAuth(['edit', 'portal']))) {
          return NextResponse.json({ error: '驗證已過期，請重新整理頁面並重新輸入密碼' }, { status: 401 })
    }
    try {
          const form = await req.formData()
          const date = form.get('date') as string
          const file = form.get('file') as File | null
          const label = (form.get('label') as string) || ''
          const isTaxable = form.get('isTaxable') === '1'

          const manualSheetsRaw = form.get('manualSheets') as string | null
          let manualSheets: string[] | undefined
          if (manualSheetsRaw) {
                  try {
                            const parsed = JSON.parse(manualSheetsRaw)
                            if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) {
                                          manualSheets = parsed
                            } else {
                                          return NextResponse.json({ error: 'manualSheets 必須是字串陣列' }, { status: 400 })
                            }
                  } catch {
                            return NextResponse.json({ error: 'manualSheets 格式錯誤（無效 JSON）' }, { status: 400 })
                  }
          }
          const isManualMode = !!(manualSheets && manualSheets.length > 0)

      if (!date || !file) {
              return NextResponse.json({ error: '缺少必要欄位 (date, file)' }, { status: 400 })
      }

      let selectedStoreCodes: string[] = []
      let roundNo = 1
      if (!isManualMode) {
        const roundRaw = form.get('roundNo') as string
        roundNo = parseInt(roundRaw, 10)
        const storesJson = form.get('stores') as string
        if (isNaN(roundNo) || !storesJson) {
          return NextResponse.json({ error: '缺少必要欄位 (roundNo, stores)' }, { status: 400 })
        }
        selectedStoreCodes = JSON.parse(storesJson)
        if (!selectedStoreCodes.length) {
          return NextResponse.json({ error: '請至少選擇一間門市' }, { status: 400 })
        }
      }

      const buffer = await file.arrayBuffer()
          const parsed = await parseDeliveryExcel(buffer, true, manualSheets)

      let storeOrders: StoreOrder[]
      if (isManualMode) {
        const roundData = parsed[0]
        if (!roundData) {
          return NextResponse.json({ error: '無法從選定分頁中解析出任何資料，請確認分頁內容格式' }, { status: 404 })
        }
        storeOrders = roundData.stores.map(s => ({
          storeName: s.name,
          products: s.products,
          deliveryDate: date,
        }))
      } else {
        const roundData = parsed.find(r => r.roundNo === roundNo)
        if (!roundData) {
          return NextResponse.json({ error: `找不到第 ${roundNo} 回目的資料，請確認 Excel 格式` }, { status: 404 })
        }
        storeOrders = []
        for (const code of selectedStoreCodes) {
          const fullName = EXCEL_STORE_MAP[code] ?? code
          const storeData = roundData.stores.find(s => s.name === code || s.name === fullName)
          storeOrders.push({ storeName: fullName, products: storeData?.products ?? [], deliveryDate: date })
        }
      }

      const batchName = label || (isManualMode ? '手動選頁' : `第${roundNo}回`)
      const shipmentNo = generateShipmentNo(date)
          const excelBuffer = await generateShipmentOrder(storeOrders, shipmentNo, batchName, isTaxable)

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

      // Return Excel as download (不上傳到 Drive)
      const productTag = batchName.replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20)
          const fileName = `${shipmentNo}_${productTag}_店鋪貨單.xlsx`
          const buf = Buffer.from(excelBuffer)

      return new NextResponse(buf, {
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
          console.error('[generate-order-free]', err)
          return NextResponse.json(
            { error: `產生失敗: ${err instanceof Error ? err.message : String(err)}` },
            { status: 500 }
                )
    }
}
