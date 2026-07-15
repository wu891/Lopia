/**
 * 出貨前兩天提醒 — 掃描所有未完結的檢查單，配送日剛好是「今天 + 2 天」就推播到出貨 LINE 群組。
 * 「出貨日期待訂」（deliveryDate = null）的單自然不會被抓到，等填了日期才會進入提醒範圍。
 * 由 app/api/checklist/notify-upcoming/route.ts 的每日 cron 呼叫。
 */
import { getChecklists, isChecklistConfigured } from '@/lib/checklist'
import { pushToGroup, lineNotifyConfigured } from '@/lib/lineNotify'

const CHECKLIST_URL = 'https://lopia-status.vercel.app/checklist'

function daysUntil(iso: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(iso + 'T00:00:00')
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

async function buildMessage(): Promise<string | null> {
  const items = await getChecklists()
  const targets = items.filter(it => !it.completed && it.deliveryDate && daysUntil(it.deliveryDate) === 2)
  if (targets.length === 0) return null

  const lines = targets.map(it => {
    let s = `■ ${it.shipmentNo}（${it.stage}）`
    if (it.content) s += `\n　${it.content}`
    return s
  })
  return `【出荷2日前リマインド】\n\n${lines.join('\n\n')}\n\n▶ チェックリスト：${CHECKLIST_URL}`
}

export async function runUpcomingReminder() {
  if (!isChecklistConfigured()) {
    return { ok: false, reason: '尚未設定 NOTION_CHECKLIST_DB', pushed: false, message: null as string | null }
  }
  const message = await buildMessage()
  if (!message) {
    return { ok: true, pushed: false, message: null as string | null, reason: '沒有兩天後要出貨的單' }
  }
  const pushed = await pushToGroup(message)
  return { ok: true, lineConfigured: lineNotifyConfigured(), pushed, message }
}
