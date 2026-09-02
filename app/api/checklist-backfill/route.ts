/**
 * /api/checklist-backfill — 一次性：第二重新增「商品單價正確」後回補舊檢查單
 * ───────────────────────────────────────────────────────────────
 * 用法（token 跟 drive-scan 同一把，只能放 Authorization 標頭）：
 *   GET  /api/checklist-backfill          … 試算：只列出會補哪幾張，不動資料
 *   POST /api/checklist-backfill?apply=1  … 真的補勾
 *
 * 安全設計（照 recon-cleanup 的規矩）：
 *   - GET 一律強制試算，避免連結被預取就改資料；真正寫入只走 POST ＋ 明確 apply=1
 *   - 只加 l2_price 這一個 key，其他勾選／退回紀錄完全不動
 *   - 保險絲：一次超過 60 張就整批中止
 *
 * 跑完就沒事做了，之後可以連同 lib/checklistBackfill.ts 一起刪掉。
 */

import { NextRequest, NextResponse } from 'next/server'
import { backfillL2Price } from '@/lib/checklistBackfill'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const scan = process.env.DRIVE_SCAN_TOKEN?.trim()
  const cron = process.env.CRON_SECRET?.trim()
  return (!!scan && auth === `Bearer ${scan}`) || (!!cron && auth === `Bearer ${cron}`)
}

async function handle(req: NextRequest, forceDry: boolean) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const apply = !forceDry && req.nextUrl.searchParams.get('apply') === '1'
    return NextResponse.json(await backfillL2Price(apply, new Date().toISOString()))
  } catch (err) {
    console.error('[checklist-backfill]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return handle(req, true) }   // 一律試算
export async function POST(req: NextRequest) { return handle(req, false) }
