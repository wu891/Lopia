import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getShipmentById, getShipmentRecords } from '@/lib/notion'
import { parseDeliveryExcel } from '@/lib/parseDeliveryExcel'

export const dynamic = 'force-dynamic'

function getDriveClient() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  return google.drive({ version: 'v3', auth })
}

export interface DerivedBatchItem {
  productName: string
  boxes: number         // 總箱：該品項跨所有輪次/店鋪加總
  shippedBoxes: number  // 已出貨：該品項在「日期 ≤ 今天且未取消的輪次」加總
}

/**
 * 從供應商 Excel 推算每個品項的總箱與已出貨數。
 * - 總箱     = 該品項在所有輪次/店鋪的箱數加總
 * - 已出貨   = 該品項在「日期已到（≤今天）且未取消的輪次」的箱數加總
 * 回傳 { derived, hasExcel }；若批次未上傳供應商 Excel，hasExcel=false 且 derived=[]。
 */
export async function GET(req: NextRequest) {
  try {
    const batchId = req.nextUrl.searchParams.get('batchId')
    if (!batchId) {
      return NextResponse.json({ error: 'Missing batchId' }, { status: 400 })
    }

    const batch = await getShipmentById(batchId)
    if (!batch.supplierExcelId) {
      return NextResponse.json({ derived: [], hasExcel: false })
    }

    // 1. 下載並解析供應商 Excel（同 generate-order 的模式）
    const drive = getDriveClient()
    const fileRes = await drive.files.get(
      { fileId: batch.supplierExcelId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    )
    const supplierBuffer = fileRes.data as ArrayBuffer
    const parsed = await parseDeliveryExcel(supplierBuffer)

    // 2. 從出貨紀錄建立「輪次 → 日期」對照（排除已取消）
    const records = await getShipmentRecords()
    const roundDate = new Map<number, string>()
    for (const r of records) {
      if (r.batchId !== batchId || r.round == null) continue
      if (r.planStatus === '已取消') continue
      if (r.date && !roundDate.has(r.round)) roundDate.set(r.round, r.date)
    }
    const today = new Date().toISOString().slice(0, 10)

    // 3. 依品項加總總箱與已出貨
    const map = new Map<string, DerivedBatchItem>()
    for (const round of parsed) {
      const date = roundDate.get(round.roundNo)
      const isShipped = !!date && date <= today
      for (const store of round.stores) {
        for (const p of store.products) {
          const name = p.name.trim()
          if (!name) continue
          const entry = map.get(name) ?? { productName: name, boxes: 0, shippedBoxes: 0 }
          entry.boxes += p.quantity
          if (isShipped) entry.shippedBoxes += p.quantity
          map.set(name, entry)
        }
      }
    }

    const derived = Array.from(map.values()).sort((a, b) => b.boxes - a.boxes)
    return NextResponse.json({ derived, hasExcel: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to derive batch items' }, { status: 500 })
  }
}
