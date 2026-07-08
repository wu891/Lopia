/**
 * 三重檢查清單 — 每人 PIN 身分認證
 * ───────────────────────────────────────────────────────────────
 * 為什麼跟現有 lib/auth.ts 分開：現有的是「權限範圍（能不能編輯）」，
 * 這裡要的是「你是誰」（KIDO / COLIN / 林 / 蔡 / 川越），因為要記錄誰勾的、
 * 而且第一重不能勾自己做的。所以需要「身分」，不只是「有沒有權」。
 *
 * 流程：
 *   1. /api/checklist/login POST { person, pin } → 比對 CHECKLIST_PINS → 設 cookie
 *   2. cookie 'lopia_who' 內容：`${personId}.${expiryMs}.${hmac}`（HttpOnly）
 *   3. mutation route 開頭呼叫 requireWho() 取出目前登入者；null＝未登入
 *
 * PIN 設定（Vercel env）：CHECKLIST_PINS="kido:1234,colin:2345,hayashi:3456,cai:4567,kawagoe:5678"
 */

import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import type { PersonId } from '@/lib/checklistModel'
import { PEOPLE } from '@/lib/checklistModel'

const COOKIE_NAME = 'lopia_who'
const COOKIE_TTL_SEC = 12 * 60 * 60 // 12h（一個工作天夠用）

function secret(): string {
  // 用主站的 AUTH_SECRET；沒設就退回 EDIT_PASSWORD（跟現有 auth 一致）
  return (process.env.AUTH_SECRET || process.env.EDIT_PASSWORD || '') + ':who'
}

function isPersonId(v: string): v is PersonId {
  return PEOPLE.some(p => p.id === v)
}

/** 解析 CHECKLIST_PINS env → { personId: pin }。格式壞掉就回空物件 */
function parsePins(): Record<string, string> {
  const raw = process.env.CHECKLIST_PINS?.trim()
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const [id, pin] = pair.split(':').map(s => s?.trim())
    if (id && pin && isPersonId(id)) out[id] = pin
  }
  return out
}

export function pinsConfigured(): boolean {
  return Object.keys(parsePins()).length > 0
}

/** timing-safe 比對，避免用回應時間猜 PIN */
function safeEqual(a: string, b: string): boolean {
  const key = 'pin-compare'
  const ha = createHmac('sha256', key).update(a).digest()
  const hb = createHmac('sha256', key).update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** 驗 PIN；對就回 personId，錯回 null */
export function verifyPin(person: string, pin: unknown): PersonId | null {
  if (typeof pin !== 'string' || !isPersonId(person)) return null
  const pins = parsePins()
  const expected = pins[person]
  if (!expected) return null
  return safeEqual(pin, expected) ? person : null
}

function sign(person: PersonId): string {
  const exp = String(Date.now() + COOKIE_TTL_SEC * 1000)
  const payload = `${person}.${exp}`
  const sig = createHmac('sha256', secret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

function verifyToken(token: string): PersonId | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [person, exp, sig] = parts
  if (!isPersonId(person)) return null
  const expNum = Number(exp)
  if (!Number.isFinite(expNum) || expNum < Date.now()) return null
  const expected = createHmac('sha256', secret()).update(`${person}.${exp}`).digest('hex')
  const sigBuf = Buffer.from(sig, 'hex')
  const expBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length === 0 || sigBuf.length !== expBuf.length) return null
  return timingSafeEqual(sigBuf, expBuf) ? person : null
}

export interface WhoCookie {
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

export function buildWhoCookie(person: PersonId): WhoCookie {
  return {
    name: COOKIE_NAME,
    value: sign(person),
    options: { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: COOKIE_TTL_SEC },
  }
}

export const CLEAR_WHO_COOKIE = {
  name: COOKIE_NAME,
  value: '',
  options: { httpOnly: true as const, secure: true as const, sameSite: 'strict' as const, path: '/', maxAge: 0 },
}

/** 取出目前登入者的 personId；未登入或過期回 null */
export async function requireWho(): Promise<PersonId | null> {
  const c = await cookies()
  const token = c.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}
