/**
 * POST/GET /api/drive-scan — Drive 出貨單自動扣帳的掃描端點。
 *
 * 呼叫者：Google Apps Script 定時器（每 10 分鐘一次），帶
 *   Authorization: Bearer {DRIVE_SCAN_TOKEN}
 *
 * 參數（query string）：
 *   ?dry=1        … 試跑：只算不寫、不發 LINE（回補核對表也用這個）
 *   ?force=1      … 忽略「指紋沒變就跳過」與「10 分鐘冷靜期」，全部重算
 *   ?fileId=xxx   … 只處理指定檔案
 *
 * ⚠️ 安全：token 只能放 Authorization 標頭，絕不可改成 ?token= query 參數
 *    （會被瀏覽器/預覽器/紀錄檔留存，變成可被貼連結觸發的寫入）。
 *    GET 一律強制 dry（只算不寫），真正扣帳只走 POST（GAS 鬧鐘用 POST）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { runScan } from '@/lib/driveScan/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60   // 掃描＋Notion 寫入可能超過預設 10 秒

function authorized(req: NextRequest): boolean {
  const token = process.env.DRIVE_SCAN_TOKEN?.trim()
  const auth = req.headers.get('authorization') ?? ''
  return !!token && auth === `Bearer ${token}`   // token 沒設就一律拒絕（fail-closed）
}

async function handle(req: NextRequest, forceDry: boolean) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const sp = req.nextUrl.searchParams
    const result = await runScan({
      dry: forceDry || sp.get('dry') === '1',
      force: sp.get('force') === '1',
      onlyFileId: sp.get('fileId') ?? undefined,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[drive-scan]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST = 真正扣帳（GAS 鬧鐘用這個）；GET 一律強制 dry，避免被連結預取誤觸發寫入
export async function POST(req: NextRequest) { return handle(req, false) }
export async function GET(req: NextRequest) { return handle(req, true) }
