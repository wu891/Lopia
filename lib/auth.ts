/**
 * Server-side auth helpers.
 *
 * 兩種 scope:
 *   - 'edit'  : 主站編輯權（EDIT_PASSWORD）
 *   - 'portal': 物流業者後台（LOGISTICS_PASSWORD）
 *
 * 流程:
 *   1. /api/auth (POST) 驗 password → 設定 HttpOnly cookie 'lopia_auth'
 *      cookie value: `${scope}.${expiryMs}.${hmac}`
 *   2. mutation route 開頭呼叫 `await requireAuth('edit')`，cookie 通過才繼續
 *   3. cookie 預設 8 小時過期，HttpOnly + Secure + SameSite=Strict
 */

import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'

export type AuthScope = 'edit' | 'portal' | 'demand'

const COOKIE_NAME = 'lopia_auth'
const COOKIE_TTL_SEC = 8 * 60 * 60 // 8h

function getSecret(scope: AuthScope): string {
  // AUTH_SECRET 是專用 HMAC key；若未設則 fallback 到對應 password
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET + ':' + scope
  if (scope === 'portal') return process.env.LOGISTICS_PASSWORD ?? ''
  if (scope === 'demand') return process.env.DEMAND_PASSWORD ?? ''
  return process.env.EDIT_PASSWORD ?? ''
}

function sign(scope: AuthScope): string | null {
  const secret = getSecret(scope)
  if (!secret) return null
  const exp = String(Date.now() + COOKIE_TTL_SEC * 1000)
  const payload = `${scope}.${exp}`
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

function verify(token: string, scope: AuthScope): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [tokenScope, exp, sig] = parts
  if (tokenScope !== scope) return false
  const expNum = Number(exp)
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false
  const secret = getSecret(scope)
  if (!secret) return false
  const expected = createHmac('sha256', secret).update(`${tokenScope}.${exp}`).digest('hex')
  const sigBuf = Buffer.from(sig, 'hex')
  const expBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length === 0 || sigBuf.length !== expBuf.length) return false
  return timingSafeEqual(sigBuf, expBuf)
}

export async function requireAuth(scope: AuthScope | AuthScope[] = 'edit'): Promise<boolean> {
  const c = await cookies()
  const token = c.get(COOKIE_NAME)?.value
  if (!token) return false
  const scopes = Array.isArray(scope) ? scope : [scope]
  return scopes.some(s => verify(token, s))
}

export interface AuthCookie {
  name: string
  value: string
  options: {
    httpOnly: true
    secure: true
    sameSite: 'strict'
    path: '/'
    maxAge: number
  }
}

export function buildAuthCookie(scope: AuthScope): AuthCookie | null {
  const value = sign(scope)
  if (!value) return null
  return {
    name: COOKIE_NAME,
    value,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: COOKIE_TTL_SEC,
    },
  }
}

export const CLEAR_COOKIE = {
  name: COOKIE_NAME,
  value: '',
  options: {
    httpOnly: true as const,
    secure: true as const,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: 0,
  },
}

/** Timing-safe 密碼比對：長度不同時也走完整 HMAC 比較，避免時序洩漏。 */
export function safePasswordCompare(input: unknown, expected: string | undefined): boolean {
  if (typeof input !== 'string' || !expected) return false
  const key = 'pw-compare'
  const a = createHmac('sha256', key).update(input).digest()
  const b = createHmac('sha256', key).update(expected).digest()
  return timingSafeEqual(a, b)
}

// ── 簡易暴力嘗試限制（記憶體型，per serverless instance）──────────────────────
// 同一 IP 在 10 分鐘內密碼錯誤達 8 次後暫時封鎖。
// 注意：Vercel 每個 instance 各自計數，僅為基本防護，非完整 rate limit。
const FAIL_WINDOW_MS = 10 * 60 * 1000
const FAIL_LIMIT = 8
const failLog = new Map<string, number[]>()

export function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const fails = (failLog.get(ip) ?? []).filter(t => now - t < FAIL_WINDOW_MS)
  failLog.set(ip, fails)
  return fails.length >= FAIL_LIMIT
}

export function recordAuthFail(ip: string) {
  const fails = failLog.get(ip) ?? []
  fails.push(Date.now())
  failLog.set(ip, fails)
  // 防止 Map 無限成長
  if (failLog.size > 1000) {
    const now = Date.now()
    for (const [k, v] of failLog) {
      if (v.every(t => now - t >= FAIL_WINDOW_MS)) failLog.delete(k)
    }
  }
}

export function clearAuthFails(ip: string) {
  failLog.delete(ip)
}

/** HTML escape for safely embedding user input into HTML email bodies. */
export function htmlEscape(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Truncate a string to a max char length (for limiting user-supplied log content). */
export function clampLen(s: unknown, max: number): string {
  const str = String(s ?? '')
  return str.length <= max ? str : str.slice(0, max)
}

/** Strip filesystem-unsafe chars from user-supplied filename fragments. */
export function sanitizeFilenamePart(s: unknown, max = 50): string {
  return String(s ?? '')
    .replace(/[\\/:*?"<>| -]/g, '')
    .trim()
    .slice(0, max)
}
