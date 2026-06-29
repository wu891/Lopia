import { NextRequest, NextResponse } from 'next/server'
import { parseMudoStock } from '@/lib/parseMudoStock'
import { parsePlanRound } from '@/lib/parsePlanShipment'
import { allocateGrades, Demand } from '@/lib/allocateGrades'
import { resolveApple11Store } from '@/lib/apple11Stores'
import { generateApple11StoreExcel, generateApple11ChukuExcel } from '@/lib/generateApple11'
import { logApple11Cycle } from '@/lib/apple11Notion'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await requireAuth(['edit', 'portal']))) {
    return NextResponse.json({ error: '驗證已過期，請重新整理頁面並重新輸入密碼' }, { status: 401 })
  }
  try {
    const form = await req.formData()
    const stockFile = form.get('stockFile') as File | null
    const planFile  = form.get('planFile')  as File | null
    const roundStr  = form.get('round')      as string | null
    const date      = form.get('date')       as string | null
    const suffix    = (form.get('suffix')    as string | null) ?? '01'
    const batchLabel = (form.get('batchLabel') as string | null) ?? ''
    const outputType = (form.get('outputType') as string | null) ?? 'both' // store|chuku|both
    const stockDate  = (form.get('stockDate') as string | null) ?? ''      // 倉庫檔日期(顯示用)

    if (!stockFile || !planFile || !roundStr || !date) {
      return NextResponse.json({ error: '缺少必要欄位（倉庫庫存檔、計画書、回目、配送日期）' }, { status: 400 })
    }
    const round = parseInt(roundStr, 10)
    if (isNaN(round)) return NextResponse.json({ error: '回目必須是數字' }, { status: 400 })

    const [stockBuf, planBuf] = await Promise.all([stockFile.arrayBuffer(), planFile.arrayBuffer()])

    // 1. 解析倉庫庫存（只取蘋果）
    const { apples } = await parseMudoStock(stockBuf)
    if (apples.length === 0) {
      return NextResponse.json({ error: '倉庫庫存檔讀不到任何蘋果品項，請確認檔案格式' }, { status: 422 })
    }

    // 2. 解析計画書該回目
    const plan = await parsePlanRound(planBuf, round)
    if (plan.stores.length === 0) {
      return NextResponse.json({ error: `計画書找不到第 ${round} 回目的店鋪分頁，請確認回目` }, { status: 404 })
    }

    // 3. 組需求（每店每品種每玉數彙總；雙價格列合併）+ 檢查店名是否可對應
    const demandMap = new Map<string, Demand>()
    const unknownStores = new Set<string>()
    for (const st of plan.stores) {
      if (!resolveApple11Store(st.code)) unknownStores.add(st.code)
      for (const row of st.rows) {
        if (row.cases <= 0) continue
        const k = `${st.code}|${row.variety}|${row.tama}`
        const cur = demandMap.get(k)
        if (cur) cur.qty += row.cases
        else demandMap.set(k, { store: st.code, variety: row.variety, tama: row.tama, qty: row.cases })
      }
    }
    // 店名對不上 → 直接擋下（否則那批貨不會出現在任何單據）
    if (unknownStores.size > 0) {
      return NextResponse.json({
        error: `計画書有無法對應的店名，已擋下未產生：${Array.from(unknownStores).join('、')}。請修正計画書分頁名，或在 lib/apple11Stores.ts 補上對應後再產生。`,
        unknownStores: Array.from(unknownStores),
      }, { status: 409 })
    }

    const demands = Array.from(demandMap.values())

    // 4. 等級分配（不足整批擋下）
    const alloc = allocateGrades(apples, demands)
    if (!alloc.ok) {
      const msg = alloc.shortages
        .map(s => `${s.variety} ${s.tama}玉 缺 ${s.short} 箱（需 ${s.demand}、庫存 ${s.stock}）`)
        .join('；')
      return NextResponse.json({ error: `庫存不足，已擋下未產生任何檔：${msg}` }, { status: 409 })
    }

    const yyyymmdd = date.replace(/[-/]/g, '')
    const shipmentNo = `S${yyyymmdd}${suffix.padStart(2, '0')}`
    const genOpts = { shipmentNo, deliveryDate: date, plan, lines: alloc.lines, stockDate: stockDate || yyyymmdd }

    // 5. 寫 Notion 歷史（best-effort，不擋產出）
    const notion = await logApple11Cycle({
      date, shipmentNo, round, batchLabel,
      lines: alloc.lines, remaining: alloc.remaining,
    }).catch(() => ({ ok: false as const, note: 'Notion 寫入失敗（已略過）' }))

    // 6. 產出
    const label = batchLabel || `第${round}回`
    if (outputType === 'store') {
      const buf = await generateApple11StoreExcel(genOpts)
      return excelResponse(buf, `${shipmentNo}_LOPIA_${label}_店鋪貨單.xlsx`, shipmentNo)
    }
    if (outputType === 'chuku') {
      const buf = await generateApple11ChukuExcel(genOpts)
      return excelResponse(buf, `_日商夢多_出庫總單_${yyyymmdd}_${label}.xlsx`, shipmentNo)
    }
    // both
    const [storeBuf, chukuBuf] = await Promise.all([
      generateApple11StoreExcel(genOpts),
      generateApple11ChukuExcel(genOpts),
    ])
    return NextResponse.json({
      shipmentNo,
      unknownStores: Array.from(unknownStores),
      notion,
      summary: alloc.lines.map(l => ({ store: l.store, name: l.rawName, bango: l.bango, qty: l.qty })),
      storeFile: { name: `${shipmentNo}_LOPIA_${label}_店鋪貨單.xlsx`, data: Buffer.from(storeBuf).toString('base64') },
      chukuFile: { name: `_日商夢多_出庫總單_${yyyymmdd}_${label}.xlsx`, data: Buffer.from(chukuBuf).toString('base64') },
    })
  } catch (err) {
    console.error('[generate-apple11]', err)
    return NextResponse.json({ error: '產生失敗，請確認兩個檔案格式是否正確' }, { status: 500 })
  }
}

function excelResponse(buf: Buffer, filename: string, shipmentNo: string) {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'X-Shipment-No': shipmentNo,
    },
  })
}
