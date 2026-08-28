/**
 * /api/recon-cleanup — 對帳明細「舊檔殘列」清理端點
 * ───────────────────────────────────────────────────────────────
 * 用途：貨單重做過（舊檔刪掉、新檔另一個 fileId）時，把**舊檔**寫進對帳明細的列封存掉。
 *   出貨紀錄本來就會自動被新檔取代，只有對帳明細沒人收 → 請款金額會多算。
 *
 * 用法（token 跟 drive-scan 同一把，只能放 Authorization 標頭）：
 *   GET  /api/recon-cleanup?fileIds=A,B          … 試算：只列出會封存哪些列，不動資料
 *   POST /api/recon-cleanup?fileIds=A,B&apply=1  … 真的封存（Notion 封存＝進垃圾桶，救得回來）
 *
 * 安全設計（照 drive-scan 的規矩）：
 *   - GET 一律強制試算，避免連結被預取就改資料；真正寫入只走 POST ＋ 明確 apply=1
 *   - 只封存「來源檔案」完全等於指定 fileId 的列 → 手動列（來源檔案空白）碰不到
 *   - 保險絲：一次超過 200 列就整批中止（防打錯 fileId 掃掉一大片）
 */

import { NextRequest, NextResponse } from 'next/server'
import { cleanupReconRows } from '@/lib/reconCleanup'

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
    const sp = req.nextUrl.searchParams
    const fileIds = (sp.get('fileIds') ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (fileIds.length === 0) {
      return NextResponse.json({ error: '請帶 ?fileIds=檔案ID1,檔案ID2' }, { status: 400 })
    }
    const apply = !forceDry && sp.get('apply') === '1'
    return NextResponse.json(await cleanupReconRows(fileIds, apply))
  } catch (err) {
    console.error('[recon-cleanup]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return handle(req, true) }   // 一律試算
export async function POST(req: NextRequest) { return handle(req, false) }
