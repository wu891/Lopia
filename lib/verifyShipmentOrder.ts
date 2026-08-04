/**
 * verifyShipmentOrder.ts
 *
 * 出貨單「交付前自動核對」。
 *
 * 白話：
 *   出貨單 Excel 做好之後，不要直接丟給人下載。
 *   先把剛做好的那個檔案「重新打開讀一遍」，把裡面每一間店、每一個商品的箱數，
 *   跟來源（計劃書解析出來的數字）一格一格比。
 *   只要有一個對不上，就不給下載，並且告訴使用者差在哪裡。
 *
 * 為什麼要這樣做：
 *   2026-08-03 第七回出貨單漏掉夢時代店（分頁名對不起來，那間店的箱數整個變 0）。
 *   數字是「產出流程自己算的」，光看程式沒人會發現；把成品讀回來對，才擋得住。
 *
 * 檢查四件事：
 *   1. 來源有的店，產出檔一定要有那個分頁
 *   2. 每間店「每個商品」的箱數要一樣
 *   3. 每間店的「總箱數」要一樣
 *   4. 總表裡每間店那一欄的加總、以及全部總箱數，也要一樣
 */

import ExcelJS from 'exceljs'
import { ParsedProduct } from './parseDeliveryExcel'
import { buildItemSpec } from './generateShipmentOrder'

/** 一筆對不上的差異 */
export interface VerifyDiff {
  where: string        // 哪裡（店名／總表）
  item?: string        // 哪個商品（沒有就是整店總數）
  expected: number     // 計劃書（來源）的數字
  actual: number       // 產出檔實際寫進去的數字
  note: string         // 白話說明
}

export interface VerifyResult {
  ok: boolean
  diffs: VerifyDiff[]
  stats: {
    storeCount: number     // 核對了幾間店
    itemCount: number      // 核對了幾個「店×商品」組合
    totalBoxes: number     // 來源總箱數
    actualBoxes: number    // 產出檔總箱數
  }
}

/** 核對用的來源資料：一間店 + 它應該要有的商品列 */
export interface ExpectedStore {
  storeName: string
  products: ParsedProduct[]
}

/** 把商品列彙總成「商品名 + 規格 → 箱數」；同名同規格會加總 */
function foldProducts(products: ParsedProduct[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of products) {
    const { detailedName, spec } = buildItemSpec(p.name, p.boxSpec)
    const key = `${detailedName}｜${spec || '—'}`
    m.set(key, (m.get(key) ?? 0) + (p.quantity || 0))
  }
  return m
}

/** 把內部 key（商品名｜規格）變成好讀的一行；規格已含在名稱裡就不重複寫 */
function labelOf(key: string): string {
  const [name, spec] = key.split('｜')
  return spec && spec !== '—' && !name.includes(spec) ? `${name}（${spec}）` : name
}

/** 是不是「合　計」那一列（可能含全形空白） */
function isTotalLabel(s: string): boolean {
  return s.replace(/[\s　]/g, '') === '合計'
}

/** 讀某一格的數字；公式格或空白一律當 0（公式的值不在檔案裡，不能拿來比） */
function numOf(cell: ExcelJS.Cell): number {
  const v = cell.value
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'result' in v && typeof v.result === 'number') return v.result
  return 0
}

/**
 * 核對產出的出貨單 Excel。
 * @param buffer   剛產生好的 Excel（還沒交給使用者）
 * @param expected 來源資料（計劃書解析出來的每間店商品列）
 */
export async function verifyShipmentOrder(
  buffer: ArrayBuffer | Buffer,
  expected: ExpectedStore[],
): Promise<VerifyResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as ArrayBuffer)

  const diffs: VerifyDiff[] = []
  let itemCount = 0
  let totalBoxes = 0
  let actualBoxes = 0

  // ── 1~3. 逐店比對 ──────────────────────────────────────────────────────────
  for (const exp of expected) {
    const sheetName = exp.storeName.slice(0, 31)   // Excel 分頁名上限 31 字
    const ws = wb.getWorksheet(sheetName)
    const wantMap = foldProducts(exp.products)
    const wantTotal = Array.from(wantMap.values()).reduce((a, b) => a + b, 0)
    totalBoxes += wantTotal

    if (!ws) {
      diffs.push({
        where: exp.storeName, expected: wantTotal, actual: 0,
        note: '產出的 Excel 裡完全沒有這間店的分頁',
      })
      continue
    }

    // 產品列從第 10 列開始，讀到「合　計」那列為止
    // A=商品名稱 B=規格 C=箱數 D=單價 E=小計
    const gotMap = new Map<string, number>()
    let sheetTotal = 0
    for (let r = 10; r <= ws.rowCount; r++) {
      const nameCell = String(ws.getCell(r, 1).value ?? '').trim()
      if (!nameCell) continue
      if (isTotalLabel(nameCell)) break           // 合　計 → 商品列結束
      const spec = String(ws.getCell(r, 2).value ?? '').trim()
      const qty  = numOf(ws.getCell(r, 3))
      const key  = `${nameCell}｜${spec || '—'}`
      gotMap.set(key, (gotMap.get(key) ?? 0) + qty)
      sheetTotal += qty
    }
    actualBoxes += sheetTotal

    // 每個商品逐項比
    for (const [key, want] of wantMap) {
      itemCount++
      const got = gotMap.get(key) ?? 0
      if (got !== want) {
        diffs.push({
          where: exp.storeName, item: labelOf(key), expected: want, actual: got,
          note: gotMap.has(key) ? '箱數跟計劃書不一樣' : '產出檔裡找不到這個商品列',
        })
      }
    }
    // 產出檔多出來的商品（計劃書沒有的）
    for (const [key, got] of gotMap) {
      if (!wantMap.has(key) && got !== 0) {
        diffs.push({
          where: exp.storeName, item: labelOf(key), expected: 0, actual: got,
          note: '計劃書沒有這個商品，產出檔卻有箱數',
        })
      }
    }
    // 整店總數
    if (sheetTotal !== wantTotal) {
      diffs.push({
        where: exp.storeName, expected: wantTotal, actual: sheetTotal,
        note: '這間店的總箱數跟計劃書不一樣',
      })
    }
  }

  // ── 4. 總表 ────────────────────────────────────────────────────────────────
  const summary = wb.getWorksheet('總表')
  if (!summary) {
    diffs.push({ where: '總表', expected: totalBoxes, actual: 0, note: '產出的 Excel 裡沒有總表分頁' })
  } else {
    // 第 2 列是表頭：商品名稱 / 規格 / 單價 / …各店… / 總箱數 / 總金額
    const header = summary.getRow(2)
    const colOfStore = new Map<string, number>()
    header.eachCell({ includeEmpty: false }, (cell, col) => {
      const t = String(cell.value ?? '').trim()
      if (col >= 4 && t && t !== '總箱數' && t !== '總金額(TWD)') colOfStore.set(t, col)
    })

    let summaryTotal = 0
    for (const exp of expected) {
      const want = foldProducts(exp.products)
      const wantTotal = Array.from(want.values()).reduce((a, b) => a + b, 0)
      const col = colOfStore.get(exp.storeName)
      if (col == null) {
        diffs.push({ where: '總表', item: exp.storeName, expected: wantTotal, actual: 0, note: '總表沒有這間店的欄位' })
        continue
      }
      let colSum = 0
      for (let r = 3; r <= summary.rowCount; r++) {
        const first = String(summary.getCell(r, 1).value ?? '').trim()
        if (!first) continue
        if (isTotalLabel(first)) break
        colSum += numOf(summary.getCell(r, col))
      }
      summaryTotal += colSum
      if (colSum !== wantTotal) {
        diffs.push({ where: '總表', item: exp.storeName, expected: wantTotal, actual: colSum, note: '總表這間店那一欄的加總跟計劃書不一樣' })
      }
    }
    if (summaryTotal !== totalBoxes) {
      diffs.push({ where: '總表', expected: totalBoxes, actual: summaryTotal, note: '總表全部加起來的箱數跟計劃書不一樣' })
    }
  }

  return {
    ok: diffs.length === 0,
    diffs,
    stats: { storeCount: expected.length, itemCount, totalBoxes, actualBoxes },
  }
}

/** 把差異整理成一段人看得懂的文字（回給前端顯示用） */
export function formatDiffs(diffs: VerifyDiff[], max = 12): string {
  const lines = diffs.slice(0, max).map(d =>
    `${d.where}${d.item ? `／${d.item}` : ''}：計劃書 ${d.expected} 箱、產出檔 ${d.actual} 箱（${d.note}）`
  )
  if (diffs.length > max) lines.push(`…另外還有 ${diffs.length - max} 項對不上`)
  return lines.join('\n')
}
