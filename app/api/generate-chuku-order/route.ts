import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

const STORE_MAP: Record<string, [string, string]> = {
  '台中lalaport': ['LPA01-5', '樂比亞台中LaLaport店青果部'],
  'lalaport台中': ['LPA01-5', '樂比亞台中LaLaport店青果部'],
  '台中la':       ['LPA01-5', '樂比亞台中LaLaport店青果部'],
  '台中':         ['LPA01-5', '樂比亞台中LaLaport店青果部'],
  '桃園':         ['LPA02-5', '樂比亞桃園春日店青果部'],
  '中和':         ['LPA03-5', '樂比亞中和環球店青果部'],
  '新莊':         ['LPA04-5', '樂比亞新莊宏匯店青果部'],
  '新荘':         ['LPA04-5', '樂比亞新莊宏匯店青果部'],
  '高雄漢神巨蛋': ['LPA05-5', '樂比亞高雄漢神巨蛋店青果部'],
  '高雄漢神':     ['LPA05-5', '樂比亞高雄漢神巨蛋店青果部'],
  '高雄巨蛋':     ['LPA05-5', '樂比亞高雄漢神巨蛋店青果部'],
  '高雄':         ['LPA05-5', '樂比亞高雄漢神巨蛋店青果部'],
  '巨蛋':         ['LPA05-5', '樂比亞高雄漢神巨蛋店青果部'],
  '南港':         ['LPA06-5', '樂比亞南港LaLaport店青果部'],
  '台中ikea':     ['LPA07-5', '樂比亞台中IKEA店青果部'],
  'ikea台中':     ['LPA07-5', '樂比亞台中IKEA店青果部'],
  'ikea':         ['LPA07-5', '樂比亞台中IKEA店青果部'],
  '夢時代':       ['LPA08-5', '樂比亞高雄統一夢時代店青果部'],
  '夢時':         ['LPA08-5', '樂比亞高雄統一夢時代店青果部'],
  '北門':         ['LPA09-5', '樂比亞台南新光三越小北門店青果部'],
  '小北門':       ['LPA09-5', '樂比亞台南新光三越小北門店青果部'],
  '台南mop':      ['LPA10-5', '樂比亞 台南MOP店青果部'],
  '台南三井':     ['LPA10-5', '樂比亞 台南MOP店青果部'],
  '三井':         ['LPA10-5', '樂比亞 台南MOP店青果部'],
  'mop':          ['LPA10-5', '樂比亞 台南MOP店青果部'],
  '漢神洲際':     ['LPA11-5', '樂比亞台中漢神洲際店青果部'],
  '台中漢神':     ['LPA11-5', '樂比亞台中漢神洲際店青果部'],
  '中漢':         ['LPA11-5', '樂比亞台中漢神洲際店青果部'],
  '台北大巨蛋':   ['LPA12-5', '樂比亞台北大巨蛋店青果部'],
  '大巨蛋':       ['LPA12-5', '樂比亞台北大巨蛋店青果部'],
  '北蛋':         ['LPA12-5', '樂比亞台北大巨蛋店青果部'],
}

const STORE_ORDER = Array.from({ length: 12 }, (_, i) => `LPA${String(i + 1).padStart(2, '0')}-5`)

function matchStore(name: string): [string, string] | null {
  const n = name.toLowerCase().trim()
  for (const [key, val] of Object.entries(STORE_MAP)) {
    if (n.includes(key) || key.includes(n)) return val
  }
  return null
}

function getStoreNum(code: string): string {
  const m = code.match(/LPA0*(\d+)-/)
  return m ? m[1] : '0'
}

interface DataRow {
  storeCode: string
  storeName: string
  code: string
  itemName: string
  qty: number
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const roundNo = Number(form.get('roundNo'))
    const dateRaw = String(form.get('date') ?? '')  // YYYY-MM-DD from Notion

    if (!file || !roundNo || !dateRaw) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 })
    }

    // Convert date: YYYY-MM-DD → YYYY/MM/DD (display) and YYYYMMDD (delivery no)
    const deliveryDate = dateRaw.replace(/-/g, '/')
    const deliveryNoDate = dateRaw.replace(/-/g, '')

    // Parse 庫存管理表
    const buffer = await file.arrayBuffer()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as ArrayBuffer)

    const sheetName = `第${roundNo}回出貨明細`
    const ws = wb.getWorksheet(sheetName)
    if (!ws) {
      return NextResponse.json({ error: `找不到工作表「${sheetName}」，請確認檔案版本正確` }, { status: 400 })
    }

    // Find 各門市出貨番号明細 section and parse
    const dataRows: DataRow[] = []
    let dataStarted = false
    let headerSkipped = false
    let currentStore = ''

    ws.eachRow((row) => {
      const vals = row.values as (string | number | null | undefined)[]
      // exceljs: vals[0] is always undefined, data starts at vals[1]
      const col0 = vals[1] != null ? String(vals[1]).trim() : ''
      const col1 = vals[2] != null ? String(vals[2]).trim() : ''
      const col2 = vals[3] != null ? String(vals[3]).trim() : ''
      const col3 = vals[4]

      if (!dataStarted) {
        if (col0.includes('各門市出貨番号明細')) dataStarted = true
        return
      }
      if (!headerSkipped) { headerSkipped = true; return }

      if (col0) currentStore = col0
      if (!col1 || col3 == null) return
      const qty = Number(col3)
      if (isNaN(qty) || qty <= 0) return

      const matched = matchStore(currentStore)
      if (!matched) return  // skip unrecognized stores

      dataRows.push({
        storeCode: matched[0],
        storeName: matched[1],
        code: col1.padStart(6, '0'),
        itemName: col2,
        qty,
      })
    })

    if (dataRows.length === 0) {
      return NextResponse.json({ error: `「${sheetName}」內找不到出貨明細資料` }, { status: 400 })
    }

    // Sort by STORE_ORDER then by product code
    dataRows.sort((a, b) => {
      const ai = STORE_ORDER.indexOf(a.storeCode)
      const bi = STORE_ORDER.indexOf(b.storeCode)
      if (ai !== bi) return ai - bi
      return a.code.localeCompare(b.code)
    })

    // Generate output Excel
    const outWb = new ExcelJS.Workbook()
    const outWs = outWb.addWorksheet('出庫單')

    const thin = { style: 'thin' as const }
    const border = { top: thin, bottom: thin, left: thin, right: thin }
    const centerAlign: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true }
    const leftAlign: Partial<ExcelJS.Alignment> = { horizontal: 'left', vertical: 'middle', wrapText: true }
    const fontNormal = { name: '微軟正黑體', size: 11 }
    const fontBold   = { name: '微軟正黑體', size: 11, bold: true }
    const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }

    outWs.columns = [
      { key: 'a', width: 12 },
      { key: 'b', width: 36 },
      { key: 'c', width: 13 },
      { key: 'd', width: 18 },
      { key: 'e', width: 10 },
      { key: 'f', width: 28 },
      { key: 'g', width: 8  },
      { key: 'h', width: 8  },
      { key: 'i', width: 10 },
    ]

    const headers = ['配送門市', '出貨門市名稱', '配送日期', '配送單號', '配送品號', '品名', '溫層', '數量', '單位名稱']
    const headerRow = outWs.addRow(headers)
    headerRow.height = 20
    headerRow.eachCell((cell) => {
      cell.font = fontBold
      cell.fill = headerFill
      cell.alignment = centerAlign
      cell.border = border
    })

    const dateObj = new Date(dateRaw)

    for (const d of dataRows) {
      const deliveryNo = `MDD${deliveryNoDate}-${getStoreNum(d.storeCode)}`
      const r = outWs.addRow([d.storeCode, d.storeName, dateObj, deliveryNo, d.code, d.itemName, '冷凍', d.qty, '箱'])
      r.height = 18
      r.eachCell((cell, colNum) => {
        cell.font = fontNormal
        cell.border = border
        if (colNum === 3) {
          cell.numFmt = 'YYYY/MM/DD'
          cell.alignment = centerAlign
        } else if (colNum === 6) {
          cell.alignment = leftAlign
        } else {
          cell.alignment = centerAlign
        }
      })
    }

    // Total row
    const totalQty = dataRows.reduce((s, d) => s + d.qty, 0)
    const totalRow = outWs.addRow(['總計', '', '', '', '', '', '', totalQty, '箱'])
    totalRow.height = 18
    totalRow.eachCell((cell, colNum) => {
      cell.font = colNum === 8 ? fontBold : fontNormal
      cell.border = border
      cell.alignment = centerAlign
    })

    const outBuf = await outWb.xlsx.writeBuffer()
    const filename = encodeURIComponent(`優儲出庫單_第${roundNo}回_${deliveryNoDate}.xlsx`)

    return new NextResponse(outBuf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      },
    })
  } catch (err) {
    console.error('[generate-chuku-order]', err)
    return NextResponse.json({ error: '伺服器錯誤，請重試' }, { status: 500 })
  }
}
