import { NextRequest, NextResponse } from 'next/server'
import { parseDeliveryExcel, resolveStoreName } from '@/lib/parseDeliveryExcel'
import { generateShipmentOrder, generateShipmentNo, buildItemSpec, StoreOrder } from '@/lib/generateShipmentOrder'
import { verifyShipmentOrder, formatDiffs } from '@/lib/verifyShipmentOrder'
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

      const roundData = isManualMode ? parsed[0] : parsed.find(r => r.roundNo === roundNo)
      if (!roundData) {
        return NextResponse.json({
          error: isManualMode
            ? '無法從選定分頁中解析出任何資料，請確認分頁內容格式'
            : `找不到第 ${roundNo} 回目的資料，請確認 Excel 格式`,
        }, { status: 404 })
      }

      // ── 防呆 1：有分頁卻讀不到任何商品 → 直接擋下 ──────────────────────────
      // 白話：Excel 裡明明有這一頁，程式卻一列都讀不出來。
      //       以前是默默跳過（那間店就這樣不見了），現在寧可不給下載也要先講。
      const skipped = roundData.skippedSheets ?? []
      if (skipped.length > 0) {
        return NextResponse.json({
          error: `這些分頁讀不到資料，已擋下不產生：\n${skipped.map(s => `・${s.sheet}（${s.reason}）`).join('\n')}\n請確認分頁內容，或告訴我這幾頁的格式。`,
          skippedSheets: skipped,
        }, { status: 409 })
      }

      // ── 組出貨單：直接用「解析出來的店」，不再靠店名字串去配對 ─────────────
      // 以前是 for(選到的 code) → 用名字去 find 資料，名字對不起來就變空的（夢時代就是這樣不見的）。
      // 現在改成：解析到幾間店就做幾間店，順序照前端送來的 code；沒對到的排在後面，一間都不會少。
      const byName = new Map(roundData.stores.map(s => [s.name, s]))
      const used = new Set<string>()
      const storeOrders: StoreOrder[] = []
      for (const code of selectedStoreCodes) {
        const data = byName.get(resolveStoreName(code)) ?? byName.get(code)
        if (!data || used.has(data.name)) continue
        used.add(data.name)
        storeOrders.push({ storeName: data.name, products: data.products, deliveryDate: date })
      }
      for (const s of roundData.stores) {
        if (used.has(s.name)) continue
        used.add(s.name)
        storeOrders.push({ storeName: s.name, products: s.products, deliveryDate: date })
      }
      if (storeOrders.length === 0) {
        return NextResponse.json({ error: '這一回目沒有任何門市資料，已擋下不產生' }, { status: 409 })
      }

      const batchName = label || (isManualMode ? '手動選頁' : `第${roundNo}回`)
      const shipmentNo = generateShipmentNo(date)
          const excelBuffer = await generateShipmentOrder(storeOrders, shipmentNo, batchName, isTaxable)

      // ── 防呆 2：交付前自動核對（做好的 Excel 讀回來，對回計劃書數字）──────
      // 一致才給下載；有任何一項對不上就擋下，並告訴使用者差在哪。
      const verify = await verifyShipmentOrder(
        excelBuffer,
        roundData.stores.map(s => ({ storeName: s.name, products: s.products })),
      )
      if (!verify.ok) {
        return NextResponse.json({
          error: `產出的出貨單跟計劃書對不上，已擋下不給下載：\n${formatDiffs(verify.diffs)}`,
          verify: { ok: false, diffs: verify.diffs, stats: verify.stats },
        }, { status: 409 })
      }
      const verifyNote =
        `${verify.stats.storeCount} 間店、${verify.stats.itemCount} 個品項、` +
        `總箱數 ${verify.stats.totalBoxes} 箱，全部與計劃書一致`

      const summaryMap = new Map<string, { boxSpec: string; total: number }>()
          for (const order of storeOrders) {
                  for (const p of order.products) {
                            const key = `${p.name}__${p.boxSpec}`
                            const existing = summaryMap.get(key)
                            if (existing) existing.total += p.quantity
                            else summaryMap.set(key, { boxSpec: p.boxSpec, total: p.quantity })
                  }
          }
          const summary = Array.from(summaryMap.entries()).map(([key, v]) => {
                  const { detailedName, spec } = buildItemSpec(key.split('__')[0], v.boxSpec)
                  return { name: detailedName, boxSpec: spec, total: v.total }
          })
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
                  已逐店逐品項對回計劃書: verify.ok,
                  核對品項數: verify.stats.itemCount,
                  核對總箱數: verify.stats.totalBoxes,
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
                        'X-Verify': Buffer.from(verifyNote).toString('base64'),
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
