/**
 * lib/driveScan/sync.ts
 *
 * Drive 自動扣帳 — 主流程（鏡像同步）。
 * ───────────────────────────────────────────────────────────────
 * 每次掃描：
 *   1. 列出 Drive 檔案 → 跟帳本比指紋，沒變的直接跳過（異常檔例外：每輪重試）
 *   2. 檔案剛改過（10 分鐘內）先不碰 → 等 Colin 編輯完稿；過大的檔跳過
 *   3. 解析 → 硬警告（讀不準）就整張單當異常，不寫
 *   4. 商品對批次 → FIFO 分配
 *   5. 防撞規則：
 *      - 手動紀錄（沒印章）同店+同日已存在 → 該店整個不寫、通知（分配前就先剔除）
 *      - 別的檔案已寫過 同單號+同批次+同店 → 比修改時間，較新的檔贏
 *      - 同檔若換了 S 單號（改用途）→ 舊單號紀錄保留不動，只通知，避免砍掉歷史
 *   6. 鏡像：自動紀錄永遠跟「本檔＋本單號」最新內容（多退少補）
 *   7. 寫完自動「讀回來逐筆核對」，結果放進 LINE 訊息
 *   8. 記帳本 ＋ LINE 通知（每張單一則；異常同內容只通知一次）
 *   9. 檔案從 Drive 消失 → 只通知、不自動砍紀錄
 *
 * 自動紀錄固定值：計畫狀態=計畫中、不填金額（毛利系統會把金額當手動營收）、
 * 備註不放「|」（/ops 會誤解析）。
 */

import { Client } from '@notionhq/client'
import { createHash } from 'crypto'
import { pushToGroup } from '../lineNotify'
import { listShipmentFiles, downloadAsXlsx, type DriveFileInfo } from './drive'
import { parseStoreOrderWorkbook, type ParsedWorkbook } from './parseStoreOrder'
import { fetchBatchesLite, allocateFifo, type BatchLite, type AllocationLine } from './match'
import { getLedgerEntries, upsertLedgerEntry, ensureRecordsSchema, type LedgerEntry } from './ledger'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

const QUIET_MINUTES = 10                 // 剛改完 10 分鐘內先不碰
const MAX_FILE_BYTES = 20 * 1024 * 1024  // 超過 20MB 的檔不處理（防超大檔拖垮）

// 同一個暖實例內，避免 cron 與手動 force 重疊跑（跨實例擋不到，但常見情況夠用）
let scanRunning = false

// ── 出貨紀錄自有讀寫（多讀「來源檔案」印章欄）──────────────────────────────────

interface RecordLite {
  id: string
  shipmentNo: string
  batchId: string | null
  store: string | null
  date: string | null
  boxes: number
  round: number | null
  planStatus: string | null
  sourceFileId: string
}

async function fetchRecordsLite(): Promise<RecordLite[]> {
  const DB = process.env.NOTION_SHIPMENT_RECORDS_DB?.trim()
  if (!DB) throw new Error('缺 NOTION_SHIPMENT_RECORDS_DB')
  const out: RecordLite[] = []
  let cursor: string | undefined
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await notion.databases.query({
      database_id: DB, page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of res.results) {
      const p = page.properties
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rich = (prop: any) => prop?.rich_text?.map((r: { plain_text: string }) => r.plain_text).join('') ?? ''
      out.push({
        id: page.id,
        shipmentNo: p['出貨單號']?.title?.[0]?.plain_text ?? '',
        batchId: p['關聯批次']?.relation?.[0]?.id ?? null,
        store: p['出貨門市']?.select?.name ?? null,
        date: p['出貨日期']?.date?.start ?? null,
        boxes: p['出貨箱數']?.number ?? 0,
        round: p['出貨輪次']?.number ?? null,
        planStatus: p['計畫狀態']?.select?.name ?? null,
        sourceFileId: rich(p['來源檔案']),
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return out
}

async function createAutoRecord(data: {
  shipmentNo: string; batchId: string; store: string; date: string
  boxes: number; round: number; sourceFileId: string
}): Promise<string> {
  const DB = process.env.NOTION_SHIPMENT_RECORDS_DB?.trim()
  if (!DB) throw new Error('缺 NOTION_SHIPMENT_RECORDS_DB')
  const page = await notion.pages.create({
    parent: { database_id: DB },
    properties: {
      '出貨單號': { title: [{ type: 'text', text: { content: data.shipmentNo } }] },
      '關聯批次': { relation: [{ id: data.batchId }] },
      '出貨門市': { select: { name: data.store } },
      '出貨日期': { date: { start: data.date } },
      '出貨箱數': { number: data.boxes },
      '出貨輪次': { number: data.round },
      '計畫狀態': { select: { name: '計畫中' } },
      '來源檔案': { rich_text: [{ type: 'text', text: { content: data.sourceFileId } }] },
    },
  })
  return page.id
}

async function updateAutoRecord(id: string, data: {
  shipmentNo: string; store: string; date: string; boxes: number; round: number
}): Promise<void> {
  await notion.pages.update({
    page_id: id,
    properties: {
      '出貨單號': { title: [{ type: 'text', text: { content: data.shipmentNo } }] },
      '出貨門市': { select: { name: data.store } },
      '出貨日期': { date: { start: data.date } },
      '出貨箱數': { number: data.boxes },
      '出貨輪次': { number: data.round },
    },
  })
}

async function archiveRecord(id: string): Promise<void> {
  await notion.pages.update({ page_id: id, archived: true })
}

// ── 小工具 ────────────────────────────────────────────────────────────────────

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 12)
}

function fingerprintOf(f: DriveFileInfo): string {
  return `${f.md5Checksum ?? ''}|${f.modifiedTime}|${f.size ?? ''}`
}

// 檔名裡的「蘋果11.3」→ 輪次提示 3。只認「蘋果/りんご/リンゴ + 數字.數字」這種寫法，
// 避免把檔名裡的日期（2026.7.9）誤讀成輪次。
function roundHintFromName(name: string): number | null {
  const m = name.match(/(?:蘋果|りんご|リンゴ)\s*\d+\.(\d{1,2})(?=\D|$)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 40 ? n : null
}

// ── 單檔處理結果 ──────────────────────────────────────────────────────────────

export interface FileOutcome {
  fileId: string
  fileName: string
  action: 'skipped-unchanged' | 'skipped-quiet' | 'skipped-toobig' | 'processed' | 'anomaly' | 'error'
  sNo?: string | null
  date?: string | null
  creates?: { batchName: string; store: string; boxes: number; round: number }[]
  updates?: { batchName: string; store: string; boxes: number; from: number }[]
  archives?: { store: string; boxes: number }[]
  conflicts?: string[]
  notes?: string[]
  errors?: string[]
  verify?: { ok: boolean; detail: string }
}

export interface ScanResult {
  scannedFiles: number
  outcomes: FileOutcome[]
  dry: boolean
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

export async function runScan(opts: { dry?: boolean; force?: boolean; onlyFileId?: string } = {}): Promise<ScanResult> {
  const dry = !!opts.dry
  if (!dry) {
    if (scanRunning) return { scannedFiles: 0, outcomes: [{ fileId: '', fileName: '', action: 'error', errors: ['另一個掃描正在進行，這次略過'] }], dry }
    scanRunning = true
  }
  try {
    return await doScan(opts, dry)
  } finally {
    if (!dry) scanRunning = false
  }
}

async function doScan(opts: { dry?: boolean; force?: boolean; onlyFileId?: string }, dry: boolean): Promise<ScanResult> {
  const files = await listShipmentFiles()
  const ledger = await getLedgerEntries()
  const now = Date.now()

  const todo: DriveFileInfo[] = []
  const outcomes: FileOutcome[] = []
  for (const f of files) {
    if (opts.onlyFileId && f.id !== opts.onlyFileId) continue
    const entry = ledger.get(f.id)
    const fp = fingerprintOf(f)
    // 過大的檔（真 xlsx 才有 size；Google 試算表下載後再檢查 buf 長度）
    if (f.size != null && Number(f.size) > MAX_FILE_BYTES) {
      outcomes.push({ fileId: f.id, fileName: f.name, action: 'skipped-toobig' })
      if (!dry) await notifyOnce(entry, f, `⚠️ 檔案過大（${Math.round(Number(f.size) / 1048576)}MB）不自動處理\n檔案：${f.name}`, '略過', `toobig:${fp}`)
      continue
    }
    const quietMs = now - new Date(f.modifiedTime).getTime()
    if (!opts.force && quietMs < QUIET_MINUTES * 60_000) {
      outcomes.push({ fileId: f.id, fileName: f.name, action: 'skipped-quiet' })
      continue
    }
    if (!opts.force && entry && entry.fingerprint === fp && entry.status === '已處理') {
      outcomes.push({ fileId: f.id, fileName: f.name, action: 'skipped-unchanged' })
      continue
    }
    todo.push(f)
  }

  // 檔案從 Drive 消失（帳本有、清單沒有）→ 只通知、不自動砍紀錄
  if (!dry && !opts.onlyFileId) {
    const listedIds = new Set(files.map(f => f.id))
    const cutoff = now - 45 * 24 * 60 * 60_000  // 只提醒近 45 天內的檔，避免舊檔輪出資料夾誤報
    for (const [fileId, entry] of ledger) {
      if (listedIds.has(fileId)) continue
      if (entry.status !== '已處理') continue
      const modMs = entry.fileModifiedTime ? new Date(entry.fileModifiedTime).getTime() : 0
      if (modMs < cutoff) continue
      const notifyHash = `gone:${fileId}`
      if (entry.notifiedHash !== notifyHash) {
        await pushToGroup(`⚠️ 檔案已從 Drive 消失，出貨紀錄仍保留（不自動刪）\n檔案：${entry.fileName}\n如要作廢請到主頁手動處理`)
        await upsertLedgerEntry(entry, {
          fileId, fileName: entry.fileName, fingerprint: entry.fingerprint,
          fileModifiedTime: entry.fileModifiedTime, status: '略過',
          notifiedHash: notifyHash, summary: '檔案已從 Drive 消失',
        })
      }
    }
  }

  if (todo.length === 0) return { scannedFiles: files.length, outcomes, dry }

  if (!dry) await ensureRecordsSchema()
  const [batches, allRecords] = await Promise.all([fetchBatchesLite(), fetchRecordsLite()])
  const records: RecordLite[] = [...allRecords]

  for (const f of todo) {
    const entry = ledger.get(f.id)
    try {
      const outcome = await processOneFile(f, entry, ledger, batches, records, dry)
      outcomes.push(outcome)
    } catch (err) {
      console.error('[drive-scan] 處理失敗', f.name, err)
      const msg = err instanceof Error ? err.message : String(err)
      outcomes.push({ fileId: f.id, fileName: f.name, action: 'error', errors: [msg] })
      if (!dry) {
        await notifyOnce(entry, f, `⚠️ 自動扣帳系統錯誤\n檔案：${f.name}\n錯誤：${msg}`.slice(0, 1500), '異常', `err:${sha1(msg)}`)
      }
    }
  }

  return { scannedFiles: files.length, outcomes, dry }
}

async function notifyOnce(
  entry: LedgerEntry | undefined, f: DriveFileInfo,
  message: string, status: '異常' | '略過', notifyHash: string,
): Promise<void> {
  if (entry?.notifiedHash !== notifyHash) await pushToGroup(message)
  await upsertLedgerEntry(entry, {
    fileId: f.id, fileName: f.name, fingerprint: fingerprintOf(f),
    fileModifiedTime: f.modifiedTime, status, notifiedHash: notifyHash,
    summary: message.slice(0, 300),
  })
}

async function processOneFile(
  f: DriveFileInfo,
  entry: LedgerEntry | undefined,
  ledger: Map<string, LedgerEntry>,
  batches: BatchLite[],
  records: RecordLite[],
  dry: boolean,
): Promise<FileOutcome> {
  const buf = await downloadAsXlsx(f)
  // Google 試算表沒有 size 欄，下載後再擋一次超大檔
  if (buf.length > MAX_FILE_BYTES) {
    const msg = `⚠️ 檔案過大（${Math.round(buf.length / 1048576)}MB）不自動處理\n檔案：${f.name}`
    if (!dry) await notifyOnce(entry, f, msg, '略過', `toobig:${fingerprintOf(f)}`)
    return { fileId: f.id, fileName: f.name, action: 'skipped-toobig' }
  }

  const wb: ParsedWorkbook = parseStoreOrderWorkbook(buf)
  const notes: string[] = [...wb.warnings]

  // 解析不出本尊分頁 → 異常
  if (!wb.dominantSno || !wb.dominantDate || wb.activeTabs.length === 0) {
    const msg = `⚠️ 無法自動扣帳（解析失敗）\n檔案：${f.name}\n原因：${notes.length ? notes.join('；') : '找不到 出貨單號／配送日期／商品明細'}\n處理：確認是標準店鋪貨單版型，或在主頁手動加出貨計畫`
    if (!dry) await notifyOnce(entry, f, msg, '異常', `parse:${sha1(msg)}`)
    return { fileId: f.id, fileName: f.name, action: 'anomaly', errors: notes.length ? notes : ['解析失敗'], notes }
  }

  // 硬警告（店名對不到、表頭壞掉、同日多單號…）→ 整張單當異常，絕不鏡像/封存
  if (wb.hardWarnings.length > 0) {
    const msg = [`⚠️ 無法自動扣帳｜${wb.dominantSno}（${wb.dominantDate}）`, `檔案：${f.name}`,
      ...wb.hardWarnings.map(w => `・${w}`), `處理：修正後 10 分鐘內會自動重試，或手動加出貨計畫`].join('\n')
    if (!dry) await notifyOnce(entry, f, msg, '異常', `hard:${sha1(wb.hardWarnings.join('|'))}`)
    return { fileId: f.id, fileName: f.name, action: 'anomaly', sNo: wb.dominantSno, date: wb.dominantDate, errors: wb.hardWarnings, notes }
  }

  const sNo = wb.dominantSno
  const date = wb.dominantDate
  const conflicts: string[] = []

  // ── 撞手動紀錄：同店+同日已有「沒印章」的紀錄 → 該店整個不自動寫（分配前先剔除，
  //    否則 FIFO 會把該店的量溢到別的批次，變成幽靈紀錄）──
  const manualStores = new Set(
    records.filter(r => !r.sourceFileId && r.planStatus !== '已取消' && r.date === date && r.store)
      .map(r => r.store as string))
  const tabsToBook = wb.activeTabs.filter(t => {
    if (t.store && manualStores.has(t.store)) {
      conflicts.push(`「${t.store}」${date} 已有手動紀錄 → 這店未自動寫入，請人工擇一`)
      return false
    }
    return true
  })

  // 這次要記帳的店（給下面判斷「會被本檔取代的舊檔紀錄」用）
  const bookStores = new Set(tabsToBook.map(t => t.store).filter(Boolean) as string[])
  // 別的檔案、同單號、同店，且對方檔比本檔舊或已消失 → 待會跨檔撞單會封存它，
  // 算剩餘時要先當它不存在，否則批次滿載時新的(1)(2)複本會被誤判「不夠扣」。
  const willSupersede = (r: RecordLite): boolean =>
    !!r.sourceFileId && r.sourceFileId !== f.id && r.shipmentNo === sNo &&
    !!r.store && bookStores.has(r.store) &&
    (() => { const m = ledger.get(r.sourceFileId)?.fileModifiedTime; return !m || m < f.modifiedTime })()

  // 可分配剩餘 = 入倉箱數 − 未取消紀錄合計（排除本檔本單號舊帳＋會被本檔取代的舊檔帳）
  const remainingByBatch = new Map<string, number>()
  for (const b of batches) {
    let used = 0
    for (const r of records) {
      if (r.batchId !== b.id) continue
      if (r.planStatus === '已取消') continue
      if (r.sourceFileId === f.id && r.shipmentNo === sNo) continue  // 本檔本單號舊帳排除
      if (willSupersede(r)) continue                                 // 待會會封存的舊檔帳排除
      used += r.boxes
    }
    remainingByBatch.set(b.id, Math.max(0, b.totalBoxes - used))
  }

  // FIFO 分配
  const alloc = allocateFifo(tabsToBook, f.name, batches, remainingByBatch)
  for (const n of alloc.notes) notes.push(n)
  if (!alloc.ok) {
    const detailLines = tabsToBook.filter(t => t.rows.length > 0).map(t => `・${t.store ?? t.sheetName} ${t.totalBoxes}箱`)
    const msg = [`⚠️ 無法自動扣帳｜${sNo}（${date}）`, `檔案：${f.name}`, `原因：`,
      ...alloc.errors.map(e => `・${e}`), `已解析明細（供人工參考）：`, ...detailLines,
      `處理：到主頁批次卡補「商品關鍵字」，10 分鐘內自動重試；或手動加出貨計畫`].join('\n')
    if (!dry) await notifyOnce(entry, f, msg, '異常', `alloc:${sha1(alloc.errors.join('|'))}`)
    return { fileId: f.id, fileName: f.name, action: 'anomaly', sNo, date, errors: alloc.errors, conflicts, notes }
  }

  // ── 跨檔撞單：別的檔案已寫過 同單號+同批次+同店 → 比修改時間，較新的檔贏 ──
  const lines: AllocationLine[] = []
  for (const line of alloc.lines) {
    const others = records.filter(r =>
      r.sourceFileId && r.sourceFileId !== f.id && r.planStatus !== '已取消' &&
      r.shipmentNo === sNo && r.batchId === line.batchId && r.store === line.store)
    let iAmNewer = true
    for (const other of others) {
      const otherMod = ledger.get(other.sourceFileId)?.fileModifiedTime
      // 對方檔還在且比我新 → 我讓步（不寫這行）；對方檔已消失或比我舊 → 我贏
      if (otherMod && otherMod > f.modifiedTime) { iAmNewer = false; break }
    }
    if (!iAmNewer) {
      conflicts.push(`「${line.store}」單號 ${sNo} 另一個較新的檔案已寫過 → 本檔這行未寫入`)
      continue
    }
    // 我贏 → 封存對方所有重複紀錄
    for (const other of others) {
      if (!dry) await archiveRecord(other.id)
      const idx = records.indexOf(other); if (idx >= 0) records.splice(idx, 1)
      conflicts.push(`「${line.store}」單號 ${sNo}：以本檔（較新）為準，已封存舊檔紀錄`)
    }
    lines.push(line)
  }

  // ── 本檔自己的既有紀錄：只認「同一個 S 單號」的當本檔資產（換單號＝改用途，舊的不動）──
  const ownAll = records.filter(r => r.sourceFileId === f.id)
  const own = ownAll.filter(r => r.shipmentNo === sNo)
  const ownOtherSno = ownAll.filter(r => r.shipmentNo !== sNo)
  if (ownOtherSno.length > 0) {
    const oldSnos = Array.from(new Set(ownOtherSno.map(r => r.shipmentNo))).join('、')
    conflicts.push(`本檔單號已從 ${oldSnos} 變成 ${sNo}（疑似改用途）→ 舊單號的 ${ownOtherSno.length} 筆紀錄保留不動，請確認是否要作廢`)
  }
  // 同 (批次|店) 若有多筆自己的紀錄（併發race留下的重複）→ 留第一筆、其餘封存
  const ownByKey = new Map<string, RecordLite[]>()
  for (const r of own) {
    if (!r.batchId || !r.store) continue
    const k = `${r.batchId}|${r.store}`
    const arr = ownByKey.get(k) ?? []; arr.push(r); ownByKey.set(k, arr)
  }
  for (const [, arr] of ownByKey) {
    for (const dup of arr.slice(1)) {
      if (!dry) await archiveRecord(dup.id)
      const idx = records.indexOf(dup); if (idx >= 0) records.splice(idx, 1)
      const oi = own.indexOf(dup); if (oi >= 0) own.splice(oi, 1)
      conflicts.push(`清掉重複紀錄：${dup.store}（${dup.boxes}箱）`)
    }
  }

  // ── 決定輪次（每個批次一個輪次號）────────────────────────────────────────────
  const batchRound = new Map<string, number>()
  const hint = roundHintFromName(f.name)
  for (const bId of new Set(lines.map(l => l.batchId))) {
    const ownRound = own.filter(r => r.batchId === bId && r.round != null)
    const sameDate = records.filter(r => r.batchId === bId && r.date === date && r.round != null && r.planStatus !== '已取消')
    const allRounds = records.filter(r => r.batchId === bId && r.round != null && r.planStatus !== '已取消').map(r => r.round as number)
    const usedByOtherDate = new Set(records.filter(r => r.batchId === bId && r.round != null && r.date !== date && r.planStatus !== '已取消').map(r => r.round as number))
    let round: number
    if (ownRound.length > 0) round = ownRound[0].round as number
    else if (sameDate.length > 0) round = sameDate[0].round as number
    else if (hint && !usedByOtherDate.has(hint)) round = hint
    else round = allRounds.length > 0 ? Math.max(...allRounds) + 1 : 1
    batchRound.set(bId, round)
  }

  // ── 鏡像同步：自動紀錄 = 本檔本單號最新內容（新增／更新／封存）──────────────────
  const desiredByKey = new Map(lines.map(l => [`${l.batchId}|${l.store}`, l]))
  const creates: NonNullable<FileOutcome['creates']> = []
  const updates: NonNullable<FileOutcome['updates']> = []
  const archives: NonNullable<FileOutcome['archives']> = []
  const writtenIds: { id: string; batchId: string; store: string; boxes: number }[] = []

  for (const line of lines) {
    const round = batchRound.get(line.batchId) ?? 1
    const existing = own.find(r => r.batchId === line.batchId && r.store === line.store)
    if (existing) {
      const changed = existing.boxes !== line.boxes || existing.date !== date
        || existing.shipmentNo !== sNo || existing.round !== round
      if (changed) {
        updates.push({ batchName: line.batchName, store: line.store, boxes: line.boxes, from: existing.boxes })
        if (!dry) await updateAutoRecord(existing.id, { shipmentNo: sNo, store: line.store, date, boxes: line.boxes, round })
        existing.boxes = line.boxes; existing.date = date; existing.shipmentNo = sNo; existing.round = round
        writtenIds.push({ id: existing.id, batchId: line.batchId, store: line.store, boxes: line.boxes })
      }
    } else {
      creates.push({ batchName: line.batchName, store: line.store, boxes: line.boxes, round })
      // dry / 非 dry 都往記憶體帳補一筆，讓後面的檔看到一致狀態
      const id = dry ? `dry-${sha1(`${f.id}|${line.batchId}|${line.store}`)}`
        : await createAutoRecord({ shipmentNo: sNo, batchId: line.batchId, store: line.store, date, boxes: line.boxes, round, sourceFileId: f.id })
      const rec: RecordLite = { id, shipmentNo: sNo, batchId: line.batchId, store: line.store, date, boxes: line.boxes, round, planStatus: '計畫中', sourceFileId: f.id }
      records.push(rec); own.push(rec)
      if (!dry) writtenIds.push({ id, batchId: line.batchId, store: line.store, boxes: line.boxes })
    }
  }
  // 本檔本單號裡已不存在的（店被拿掉／箱數歸零）→ 封存
  for (const r of own.slice()) {
    if (!r.batchId || !r.store) continue
    if (r.id.startsWith('dry-')) continue
    if (!desiredByKey.has(`${r.batchId}|${r.store}`)) {
      archives.push({ store: r.store, boxes: r.boxes })
      if (!dry) await archiveRecord(r.id)
      const idx = records.indexOf(r); if (idx >= 0) records.splice(idx, 1)
      const oi = own.indexOf(r); if (oi >= 0) own.splice(oi, 1)
    }
  }

  // ── 讀回核對 ─────────────────────────────────────────────────────────────────
  let verify: FileOutcome['verify'] = { ok: true, detail: dry ? '試跑（未寫入）' : '無寫入動作' }
  if (!dry && writtenIds.length > 0) {
    let okCount = 0
    const bad: string[] = []
    for (const w of writtenIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page: any = await notion.pages.retrieve({ page_id: w.id })
      const p = page?.properties
      if (p?.['出貨箱數']?.number === w.boxes && p?.['出貨門市']?.select?.name === w.store && p?.['關聯批次']?.relation?.[0]?.id === w.batchId) okCount++
      else bad.push(`${w.store}（寫${w.boxes}箱，讀回${p?.['出貨箱數']?.number ?? '?'}）`)
    }
    verify = bad.length === 0 ? { ok: true, detail: `讀回 ${okCount}/${writtenIds.length} 筆一致` }
      : { ok: false, detail: `❌ 有 ${bad.length} 筆讀回不一致：${bad.join('、')}` }
  }

  // ── 組 LINE 訊息 ─────────────────────────────────────────────────────────────
  const changed = creates.length + updates.length + archives.length > 0
  const batchLines: string[] = []
  for (const bId of new Set(lines.map(l => l.batchId))) {
    const b = batches.find(x => x.id === bId)
    const mine = lines.filter(x => x.batchId === bId)
    // 用實際寫入的 lines 加總，而非 alloc.perBatchTotal（跨檔撞單剔除後才會一致）
    const total = mine.reduce((s, l) => s + l.boxes, 0)
    const remain = remainingByBatch.get(bId) ?? 0
    batchLines.push(`▸ ${b?.ivName ?? bId}：本單 ${total} 箱（剩餘可排 ${remain}／入倉 ${b?.totalBoxes ?? '?'}）`)
    for (const l of mine) batchLines.push(`　・${l.store} ${l.boxes}`)
  }
  const message = [
    `✅ 自動扣帳｜${sNo}（配送 ${date}）`, `檔案：${f.name}`, ...batchLines,
    ...(updates.length ? [`鏡像更新 ${updates.length} 筆：${updates.map(u => `${u.store} ${u.from}→${u.boxes}`).join('、')}`] : []),
    ...(archives.length ? [`已移除 ${archives.length} 筆（檔案裡已刪）：${archives.map(a => a.store).join('、')}`] : []),
    ...(conflicts.length ? [`⚠️ 提醒：`, ...conflicts.map(c => `・${c}`)] : []),
    ...(notes.length ? [`備註：`, ...notes.map(n => `・${n}`)] : []),
    `核對：${verify.detail}${verify.ok ? ' ✅' : ''}`,
  ].join('\n')

  if (!dry) {
    const status = verify.ok ? '已處理' : '異常'
    const notifyHash = `ok:${sha1(message)}`
    if (changed || !verify.ok || conflicts.length > 0) {
      if (entry?.notifiedHash !== notifyHash) await pushToGroup(message)
    }
    await upsertLedgerEntry(entry, {
      fileId: f.id, fileName: f.name, fingerprint: fingerprintOf(f),
      fileModifiedTime: f.modifiedTime, status, notifiedHash: notifyHash,
      summary: `${sNo} ${date}｜建${creates.length} 改${updates.length} 移${archives.length}｜${verify.detail}`,
    })
  }

  return { fileId: f.id, fileName: f.name, action: verify.ok ? 'processed' : 'anomaly', sNo, date, creates, updates, archives, conflicts, notes, verify }
}
