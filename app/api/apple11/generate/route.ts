import { NextRequest, NextResponse } from 'next/server'
import { parsePlanRound } from '@/lib/parsePlanShipment'
import { allocateGrades, Demand } from '@/lib/allocateGrades'
import { resolveApple11Store } from '@/lib/apple11Stores'
import { generateApple11StoreExcel, generateApple11ChukuExcel } from '@/lib/generateApple11'
import { getCurrentStock, applyRemaining } from '@/lib/apple11StockStore'
import { logApple11Cycle, hasShipment } from '@/lib/apple11Notion'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await requireAuth(['edit', 'portal']))) {
    return NextResponse.json({ error: '驗證已過期，請重新整理頁面並重新輸入密碼' }, { status: 401 })
  }
  try {
    const form = await req.formData()
    const planFile  = form.get('planFile')  as File | null
    const roundStr  = form.get('round')      as string | null
    const date      = form.get('date')       as string | null
    const suffix    = (form.get('suffix')    as string | null) ?? '01'
    const batchLabel = (form.get('batchLabel') as string | null) ?? ''
    const outputType = (form.get('outputType') as string | null) ?? 'both'
    const force      = (form.get('force') as string | null) === '1'

    if (!planFile || !roundStr || !date) {
      return NextResponse.json({ error: '缺少必要欄位（計画書、回目、配送日期）' }, { status: 400 })
    }
    const round = parseInt(roundStr, 10)
    if (isNaN(round)) return NextResponse.json({ error: '回目必須是數字' }, { status: 400 })

    // 1. 讀系統庫存
    let stock
    try { stock = await getCurrentStock() }
    catch (e) { return NextResponse.json({ error: '無法讀取庫存（請確認 Notion 整合已分享給「蘋果11目前庫存」）：' + (e instanceof Error ? e.message : '') }, { status: 502 }) }
    if (stock.length === 0) {
      return NextResponse.json({ error: '系統還沒有庫存資料，請先到「更新庫存」上傳倉庫檔初始化' }, { status: 409 })
    }

    // 2. 解析計画書該回目
    const plan = await parsePlanRound(await planFile.arrayBuffer(), round)
    if (plan.stores.length === 0) {
      return NextResponse.json({ error: `計画書找不到第 ${round} 回目的店鋪分頁` }, { status: 404 })
    }

    const yyyymmdd = date.replace(/[-/]/g, '')
    const shipmentNo = `S${yyyymmdd}${suffix.padStart(2, '0')}`

    // 3. 防重複扣帳
    if (!force && await hasShipment(shipmentNo)) {
      return NextResponse.json({ error: `單號 ${shipmentNo} 已經出過貨並扣過庫存。若確定要再扣一次，請勾選「強制重跑」。`, alreadyShipped: true }, { status: 409 })
    }

    // 4. 組需求 + 分配（不足整批擋下）
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
    const demands = Array.from(demandMap.values())
    const alloc = allocateGrades(stock, demands)
    if (!alloc.ok) {
      const msg = alloc.shortages.map(s => `${s.variety} ${s.tama}玉 缺 ${s.short} 箱（需 ${s.demand}、庫存 ${s.stock}）`).join('；')
      return NextResponse.json({ error: `庫存不足，已擋下未扣帳也未產生：${msg}` }, { status: 409 })
    }

    // 5. 產出（記憶體）
    const genOpts = { shipmentNo, deliveryDate: date, plan, lines: alloc.lines, stockDate: '系統庫存' }
    const [storeBuf, chukuBuf] = await Promise.all([
      generateApple11StoreExcel(genOpts),
      generateApple11ChukuExcel(genOpts),
    ])

    // 6. 扣帳寫回（成功後才算數）
    try { await applyRemaining(alloc.remaining) }
    catch (e) { return NextResponse.json({ error: '扣帳寫回庫存失敗，未交付（請重試或檢查 Notion 權限）：' + (e instanceof Error ? e.message : '') }, { status: 502 }) }

    // 7. 寫歷史（best-effort）
    const notion = await logApple11Cycle({ date, shipmentNo, round, batchLabel, lines: alloc.lines, remaining: alloc.remaining })
      .catch(() => ({ ok: false as const, note: 'Notion 歷史寫入失敗（已略過）' }))

    const label = batchLabel || `第${round}回`
    const shippedTotal = alloc.lines.reduce((s, l) => s + l.qty, 0)
    const remainTotal = alloc.remaining.reduce((s, r) => s + r.qty, 0)

    if (outputType === 'store') return excelResponse(storeBuf, `${shipmentNo}_LOPIA_${label}_店鋪貨單.xlsx`, shipmentNo)
    if (outputType === 'chuku') return excelResponse(chukuBuf, `_日商夢多_出庫總單_${yyyymmdd}_${label}.xlsx`, shipmentNo)

    return NextResponse.json({
      shipmentNo,
      unknownStores: Array.from(unknownStores),
      notion,
      shippedTotal, remainTotal,
      summary: alloc.lines.map(l => ({ store: l.store, name: l.rawName, bango: l.bango, qty: l.qty })),
      storeFile: { name: `${shipmentNo}_LOPIA_${label}_店鋪貨單.xlsx`, data: Buffer.from(storeBuf).toString('base64') },
      chukuFile: { name: `_日商夢多_出庫總單_${yyyymmdd}_${label}.xlsx`, data: Buffer.from(chukuBuf).toString('base64') },
    })
  } catch (err) {
    console.error('[apple11/generate]', err)
    return NextResponse.json({ error: '產生失敗，請確認計画書格式' }, { status: 500 })
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
