import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { Readable } from 'stream'
import { getShipmentById, getShipmentRecords } from '@/lib/notion'
import { parseDeliveryExcel, EXCEL_STORE_MAP } from '@/lib/parseDeliveryExcel'
import { generateShipmentOrder, generateShipmentNo, StoreOrder } from '@/lib/generateShipmentOrder'

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

export async function POST(req: NextRequest) {
  try {
    const { batchId, roundNo } = await req.json()
    if (!batchId || roundNo == null) {
      return NextResponse.json({ error: 'Missing batchId or roundNo' }, { status: 400 })
    }

    // 1. Get batch info
    const batch = await getShipmentById(batchId)
    if (!batch.supplierExcelId) {
      return NextResponse.json({ error: '此批次尚未上傳供應商配送Excel' }, { status: 400 })
    }

    // 2. Get shipment records for this round
    const allRecords = await getShipmentRecords()
    const roundRecords = allRecords.filter(
      r => r.batchId === batchId && r.round === roundNo
    )
    if (roundRecords.length === 0) {
      return NextResponse.json({ error: `找不到第 ${roundNo} 輪的出貨紀錄` }, { status: 404 })
    }

    // Get delivery date from records
    const deliveryDate = roundRecords[0].date ?? new Date().toISOString().slice(0, 10)

    // 3. Download supplier Excel from Google Drive
    const drive = getDriveClient()
    const fileRes = await drive.files.get(
      { fileId: batch.supplierExcelId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    )
    const supplierBuffer = fileRes.data as ArrayBuffer

    // 4. Parse supplier Excel to get product details
    const parsed = await parseDeliveryExcel(supplierBuffer)
    const roundData = parsed.find(r => r.roundNo === roundNo)

    // 5. Build store orders
    const storeOrders: StoreOrder[] = []
    for (const record of roundRecords) {
      if (!record.store) continue

      // Find matching product data from supplier Excel
      let products = roundData?.stores.find(s => s.name === record.store)?.products
      if (!products || products.length === 0) {
        // Try fuzzy match via EXCEL_STORE_MAP
        const shortName = Object.entries(EXCEL_STORE_MAP).find(([, full]) => full === record.store)?.[0]
        if (shortName) {
          products = roundData?.stores.find(s =>
            s.name === shortName || s.name === record.store
          )?.products
        }
      }

      storeOrders.push({
        storeName: record.store,
        products: products ?? [{
          name: batch.productSummary ?? batch.ivName,
          boxSpec: '',
          quantity: record.boxes ?? 0,
          unitPrice: 0,
          category: '水果',
        }],
        deliveryDate,
      })
    }

    // 6. Generate shipment number
    const shipmentNo = generateShipmentNo(deliveryDate)

    // 7. Generate Excel
    const excelBuffer = generateShipmentOrder(storeOrders, shipmentNo, batch.ivName)

    // 8. Upload to Google Drive
    const fileName = `${shipmentNo} LOPIA_${batch.ivName}_店鋪貨單.xlsx`
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID!
    const buffer = Buffer.from(excelBuffer)

    const uploaded = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `[出貨單] ${fileName}`,
        parents: [folderId],
        description: `Batch: ${batch.ivName} | Round: ${roundNo}`,
      },
      media: {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: Readable.from(buffer),
      },
      fields: 'id,name,webViewLink',
    })

    // Make publicly readable
    await drive.permissions.create({
      fileId: uploaded.data.id!,
      supportsAllDrives: true,
      requestBody: { role: 'reader', type: 'anyone' },
    })

    const driveUrl = `https://drive.google.com/file/d/${uploaded.data.id}/view`

    // 9. Return Excel as download + drive URL in header
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'X-Drive-Url': driveUrl,
        'X-Shipment-No': shipmentNo,
      },
    })
  } catch (err) {
    console.error('[generate-order]', err)
    return NextResponse.json(
      { error: `出貨單產生失敗: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
