/**
 * 「本週是哪一天到哪一天」的共用小工具（純計算，沒有連 Notion）
 * ───────────────────────────────────────────────────────────────
 * 為什麼要單獨拉出來一個檔案：
 *   lib/weekly.ts 是伺服器端的（裡面有 Notion 金鑰相關的東西），
 *   瀏覽器端的頁面（app/checklist/page.tsx）不能 import 它。
 *   但兩邊都需要「本週＝週一～週日」這個定義，所以放在這裡共用，
 *   避免兩邊各寫一份、以後改了一邊忘了另一邊。
 */

/**
 * 回傳指定週的週一～週日（yyyy-mm-dd）。offsetWeeks=0 是本週、-1 上週、+1 下週。
 * 為什麼要自己算時區：Vercel 伺服器是 UTC，直接用 new Date() 會在台灣週日晚上就跳到下一週。
 */
export function weekRange(offsetWeeks = 0, nowMs = Date.now()): { from: string; to: string; label: string } {
  const TW_OFFSET = 8 * 60 * 60 * 1000
  const tw = new Date(nowMs + TW_OFFSET) // 用底下的 getUTC* 讀，即等於台灣當地時間
  const dow = tw.getUTCDay()             // 0=日, 1=一, …, 6=六
  const mondayShift = (dow === 0 ? -6 : 1 - dow) + offsetWeeks * 7
  const monday = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate() + mondayShift))
  const sunday = new Date(monday.getTime() + 6 * 86400000)
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  const from = fmt(monday)
  const to = fmt(sunday)
  return { from, to, label: `${from} ~ ${to}` }
}
