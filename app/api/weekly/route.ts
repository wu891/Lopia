import { NextRequest, NextResponse } from 'next/server'
import { getWeeklyRows, createWeeklyRow, isWeeklyConfigured, weekRange } from '@/lib/weekly'
import { canEditWeekly, personName } from '@/lib/checklistModel'
import { requireWho } from '@/lib/checklistAuth'
import { clampLen } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET：列出某一週的出貨計畫（唯讀，不需登入）
//   ?week=0 本週(預設) / -1 上週 / 1 下週；也接受 ?all=1 拿全部
export async function GET(req: NextRequest) {
  try {
    if (!isWeeklyConfigured()) {
      return NextResponse.json({ configured: false, rows: [], range: null })
    }
    const sp = req.nextUrl.searchParams
    if (sp.get('all') === '1') {
      const rows = await getWeeklyRows()
      return NextResponse.json({ configured: true, rows, range: null })
    }
    const offset = Number(sp.get('week') ?? '0')
    const range = weekRange(Number.isFinite(offset) ? offset : 0)
    const rows = await getWeeklyRows(range)
    return NextResponse.json({ configured: true, rows, range })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch weekly rows' }, { status: 500 })
  }
}

// POST { product, deliveryDate, stores, note }：新增一列（僅川越／COLIN）
export async function POST(req: NextRequest) {
  const who = await requireWho()
  if (!who) return NextResponse.json({ error: '請先登入' }, { status: 401 })
  if (!canEditWeekly(who)) {
    return NextResponse.json({ error: '本週出貨清單只有川越さん和 COLIN 可以編輯' }, { status: 403 })
  }
  try {
    const data = await req.json()
    const product = clampLen(data.product ?? '', 200).trim()
    if (!product) return NextResponse.json({ error: '請輸入品項' }, { status: 400 })
    const deliveryDate = typeof data.deliveryDate === 'string' && data.deliveryDate ? data.deliveryDate : null
    const stores = clampLen(data.stores ?? '', 300).trim()
    const note = clampLen(data.note ?? '', 300).trim()
    const row = await createWeeklyRow({ product, deliveryDate, stores, note, createdBy: personName(who) })
    return NextResponse.json({ row })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create weekly row'
    const status = /尚未設定/.test(msg) ? 400 : 500
    if (status === 500) console.error(err)
    return NextResponse.json({ error: msg }, { status })
  }
}
