/**
 * lib/reconCleanup.ts — 對帳明細「舊檔殘列」清理（依來源檔案封存）
 * ───────────────────────────────────────────────────────────────
 * 為什麼需要這支：
 *   貨單重做過（舊檔從 Drive 刪掉、新檔是另一個 fileId）時——
 *     - 出貨紀錄：sync.ts 有跨檔覆蓋，新檔會取代舊檔 ✅
 *     - 對帳明細：reconciliation.ts 的去重複範圍是「來源檔案」，各檔各管各的，
 *       舊檔的列沒人收 → 同一批貨被算兩次，請款金額多算 ❌
 *   （2026-08-28 抓到 8 月多算 138 箱 / NT$219,460 就是這個。）
 *
 * 這支做的事很窄：**把指定 Drive 檔案 ID 寫進去的對帳列封存起來**，其他一律不碰。
 *   - 只認完全相符的「來源檔案」值 → 手動列（來源檔案空白）永遠不會被誤刪
 *   - 封存＝Notion 的 archived（丟進垃圾桶，救得回來），不是真的永久刪除
 *   - 預設 dry（只算不改），要真的封存必須明確帶 apply
 */

import { Client } from '@notionhq/client'
import { notionRetry } from './notion'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

export interface ReconRowLite {
  pageId: string
  shipmentNo: string
  store: string
  product: string
  spec: string
  boxes: number
  unitPrice: number
  amount: number
  sourceFile: string
}

export interface CleanupResult {
  dry: boolean
  fileIds: string[]
  perFile: { fileId: string; rows: number; boxes: number; amount: number }[]
  rows: ReconRowLite[]
  totals: { rows: number; boxes: number; amount: number }
  archived: number
  errors: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rich = (p: any) => p?.rich_text?.map((r: { plain_text: string }) => r.plain_text).join('') ?? ''

/** 撈出「來源檔案」正好等於某個 fileId 的所有對帳列 */
async function rowsOfFile(db: string, fileId: string): Promise<ReconRowLite[]> {
  const out: ReconRowLite[] = []
  let cursor: string | undefined
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await notionRetry(() => notion.databases.query({
      database_id: db,
      filter: { property: '來源檔案', rich_text: { equals: fileId } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    }))
    for (const page of res.results) {
      const p = page.properties
      const boxes = p['箱數']?.number ?? 0
      const unitPrice = p['單價']?.number ?? 0
      out.push({
        pageId: page.id,
        shipmentNo: rich(p['ShipmentNo']),
        store: rich(p['門市']),
        product: rich(p['商品名稱']),
        spec: rich(p['入數']),
        boxes, unitPrice, amount: boxes * unitPrice,
        sourceFile: rich(p['來源檔案']),
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return out
}

/**
 * 封存指定來源檔案的對帳列。
 * @param fileIds 要清掉的 Drive 檔案 ID（通常是掃描帳本裡標「略過／檔案已從 Drive 消失」的舊檔）
 * @param apply   false（預設）＝只列出不改；true＝真的封存
 * @param maxRows 保險絲：要封存的列數超過這個數就整批中止（防手滑打錯 fileId 掃掉一大片）
 */
export async function cleanupReconRows(
  fileIds: string[], apply: boolean, maxRows = 200,
): Promise<CleanupResult> {
  const db = process.env.NOTION_EXCEL_ROWS_DB?.trim()   // trim 防 env 尾端換行（踩過的坑）
  if (!db) throw new Error('缺 NOTION_EXCEL_ROWS_DB')
  const ids = fileIds.map(s => s.trim()).filter(Boolean)
  if (ids.length === 0) throw new Error('沒有指定 fileIds')

  const errors: string[] = []
  const perFile: CleanupResult['perFile'] = []
  const rows: ReconRowLite[] = []
  for (const fileId of ids) {
    const rs = await rowsOfFile(db, fileId)
    rows.push(...rs)
    perFile.push({
      fileId, rows: rs.length,
      boxes: rs.reduce((s, r) => s + r.boxes, 0),
      amount: rs.reduce((s, r) => s + r.amount, 0),
    })
  }
  const totals = {
    rows: rows.length,
    boxes: rows.reduce((s, r) => s + r.boxes, 0),
    amount: rows.reduce((s, r) => s + r.amount, 0),
  }

  let archived = 0
  if (apply) {
    if (totals.rows > maxRows) {
      errors.push(`要封存 ${totals.rows} 列，超過保險絲上限 ${maxRows} 列 → 整批中止，一列都沒動。確認 fileIds 是否正確。`)
      return { dry: false, fileIds: ids, perFile, rows, totals, archived: 0, errors }
    }
    for (const r of rows) {
      try {
        await notionRetry(() => notion.pages.update({ page_id: r.pageId, archived: true }))
        archived++
      } catch (e) {
        errors.push(`封存失敗 ${r.shipmentNo}/${r.store}/${r.product}：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return { dry: !apply, fileIds: ids, perFile, rows, totals, archived, errors }
}
