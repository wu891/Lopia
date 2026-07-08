import { NextRequest, NextResponse } from 'next/server'
import {
  getChecklistById, saveChecklistState,
  applyCheck, applyReject, canCheck,
  currentLayerId, personName, LAST_LAYER_ID,
} from '@/lib/checklist'
import { requireWho } from '@/lib/checklistAuth'
import { clampLen } from '@/lib/auth'
import { pushToGroup } from '@/lib/lineNotify'

export const dynamic = 'force-dynamic'

// GET：取單一檢查清單
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const item = await getChecklistById(id)
    return NextResponse.json({ item })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch checklist' }, { status: 500 })
  }
}

// 一層完成後，下一位是誰（給 LINE 通知用）
function nextUpMessage(shipmentNo: string, afterLayer: number): string {
  if (afterLayer > LAST_LAYER_ID) {
    return `✅【${shipmentNo}】三重檢查全部完成，川越さん已共享給平山さん。`
  }
  const nextWho: Record<number, string> = {
    2: '林さん（確認指示已送達倉庫與物流）',
    3: '蔡さん（總合確認）',
    4: '川越さん（共享給平山さん）',
  }
  return `🔔【${shipmentNo}】上一層已完成，輪到 ${nextWho[afterLayer] ?? ''} 確認。`
}

// PATCH：勾/取消勾（action=check）或 退回（action=reject）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await requireWho()
  if (!who) return NextResponse.json({ error: '請先登入' }, { status: 401 })

  try {
    const { id } = await params
    const body = await req.json()
    const action = body.action
    const nowIso = new Date().toISOString()

    const current = await getChecklistById(id)
    const beforeLayer = currentLayerId(current.state)

    if (action === 'check') {
      const itemKey = String(body.itemKey ?? '')
      const checked = !!body.checked
      // 先檢查權限，給明確錯誤訊息（例如「上一層還沒完成」「不能勾自己做的」）
      const can = canCheck(current.state, itemKey, who)
      if (!can.ok) return NextResponse.json({ error: can.reason ?? '無法勾選' }, { status: 403 })

      const next = applyCheck(current.state, itemKey, who, checked, nowIso)
      const saved = await saveChecklistState(id, next)

      // 只有「往上跨過一層」才通知（勾完某層的最後一項）
      const afterLayer = currentLayerId(next)
      if (checked && afterLayer > beforeLayer) {
        await pushToGroup(nextUpMessage(saved.shipmentNo, afterLayer))
      }
      return NextResponse.json({ item: saved })
    }

    if (action === 'reject') {
      const toLayer = Number(body.toLayer)
      const reason = clampLen(body.reason ?? '', 500).trim()
      if (!reason) return NextResponse.json({ error: '退回一定要寫原因' }, { status: 400 })

      const next = applyReject(current.state, toLayer, who, reason, nowIso)
      const saved = await saveChecklistState(id, next)
      await pushToGroup(
        `↩️【${saved.shipmentNo}】被 ${personName(who)} 退回到第 ${toLayer} 層，` +
        `原因：${reason}。請該層重新確認。`
      )
      return NextResponse.json({ item: saved })
    }

    return NextResponse.json({ error: '未知的操作' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update checklist'
    // applyCheck/applyReject 丟的是可預期的驗證錯誤 → 400；其餘 500
    const known = /退回|不能|上層|上一層|只有|無法勾|層級/.test(msg)
    if (!known) console.error(err)
    return NextResponse.json({ error: msg }, { status: known ? 400 : 500 })
  }
}
