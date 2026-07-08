import { NextRequest, NextResponse } from 'next/server'
import { getChecklists, createChecklist, isChecklistConfigured } from '@/lib/checklist'
import { requireWho } from '@/lib/checklistAuth'
import { clampLen } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET：列出所有檢查清單（唯讀，不需登入；牆上螢幕也能看狀態）
export async function GET() {
  try {
    if (!isChecklistConfigured()) {
      return NextResponse.json({ configured: false, items: [] })
    }
    const items = await getChecklists()
    return NextResponse.json({ configured: true, items })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch checklists' }, { status: 500 })
  }
}

// POST { shipmentNo, deliveryDate }：建立一張新檢查清單（需登入）
export async function POST(req: NextRequest) {
  const who = await requireWho()
  if (!who) return NextResponse.json({ error: '請先登入' }, { status: 401 })

  try {
    const data = await req.json()
    const shipmentNo = clampLen(data.shipmentNo ?? '', 40).trim()
    if (!shipmentNo) {
      return NextResponse.json({ error: '請輸入出貨單號（S 單號）' }, { status: 400 })
    }
    const deliveryDate = typeof data.deliveryDate === 'string' && data.deliveryDate ? data.deliveryDate : null
    const content = clampLen(data.content ?? '', 500).trim() || null
    const item = await createChecklist({ shipmentNo, deliveryDate, content })
    return NextResponse.json({ item })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create checklist'
    // 已存在 / 未設定 DB 之類屬於可預期錯誤，回 400 讓前端顯示訊息
    const status = /已經有|尚未設定|已存在/.test(msg) ? 400 : 500
    if (status === 500) console.error(err)
    return NextResponse.json({ error: msg }, { status })
  }
}
