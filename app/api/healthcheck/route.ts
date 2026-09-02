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
 * 檢查內容都在 lib/healthcheck.ts（關鍵字/箱數/兩系統一致/狀態陷阱/卡住的檔/入倉日空白）。
 * 安全：token 只收 Authorization 標頭（同 drive-scan 的規矩）；整支只讀 Notion，不寫任何資料。
 *
 * ── 超領走自己的信箱通道（2026-09-02 Colin 指示 R3）──────────────────────
 * 超領（check === 'overdraw'）不跟其他項目混在同一封信裡，改成單獨寄一封 🚨。
 * 拆成兩封：🚨 超領警報（只講超領，一封信一件事）＋ ⚠️ 一般健檢（其餘項目）。
 * 沒修好就每天各自重寄；兩邊都乾淨時才輪到週一的 ✅ 心跳信。
 *
 * 注意：光拆信不夠。9/3 地瓜實測發現超領檢查本身根本沒響過——它只算
 * 「出貨日 ≤ 今天」的紀錄，CITY20260701S 那 520 箱超領全來自未來日期的計畫。
 * 真正的漏洞在 lib/healthcheck.ts 的 plannedByBatch（同日補），這裡只負責讓它被看見。
 */

import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { runHealthcheck, type HealthReport, type HealthIssue } from '@/lib/healthcheck'

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

// 共用的寄信管道（超領信、一般健檢信、心跳信都走這裡）
async function sendGmail(subject: string, text: string): Promise<string> {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return 'skipped: gmail not configured'
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
  await transporter.sendMail({
    from: `"LOPIA 進口系統" <${user}>`,
    to: user,               // 寄給 Colin 自己（GMAIL_USER＝wu@tm-japan.jp）
    subject,
    text,
  })
  return 'sent'
}

async function sendMail(report: HealthReport, heartbeat: boolean): Promise<string> {
  const subject = heartbeat
    ? `✅ LOPIA 健檢正常（${report.ranAt.slice(0, 10)}）`
    : `⚠️ LOPIA 健檢：${report.counts.error} 錯誤 ${report.counts.warn} 警告（${report.ranAt.slice(0, 10)}）`
  return sendGmail(subject, heartbeat ? `今天健檢沒有發現問題。\n\n${formatMailBody(report)}` : formatMailBody(report))
}

// 🚨 超領專用信：一封信只講一件事，附上「怎麼處理」三選一，收到就能直接動手
function formatOverdrawBody(issues: HealthIssue[], ranAt: string): string {
  const lines: string[] = []
  lines.push(`LOPIA 超領警報（${ranAt.slice(0, 10)}）`)
  lines.push(`有 ${issues.length} 批的「已排出貨箱數」超過「入倉箱數」。`)
  lines.push('')
  for (const i of issues) {
    lines.push(`🚨【${i.subject}】${i.message}`)
    lines.push('')
  }
  lines.push('—')
  lines.push('怎麼處理（三選一）：')
  lines.push('・入倉箱數填錯 → 到批次卡改「入倉箱數」')
  lines.push('・有出貨單記到錯的批 → 到出貨紀錄改「關聯批次」')
  lines.push('・同一張單被記兩次 → 把多出來的那筆標「已取消」')
  lines.push('')
  lines.push('這封信跟一般健檢信分開寄；沒處理的話每天都會再收到一次。')
  lines.push('此信由 lopia-status 每日健檢自動寄出（/api/healthcheck）。')
  return lines.join('\n')
}

async function sendOverdrawMail(issues: HealthIssue[], ranAt: string): Promise<string> {
  return sendGmail(
    `🚨 LOPIA 超領警報：${issues.length} 批（${ranAt.slice(0, 10)}）`,
    formatOverdrawBody(issues, ranAt),
  )
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const report = await runHealthcheck()

    // 超領抽出來走自己的信；其餘項目留在一般健檢信 → 同一件事不會兩封都講
    const overdraw = report.issues.filter(i => i.check === 'overdraw')
    const rest = report.issues.filter(i => i.check !== 'overdraw')
    const restReport: HealthReport = {
      ...report,
      issues: rest,
      counts: {
        error: rest.filter(i => i.level === 'error').length,
        warn: rest.filter(i => i.level === 'warn').length,
        info: rest.filter(i => i.level === 'info').length,
      },
    }
    const hasRestAlarm = restReport.counts.error + restReport.counts.warn > 0

    // cron 呼叫預設會寄；人工呼叫要加 ?mail=1 才寄（避免測試時亂發信）
    const wantMail = isCronCall(req) || req.nextUrl.searchParams.get('mail') === '1'
    let mailed = 'no'
    let mailedOverdraw = 'no'
    if (wantMail) {
      if (overdraw.length > 0) mailedOverdraw = await sendOverdrawMail(overdraw, report.ranAt)
      if (hasRestAlarm) mailed = await sendMail(restReport, false)
      // 心跳信只在「兩邊都乾淨」時才發，否則會出現「有超領卻同時說一切正常」的怪事
      else if (overdraw.length === 0 && taiwanWeekday() === 1) mailed = await sendMail(report, true)
      else mailed = 'quiet: no issues'
    }
    // 回傳的 JSON 保留完整 issues（含超領），只是多兩個欄位說明信怎麼寄的
    return NextResponse.json({ ...report, overdrawCount: overdraw.length, mailed, mailedOverdraw })
  } catch (err) {
    console.error('[healthcheck]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
