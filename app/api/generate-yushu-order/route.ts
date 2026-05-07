import { NextRequest, NextResponse } from 'next/server'
import { parseKanriExcel, parsePlanExcel } from '@/lib/parseYushuExcel'
import { generateStoreShipmentExcel, generateChukuExcel } from '@/lib/generateYushuShipment'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const kanriFile = form.get('kanriFile') as File | null
    const planFile  = form.get('planFile')  as File | null
    const roundStr  = form.get('round')     as string | null
    const date      = form.get('date')      as string | null
    const suffix    = (form.get('suffix')   as string | null) ?? '01'
    const batchLabel = (form.get('batchLabel') as string | null) ?? ''
    const outputType = (form.get('outputType') as string | null) ?? 'both'
    // outputType: 'store' | 'chuku' | 'both'

    if (!kanriFile || !planFile || !roundStr || !date) {
      return NextResponse.json({ error: '缺少必要欄位 (kanriFile, planFile, round, date)' }, { status: 400 })
    }

    const round = parseInt(roundStr, 10)
    if (isNaN(round)) {
      return NextResponse.json({ error: '回目必須是數字' }, { status: 400 })
    }

    // Parse both files
    const [kanriBuf, planBuf] = await Promise.all([
      kanriFile.arrayBuffer(),
      planFile.arrayBuffer(),
    ])

    const { masters, rounds } = await parseKanriExcel(kanriBuf)
    const roundData = rounds.find(r => r.round === round)
    if (!roundData) {
      return NextResponse.json({ error: `找不到第 ${round} 回出貨明細，請確認庫存管理表格式` }, { status: 404 })
    }

    const { priceMap } = await parsePlanExcel(planBuf, round)
    if (Object.keys(priceMap).length === 0) {
      return NextResponse.json({ error: `找不到第 ${round} 回目的計画書資料，請確認計画書格式` }, { status: 404 })
    }

    // Build shipment number
    const yyyymmdd = date.replace(/-/g, '').replace(/\//g, '')
    const shipmentNo = `S${yyyymmdd}${suffix.padStart(2, '0')}`

    const opts = { shipmentNo, batchLabel, deliveryDate: date, round, masters, roundData, priceMap }

    if (outputType === 'store') {
      const buf = await generateStoreShipmentExcel(opts)
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${shipmentNo}_LOPIA_${batchLabel}_店鋪貨單.xlsx`)}`,
          'X-Shipment-No': shipmentNo,
        },
      })
    }

    if (outputType === 'chuku') {
      const buf = await generateChukuExcel(opts)
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`出貨總單${yyyymmdd}${suffix}(${batchLabel}).xlsx`)}`,
          'X-Shipment-No': shipmentNo,
        },
      })
    }

    // Both: generate both and return as two separate responses embedded in JSON
    // Since HTTP can only return one body, we encode both as base64 in JSON
    const [storeBuf, chukuBuf] = await Promise.all([
      generateStoreShipmentExcel(opts),
      generateChukuExcel(opts),
    ])

    return NextResponse.json({
      shipmentNo,
      storeFile: {
        name: `${shipmentNo}_LOPIA_${batchLabel}_店鋪貨單.xlsx`,
        data: Buffer.from(storeBuf).toString('base64'),
      },
      chukuFile: {
        name: `出貨總單${yyyymmdd}${suffix}(${batchLabel}).xlsx`,
        data: Buffer.from(chukuBuf).toString('base64'),
      },
    })

  } catch (err) {
    console.error('[generate-yushu-order]', err)
    return NextResponse.json({ error: '產生失敗，請確認檔案格式是否正確' }, { status: 500 })
  }
}
