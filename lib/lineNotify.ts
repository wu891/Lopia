/**
 * LINE 群組推播（第二批啟用；對帳同步是第三批，發到另一個群組）
 * ───────────────────────────────────────────────────────────────
 * 每一層勾完，自動發一則訊息到現有 LINE 群組提醒「輪到下一位」。
 * Drive 自動扣帳／對帳同步也用這裡推播結果。
 *
 * 需要 Vercel env（沒設就靜默略過，不影響呼叫端流程）：
 *   LINE_CHANNEL_ACCESS_TOKEN  … Messaging API 的 channel access token（推播用，跟收訊的 secret 不同，兩個群組共用同一個 token）
 *   LINE_TARGET_GROUP_ID      … 出貨／扣帳通知群組「Lopia台湾支社出荷専用」的 groupId
 *   LINE_RECON_GROUP_ID       … 對帳同步通知群組「LOPIA對帳」的 groupId
 *                                （可從 line-webhook 收到的訊息紀錄裡取得，見 saveLineMessage 的「群組ID」）
 *
 * 注意：發到「群組」用 push message，需要 bot 仍在該群組內。
 */

// ⏸️ 2026-07-22 LINE 月額度用完（429 monthly limit），全站推播暫停，
// 只留「檢查清單」通知（走 pushChecklistGroup，不受此開關影響）。
// 額度恢復（升級方案或每月1日重置）後，把這裡改回 false 即全部恢復。
const PAUSED = true

async function pushText(token: string, groupId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: 'text', text: text.slice(0, 4900) }],
      }),
    })
    if (!res.ok) {
      console.error('LINE push failed:', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (e) {
    console.error('LINE push error:', e)
    return false
  }
}

export function lineNotifyConfigured(): boolean {
  return !!(process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() && process.env.LINE_TARGET_GROUP_ID?.trim())
}

/**
 * 推播一則純文字到「出貨／扣帳」群組。
 * 回傳是否真的送出（env 沒設或失敗回 false）；刻意不丟例外，避免通知失敗連帶讓勾選 API 失敗。
 */
export async function pushToGroup(text: string): Promise<boolean> {
  if (PAUSED) return false
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()
  const groupId = process.env.LINE_TARGET_GROUP_ID?.trim()
  if (!token || !groupId) return false
  return pushText(token, groupId, text)
}

/**
 * 檢查清單專用通道：發到「出貨」群組，不受 PAUSED 開關影響。
 * 三重チェック的「輪到下一位」「差し戻し」通知是流程必需，額度緊縮期間唯一保留的推播。
 */
export async function pushChecklistGroup(text: string): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()
  const groupId = process.env.LINE_TARGET_GROUP_ID?.trim()
  if (!token || !groupId) return false
  return pushText(token, groupId, text)
}

export function reconNotifyConfigured(): boolean {
  return !!(process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() && process.env.LINE_RECON_GROUP_ID?.trim())
}

/** 推播一則純文字到「LOPIA對帳」群組（對帳同步結果專用，跟扣帳通知分開）。 */
export async function pushToReconGroup(text: string): Promise<boolean> {
  if (PAUSED) return false
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()
  const groupId = process.env.LINE_RECON_GROUP_ID?.trim()
  if (!token || !groupId) return false
  return pushText(token, groupId, text)
}
