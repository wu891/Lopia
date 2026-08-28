/**
 * lib/healthcheck.ts — 每日資料健檢（只讀不改）
 * ───────────────────────────────────────────────────────────────
 * 為什麼要有這支：過去半年的錯帳（6月營收翻倍、7/24 加工品誤扣舊批、
 * 8月初葡萄/混搭/蘋果三件錯帳）根因全是「批次關鍵字填錯/漏填」或
 * 「兩套資料悄悄岔開」，而且都是事後人工才發現。
 * 這支每天自動跑一次，把同一類問題在爆炸「前」抓出來。
 *
 * 五個檢查（全部只讀。健檢絕不自動改資料——寧可吵，不代改，
 * 避免又多一個自動系統跟扣帳系統互踩）：
 *   1) 關鍵字健檢 … (a)格式亂貼（整行 INVOICE、含 Tab/全形空格）
 *                    (b)關鍵字對不到近 120 天任何貨單商品名（0801S 那型未爆彈）
 *                    (c)同一商品名同時命中多個批次（重疊提示，切櫃屬正常）
 *   2) 箱數上限   … 各批次未取消出貨合計 vs 入倉箱數（超領警告＋「快出完了」提醒）
 *   3) 兩系統一致 … 對帳明細(Excel列) vs 出貨紀錄 的當月箱數合計（6月翻倍那型）
 *   4) 狀態陷阱   … 標了「全數出貨」但箱數對不上（提早關帳會害殘量掛錯批）
 *   5) 卡住的檔   … 掃描帳本裡狀態＝異常的出貨單（正卡著沒記帳，等人處理）
 *
 * 呼叫端：/api/healthcheck（Vercel Cron 每天早上跑，有問題就寄 Gmail）。
 */

import { Client } from '@notionhq/client'
import { fetchBatchesLite, type BatchLite } from './driveScan/match'
import { getExcelRows, type ExcelRow } from './notion'
import { getLedgerEntries } from './driveScan/ledger'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

// ── 型別 ─────────────────────────────────────────────────────────────────────

export type IssueLevel = 'error' | 'warn' | 'info'

export interface HealthIssue {
  level: IssueLevel
  check: string      // 哪個檢查抓到的（keyword / boxes / consistency / status / stuck-file）
  subject: string    // 主角（批次名、檔名、月份…）
  message: string    // 白話說明＋建議動作
}

export interface HealthReport {
  ok: boolean                          // true＝沒有 error 也沒有 warn（info 不算病）
  ranAt: string
  counts: { error: number; warn: number; info: number }
  issues: HealthIssue[]
  stats: Record<string, number>        // 掃了多少東西（回報用，證明真的有跑）
}

// 出貨紀錄只需要這幾欄（自帶小讀取器，不跟 sync.ts 的內部函式耦合）
export interface HcRecord {
  batchId: string | null
  date: string | null
  boxes: number
  planStatus: string | null
  shipmentNo: string
}

// ── 小工具 ───────────────────────────────────────────────────────────────────

// 跟 match.ts 的 hitKeyword 同一套規則：商品名「包含」任一關鍵字＝命中（不分大小寫）
function hit(text: string, b: BatchLite): boolean {
  const t = text.toLowerCase()
  return b.keywords.some(k => k && t.includes(k.toLowerCase()))
}

function isCancelled(r: HcRecord): boolean {
  return r.planStatus === '已取消'
}

// 出貨日在今天(含)以前才算「實際出貨」；未來的是計畫，不進健檢比對
function actual(r: HcRecord, today: string): boolean {
  return !isCancelled(r) && !!r.date && r.date <= today
}

function monthOf(d: string): string {
  return d.slice(0, 7)
}

function prevMonthOf(month: string): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// ── 檢查 1：關鍵字健檢 ────────────────────────────────────────────────────────

export function checkKeywords(batches: BatchLite[], rows: ExcelRow[], today: string): HealthIssue[] {
  const issues: HealthIssue[] = []
  const open = batches.filter(b => b.deliveryStatus !== '全數出貨')

  // (a) 格式亂貼：關鍵字含 Tab／HTML 碎片／全形空格，或單一關鍵字超長
  //     ＝多半是把 INVOICE 整行貼進來（8月三件錯帳＋0801S 的共同根因）
  const linted = new Set<string>()
  for (const b of open) {
    if (b.keywords.length === 0) {
      issues.push({
        level: 'warn', check: 'keyword', subject: b.ivName,
        message: '未填「商品關鍵字」——這批只剩「檔名帶批次號」一種方式能對到貨單。請照同商品舊批次的格式補關鍵字。',
      })
      linted.add(b.id)
      continue
    }
    const bad = b.keywords.filter(k => /[\t<>]/.test(k) || k.includes('　') || k.length > 20)
    if (bad.length > 0) {
      issues.push({
        level: 'warn', check: 'keyword', subject: b.ivName,
        message: `關鍵字疑似整行 INVOICE 貼上（例：「${bad[0].slice(0, 30)}…」）——貨單商品名對不到這種長字串。請改成貨單上會出現的短詞（照同商品舊批次抄格式）。`,
      })
      linted.add(b.id)
    }
  }

  // (b) 模擬比對：拿近 120 天貨單商品名去試撞每個未關帳批次的關鍵字。
  //     一個都撞不到＝切櫃那天會整張報錯（0801S 那型）。新商品第一櫃沒有歷史可比，屬正常、先忽略即可。
  const cutoff = new Date(new Date(today).getTime() - 120 * 86400e3).toISOString().slice(0, 10)
  const recentNames = Array.from(new Set(
    rows.filter(r => r.date && r.date >= cutoff && r.date <= today && r.product).map(r => r.product)
  ))
  for (const b of open) {
    if (linted.has(b.id)) continue                 // 格式就有病的上面講過了，不重複唸
    if (!recentNames.some(n => hit(n, b))) {
      issues.push({
        level: 'warn', check: 'keyword', subject: b.ivName,
        message: `關鍵字對不到近 120 天任何一筆貨單商品名（現有關鍵字：${b.keywords.slice(0, 3).join('、')}${b.keywords.length > 3 ? '…' : ''}）。若是接手舊商品的新櫃，代表切櫃當天會整張報錯——請照舊櫃格式補關鍵字；若是全新商品的第一櫃可先忽略。`,
      })
    }
  }

  // (c) 重疊提示：近 30 天有商品名同時命中 ≥2 個未關帳批次。
  //     同商品新舊櫃交接（FIFO 先扣舊櫃）屬「正常」；只有「不同商品卻互相命中」才要改關鍵字。
  const cutoff30 = new Date(new Date(today).getTime() - 30 * 86400e3).toISOString().slice(0, 10)
  const overlapByCombo = new Map<string, { batches: string; examples: string[] }>()
  for (const name of Array.from(new Set(
    rows.filter(r => r.date && r.date >= cutoff30 && r.date <= today && r.product).map(r => r.product)
  ))) {
    const hits = open.filter(b => hit(name, b))
    if (hits.length < 2) continue
    const key = hits.map(b => b.ivName).sort().join('＋')
    const entry = overlapByCombo.get(key) ?? { batches: key, examples: [] }
    if (entry.examples.length < 3) entry.examples.push(name)
    overlapByCombo.set(key, entry)
  }
  for (const { batches: combo, examples } of overlapByCombo.values()) {
    issues.push({
      level: 'info', check: 'keyword', subject: combo,
      message: `「${examples.join('」「')}」等商品名同時命中這幾批。同商品切櫃屬正常（FIFO 會先扣完舊櫃）；若這幾批其實裝不同商品，請把關鍵字改得更專一。`,
    })
  }

  return issues
}

// ── 檢查 2：箱數上限 ─────────────────────────────────────────────────────────

export function shippedByBatch(records: HcRecord[], today: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of records) {
    if (!actual(r, today) || !r.batchId) continue
    m.set(r.batchId, (m.get(r.batchId) ?? 0) + r.boxes)
  }
  return m
}

export function checkBoxCeiling(batches: BatchLite[], records: HcRecord[], today: string): HealthIssue[] {
  const issues: HealthIssue[] = []
  const shipped = shippedByBatch(records, today)
  for (const b of batches) {
    if (b.totalBoxes <= 0) continue
    const s = shipped.get(b.id) ?? 0
    if (s > b.totalBoxes) {
      issues.push({
        level: 'warn', check: 'boxes', subject: b.ivName,
        message: `已出 ${s} 箱 ＞ 入倉 ${b.totalBoxes} 箱（超領 ${s - b.totalBoxes} 箱）。常見原因：入倉箱數沒更新、有單記錯批、或同一張單重複記（7/17 蘋果11那型）。`,
      })
    } else if (b.deliveryStatus !== '全數出貨' && s / b.totalBoxes >= 0.95) {
      issues.push({
        level: 'info', check: 'boxes', subject: b.ivName,
        message: `已出 ${s}/${b.totalBoxes} 箱（${Math.round((s / b.totalBoxes) * 100)}%），快出完了。切櫃前記得：新批次照本批格式補好關鍵字、到貨當天填入倉日。`,
      })
    }
  }
  return issues
}

// ── 檢查 3：兩系統一致（對帳明細 vs 出貨紀錄，當月箱數） ─────────────────────

export function checkConsistency(rows: ExcelRow[], records: HcRecord[], today: string): HealthIssue[] {
  const issues: HealthIssue[] = []

  // 整張單被取消（該單號的紀錄「全部」標已取消）→ 它的對帳明細列不算，避免永遠報差異
  const bySNo = new Map<string, HcRecord[]>()
  for (const r of records) {
    if (!r.shipmentNo) continue
    const list = bySNo.get(r.shipmentNo) ?? []
    list.push(r)
    bySNo.set(r.shipmentNo, list)
  }
  const cancelledSNos = new Set(
    Array.from(bySNo.entries()).filter(([, list]) => list.every(isCancelled)).map(([sno]) => sno)
  )

  const thisMonth = monthOf(today)
  const months: { m: string; level: IssueLevel }[] = [
    { m: thisMonth, level: 'warn' },            // 當月不一致＝現在進行式，要看
    { m: prevMonthOf(thisMonth), level: 'info' }, // 上月的舊差異當參考，不進警報信洗版
  ]
  for (const { m, level } of months) {
    const excelBoxes = rows
      .filter(r => r.date && monthOf(r.date) === m && r.date <= today && !cancelledSNos.has(r.shipmentNo))
      .reduce((s, r) => s + r.quantity, 0)
    const recordBoxes = records
      .filter(r => actual(r, today) && monthOf(r.date as string) === m)
      .reduce((s, r) => s + r.boxes, 0)
    if (excelBoxes !== recordBoxes) {
      issues.push({
        level, check: 'consistency', subject: m,
        message: `對帳明細 ${excelBoxes} 箱 vs 出貨紀錄 ${recordBoxes} 箱，差 ${excelBoxes - recordBoxes} 箱。常見原因：手動＋自動重複記（6月翻倍那型）、有單被規則跳過沒補記、或取消單的明細列沒清。`,
      })
    }
  }
  return issues
}

// ── 檢查 4：狀態陷阱（提早標全數出貨） ───────────────────────────────────────

export function checkStatusTrap(batches: BatchLite[], records: HcRecord[], today: string): HealthIssue[] {
  const issues: HealthIssue[] = []
  const shipped = shippedByBatch(records, today)
  for (const b of batches) {
    if (b.deliveryStatus !== '全數出貨' || b.totalBoxes <= 0) continue
    const s = shipped.get(b.id) ?? 0
    if (s < b.totalBoxes) {
      issues.push({
        level: 'warn', check: 'status', subject: b.ivName,
        message: `標了「全數出貨」但紀錄只出 ${s}/${b.totalBoxes} 箱（差 ${b.totalBoxes - s} 箱）。全數出貨的批次不參與自動扣帳——剩餘的單會整包掛到別批。真出完＝請修入倉箱數；還沒出完＝請退回「部分出貨」。`,
      })
    }
  }
  return issues
}

// ── 出貨紀錄小讀取器 ─────────────────────────────────────────────────────────

export async function fetchHcRecords(): Promise<HcRecord[]> {
  const DB = process.env.NOTION_SHIPMENT_RECORDS_DB?.trim()
  if (!DB) throw new Error('缺 NOTION_SHIPMENT_RECORDS_DB')
  const out: HcRecord[] = []
  let cursor: string | undefined
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await notion.databases.query({
      database_id: DB, page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of res.results) {
      const p = page.properties
      out.push({
        shipmentNo: p['出貨單號']?.title?.[0]?.plain_text ?? '',
        batchId: p['關聯批次']?.relation?.[0]?.id ?? null,
        date: p['出貨日期']?.date?.start ?? null,
        boxes: p['出貨箱數']?.number ?? 0,
        planStatus: p['計畫狀態']?.select?.name ?? null,
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return out
}

// ── 總指揮：抓資料 → 跑檢查 → 出報告 ─────────────────────────────────────────

const LEVEL_ORDER: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 }

export async function runHealthcheck(): Promise<HealthReport> {
  const today = new Date().toISOString().slice(0, 10)
  const issues: HealthIssue[] = []
  const stats: Record<string, number> = {}

  // 四個資料源各自 try：一個讀不到不能讓整個健檢掛掉（監控工具自己不能太脆）
  let batches: BatchLite[] = []
  let records: HcRecord[] = []
  let rows: ExcelRow[] = []
  try { batches = await fetchBatchesLite(); stats['批次數'] = batches.length } catch (e) {
    issues.push({ level: 'error', check: 'self', subject: '進口批次', message: `健檢讀不到批次資料：${e instanceof Error ? e.message : String(e)}` })
  }
  try { records = await fetchHcRecords(); stats['出貨紀錄數'] = records.length } catch (e) {
    issues.push({ level: 'error', check: 'self', subject: '出貨紀錄', message: `健檢讀不到出貨紀錄：${e instanceof Error ? e.message : String(e)}` })
  }
  try { rows = await getExcelRows(); stats['對帳明細列數'] = rows.length } catch (e) {
    issues.push({ level: 'error', check: 'self', subject: '對帳明細', message: `健檢讀不到對帳明細：${e instanceof Error ? e.message : String(e)}` })
  }

  if (batches.length > 0) {
    issues.push(...checkKeywords(batches, rows, today))
    issues.push(...checkBoxCeiling(batches, records, today))
    issues.push(...checkStatusTrap(batches, records, today))
  }
  if (rows.length > 0 || records.length > 0) {
    issues.push(...checkConsistency(rows, records, today))
  }

  // 檢查 5：掃描帳本卡「異常」的檔（出貨單正卡著沒記帳，等人補關鍵字/處理）
  try {
    const ledger = await getLedgerEntries()
    const stuck = Array.from(ledger.values()).filter(e => e.status === '異常')
    stats['帳本檔案數'] = ledger.size
    for (const f of stuck.slice(0, 10)) {
      issues.push({
        level: 'error', check: 'stuck-file', subject: f.fileName || f.fileId,
        message: `這張出貨單卡在「異常」沒記帳：${(f.summary || '（無摘要）').slice(0, 140)}`,
      })
    }
    if (stuck.length > 10) {
      issues.push({ level: 'error', check: 'stuck-file', subject: '掃描帳本', message: `還有 ${stuck.length - 10} 個異常檔沒列出，請到掃描帳本看全部。` })
    }
  } catch (e) {
    issues.push({ level: 'warn', check: 'self', subject: '掃描帳本', message: `健檢讀不到掃描帳本：${e instanceof Error ? e.message : String(e)}` })
  }

  issues.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  const counts = {
    error: issues.filter(i => i.level === 'error').length,
    warn: issues.filter(i => i.level === 'warn').length,
    info: issues.filter(i => i.level === 'info').length,
  }
  return { ok: counts.error + counts.warn === 0, ranAt: new Date().toISOString(), counts, issues, stats }
}
