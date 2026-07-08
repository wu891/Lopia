/**
 * LINE 群組推播（第二批啟用）
 * ───────────────────────────────────────────────────────────────
 * 每一層勾完，自動發一則訊息到現有 LINE 群組提醒「輪到下一位」。
 *
 * 需要兩個 Vercel env（沒設就靜默略過，不影響勾選流程）：
 *   LINE_CHANNEL_ACCESS_TOKEN  … Messaging API 的 channel access token（推播用，跟收訊的 secret 不同）
 *   LINE_TARGET_GROUP_ID       … 要發到哪個群組的 groupId
 *                                （可從 line-webhook 收到的訊息紀錄裡取得，見 saveLineMessage 的「群組ID」）
 *
 * 注意：發到「群組」用 push message，需要 bot 仍在該群組內。
 */

export function lineNotifyConfigured(): boolean {
  return !!(process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() && process.env.LINE_TARGET_GROUP_ID?.trim())
}

/**
 * 推播一則純文字到設定好的群組。
 * 回傳是否真的送出（env 沒設或失敗回 false）；刻意不丟例外，避免通知失敗連帶讓勾選 API 失敗。
 */
export async function pushToGroup(text: string): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()
  const groupId = process.env.LINE_TARGET_GROUP_ID?.trim()
  if (!token || !groupId) return false

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
