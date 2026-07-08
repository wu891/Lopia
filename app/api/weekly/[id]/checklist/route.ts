import { NextRequest, NextResponse } from 'next/server'
import { getWeeklyRowById, markWeeklyChecklistCreated } from '@/lib/weekly'
import { createChecklist } from '@/lib/checklist'
import { requireWho } from '@/lib/checklistAuth'
import { clampLen } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// POST { shipmentNo }：從這一列週計畫建立一張三重檢查清單
//   配送日／品項／店鋪自動帶入，使用者只補 S 單號。任何登入者都可建（這是 KIDO／COLIN 的工作）。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await requireWho()
  if (!who) return NextResponse.json({ error: '請先登入' }, { status: 401 })

  try {
    const { id } = await params
    const data = await req.json()
    const shipmentNo = clampLen(data.shipmentNo ?? '', 40).trim()
    if (!shipmentNo) return NextResponse.json({ error: '請輸入出貨單號（S 單號）' }, { status: 400 })

    const row = await getWeeklyRowById(id)
    // 把「這批出什麼」組成一段文字帶進檢查清單，讓檢查的人看得到內容而不只是 S 單號
    const content = [row.product, row.stores, row.note].map(s => (s || '').trim()).filter(Boolean).join('｜')

    const checklist = await createChecklist({
      shipmentNo,
      deliveryDate: row.deliveryDate,
      content,
    })
    const weekly = await markWeeklyChecklistCreated(id, checklist.id)
    return NextResponse.json({ checklist, weekly })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create checklist from weekly row'
    const status = /已經有|尚未設定|已存在/.test(msg) ? 400 : 500
    if (status === 500) console.error(err)
    return NextResponse.json({ error: msg }, { status })
  }
}
