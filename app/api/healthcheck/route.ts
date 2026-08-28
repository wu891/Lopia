/**
 * GET /api/healthcheck — 每日資料健檢（只讀不改）＋有病就寄信
 * ───────────────────────────────────────────────────────────────
 * 呼叫者：
 *   1. Vercel Cron（每天 23:00 UTC＝台灣早上 07:00，見 vercel.json），
 *      帶 Authorization: Bearer {CRON_SECRET} → 有 error/warn 就寄 Gmail 給 Colin；
 *      全部正常時只有「台灣時間週一」寄一封 ✅ 心跳信（證明機器人自己還活著）。
 *   2. 手動測試：帶 Bearer {DRIVE_SCAN_TOKEN} 或 {CRON_SECRET} 打 GET，
 *      預設只回 JSON 不寄信；加 ?mail=1 才真的寄（測信件格式用）。
 *
 * 檢查內容都在 lib/healthcheck.ts（關鍵字/箱數/兩系統一致/狀態陷阱/卡住的檔）。
 * 安全：token 只收 Authorization 標頭（同 drive-scan 的規矩）；整支只讀 Notion，不寫任何資料。
 */

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { runHealthcheck, type HealthReport } from '@/lib/healthcheck'

export const dynamic = 'force-dynamic'
export const maxDuration = 60   // 要翻完整個對帳明細 DB，Notion 分頁讀取會超過預設 10 秒

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const cron = process.env.CRON_SECRET?.trim()
  const scan = process.env.DRIVE_SCAN_TOKEN?.trim()
  // 兩把既有 token 都認得（cron 用 CRON_SECRET、人工/GAS 用 DRIVE_SCAN_TOKEN）；都沒設就一律拒絕
  return (!!cron && auth === `Bearer ${cron}`) || (!!scan && auth === `Bearer ${scan}`)
}

function isCronCall(req: NextRequest): boolean {
  const cron = process.env.CRON_SECRET?.trim()
  return !!cron && (req.headers.get('authorization') ?? '') === `Bearer ${cron}`
}

// 台灣時間的星期幾（0=日、1=一…）。心跳信只在週一發，其他天沒事就安靜。
function taiwanWeekday(): number {
  return new Date(Date.now() + 8 * 3600e3).getUTCDay()
}

function formatMailBody(report: HealthReport): string {
  const tag: Record<string, string> = { error: '❌', warn: '⚠️', info: 'ℹ️' }
  const lines: string[] = []
  lines.push(`LOPIA 每日健檢（${report.ranAt.slice(0, 10)}）`)
  lines.push(`結果：${report.counts.error} 錯誤／${report.counts.warn} 警告／${report.counts.info} 提示`)
  lines.push('')
  for (const i of report.issues.slice(0, 50)) {
    lines.push(`${tag[i.level]}【${i.subject}】${i.message}`)
    lines.push('')
  }
  if (report.issues.length > 50) lines.push(`…還有 ${report.issues.length - 50} 條沒列出。`)
  const st = Object.entries(report.stats).map(([k, v]) => `${k} ${v}`).join('、')
  lines.push(`—`)
  lines.push(`本次掃描：${st}`)
  lines.push(`此信由 lopia-status 每日健檢自動寄出（/api/healthcheck）。`)
  return lines.join('\n')
}

async function sendMail(report: HealthReport, heartbeat: boolean): Promise<string> {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return 'skipped: gmail not configured'
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
  const subject = heartbeat
    ? `✅ LOPIA 健檢正常（${report.ranAt.slice(0, 10)}）`
    : `⚠️ LOPIA 健檢：${report.counts.error} 錯誤 ${report.counts.warn} 警告（${report.ranAt.slice(0, 10)}）`
  await transporter.sendMail({
    from: `"LOPIA 進口系統" <${user}>`,
    to: user,               // 寄給 Colin 自己（GMAIL_USER＝wu@tm-japan.jp）
    subject,
    text: heartbeat ? `今天健檢沒有發現問題。\n\n${formatMailBody(report)}` : formatMailBody(report),
  })
  return 'sent'
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const report = await runHealthcheck()
    const hasAlarm = report.counts.error + report.counts.warn > 0
    // cron 呼叫預設會寄；人工呼叫要加 ?mail=1 才寄（避免測試時亂發信）
    const wantMail = isCronCall(req) || req.nextUrl.searchParams.get('mail') === '1'
    let mailed = 'no'
    if (wantMail) {
      if (hasAlarm) mailed = await sendMail(report, false)
      else if (taiwanWeekday() === 1) mailed = await sendMail(report, true)   // 週一心跳信
      else mailed = 'quiet: no issues'
    }
    return NextResponse.json({ ...report, mailed })
  } catch (err) {
    console.error('[healthcheck]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
