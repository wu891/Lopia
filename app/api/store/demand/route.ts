// 門市入口頁專用的公開需求 POST 端點
// 不需要 Colin 密碼，但會驗證門市名稱必須是真實的 LOPIA 門市
// 狀態自動設為「待確認」，來源設為「門市」
import { NextRequest, NextResponse } from 'next/server'
import { createDemandItem } from '@/lib/notion'
import { STORES } from '@/lib/stores'

export const dynamic = 'force-dynamic'

// 輸入長度上限，防止濫用
const MAX_PRODUCT  = 500
const MAX_QUANTITY = 200
const MAX_NOTE     = 1000

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()

    // 驗證門市名稱必須是 LOPIA 正式門市（開幕中的才能提交需求）
    const validStore = STORES.find(
      s => s.name_zh === data.store && s.status === 'open'
    )
    if (!validStore) {
      return NextResponse.json(
        { error: '無效的門市名稱' },
        { status: 400 }
      )
    }

    // 清理輸入，防止超長字串
    const product  = String(data.product  ?? '').slice(0, MAX_PRODUCT).trim()
    const quantity = String(data.quantity ?? '').slice(0, MAX_QUANTITY).trim()
    const note     = String(data.note     ?? '').slice(0, MAX_NOTE).trim()

    if (!product) {
      return NextResponse.json(
        { error: '商品名稱不可空白' },
        { status: 400 }
      )
    }

    // 日期格式驗證（只允許 YYYY-MM-DD 或空值）
    const needDate = data.needDate
      ? /^\d{4}-\d{2}-\d{2}$/.test(String(data.needDate))
        ? String(data.needDate)
        : null
      : null

    const item = await createDemandItem({
      store:    validStore.name_zh,
      product,
      quantity,
      needDate,
      status:   '待確認',   // 門市提交的先設為待確認，Colin 確認後再改為待處理
      note,
      source:   '門市',     // 區分來源：門市 / LINE / 手動
    })

    return NextResponse.json({ item })
  } catch (err) {
    console.error('[api/store/demand POST]', err)
    return NextResponse.json(
      { error: '送出失敗，請稍後再試' },
      { status: 500 }
    )
  }
}
