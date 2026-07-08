import { NextRequest, NextResponse, after } from 'next/server'
import {
  getChecklistById, saveChecklistState, deleteChecklist,
  updateChecklistInfo, getChecklistByShipmentNo,
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

// TMJ AI 發到 LINE 群組的訊息一律用日文（給日本本社/供應商看）；帶連結可直接點開該張單
const CHECKLIST_URL = 'https://lopia-status.vercel.app/checklist'
function checklistLink(shipmentNo: string): string {
  return `${CHECKLIST_URL}?s=${encodeURIComponent(shipmentNo)}`
}

// 一層完成後的 LINE 通知（日文）。afterLayer＝現在輪到的層；剛完成的是 afterLayer-1。
function nextUpMessage(shipmentNo: string, afterLayer: number): string {
  const link = checklistLink(shipmentNo)
  if (afterLayer > LAST_LAYER_ID) {
    return `🎉【${shipmentNo}】三重チェック 全工程完了\n`
      + `第4重「社外共有」まで完了しました。川越さんが平山さんへ情報共有済みです。\n`
      + `▶ 詳細：${link}`
  }
  // 直前に完了した重（afterLayer-1）の名称と内容
  const done: Record<number, string> = {
    1: '第1重「作成・相互チェック」\n（KIDO・COLINが納品書を相互確認し、林さんへ報告済み）',
    2: '第2重「到着確認」\n（林さんが倉庫（優儲・美福・三義）・物流会社（三義）への到着を確認し、蔡さんへ報告済み）',
    3: '第3重「総合確認」\n（蔡さんがステップ1・2を総合確認し、川越さんへ報告済み）',
  }
  // 次の担当者（afterLayer）と、その人がやること
  const next: Record<number, string> = {
    2: '👉 次は林さんの番です\n出荷指示が倉庫（優儲・美福・三義）・物流会社（三義）へ届いているかご確認ください。',
    3: '👉 次は蔡さんの番です\nステップ1・2の内容を総合確認してください。',
    4: '👉 次は川越さんの番です\n平山さんへ情報共有をお願いします（共有で完了です）。',
  }
  return `🔔【${shipmentNo}】\n`
    + `✅ 完了：${done[afterLayer - 1] ?? ''}\n\n`
    + `${next[afterLayer] ?? ''}\n\n`
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

      // 只有「往上跨過一層」才通知（勾完某層的最後一項）。
      // 用 after()：先把回應送給使用者（勾勾馬上有反應），LINE 通知在背景送，
      // pushToGroup 本身不會丟例外，送失敗只寫 log 不影響勾選。
      const afterLayer = currentLayerId(next)
      if (checked && afterLayer > beforeLayer) {
        after(() => pushToGroup(nextUpMessage(saved.shipmentNo, afterLayer)))
      }
      return NextResponse.json({ item: saved })
    }

    // edit：修改基本資料（出貨單號／配送日期／出貨內容），不動勾選與退回紀錄
    if (action === 'edit') {
      const shipmentNo = clampLen(String(body.shipmentNo ?? ''), 100).trim()
      if (!shipmentNo) return NextResponse.json({ error: '出貨單號不能空白' }, { status: 400 })
      const deliveryDate = typeof body.deliveryDate === 'string' && body.deliveryDate ? body.deliveryDate : null
      const content = clampLen(String(body.content ?? ''), 300).trim() || null

      // 如果改了單號，先確認沒有跟別張單撞號
      if (shipmentNo !== current.shipmentNo) {
        const dup = await getChecklistByShipmentNo(shipmentNo)
        if (dup && dup.id !== id) {
          return NextResponse.json({ error: `${shipmentNo} 已經有檢查清單了` }, { status: 400 })
        }
      }

      const saved = await updateChecklistInfo(id, current.state, { shipmentNo, deliveryDate, content })
      return NextResponse.json({ item: saved })
    }

    if (action === 'reject') {
      const toLayer = Number(body.toLayer)
      const reason = clampLen(body.reason ?? '', 500).trim()
      if (!reason) return NextResponse.json({ error: '退回一定要寫原因' }, { status: 400 })

      const next = applyReject(current.state, toLayer, who, reason, nowIso)
      const saved = await saveChecklistState(id, next)
      // 同樣改成背景送，退回按鈕不用等 LINE
      after(() => pushToGroup(
        `↩️【${saved.shipmentNo}】差し戻し\n` +
        `${personName(who)}が「第${toLayer}重」へ差し戻しました。\n` +
        `理由：${reason}\n` +
        `該当の担当者は再確認をお願いします。\n` +
        `▶ チェックリスト：${checklistLink(saved.shipmentNo)}`
      ))
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
