/**
 * 出貨提醒 — 每天早上 09:00（台灣）掃一次所有檢查單的「配送日期」，兩種情況會推播到出貨 LINE 群組：
 *   ① 本日出荷  ：配送日期＝今天（含已完結的單，用 ✅ 標示，讓大家知道今天要出什麼）
 *   ② 2日後出荷：配送日期＝今天＋2 天，且還沒完結（提前備料用，只提醒還沒做完的）
 * 兩段合併成「同一則」訊息發送，一天最多一則，不會多燒 LINE 額度。
 * 「出貨日期待訂」（deliveryDate = null）的單自然不會被抓到，等填了日期才會進入提醒範圍。
 * 由 app/api/checklist/notify-upcoming/route.ts 的每日 cron 呼叫。
 */
import { getChecklists, isChecklistConfigured } from '@/lib/checklist'
import { pushChecklistGroup, lineNotifyConfigured } from '@/lib/lineNotify'

const CHECKLIST_URL = 'https://lopia-status.vercel.app/checklist'

/**
 * 今天是幾號（以台灣時間算，回傳 YYYY-MM-DD）。
 * 為什麼要特別處理：Vercel 伺服器的時鐘是 UTC（比台灣慢 8 小時），
 * 直接用 new Date() 取日期，在某些時間點會算成「昨天」。這裡明講用 Asia/Taipei 就不會錯。
 */
function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** 兩個 YYYY-MM-DD 日期相差幾天（都當成 UTC 零點來算，不受伺服器時區影響）。 */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000
  )
}

/** 把 YYYY-MM-DD 變成好讀的「8/10」。 */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

interface ReminderItem {
  shipmentNo: string
  deliveryDate: string | null
  content: string | null
  stage: string
  completed: boolean
}

/** 把一批檢查單排成訊息裡的條列文字。 */
function formatLines(items: ReminderItem[]): string {
  return items
    .map(it => {
      // 已完結的單前面加 ✅，一眼知道這批文件已經全部檢查過了
      let s = `■ ${it.completed ? '✅ ' : ''}${it.shipmentNo}（${it.stage}）`
      if (it.content) s += `\n　${it.content}`
      return s
    })
    .join('\n\n')
}

async function buildMessage(): Promise<string | null> {
  const items = await getChecklists()
  const today = taipeiToday()

  // 只看有填配送日期的單；用「今天」跟每張單的配送日期比對差幾天
  const dated = items.filter(it => !!it.deliveryDate)
  const todayItems = dated.filter(it => daysBetween(today, it.deliveryDate!) === 0)
  const in2Days = dated.filter(it => daysBetween(today, it.deliveryDate!) === 2 && !it.completed)

  if (todayItems.length === 0 && in2Days.length === 0) return null

  const sections: string[] = []
  if (todayItems.length > 0) {
    sections.push(`▼ 本日出荷（${shortDate(today)}）\n\n${formatLines(todayItems)}`)
  }
  if (in2Days.length > 0) {
    const d = in2Days[0].deliveryDate!
    sections.push(`▼ 2日後出荷（${shortDate(d)}）\n\n${formatLines(in2Days)}`)
  }

  return `【出荷リマインド】\n\n${sections.join('\n\n')}\n\n▶ チェックリスト：${CHECKLIST_URL}`
}

/**
 * 跑一次提醒。
 * @param dryRun 只產生訊息、不真的發 LINE（測試看格式用，不會消耗 LINE 額度）
 */
export async function runUpcomingReminder(dryRun = false) {
  if (!isChecklistConfigured()) {
    return { ok: false, reason: '尚未設定 NOTION_CHECKLIST_DB', pushed: false, message: null as string | null }
  }
  const message = await buildMessage()
  if (!message) {
    return { ok: true, pushed: false, message: null as string | null, reason: '今天沒有出貨，兩天後也沒有' }
  }
  if (dryRun) {
    return { ok: true, dryRun: true, lineConfigured: lineNotifyConfigured(), pushed: false, message }
  }
  const pushed = await pushChecklistGroup(message)
  return { ok: true, lineConfigured: lineNotifyConfigured(), pushed, message }
}
