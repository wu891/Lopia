import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

export async function POST(req: NextRequest) {
  try {
    const { batchName, supplier, flightNo, awbNo, departJP, arrivalTW, totalBoxes, fileNames } = await req.json()

    const recipients = process.env.NOTIFY_EMAILS ?? ''
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

    const driveLink = `https://drive.google.com/drive/folders/${process.env.GOOGLE_DRIVE_FOLDER_ID}`

    const rows = [
      ['批次名稱', batchName],
      ['供應商',   supplier  || '—'],
      ['班機號',   flightNo  || '—'],
      ['AWB 號',  awbNo     || '—'],
      ['日本出發日', departJP || '—'],
      ['抵台日',   arrivalTW || '—'],
      ['入倉箱數',  totalBoxes ? `${totalBoxes} 箱` : '—'],
    ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap">${k}</td><td style="padding:4px 0;font-weight:600">${v}</td></tr>`).join('')

    const fileListHtml = fileNames?.length
      ? `<p style="margin:16px 0 4px;color:#444;font-size:14px">📎 已上傳文件：</p><ul style="margin:0;padding-left:20px">${fileNames.map((n: string) => `<li style="font-size:13px;color:#555">${n}</li>`).join('')}</ul>`
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

    await transporter.sendMail({
      from: `"LOPIA 進口系統" <${process.env.GMAIL_USER}>`,
      to: recipients,
      subject: `📦 LOPIA 新批次登錄：${batchName}`,
      html,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[notify]', err)
    return NextResponse.json({ error: 'Notify failed' }, { status: 500 })
  }
}
