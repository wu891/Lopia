import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { generateDiguaNoteWorkbook, DiguaNoteInput } from '@/lib/digua/generateDiguaNote'

export async function POST(req: NextRequest) {
  if (!(await requireAuth(['edit', 'portal']))) {
    return NextResponse.json({ error: '驗證已過期，請重新整理頁面並重新輸入密碼' }, { status: 401 })
  }
  try {
    const body = (await req.json()) as DiguaNoteInput

    if (!body.shipmentNo || !body.deliveryDate || !Array.isArray(body.stores)) {
      return NextResponse.json({ error: '缺少必要參數（出貨單號／配送日期／店鋪清單）' }, { status: 400 })
    }

    const wb = await generateDiguaNoteWorkbook(body)
    const buf = await wb.xlsx.writeBuffer()
    const filename = encodeURIComponent(`${body.shipmentNo}_茨城地瓜+大學芋_店鋪貨單.xlsx`)

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      },
    })
  } catch (err) {
    console.error('[generate-digua-note]', err)
    const message = err instanceof Error ? err.message : '伺服器錯誤，請重試'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
