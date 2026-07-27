/**
 * GET /api/audit — 三方對帳稽核（出貨單 vs 對帳明細 vs 出貨紀錄／profit）
 * ───────────────────────────────────────────────────────────────
 * 背景（2026-07-27）：對帳明細重複上傳 86 萬、出貨紀錄漏登 109 萬，
 * 滾了三個月才被抓到。各系統原本只有「單向」防線（同檔去重、寫入讀回核對），
 * 沒有人定期把三邊的總數互相對。這支端點就是那道「三方對帳閘門」：
 *
 *   ① Drive 出貨單（真相來源，Colin 拍板一律以出貨單為主）
 *   ② Notion 對帳明細（Excel 上傳）＝對帳系統的營收來源
 *   ③ Notion 出貨紀錄＝profit 毛利頁的箱數／批次來源
 *
 * 檢查範圍：當月＋上月（跟 Drive 自動掃描同視窗，掃描器 listShipmentFiles 決定）。
 * 逐「出貨單號」比對三邊箱數與金額；單號對不上時退一步用「同一天總額」再比
 * 一次（同一天兩個檔被編成 01/02 兩單的情況，金額一致就只記備註不報警）。
 * 最後附上月度小計：出貨單 vs 對帳 vs profit 月營收。
 *
 * 呼叫方式（二選一）：
 *   - 瀏覽器：先在 /profit.html 輸入密碼取得 cookie，再開 /api/audit
 *   - 排程（GAS 等）：Authorization: Bearer {DRIVE_SCAN_TOKEN}（跟 drive-scan 同一把）
 * ⚠️ token 只能放標頭，不可改成 ?token= query（會留在紀錄檔）。
 *
 * 純唯讀：只讀 Drive 與 Notion，不寫任何東西，跑幾次都安全。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { listShipmentFiles, downloadAsXlsx } from '@/lib/driveScan/drive'
import { parseStoreOrderWorkbook } from '@/lib/driveScan/parseStoreOrder'
import { getExcelRows, getShipmentRecords, getShipments, getMonthlyLogistics, getBatchPrices } from '@/lib/notion'
import { computeLiveMargins } from '@/lib/liveMargin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60   // 要下載並解析十幾個 Drive 檔，超過預設 10 秒

// 已確認的例外：出貨單上有、但實際沒出貨的列（Colin 拍板才能加）
// 2026-07-27：S2026050101 蘋果10.2 的台北大巨蛋 102 箱沒有出（門市未開幕）
const EXCEPTIONS: { sno: string; store: string; reason: string }[] = [
  { sno: 'S2026050101', store: '台北大巨蛋店', reason: '未出貨（門市未開幕），Colin 2026-07-27 確認' },
]

interface SideTotal { boxes: number; amount: number }
interface SnoRow {
  sno: string
  date: string
  drive: SideTotal | null      // 出貨單（真相）
  recon: SideTotal | null      // 對帳明細
  recordBoxes: number | null   // 出貨紀錄（未取消）的箱數；金額多半空白所以只比箱數
  status: 'ok' | 'note' | 'mismatch'
  notes: string[]
}

function bearerOk(req: NextRequest): boolean {
  const token = process.env.DRIVE_SCAN_TOKEN?.trim()
  const auth = req.headers.get('authorization') ?? ''
  return !!token && auth === `Bearer ${token}`
}

export async function GET(req: NextRequest) {
  // 內含各單金額，比照 /api/profit 用編輯權限保護；排程走 Bearer token
  if (!bearerOk(req) && !(await requireAuth('edit'))) {
    return NextResponse.json({ error: '需要密碼或 Bearer token' }, { status: 401 })
  }
  try {
    // 單號 → 日期 查表（放在請求內，不能放模組層：serverless 會跨請求殘留舊資料）
    const dateOfSno = new Map<string, string>()

    // ── ① Drive 出貨單：下載當月＋上月所有貨單，逐檔解析 ──────────────────
    const files = await listShipmentFiles()
    const driveBySno = new Map<string, SideTotal & { files: string[] }>()
    const problems: string[] = []
    let parsedFiles = 0
    for (const f of files) {
      let wb
      try {
        wb = parseStoreOrderWorkbook(await downloadAsXlsx(f))
      } catch (e) {
        problems.push(`檔案「${f.name}」解析失敗：${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      const sno = wb.dominantSno
      const date = wb.dominantDate
      if (!sno || !date) { problems.push(`檔案「${f.name}」讀不到出貨單號或日期，未列入比對`); continue }
      for (const w of wb.hardWarnings) problems.push(`檔案「${f.name}」：${w}`)
      parsedFiles++
      const cur = driveBySno.get(sno) ?? { boxes: 0, amount: 0, files: [] }
      for (const tab of wb.activeTabs) {
        if (!tab.store) continue
        if (EXCEPTIONS.some(x => x.sno === sno && x.store === tab.store)) continue // 已確認未出貨
        for (const r of tab.rows) {
          cur.boxes += r.boxes
          cur.amount += r.boxes * (r.price ?? 0)
        }
      }
      cur.files.push(f.name)
      driveBySno.set(sno, cur)
      // 順便把日期記在 map 外（下面組表用）
      dateOfSno.set(sno, date)
    }

    // 稽核視窗 ＝ Drive 檔案實際涵蓋的月份（當月＋上月）
    const windowMonths = new Set([...dateOfSno.values()].map(d => d.slice(0, 7)))

    // ── ② 對帳明細：只取視窗月份 ─────────────────────────────────────────
    const excelRows = await getExcelRows()
    const reconBySno = new Map<string, SideTotal>()
    for (const r of excelRows) {
      const m = (r.date || '').slice(0, 7)
      if (!windowMonths.has(m)) continue
      const cur = reconBySno.get(r.shipmentNo) ?? { boxes: 0, amount: 0 }
      cur.boxes += r.quantity ?? 0
      cur.amount += (r.quantity ?? 0) * (r.unitPrice ?? 0)
      reconBySno.set(r.shipmentNo, cur)
      if (!dateOfSno.has(r.shipmentNo) && r.date) dateOfSno.set(r.shipmentNo, r.date.slice(0, 10))
    }

    // ── ③ 出貨紀錄：未取消的箱數 ─────────────────────────────────────────
    const records = await getShipmentRecords()
    const recBySno = new Map<string, number>()
    for (const r of records) {
      const m = (r.date || '').slice(0, 7)
      if (!windowMonths.has(m)) continue
      if (r.planStatus === '已取消') continue
      const key = r.shipmentNo || '(無單號)'
      recBySno.set(key, (recBySno.get(key) ?? 0) + (r.boxes ?? 0))
      if (!dateOfSno.has(key) && r.date) dateOfSno.set(key, r.date.slice(0, 10))
    }

    // ── 逐單號比對 ──────────────────────────────────────────────────────
    const allSnos = [...new Set([...driveBySno.keys(), ...reconBySno.keys(), ...recBySno.keys()])].sort()
    const perSno: SnoRow[] = []
    // 同日總額（單號拆法不同時的第二層比對）
    const sumByDate = (m: Map<string, SideTotal>) => {
      const out = new Map<string, number>()
      for (const [sno, v] of m) {
        const d = dateOfSno.get(sno) ?? ''
        out.set(d, (out.get(d) ?? 0) + v.amount)
      }
      return out
    }
    const driveByDate = sumByDate(driveBySno)
    const reconByDate = sumByDate(reconBySno)

    const today = new Date().toISOString().slice(0, 10)
    for (const sno of allSnos) {
      const d = driveBySno.get(sno) ?? null
      const rc = reconBySno.get(sno) ?? null
      const rec = recBySno.get(sno) ?? null
      const date = dateOfSno.get(sno) ?? ''
      const notes: string[] = []
      let status: SnoRow['status'] = 'ok'
      const flag = (msg: string) => { status = 'mismatch'; notes.push(msg) }

      if (d && rc && Math.abs(d.amount - rc.amount) > 1) {
        // 金額對不上 → 先看是不是同日拆單（同一天總額一致就只記備註，如 S2026052701/02）
        const dd = driveByDate.get(date) ?? 0
        const rd = reconByDate.get(date) ?? 0
        if (Math.abs(dd - rd) <= 1) {
          if (status === 'ok') status = 'note'
          notes.push('單號拆法不同，但當日出貨單與對帳總額一致')
        } else {
          flag(`對帳金額 ${rc.amount.toLocaleString()} ≠ 出貨單 ${d.amount.toLocaleString()}（差 ${(rc.amount - d.amount).toLocaleString()}）`)
        }
      }
      if (d && !rc) flag('對帳明細沒有這張單（漏上傳？）')
      if (!d && rc) flag('對帳明細有、但 Drive 沒有這張出貨單（重複上傳或該刪的殘留？）')
      if (d && rec != null && rec !== d.boxes) flag(`出貨紀錄 ${rec} 箱 ≠ 出貨單 ${d.boxes} 箱（差 ${rec - d.boxes}）`)
      if (d && rec == null) flag('出貨紀錄完全沒有這張單（自動掃描漏建？）')
      if (!d && !rc && rec != null) flag('只有出貨紀錄有這個單號（單號打錯或出貨單沒歸檔？）')

      // 未來的出貨（計畫單）：貨單通常晚幾天才歸檔、自動掃描也還沒跑，不算異常
      if (status === 'mismatch' && date > today) {
        status = 'note'
        notes.push('出貨日在未來（計畫中），先觀察不報警；出貨後仍對不上才算異常')
      }

      perSno.push({ sno, date, drive: d ? { boxes: d.boxes, amount: d.amount } : null, recon: rc, recordBoxes: rec, status, notes })
    }

    // ── 月度小計：出貨單 vs 對帳 vs profit 營收 ──────────────────────────
    // profit 的營收對加工品批次會除以 1.05 還原未稅；目前批次都是免稅所以直接可比
    const [logistics, batchPrices, shipments] = await Promise.all([
      getMonthlyLogistics(),
      getBatchPrices().catch(() => ({})),
      getShipments(),
    ])
    const live = computeLiveMargins(shipments, records, logistics, excelRows, batchPrices)
    // 月度小計只算「已出貨」（日期 ≤ 今天）：profit 本來就不計未來出貨，三邊才可比
    const shipped = (s: string) => (dateOfSno.get(s) ?? '') <= today
    const monthly = [...windowMonths].sort().map(month => {
      const dAmt = [...driveBySno.entries()].filter(([s]) => shipped(s) && (dateOfSno.get(s) ?? '').startsWith(month)).reduce((s, [, v]) => s + v.amount, 0)
      const rAmt = [...reconBySno.entries()].filter(([s]) => shipped(s) && (dateOfSno.get(s) ?? '').startsWith(month)).reduce((s, [, v]) => s + v.amount, 0)
      const pRev = live.months.find(m => m.month === month)?.revenue ?? 0
      return {
        month,
        driveAmount: Math.round(dAmt),
        reconAmount: Math.round(rAmt),
        profitRevenue: Math.round(pRev),
        reconDiff: Math.round(rAmt - dAmt),
        profitDiff: Math.round(pRev - dAmt),
      }
    })

    const mismatches = perSno.filter(r => r.status === 'mismatch')
    return NextResponse.json({
      ok: mismatches.length === 0 && problems.length === 0,
      generatedAt: new Date().toISOString(),
      window: [...windowMonths].sort(),
      filesParsed: parsedFiles,
      summary: {
        snosChecked: perSno.length,
        okCount: perSno.filter(r => r.status === 'ok').length,
        noteCount: perSno.filter(r => r.status === 'note').length,
        mismatchCount: mismatches.length,
      },
      monthly,
      mismatches,          // 對不上的擺前面，一眼看到重點
      perSno,
      problems,
      exceptionsApplied: EXCEPTIONS,
    })
  } catch (err) {
    console.error('[audit]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `稽核失敗：${msg}` }, { status: 500 })
  }
}
