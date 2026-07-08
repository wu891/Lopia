import { NextRequest, NextResponse } from 'next/server'
import { updateWeeklyRow, deleteWeeklyRow, getWeeklyRowById } from '@/lib/weekly'
import { canEditWeekly } from '@/lib/checklistModel'
import { requireWho } from '@/lib/checklistAuth'
import { clampLen } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const AUTO_ROW_LOCKED = '這列是從主頁出貨計畫自動同步來的（唯讀）。要修改請到主頁改該批次的出貨計畫，這裡會自動跟著更新。'

// PATCH：修改一列（僅川越／COLIN；自動同步列唯讀）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await requireWho()
  if (!who) return NextResponse.json({ error: '請先登入' }, { status: 401 })
  if (!canEditWeekly(who)) {
    return NextResponse.json({ error: '本週出貨清單只有川越さん和 COLIN 可以編輯' }, { status: 403 })
  }
  try {
    const { id } = await params
    const existing = await getWeeklyRowById(id)
    if (existing.sourceKey) {
      return NextResponse.json({ error: AUTO_ROW_LOCKED }, { status: 403 })
    }
    const data = await req.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = {}
    if (data.product !== undefined) {
      const product = clampLen(data.product ?? '', 200).trim()
      if (!product) return NextResponse.json({ error: '品項不能空白' }, { status: 400 })
      patch.product = product
    }
    if (data.deliveryDate !== undefined) {
      patch.deliveryDate = typeof data.deliveryDate === 'string' && data.deliveryDate ? data.deliveryDate : null
    }
    if (data.stores !== undefined) patch.stores = clampLen(data.stores ?? '', 300).trim()
    if (data.note !== undefined) patch.note = clampLen(data.note ?? '', 300).trim()
    const row = await updateWeeklyRow(id, patch)
    return NextResponse.json({ row })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update weekly row' }, { status: 500 })
  }
}

// DELETE：刪除（封存）一列（僅川越／COLIN；自動同步列唯讀）
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await requireWho()
  if (!who) return NextResponse.json({ error: '請先登入' }, { status: 401 })
  if (!canEditWeekly(who)) {
    return NextResponse.json({ error: '本週出貨清單只有川越さん和 COLIN 可以編輯' }, { status: 403 })
  }
  try {
    const { id } = await params
    const existing = await getWeeklyRowById(id)
    if (existing.sourceKey) {
      return NextResponse.json({ error: AUTO_ROW_LOCKED }, { status: 403 })
    }
    await deleteWeeklyRow(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to delete weekly row' }, { status: 500 })
  }
}
