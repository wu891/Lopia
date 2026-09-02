/**
 * 一次性回補：第二重新增「商品單價正確」(l2_price) 之後，補勾舊檢查單
 * ───────────────────────────────────────────────────────────────
 * 為什麼要這支：
 *   「這一層完成沒」是每次即時重算的（該層每一項都要勾）。第二重多一項，
 *   線上那些「第二重原本三項都勾完」的舊單會瞬間退回「待林さん確認」，
 *   第三重也會重新鎖住 → 已完結的單看起來像沒做完。
 *
 * 做法：只對「第二重舊三項全部已勾、而且 l2_price 還沒勾」的單，
 *   補上一筆 l2_price，記成「蔡さん代林さん確認」＋回補當下的時間（不偽造成當初的時間）。
 *   其他任何欄位、其他層的勾、退回紀錄，一律不動。
 *
 * 這支跑完就沒事做了，之後可以整支刪掉。
 */

import { getChecklists, saveChecklistState } from '@/lib/checklist'
import type { ChecklistState } from '@/lib/checklistModel'

// 第二重「原本就有」的三項：全部勾完才算是這次改版前已經做完第二重的單
const OLD_L2_KEYS = ['l2_warehouse', 'l2_logistics', 'l2_reported']
const NEW_KEY = 'l2_price'

// 保險絲：一次超過這個數量就整批中止（防呆，正常只有 30 幾張單）
const MAX_ROWS = 60

export interface BackfillRow {
  id: string
  shipmentNo: string
  stageBefore: string
  completedBefore: boolean
}

export interface BackfillResult {
  apply: boolean
  scanned: number
  targets: BackfillRow[]
  updated: number
  skipped: { alreadyDone: number; l2Incomplete: number }
  note: string
}

export async function backfillL2Price(apply: boolean, nowIso: string): Promise<BackfillResult> {
  const all = await getChecklists()

  let alreadyDone = 0
  let l2Incomplete = 0
  const targets: BackfillRow[] = []

  for (const c of all) {
    const checks = c.state.checks
    if (checks[NEW_KEY]?.checked === true) { alreadyDone++; continue }
    if (!OLD_L2_KEYS.every(k => checks[k]?.checked === true)) { l2Incomplete++; continue }
    targets.push({
      id: c.id,
      shipmentNo: c.shipmentNo,
      stageBefore: c.stage,
      completedBefore: c.completed,
    })
  }

  if (targets.length > MAX_ROWS) {
    throw new Error(`要補 ${targets.length} 張，超過保險絲上限 ${MAX_ROWS} 張，整批中止`)
  }

  let updated = 0
  if (apply) {
    for (const t of targets) {
      const cur = all.find(c => c.id === t.id)!
      const next: ChecklistState = {
        ...cur.state,
        checks: {
          ...cur.state.checks,
          // 記成「蔡さん代林さん確認」：蔡さん本來就是系統裡的代理人，畫面會顯示「代林さん」
          [NEW_KEY]: { checked: true, by: 'cai', at: nowIso, proxyFor: 'hayashi' },
        },
      }
      await saveChecklistState(t.id, next)
      updated++
    }
  }

  return {
    apply,
    scanned: all.length,
    targets,
    updated,
    skipped: { alreadyDone, l2Incomplete },
    note: apply
      ? `已補勾 ${updated} 張，這些單維持原本的階段`
      : `試算：會補勾 ${targets.length} 張（還沒動資料）`,
  }
}
