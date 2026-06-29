import { NextRequest, NextResponse } from 'next/server'
import { parseMudoStock } from '@/lib/parseMudoStock'
import { getCurrentStock, isStockSeeded, seedStock, overwriteStock } from '@/lib/apple11StockStore'
import { diffStock } from '@/lib/apple11Reconcile'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function summarize(stock: { variety: string; qty: number; bango: string; rawName: string; grade: string; tama: number }[]) {
  const byVariety: Record<string, number> = {}
  for (const s of stock) byVariety[s.variety] = (byVariety[s.variety] ?? 0) + s.qty
  return {
    total: stock.reduce((t, s) => t + s.qty, 0),
    byVariety,
    items: stock.map(s => ({ bango: s.bango, name: s.rawName, qty: s.qty })),
  }
}

// GET：回目前庫存
export async function GET() {
  if (!(await requireAuth(['edit', 'portal']))) {
    return NextResponse.json({ error: '驗證已過期' }, { status: 401 })
  }
  try {
    const stock = await getCurrentStock()
    return NextResponse.json({ seeded: stock.length > 0, ...summarize(stock) })
  } catch (e) {
    return NextResponse.json({ seeded: false, error: '無法存取庫存資料庫（請確認 Notion 整合已分享給「蘋果11目前庫存」）：' + (e instanceof Error ? e.message : '') }, { status: 200 })
  }
}

// POST：對帳。action=preview（看差異）/ commit（寫入：空則初始化，有則覆寫）
export async function POST(req: NextRequest) {
  if (!(await requireAuth(['edit', 'portal']))) {
    return NextResponse.json({ error: '驗證已過期，請重新整理頁面並重新輸入密碼' }, { status: 401 })
  }
  try {
    const form = await req.formData()
    const action = (form.get('action') as string | null) ?? 'preview'
    const stockFile = form.get('stockFile') as File | null
    if (!stockFile) return NextResponse.json({ error: '請上傳倉庫庫存檔' }, { status: 400 })

    const { apples } = await parseMudoStock(await stockFile.arrayBuffer())
    if (apples.length === 0) {
      return NextResponse.json({ error: '讀不到任何蘋果品項，請確認檔案格式' }, { status: 422 })
    }

    let seeded = false
    try { seeded = await isStockSeeded() }
    catch (e) { return NextResponse.json({ error: '無法存取庫存資料庫（請確認 Notion 整合已分享給「蘋果11目前庫存」）：' + (e instanceof Error ? e.message : '') }, { status: 502 }) }

    if (action === 'preview') {
      if (!seeded) {
        return NextResponse.json({ mode: 'seed', willSeed: true, ...summarize(apples) })
      }
      const current = await getCurrentStock()
      const diff = diffStock(current, apples)
      return NextResponse.json({ mode: 'reconcile', diff })
    }

    // commit
    if (!seeded) {
      const n = await seedStock(apples)
      return NextResponse.json({ mode: 'seed', done: true, count: n, ...summarize(apples) })
    }
    const result = await overwriteStock(apples)
    return NextResponse.json({ mode: 'reconcile', done: true, ...result, ...summarize(apples) })
  } catch (err) {
    console.error('[apple11/stock]', err)
    return NextResponse.json({ error: '處理失敗，請確認檔案格式' }, { status: 500 })
  }
}
