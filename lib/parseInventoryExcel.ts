import * as XLSX from 'xlsx'

export interface InventoryItem {
  code: string        // 商品編號 e.g. "000426"
  name: string        // 商品名稱(全名)
  spec: string        // 規格說明 e.g. "26PCS/箱"
  stock: number       // 庫存數量
  unit: string        // 出貨包裝階 e.g. "箱"
  temperature: string // 溫層 e.g. "冷藏品"
}

// 解析優儲倉庫庫存明細 Excel（固定格式：第4列為欄位名稱，商品編號在 index 1）
export function parseInventoryExcel(buffer: Buffer): InventoryItem[] {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  if (!wb.SheetNames.length) throw new Error('Excel 沒有分頁')

  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as string[][]

  // 找標頭列（商品編號 在 col index 1）
  const headerIdx = rows.findIndex(r => String(r[1]).trim() === '商品編號')
  if (headerIdx === -1) throw new Error('找不到標頭列（商品編號）—請確認是否為正確的庫存明細格式')

  const items: InventoryItem[] = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const code = String(r[1] ?? '').trim()
    const name = String(r[2] ?? '').trim()
    if (!code || !name) continue
    items.push({
      code,
      name,
      spec: String(r[3] ?? '').trim(),
      temperature: String(r[5] ?? '').trim() || '冷藏品',
      stock: Number(r[6]) || 0,
      unit: String(r[7] ?? '').trim() || '箱',
    })
  }

  if (!items.length) throw new Error('Excel 沒有解析到任何商品資料')
  return items
}
