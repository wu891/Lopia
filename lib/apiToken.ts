/**
 * 「通行碼」檢查：給自動化程式（月報網站、GAS 排程）讀鎖起來的 API 用。
 *
 * 人用瀏覽器 → 走 requireAuth('edit')（輸入編輯密碼換 cookie）
 * 程式 → 在標頭帶 `Authorization: Bearer {LOPIA_API_TOKEN}`
 *
 * 規則：
 *   - token 只能放標頭，不可改成 ?token= query（會留在紀錄檔）
 *   - 環境變數沒設 → 一律不通過（不會因為忘了設就變成全開）
 *   - 舊的 DRIVE_SCAN_TOKEN 也接受，GAS 排程不用換鑰匙
 */
import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { requireAuth } from '@/lib/auth'

function sameToken(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function bearerOk(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return false
  const given = auth.slice('Bearer '.length).trim()
  if (!given) return false
  const candidates = [process.env.LOPIA_API_TOKEN, process.env.DRIVE_SCAN_TOKEN]
    .map(t => (t ?? '').trim())
    .filter(Boolean)
  return candidates.some(t => sameToken(given, t))
}

/** 有編輯權 cookie，或帶了正確通行碼 → 可以看金額／成本 */
export async function canSeeMoney(req: NextRequest): Promise<boolean> {
  if (bearerOk(req)) return true
  return requireAuth('edit')
}
