import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { parseInventoryExcel } from '@/lib/parseInventoryExcel'
import { upsertInventory, diffInventory, reconcileInventory } from '@/lib/inventoryNotion'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ── 共用：把 items 存進 Notion ──────────────────────────────────────────
// syncTime 傳入時使用（例如 Gmail 信件寄出時間），未傳入則用現在時間（手動上傳）
async function syncItems(buffer: Buffer, source: string, syncTime?: string) {
  const items = parseInventoryExcel(buffer)
  const time = syncTime ?? new Date().toISOString()
  const result = await upsertInventory(items, time)
  console.log(`[inventory sync] source=${source} updated=${result.updated} created=${result.created}`)
  return { ...result, total: items.length, syncTime: time }
}

// ── Gmail 拉取 ───────────────────────────────────────────────────────────
// 支援兩種驗證方式（優先用方式 A）：
//
// 方式 A：Service Account + 網域授權（DWD）—— 推薦給 Google Workspace 管理員
//   前置作業：
//   1. GCP Console → 啟用 Gmail API
//   2. Google Workspace 管理員控制台 → 安全性 → API 控制 → 網域廣泛授權
//      → 新增服務帳號 Client ID，範圍填入：https://www.googleapis.com/auth/gmail.readonly
//   不需額外 env var（使用現有的 GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY + GMAIL_USER）
//
// 方式 B：OAuth2 Refresh Token —— 不需要 Workspace 管理員
//   前置作業：
//   1. GCP Console → 建立 OAuth2 Client（Web application），Redirect URI 填：
//      https://developers.google.com/oauthplayground
//   2. 到 https://developers.google.com/oauthplayground
//      右上角設定 → Use your own OAuth credentials → 輸入 Client ID / Secret
//      選取範圍：https://www.googleapis.com/auth/gmail.readonly → 授權 → 換取 token
//   3. 把 Refresh token 複製到 Vercel env：GMAIL_REFRESH_TOKEN
//   Vercel env vars：GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
async function pullFromGmail(): Promise<{ buffer: Buffer; emailDate: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let auth: any

  const refreshToken = process.env.GMAIL_REFRESH_TOKEN
  const clientId     = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET

  if (refreshToken && clientId && clientSecret) {
    // 方式 B：OAuth2
    const oauth = new google.auth.OAuth2(clientId, clientSecret)
    oauth.setCredentials({ refresh_token: refreshToken })
    auth = oauth
  } else {
    // 方式 A：Service Account + DWD
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL
    const subject = process.env.GMAIL_USER  // 要模擬的信箱（ex: wu@tm-japan.jp）
    if (!clientEmail || !privateKey || !subject) {
      throw new Error(
        'Gmail 設定不完整：請設定 DWD（GOOGLE_CLIENT_EMAIL + GMAIL_USER）或 OAuth2（GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN）'
      )
    }
    auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      subject,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gmail = google.gmail({ version: 'v1', auth: auth as any })

  // 搜尋倉庫寄件人最近 30 天內含 xlsx 附件的信
  const SENDER = 'vera.peng@goodsmile.ltd'
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `from:${SENDER} has:attachment filename:xlsx newer_than:30d`,
    maxResults: 5,
  })

  const messages = listRes.data.messages ?? []
  if (!messages.length) throw new Error(`在 Gmail 找不到 ${SENDER} 寄來的庫存 Excel（最近 30 天）`)

  // 取最新一封（list 預設從新到舊）
  const msgId = messages[0].id!
  const msg = await gmail.users.messages.get({ userId: 'me', id: msgId })

  // 信件寄出時間（internalDate 是 Unix ms 時間戳）
  const emailDate = msg.data.internalDate
    ? new Date(Number(msg.data.internalDate)).toISOString()
    : new Date().toISOString()

  // 找 xlsx 附件
  const parts = msg.data.payload?.parts ?? []
  let attachmentId: string | null = null
  for (const part of parts) {
    if (part.filename?.endsWith('.xlsx') && part.body?.attachmentId) {
      attachmentId = part.body.attachmentId
      break
    }
  }
  if (!attachmentId) throw new Error('信件中找不到 .xlsx 附件')

  const att = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: msgId,
    id: attachmentId,
  })

  // Gmail 回傳 base64url 編碼
  const data = att.data.data ?? ''
  const buffer = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return { buffer, emailDate }
}

// ── GET：Vercel Cron 觸發（每小時）──────────────────────────────────────
// vercel.json cron 會在 Authorization header 帶 Bearer CRON_SECRET
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { buffer, emailDate } = await pullFromGmail()
    const result = await syncItems(buffer, 'gmail-cron', emailDate)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[inventory sync cron]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── POST：手動上傳 Excel 或手動觸發 Gmail 拉取 ──────────────────────────
export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ct = req.headers.get('content-type') ?? ''

  // 手動上傳 xlsx 檔案
  if (ct.includes('multipart/form-data')) {
    try {
      const form = await req.formData()
      const file = form.get('file') as File | null
      const mode = String(form.get('mode') ?? 'upsert') // upsert(預設) / preview / replace
      if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
      if (!file.name.endsWith('.xlsx')) {
        return NextResponse.json({ error: '請上傳 .xlsx 格式的檔案' }, { status: 400 })
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      const items = parseInventoryExcel(buffer)

      // preview：只比對差異、不寫入，給前端預覽確認用
      if (mode === 'preview') {
        const diff = await diffInventory(items)
        return NextResponse.json({ ok: true, diff, total: items.length })
      }

      // replace（校正）：報表內更新/新增，報表沒有的舊品項移除
      if (mode === 'replace') {
        const time = new Date().toISOString()
        const result = await reconcileInventory(items, time)
        console.log(`[inventory reconcile] updated=${result.updated} created=${result.created} removed=${result.removed}`)
        return NextResponse.json({ ok: true, ...result, total: items.length, syncTime: time })
      }

      // 預設（沿用舊「上傳 Excel」按鈕）：只更新/新增，不移除
      const time = new Date().toISOString()
      const result = await upsertInventory(items, time)
      console.log(`[inventory sync] source=manual-upload updated=${result.updated} created=${result.created}`)
      return NextResponse.json({ ok: true, ...result, total: items.length, syncTime: time })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // 手動觸發 Gmail 拉取
  try {
    const { buffer, emailDate } = await pullFromGmail()
    const result = await syncItems(buffer, 'gmail-manual', emailDate)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
