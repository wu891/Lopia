import { NextRequest, NextResponse, after } from 'next/server'
import {
  getChecklistById, saveChecklistState, deleteChecklist,
  updateChecklistInfo, getChecklistByShipmentNo,
  applyCheck, applyReject, canCheck,
  currentLayerId, LAST_LAYER_ID, WAREHOUSES,
} from '@/lib/checklist'
import { requireWho } from '@/lib/checklistAuth'
import { clampLen } from '@/lib/auth'
import { pushChecklistGroup } from '@/lib/lineNotify'

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

// TMJ AI 發到 LINE 群組的訊息一律用日文（給日本本社/供應商看）；帶連結可直接點開該張單
const CHECKLIST_URL = 'https://lopia-status.vercel.app/checklist'
function checklistLink(shipmentNo: string): string {
  return `${CHECKLIST_URL}?s=${encodeURIComponent(shipmentNo)}`
}

// 三重チェックが全部終わった（＝この出荷が完結した）時だけ送る通知（日文）。
// LINE額度緊縮中、途中の層の遷移・差し戻しは通知しない。
function completedMessage(shipmentNo: string): string {
  const link = checklistLink(shipmentNo)
  return `🎉【${shipmentNo}】\n`
    + `✅ 三重チェック 全工程完了\n`
    + `（第1重 相互チェック → 第2重 送達確認 → 第3重 総合確認、すべて完了しました）\n\n`
    + `▶ チェックリスト：${link}`
}

// DELETE：刪除一張檢查清單（要登入才能刪；實際上是把 Notion 頁面丟進垃圾桶，30 天內可救回）
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await requireWho()
  if (!who) return NextResponse.json({ error: '請先登入' }, { status: 401 })

  try {
    const { id } = await params
    await deleteChecklist(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: '刪除失敗' }, { status: 500 })
  }
}

// PATCH：勾/取消勾（action=check）、修改基本資料（action=edit）或 退回（action=reject）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await requireWho()
  if (!who) return NextResponse.json({ error: '請先登入' }, { status: 401 })

  try {
    const { id } = await params
    const body = await req.json()
    const action = body.action
    const nowIso = new Date().toISOString()

    const current = await getChecklistById(id)

    // 樂觀鎖：前端帶著它載入時看到的版本(lastEdited)，若這張單在期間被別人改過就擋下，
    // 避免「兩人幾乎同時各自勾一項 → 後寫入者整份覆蓋掉先寫入者的勾」的靜默資料遺失。
    // 第一重 KIDO＆COLIN 是設計上就會同時在同一張單上互查，這種情況最常發生。
    const baseLastEdited = typeof body.baseLastEdited === 'string' ? body.baseLastEdited : null
    if (baseLastEdited && current.lastEdited && baseLastEdited !== current.lastEdited) {
      return NextResponse.json(
        { error: '這張單剛剛被其他人更新了，已幫你重新整理，請再操作一次', conflict: true, item: current },
        { status: 409 },
      )
    }

    const beforeLayer = currentLayerId(current.state)

    if (action === 'check') {
      const itemKey = String(body.itemKey ?? '')
      const checked = !!body.checked
      // 先檢查權限，給明確錯誤訊息（例如「上一層還沒完成」「不能勾自己做的」）
      const can = canCheck(current.state, itemKey, who)
      if (!can.ok) return NextResponse.json({ error: can.reason ?? '無法勾選' }, { status: 403 })

      const next = applyCheck(current.state, itemKey, who, checked, nowIso)
      const saved = await saveChecklistState(id, next)

      // 只在「最後一層（第3重）勾完、此單完結」這一刻通知（LINE額度緊縮期間只留這一種+出貨前2天提醒）。
      // 用 after()：先把回應送給使用者（勾勾馬上有反應），LINE 通知在背景送，
      // pushChecklistGroup 本身不會丟例外，送失敗只寫 log 不影響勾選。
      const afterLayer = currentLayerId(next)
      if (checked && afterLayer > beforeLayer && afterLayer > LAST_LAYER_ID) {
        after(() => pushChecklistGroup(completedMessage(saved.shipmentNo)))
      }
      return NextResponse.json({ item: saved })
    }

    // edit：修改基本資料（出貨單號／配送日期／出貨內容），不動勾選與退回紀錄
    if (action === 'edit') {
      const shipmentNo = clampLen(String(body.shipmentNo ?? ''), 100).trim()
      if (!shipmentNo) return NextResponse.json({ error: '出貨單號不能空白' }, { status: 400 })
      const deliveryDate = typeof body.deliveryDate === 'string' && body.deliveryDate ? body.deliveryDate : null
      const content = clampLen(String(body.content ?? ''), 300).trim() || null
      const warehouseRaw = typeof body.warehouse === 'string' ? body.warehouse.trim() : ''
      const warehouse = WAREHOUSES.includes(warehouseRaw as typeof WAREHOUSES[number]) ? warehouseRaw : null

      // 如果改了單號，先確認沒有跟別張單撞號
      if (shipmentNo !== current.shipmentNo) {
        const dup = await getChecklistByShipmentNo(shipmentNo)
        if (dup && dup.id !== id) {
          return NextResponse.json({ error: `${shipmentNo} 已經有檢查清單了` }, { status: 400 })
        }
      }

      const saved = await updateChecklistInfo(id, current.state, { shipmentNo, deliveryDate, content, warehouse })
      return NextResponse.json({ item: saved })
    }

    if (action === 'reject') {
      const toLayer = Number(body.toLayer)
      const reason = clampLen(body.reason ?? '', 500).trim()
      if (!reason) return NextResponse.json({ error: '退回一定要寫原因' }, { status: 400 })

      const next = applyReject(current.state, toLayer, who, reason, nowIso)
      const saved = await saveChecklistState(id, next)
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
