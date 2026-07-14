/**
 * lib/driveScan/reconciliation.ts
 *
 * Drive 自動扣帳 — 順便把同一批解析好的商品列同步進「對帳明細（Excel 上傳）」Notion DB。
 * ───────────────────────────────────────────────────────────────
 * 跟庫存扣帳共用同一份解析結果（parseStoreOrder.ts 的 ParsedStoreTab），只是另外存一份給
 * 對帳系統（reconciliation-dashboard.html）用。設計重點（訪談定案）：
 *
 *   - 去重複範圍＝「來源檔案」（這個 Drive 檔案 ID），不是「出貨單號」。
 *     同一個 S 單號常常拆成好幾個檔案（同一天不同品項各開一張單），如果用「單號砍掉重建」
 *     會把別的檔案寫的資料一起洗掉。改成「這個檔案」鏡像同步，各檔各管各的，不會互相覆蓋。
 *   - 跟庫存扣帳「綁在一起」：只有呼叫端已經確認這批商品成功比對到批次（alloc.ok）才會呼叫
 *     這裡；批次比對失敗時，呼叫端本來就會整張單當異常、不會走到這裡——對帳也就一起不同步，
 *     等 Colin 把批次卡設定修好、下一輪重跑，兩邊一次補齊。
 *   - 缺單價的商品列（表頭抓不到「單價」欄、或該列單價是空白/0）→ 跳過不寫，回傳清單讓呼叫端
 *     放進 LINE 訊息提醒 Colin 手動去對帳系統網頁補。
 *   - 鏡像同步：這個檔案這次解析出的（門市＋商品＋規格）組合，就是這個檔案在對帳系統裡該有的
 *     全部資料——新的建立、變過的更新、檔案裡已經拿掉的自動封存，不留幽靈資料。
 *   - 寫完讀回核對：比對「箱數合計」「金額合計」，兜不起來就回報 ok=false，呼叫端會把整張單
 *     標「異常」，下一輪重試，不會默默留著錯的請款金額。
 */

import { Client } from '@notionhq/client'
import { notionRetry } from '../notion'
import type { ParsedStoreTab } from './parseStoreOrder'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

// 跟 reconciliation-dashboard.html 的 classifyProduct() 規則保持一致（同一份關鍵字清單）
const PROCESSED_KW = ['ジュース','果汁','ジャム','果醬','ドライ','果乾','ゼリー','果凍','チョコ','ケーキ','クッキー','餅乾','アイス','プリン','加工','調味','醬','sauce','ソース','漬け','醃','干し','乾燥','冷凍','罐','瓶','ボトル','大学芋','大學芋','スティック','揚げ','フライ','コロッケ','焼き芋','干しいも','いもスティック','天ぷら','炒め','地瓜條','芋條','酥脆地瓜']
const VEG_KW = ['地瓜','さつまいも','サツマイモ','甘薯','馬鈴薯','じゃがいも','キャベツ','高麗菜','白菜','大根','蘿蔔','にんじん','紅蘿蔔','トマト','番茄','レタス','ほうれん草','きゅうり','なす','茄子','玉ねぎ','洋蔥','ねぎ','蔥','にんにく','大蒜','ブロッコリー','アスパラ','とうもろこし','えだまめ','毛豆','芋','野菜','蔬菜']

export function classifyProduct(name: string): '水果' | '蔬菜' | '加工品' {
  const l = name.toLowerCase()
  if (PROCESSED_KW.some(k => l.includes(k.toLowerCase()))) return '加工品'
  if (VEG_KW.some(k => l.includes(k.toLowerCase()))) return '蔬菜'
  return '水果'
}

interface ExistingReconRow {
  id: string
  store: string
  product: string
  spec: string
  boxes: number
  unitPrice: number
  category: string
  date: string
}

interface DesiredReconRow {
  store: string
  product: string
  spec: string
  boxes: number
  unitPrice: number
  category: string
}

export interface ReconSyncResult {
  ok: boolean
  creates: number
  updates: number
  archives: number
  skippedNoPrice: string[]   // 「門市「商品名」」描述，供 LINE 訊息用
  verify: { ok: boolean; detail: string }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function richText(prop: any): string {
  return prop?.rich_text?.map((r: { plain_text: string }) => r.plain_text).join('') ?? ''
}

function reconKey(r: { store: string; product: string; spec: string }): string {
  return `${r.store}|${r.product}|${r.spec}`
}

async function fetchReconRowsByFile(db: string, fileId: string): Promise<ExistingReconRow[]> {
  const out: ExistingReconRow[] = []
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
      out.push({
        id: page.id,
        store: richText(p['門市']),
        product: richText(p['商品名稱']),
        spec: richText(p['入數']),
        boxes: p['箱數']?.number ?? 0,
        unitPrice: p['單價']?.number ?? 0,
        category: p['類別']?.select?.name ?? '水果',
        date: p['出貨日期']?.date?.start ?? '',
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProps(d: DesiredReconRow, shipmentNo: string, date: string, fileId: string): Record<string, any> {
  return {
    '名稱': { title: [{ text: { content: `${shipmentNo}_${d.store}_${d.product}` } }] },
    'ShipmentNo': { rich_text: [{ text: { content: shipmentNo } }] },
    '出貨日期': date ? { date: { start: date } } : { date: null },
    '門市': { rich_text: [{ text: { content: d.store } }] },
    '商品名稱': { rich_text: [{ text: { content: d.product } }] },
    '入數': { rich_text: [{ text: { content: d.spec } }] },
    '箱數': { number: d.boxes },
    '單價': { number: d.unitPrice },
    '類別': { select: { name: d.category } },
    '來源檔案': { rich_text: [{ text: { content: fileId } }] },
  }
}

export async function syncReconciliation(params: {
  fileId: string
  fileName: string
  shipmentNo: string
  date: string
  tabs: ParsedStoreTab[]
  dry: boolean
}): Promise<ReconSyncResult> {
  const db = process.env.NOTION_EXCEL_ROWS_DB?.trim()
  if (!db) {
    return { ok: true, creates: 0, updates: 0, archives: 0, skippedNoPrice: [], verify: { ok: true, detail: '未設定 NOTION_EXCEL_ROWS_DB，略過對帳同步' } }
  }
  const { fileId, shipmentNo, date, tabs, dry } = params

  // ── 1) 這個檔案「應該有」的對帳列：同（門市＋商品＋規格）用加總，不覆蓋 ──────────
  const desiredMap = new Map<string, DesiredReconRow>()
  const skippedNoPrice: string[] = []
  for (const tab of tabs) {
    if (!tab.store || tab.rows.length === 0) continue
    for (const row of tab.rows) {
      if (row.price == null || row.price <= 0) {
        skippedNoPrice.push(`${tab.store}「${row.name}」`)
        continue
      }
      const k = reconKey({ store: tab.store, product: row.name, spec: row.spec || '' })
      const existing = desiredMap.get(k)
      if (existing) existing.boxes += row.boxes
      else desiredMap.set(k, { store: tab.store, product: row.name, spec: row.spec || '', boxes: row.boxes, unitPrice: row.price, category: classifyProduct(row.name) })
    }
  }

  // ── 2) 這個檔案「目前已經寫過」的對帳列 ──────────────────────────────────────
  const existing = await fetchReconRowsByFile(db, fileId)
  const existingByKey = new Map(existing.map(r => [reconKey(r), r]))

  let creates = 0, updates = 0, archives = 0
  const touched = desiredMap.size > 0 || existingByKey.size > 0
  // 這輪實際新增／更新過的頁面，讀回核對只認這些（見下方說明，不要重查資料庫）
  const writtenIds: { id: string; want: DesiredReconRow }[] = []

  // ── 3) 鏡像同步：新增／更新 desired 裡的列 ──────────────────────────────────
  for (const [k, d] of desiredMap) {
    const ex = existingByKey.get(k)
    if (!ex) {
      creates++
      if (!dry) {
        const page = await notionRetry(() => notion.pages.create({ parent: { database_id: db }, properties: buildProps(d, shipmentNo, date, fileId) }))
        writtenIds.push({ id: page.id, want: d })
      }
    } else if (ex.boxes !== d.boxes || ex.unitPrice !== d.unitPrice || ex.date !== date || ex.category !== d.category) {
      updates++
      if (!dry) {
        await notionRetry(() => notion.pages.update({ page_id: ex.id, properties: buildProps(d, shipmentNo, date, fileId) }))
        writtenIds.push({ id: ex.id, want: d })
      }
    }
  }
  // ── 4) 鏡像同步：檔案裡已經拿掉的列 → 封存 ──────────────────────────────────
  for (const [k, ex] of existingByKey) {
    if (!desiredMap.has(k)) {
      archives++
      if (!dry) await notionRetry(() => notion.pages.update({ page_id: ex.id, archived: true }))
    }
  }

  if (!touched) {
    return { ok: true, creates: 0, updates: 0, archives: 0, skippedNoPrice, verify: { ok: true, detail: '無對帳資料（沒有可用單價的商品列）' } }
  }

  // ── 5) 讀回核對：逐筆用「頁面 ID」直接讀回剛寫的那幾筆 ──────────────────────
  // 注意：這裡故意不重新查詢資料庫（databases.query）核對合計——Notion 的查詢／搜尋索引
  // 剛寫入時會有短暫延遲，同一秒內重查常常讀不到剛建立的頁面，會把「寫成功」誤判成「讀不到」。
  // 直接用 pages.retrieve(page_id) 讀單一頁面沒有這個延遲問題（庫存扣帳那邊本來就是這樣做，同一套邏輯）。
  let verify = { ok: true, detail: dry ? '試跑（未寫入）' : '無變更' }
  if (!dry && writtenIds.length > 0) {
    let okCount = 0
    const bad: string[] = []
    for (const w of writtenIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page: any = await notionRetry(() => notion.pages.retrieve({ page_id: w.id }))
      const p = page?.properties
      if (p?.['箱數']?.number === w.want.boxes && p?.['單價']?.number === w.want.unitPrice) okCount++
      else bad.push(`${w.want.store}「${w.want.product}」（寫${w.want.boxes}箱/${w.want.unitPrice}元，讀回${p?.['箱數']?.number ?? '?'}箱/${p?.['單價']?.number ?? '?'}元）`)
    }
    verify = bad.length === 0
      ? { ok: true, detail: `讀回 ${okCount}/${writtenIds.length} 筆一致` }
      : { ok: false, detail: `❌ 有 ${bad.length} 筆讀回不一致：${bad.join('、')}` }
  }

  return { ok: verify.ok, creates, updates, archives, skippedNoPrice, verify }
}
