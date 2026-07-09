/**
 * lib/driveScan/ledger.ts
 *
 * Drive 自動扣帳 — 掃描帳本（哪個檔處理到哪了）＋一次性建置。
 * ───────────────────────────────────────────────────────────────
 * 帳本是一個小 Notion DB（NOTION_DRIVE_SCAN_DB），一個檔案一頁，記：
 *   - 內容指紋（md5＋修改時間＋大小）→ 沒變就跳過，10 分鐘掃一次也不浪費
 *   - 狀態（已處理／異常／略過）→ 異常檔每輪重試（等 Colin 補關鍵字後自動成功）
 *   - 通知指紋 → 同一個異常只通知一次，不會每 10 分鐘洗版
 *
 * 一次性建置（setup 端點呼叫）：
 *   - 出貨紀錄 DB 補「來源檔案」欄（自動紀錄的身分證＝Drive fileId）
 *   - 進口批次 DB 補「商品關鍵字」欄（商品↔批次對照）
 *   - 建帳本 DB（放在進口批次 DB 同一個父頁面下，整合自動有權限）
 *   - 幫現有活躍批次填好初始關鍵字
 *
 * 仿照 lib/weekly.ts 的 ensureSyncSchema / lib/checklist.ts 的 provision 模式。
 */

import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

export function ledgerDb(): string | null {
  return process.env.NOTION_DRIVE_SCAN_DB?.trim() || null
}

// ── 帳本讀寫 ──────────────────────────────────────────────────────────────────

export type LedgerStatus = '已處理' | '異常' | '略過'

export interface LedgerEntry {
  pageId: string
  fileId: string
  fileName: string
  fingerprint: string
  fileModifiedTime: string
  status: LedgerStatus | string
  notifiedHash: string
  summary: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rich(prop: any): string {
  return prop?.rich_text?.map((r: { plain_text: string }) => r.plain_text).join('') ?? ''
}

function rt(s: string) {
  const clipped = (s ?? '').slice(0, 1900)
  return clipped ? [{ type: 'text' as const, text: { content: clipped } }] : []
}

export async function getLedgerEntries(): Promise<Map<string, LedgerEntry>> {
  const DB = ledgerDb()
  if (!DB) throw new Error('缺 NOTION_DRIVE_SCAN_DB（先呼叫 /api/drive-scan/setup 建帳本）')
  const out = new Map<string, LedgerEntry>()
  let cursor: string | undefined
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await notion.databases.query({
      database_id: DB, page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of res.results) {
      const p = page.properties
      const fileId = p['檔案ID']?.title?.[0]?.plain_text ?? ''
      if (!fileId) continue
      out.set(fileId, {
        pageId: page.id,
        fileId,
        fileName: rich(p['檔名']),
        fingerprint: rich(p['內容指紋']),
        fileModifiedTime: rich(p['檔案修改時間']),
        status: p['狀態']?.select?.name ?? '',
        notifiedHash: rich(p['通知指紋']),
        summary: rich(p['摘要']),
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return out
}

export async function upsertLedgerEntry(
  existing: LedgerEntry | undefined,
  data: {
    fileId: string; fileName: string; fingerprint: string; fileModifiedTime: string
    status: LedgerStatus; notifiedHash: string; summary: string
  },
): Promise<void> {
  const DB = ledgerDb()
  if (!DB) return
  const props = {
    '檔案ID':     { title: [{ type: 'text' as const, text: { content: data.fileId } }] },
    '檔名':       { rich_text: rt(data.fileName) },
    '內容指紋':   { rich_text: rt(data.fingerprint) },
    '檔案修改時間': { rich_text: rt(data.fileModifiedTime) },
    '狀態':       { select: { name: data.status } },
    '通知指紋':   { rich_text: rt(data.notifiedHash) },
    '摘要':       { rich_text: rt(data.summary) },
    '最後掃描':   { date: { start: new Date().toISOString() } },
  }
  if (existing) {
    await notion.pages.update({ page_id: existing.pageId, properties: props })
  } else {
    await notion.pages.create({ parent: { database_id: DB }, properties: props })
  }
}

// ── 一次性建置 ────────────────────────────────────────────────────────────────

// 各 DB 各自一個旗標（weekly 的教訓：不能共用一個 boolean）
let recordsSchemaReady = false
let batchSchemaReady = false

/** 出貨紀錄 DB 補「來源檔案」欄（rich_text，存 Drive fileId）。冪等，可重複呼叫。 */
export async function ensureRecordsSchema(): Promise<void> {
  if (recordsSchemaReady) return
  const DB = process.env.NOTION_SHIPMENT_RECORDS_DB?.trim()
  if (!DB) throw new Error('缺 NOTION_SHIPMENT_RECORDS_DB')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (await notion.databases.retrieve({ database_id: DB })) as any
  if (!meta?.properties?.['來源檔案']) {
    await notion.databases.update({ database_id: DB, properties: { '來源檔案': { rich_text: {} } } })
  }
  recordsSchemaReady = true
}

/** 進口批次 DB 補「商品關鍵字」欄。冪等。 */
export async function ensureBatchSchema(): Promise<void> {
  if (batchSchemaReady) return
  const DB = process.env.NOTION_IMPORT_STATUS_DB?.trim()
  if (!DB) throw new Error('缺 NOTION_IMPORT_STATUS_DB')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (await notion.databases.retrieve({ database_id: DB })) as any
  if (!meta?.properties?.['商品關鍵字']) {
    await notion.databases.update({ database_id: DB, properties: { '商品關鍵字': { rich_text: {} } } })
  }
  batchSchemaReady = true
}

/** 建帳本 DB（放在進口批次 DB 的父頁面下）。回傳新 DB id，要設成 env 再部署。 */
export async function provisionLedgerDb(): Promise<{ databaseId: string }> {
  const importDb = process.env.NOTION_IMPORT_STATUS_DB?.trim()
  if (!importDb) throw new Error('缺 NOTION_IMPORT_STATUS_DB，無法定位父頁面')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (await notion.databases.retrieve({ database_id: importDb })) as any
  const parent = meta?.parent
  if (parent?.type !== 'page_id' || !parent.page_id) {
    throw new Error('進口批次 DB 的父層不是頁面，無法自動建立帳本 DB')
  }
  const created = await notion.databases.create({
    parent: { type: 'page_id', page_id: parent.page_id },
    title: [{ type: 'text', text: { content: 'Drive出貨單掃描帳' } }],
    properties: {
      '檔案ID':       { title: {} },
      '檔名':         { rich_text: {} },
      '內容指紋':     { rich_text: {} },
      '檔案修改時間': { rich_text: {} },
      '狀態':         { select: { options: [{ name: '已處理' }, { name: '異常' }, { name: '略過' }] } },
      '通知指紋':     { rich_text: {} },
      '摘要':         { rich_text: {} },
      '最後掃描':     { date: {} },
    },
  })
  return { databaseId: created.id }
}

/**
 * 幫現有批次填初始「商品關鍵字」（只填空白的，不覆蓋 Colin 已填的）。
 * 關鍵字設計原則：
 *   - 加工品關鍵字要能跟生鮮區分（例：生地瓜用「地瓜(產地」，大學芋用「拔絲地瓜」）
 *   - 蘋果批次靠檔名的「蘋果NN」對（商品列只有品種名，品種會跨批次重複）
 */
export const KEYWORD_SEED: Record<string, string> = {
  'TW00-01385':    '蘋果11, りんご11, リンゴ11',
  'TW00-01383':    '蘋果10, りんご10, リンゴ10',
  'CITY20260701':  '麝香, 葡萄, 珍珠, シャイン, Shine, デラウェア, 德拉瓦',
  'CITY20260701S': '地瓜(產地, 千葉地瓜, 茨城地瓜, 紅春香, シルク, 拔絲地瓜, 地瓜燒, 大學芋, Candied',
  'CITY20260601FS': '大學芋, 拔絲地瓜, 地瓜燒, Candied, 冷凍大學芋',
  'CITY20260501S': '地瓜(產地, 千葉地瓜, 茨城地瓜',
}
// 注意：CITY20260701S 是「地瓜＋加工品」混合批次，同時掛生鮮與加工關鍵字；
// FIFO 會先扣完舊的專屬批次（501S/601FS）才輪到它，順序天然正確。

export async function seedBatchKeywords(): Promise<{ seeded: string[]; skipped: string[] }> {
  const DB = process.env.NOTION_IMPORT_STATUS_DB?.trim()
  if (!DB) throw new Error('缺 NOTION_IMPORT_STATUS_DB')
  const seeded: string[] = []
  const skipped: string[] = []
  let cursor: string | undefined
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await notion.databases.query({
      database_id: DB, page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of res.results) {
      const p = page.properties
      const ivName = p['IV Name']?.title?.[0]?.plain_text ?? ''
      const seed = KEYWORD_SEED[ivName]
      if (!seed) continue
      const existing = rich(p['商品關鍵字'])
      if (existing.trim()) { skipped.push(ivName); continue }   // Colin 填過的不動
      await notion.pages.update({
        page_id: page.id,
        properties: { '商品關鍵字': { rich_text: rt(seed) } },
      })
      seeded.push(ivName)
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return { seeded, skipped }
}
