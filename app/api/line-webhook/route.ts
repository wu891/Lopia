import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { parseDemandText } from '@/lib/parseDemandText'
import { createDemandItem, demandItemExistsForLineMessage } from '@/lib/notion'
import { clampLen } from '@/lib/auth'

export const dynamic = 'force-dynamic'

interface LineMessage {
  id: string
  type: string
  text?: string
}

interface LineEvent {
  type: string
  message?: LineMessage
}

// 用 LINE_CHANNEL_SECRET 驗證這個請求真的是LINE平台送來的
// 做法：把請求內容(body)用密鑰算出一個簽章，跟LINE附帶的簽章比對是否一致
function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const hash = createHmac('sha256', secret).update(body).digest('base64')
  return hash === signature
}

export async function POST(req: NextRequest) {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret) {
    console.error('Missing LINE_CHANNEL_SECRET env var')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  const body = await req.text()
  const signature = req.headers.get('x-line-signature')
  if (!verifySignature(body, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let events: LineEvent[] = []
  try {
    events = JSON.parse(body).events ?? []
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  for (const event of events) {
    if (event.type !== 'message') continue
    const message = event.message
    if (!message || message.type !== 'text' || !message.text) continue

    const text = message.text
    const parsedItems = parseDemandText(text)

    // 一則LINE訊息可能含多行、解析出多筆需求，每一筆用「訊息ID+序號」當去重編號，
    // 避免LINE重送同一則訊息時，清單裡出現重複項目
    for (let i = 0; i < parsedItems.length; i++) {
      const lineMessageId = `${message.id}_${i}`
      const exists = await demandItemExistsForLineMessage(lineMessageId)
      if (exists) continue

      const item = parsedItems[i]
      await createDemandItem({
        store: item.store || undefined,
        product: clampLen(item.product, 2000),
        quantity: item.quantity,
        needDate: item.needDate || null,
        status: '待確認',
        source: 'LINE',
        rawMessage: clampLen(text, 2000),
        lineMessageId,
      })
    }
  }

  return NextResponse.json({ ok: true })
}
