/**
 * POST /api/drive-scan/setup — Drive 自動扣帳的一次性建置（冪等，可重複呼叫）。
 *
 * 做四件事：
 *   1. 出貨紀錄 DB 補「來源檔案」欄
 *   2. 進口批次 DB 補「商品關鍵字」欄
 *   3. 建「Drive出貨單掃描帳」DB（若 NOTION_DRIVE_SCAN_DB 還沒設）
 *      → 回傳新 DB id，要設進 Vercel env 再重新部署
 *   4. 幫現有活躍批次填初始商品關鍵字（只填空白的）
 *
 * 認證：Bearer DRIVE_SCAN_TOKEN（跟掃描端點同一把）
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  ensureRecordsSchema, ensureBatchSchema, provisionLedgerDb, seedBatchKeywords, ledgerDb,
} from '@/lib/driveScan/ledger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const token = process.env.DRIVE_SCAN_TOKEN?.trim()
  const auth = req.headers.get('authorization') ?? ''
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    await ensureRecordsSchema()
    await ensureBatchSchema()
    const seeds = await seedBatchKeywords()

    let ledgerInfo: { databaseId: string; alreadyConfigured: boolean }
    const existing = ledgerDb()
    if (existing) {
      ledgerInfo = { databaseId: existing, alreadyConfigured: true }
    } else {
      const created = await provisionLedgerDb()
      ledgerInfo = { databaseId: created.databaseId, alreadyConfigured: false }
    }

    return NextResponse.json({
      ok: true,
      recordsSchema: '來源檔案 欄位已就緒',
      batchSchema: '商品關鍵字 欄位已就緒',
      keywordsSeeded: seeds.seeded,
      keywordsSkipped: seeds.skipped,
      ledger: ledgerInfo,
      next: ledgerInfo.alreadyConfigured
        ? '帳本已設定，無需動作'
        : `請設定 Vercel env：NOTION_DRIVE_SCAN_DB = ${ledgerInfo.databaseId}，然後重新部署`,
    })
  } catch (err) {
    console.error('[drive-scan setup]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
