import { NextResponse } from 'next/server'
import { provisionChecklistDb, isChecklistConfigured } from '@/lib/checklist'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * 一次性建置：建立「出貨三重檢查清單」Notion 資料庫。
 * 用主站編輯密碼保護（requireAuth 'edit'）。
 * 成功後把回傳的 databaseId 貼到 Vercel 環境變數 NOTION_CHECKLIST_DB 再重新部署。
 */
export async function POST() {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: '請先用編輯密碼登入主站' }, { status: 401 })
  }
  if (isChecklistConfigured()) {
    return NextResponse.json({
      ok: true,
      alreadyConfigured: true,
      message: '已設定 NOTION_CHECKLIST_DB，無需重建。',
    })
  }
  try {
    const { databaseId } = await provisionChecklistDb()
    return NextResponse.json({
      ok: true,
      databaseId,
      message: `資料庫已建立。請到 Vercel 設定環境變數 NOTION_CHECKLIST_DB = ${databaseId}，再重新部署。`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '建立失敗'
    console.error(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
