import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { google } from 'googleapis'
import { requireAuth, htmlEscape } from '@/lib/auth'

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  return google.drive({ version: 'v3', auth })
}

async function grantDriveAccess(emails: string[]) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
  if (!folderId || !process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) return
  const drive = getDriveClient()
  await Promise.allSettled(
    emails.map(email =>
      drive.permissions.create({
        fileId: folderId,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: { role: 'reader', type: 'user', emailAddress: email },
      })
    )
  )
}

export async function POST(req: NextRequest) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()

    // ── Warehouse dispatch notification ──────────────────────────────────────
    // 派貨通知：告訴倉庫「甚麼時候、哪間店、哪個商品、幾箱」
    // 觸發時機：Colin 在 inventory 頁確認出貨回次後點「通知倉庫」
    if (body.type === 'dispatch') {
      const { batchName, roundNo, storeOrders, dispatchDate } = body as {
        batchName: string
        roundNo: number | string
        storeOrders: { storeName: string; products: { name: string; quantity: number }[]; boxes: number; deliveryDate?: string }[]
        dispatchDate?: string
      }

      const recipient =
        process.env.DISPATCH_EMAIL ??        // 倉庫專用收件人（優先）
        process.env.NOTIFY_EMAILS ??         // 沒設就用一般通知名單
        ''
      if (!recipient) return NextResponse.json({ ok: true, skipped: 'no dispatch recipient' })
      if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD)
        return NextResponse.json({ ok: true, skipped: 'gmail not configured' })

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      })

      const safeBatch = htmlEscape(batchName ?? '—')
      const safeRound = htmlEscape(String(roundNo ?? '—'))
      const safeDate  = htmlEscape(dispatchDate ?? '待確認')

      // 產生各門市列
      const storeRows = (storeOrders ?? []).map(o => {
        const products = o.products.map(p => htmlEscape(`${p.name} ×${p.quantity}`)).join('、')
        const date     = htmlEscape(o.deliveryDate ?? dispatchDate ?? '待確認')
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#334155">${htmlEscape(o.storeName)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center;font-weight:700;color:#E8002D">${o.boxes}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#475569;font-size:13px">${products || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px">${date}</td>
        </tr>`
      }).join('')

      const totalBoxes = (storeOrders ?? []).reduce((s, o) => s + (o.boxes ?? 0), 0)
      const storeCount = (storeOrders ?? []).length

      const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:620px;margin:0 auto">
  <div style="background:#1a1a2e;padding:20px 24px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:12px">
    <div style="background:#E8002D;color:white;padding:4px 10px;border-radius:4px;font-size:13px;font-weight:700;letter-spacing:1px">LOPIA</div>
    <p style="color:white;font-size:18px;font-weight:700;margin:0">派貨通知</p>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:0">
    <!-- 摘要列 -->
    <div style="padding:16px 24px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;gap:24px;flex-wrap:wrap">
      <div><p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">批次</p><p style="margin:4px 0 0;font-weight:700;color:#1e293b">${safeBatch}</p></div>
      <div><p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">回次</p><p style="margin:4px 0 0;font-weight:700;color:#1e293b">第 ${safeRound} 回</p></div>
      <div><p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">出貨日</p><p style="margin:4px 0 0;font-weight:700;color:#1e293b">${safeDate}</p></div>
      <div><p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">門市數</p><p style="margin:4px 0 0;font-weight:700;color:#E8002D">${storeCount} 間</p></div>
      <div><p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">合計箱數</p><p style="margin:4px 0 0;font-weight:700;color:#E8002D">${totalBoxes} 箱</p></div>
    </div>
    <!-- 各門市明細 -->
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">門市</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">箱數</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">商品</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">預計到貨日</th>
        </tr>
      </thead>
      <tbody>${storeRows}</tbody>
    </table>
    <p style="margin:16px 24px 20px;font-size:12px;color:#94a3b8">此信件由 LOPIA 進口追蹤系統自動發送 — 如有疑問請聯絡 TMJ 業務</p>
  </div>
</div>`

      await transporter.sendMail({
        from: `"LOPIA 進口系統" <${process.env.GMAIL_USER}>`,
        to: recipient,
        subject: `【LOPIA 派貨通知】${String(batchName ?? '').slice(0, 60)} 第${roundNo}回 — ${storeCount}間門市 / ${totalBoxes}箱`,
        html,
      })
      return NextResponse.json({ ok: true })
    }

    // ── Chase doc reminder ────────────────────────────────────────────────────
    if (body.type === 'chase') {
      const { batchName, missingDocs, departJP } = body
      if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD)
        return NextResponse.json({ ok: true, skipped: 'gmail not configured' })

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      })
      const docs: string[] = Array.isArray(missingDocs) ? missingDocs : []
      const missingList = docs.map(d => `<li>${htmlEscape(d)}</li>`).join('')
      const safeBatchName = htmlEscape(batchName)
      const safeDepartJP = htmlEscape(departJP ?? '—')
      const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
  <div style="background:#f97316;padding:16px 24px;border-radius:8px 8px 0 0">
    <p style="color:white;font-size:18px;font-weight:700;margin:0">📨 LOPIA — 書類催促</p>
  </div>
  <div style="border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;padding:20px 24px">
    <p style="margin:0 0 12px;color:#333">以下の書類が未提出です。至急ご確認ください。</p>
    <p style="margin:0 0 6px;font-weight:600;color:#444">ロット：${safeBatchName}</p>
    <p style="margin:0 0 6px;color:#444">出発日：${safeDepartJP}</p>
    <p style="margin:8px 0 4px;color:#444">未提出書類：</p>
    <ul style="margin:0;padding-left:20px;color:#d32f2f;font-weight:600">${missingList}</ul>
    <p style="margin-top:16px;font-size:12px;color:#aaa">此信件由 LOPIA 進口追蹤系統自動發送</p>
  </div>
</div>`
      await transporter.sendMail({
        from: `"LOPIA 進口系統" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `【催件】${String(batchName ?? '').slice(0, 100)} - 文件未齊`,
        html,
      })
      return NextResponse.json({ ok: true })
    }

    // ── New batch notification ────────────────────────────────────────────────
    const { batchName, supplier, transportMode, flightNo, awbNo, departJP, arrivalTW, totalBoxes, fileNames } = body

    const recipients =
      transportMode === '空運' ? (process.env.NOTIFY_EMAILS_AIR ?? process.env.NOTIFY_EMAILS ?? '') :
      transportMode === '海運' ? (process.env.NOTIFY_EMAILS_SEA ?? process.env.NOTIFY_EMAILS ?? '') :
      (process.env.NOTIFY_EMAILS ?? '')
    if (!recipients) return NextResponse.json({ ok: true, skipped: 'no recipients' })
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD)
      return NextResponse.json({ ok: true, skipped: 'gmail not configured' })

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    })

    const driveLink = `https://drive.google.com/drive/folders/${encodeURIComponent(process.env.GOOGLE_DRIVE_FOLDER_ID ?? '')}`

    const rows = [
      ['批次名稱', batchName],
      ['供應商',   supplier  || '—'],
      ['班機號',   flightNo  || '—'],
      ['AWB 號',  awbNo     || '—'],
      ['日本出發日', departJP || '—'],
      ['抵台日',   arrivalTW || '—'],
      ['入倉箱數',  totalBoxes ? `${totalBoxes} 箱` : '—'],
    ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap">${htmlEscape(k)}</td><td style="padding:4px 0;font-weight:600">${htmlEscape(v)}</td></tr>`).join('')

    const safeFileNames: string[] = Array.isArray(fileNames) ? fileNames : []
    const fileListHtml = safeFileNames.length
      ? `<p style="margin:16px 0 4px;color:#444;font-size:14px">📎 已上傳文件：</p><ul style="margin:0;padding-left:20px">${safeFileNames.map((n) => `<li style="font-size:13px;color:#555">${htmlEscape(n)}</li>`).join('')}</ul>`
      : ''

    const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
  <div style="background:#d32f2f;padding:20px 24px;border-radius:8px 8px 0 0">
    <p style="color:white;font-size:20px;font-weight:700;margin:0">📦 LOPIA — 新批次已登錄</p>
  </div>
  <div style="border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;padding:24px">
    <p style="color:#333;margin-top:0">出口商已新增一筆新的進口批次，詳細資訊如下：</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    ${fileListHtml}
    <div style="margin-top:20px">
      <a href="${driveLink}" style="display:inline-block;background:#d32f2f;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">
        📁 開啟 Google Drive 資料夾
      </a>
    </div>
    <p style="margin-top:20px;font-size:12px;color:#aaa">此信件由 LOPIA 進口追蹤系統自動發送</p>
  </div>
</div>`

    const emailList = recipients.split(',').map((e: string) => e.trim()).filter(Boolean)

    await Promise.all([
      transporter.sendMail({
        from: `"LOPIA 進口系統" <${process.env.GMAIL_USER}>`,
        to: recipients,
        subject: `📦 LOPIA 新批次登錄：${String(batchName ?? '').slice(0, 100)}`,
        html,
      }),
      grantDriveAccess(emailList),
    ])

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[notify]', err)
    return NextResponse.json({ error: 'Notify failed' }, { status: 500 })
  }
}
