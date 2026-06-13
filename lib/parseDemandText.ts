// ============================================================
// 白話說明：這個檔案是「自動辨識」的核心邏輯。
// 給它一段文字（例如LINE訊息或手動貼上的文字），
// 它會試著從裡面找出「門市、商品、數量、需要日期」。
//
// 這份邏輯跟 lopia-demand-tracker.html（舊的單機版工具）裡的規則完全一樣，
// 確保兩邊解析出來的結果一致。
// ============================================================

export interface ParsedDemandItem {
  store: string
  product: string
  quantity: string
  needDate: string // 'YYYY-MM-DD'，找不到日期時是空字串
}

// 店鋪對照表：每間店可能有幾種常見講法（別名），程式會用這些別名去比對文字
// 如果之後有新店開幕，或發現某間店常用的講法沒被抓到，直接在這裡加一個別名字串就好
const STORES: { name: string; aliases: string[] }[] = [
  { name: 'LaLaport台中', aliases: ['LaLaport台中', '台中LaLaport'] },
  { name: '桃園春日', aliases: ['桃園春日', '春日'] },
  { name: '新北中和環球', aliases: ['新北中和環球', '中和環球', '新北中和'] },
  { name: '新莊宏匯', aliases: ['新莊宏匯', '宏匯'] },
  { name: '高雄漢神巨蛋', aliases: ['高雄漢神巨蛋', '漢神巨蛋'] },
  { name: '南港LaLaport', aliases: ['南港LaLaport', '南港'] },
  { name: 'IKEA台中南屯', aliases: ['IKEA台中南屯', 'IKEA南屯', '台中南屯'] },
  { name: '高雄夢時代', aliases: ['高雄夢時代', '夢時代'] },
  { name: '台南小北門', aliases: ['台南小北門', '小北門'] },
  { name: '台南三井Outlet', aliases: ['台南三井Outlet', '三井Outlet', 'MOP', '三井'] },
  { name: '台中漢神中港', aliases: ['台中漢神中港', '漢神中港', '台中漢神'] },
  { name: '台北大巨蛋', aliases: ['台北大巨蛋', '大巨蛋'] },
  { name: '台南SOGO新天', aliases: ['台南SOGO新天', 'SOGO新天'] },
  { name: '高雄漢神百貨', aliases: ['高雄漢神百貨', '漢神百貨'] },
]

// 給網頁的「店鋪」下拉選單用：只取店名，不含別名
export const STORE_NAMES: string[] = STORES.map(s => s.name)

// 把所有「別名」攤平成一個陣列，並依照字數從長到短排序
// 白話：比對的時候先用比較完整、比較不會搞混的講法去對，
// 避免「漢神」這種會出現在好幾間店名字裡的短字，誤判成別的店。
const STORE_ALIAS_LIST = STORES
  .flatMap(s => s.aliases.map(alias => ({ alias, name: s.name })))
  .sort((a, b) => b.alias.length - a.alias.length)

// 找店鋪：依序比對「別名清單」（長的先比對），回傳第一個比對到的店名，
// 以及比對到的文字本身（之後要從原文拿掉）
function extractStore(text: string): { store: string; matched: string } {
  for (const { alias, name } of STORE_ALIAS_LIST) {
    if (text.indexOf(alias) !== -1) {
      return { store: name, matched: alias }
    }
  }
  return { store: '', matched: '' }
}

// 把年/月/日數字組合成 "YYYY-MM-DD" 格式的文字
function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// 月/日沒有年份時，判斷該用今年還是明年
// 白話：常見情境是「12月收到『1/15要到貨』，通常是指明年1月」，
// 所以如果換算出來的日期比今天早超過30天，就改用明年
function resolveYear(year: number, month: number, day: number, today: Date): number {
  const d = new Date(year, month - 1, day)
  const oneMonthAgo = new Date(today)
  oneMonthAgo.setDate(oneMonthAgo.getDate() - 30)
  return d < oneMonthAgo ? year + 1 : year
}

// 找日期：支援「YYYY-MM-DD / YYYY/MM/DD」「M月D日」「M/D」「今天/明天/後天」
// 找到後會換算成「YYYY-MM-DD」格式存起來，方便排序
function extractDate(text: string): { date: string; matched: string } {
  const today = new Date()
  const thisYear = today.getFullYear()

  // 1) YYYY-MM-DD 或 YYYY/MM/DD（最完整的格式，先比對）
  let m = text.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/)
  if (m) {
    return { date: toIsoDate(Number(m[1]), Number(m[2]), Number(m[3])), matched: m[0] }
  }

  // 2) M月D日（日可省略，例如「7月1日」或「7月1」）
  m = text.match(/(\d{1,2})月(\d{1,2})日?/)
  if (m) {
    const year = resolveYear(thisYear, Number(m[1]), Number(m[2]), today)
    return { date: toIsoDate(year, Number(m[1]), Number(m[2])), matched: m[0] }
  }

  // 3) 今天 / 明天 / 後天
  m = text.match(/今天|明天|後天/)
  if (m) {
    const offset = m[0] === '今天' ? 0 : m[0] === '明天' ? 1 : 2
    const d = new Date(today)
    d.setDate(d.getDate() + offset)
    return { date: toIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate()), matched: m[0] }
  }

  // 4) M/D（前面已經先檢查過完整的 YYYY/MM/DD，這裡只會抓到單純的「月/日」）
  m = text.match(/(?<![\d.])(\d{1,2})\/(\d{1,2})(?![\d\/])/)
  if (m) {
    const year = resolveYear(thisYear, Number(m[1]), Number(m[2]), today)
    return { date: toIsoDate(year, Number(m[1]), Number(m[2])), matched: m[0] }
  }

  return { date: '', matched: '' }
}

// 找數量：抓「數字 + 常見單位」（箱、盒、包...），抓不到單位就只取數字本身
function extractQuantity(text: string): { quantity: string; matched: string } {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(箱|盒|包|個|件|條|支|瓶|罐|組|份|公斤|斤|kg|KG|Kg|噸|台|串|顆|片|袋|捆|束|本|套)?/)
  if (m) {
    return { quantity: m[0].trim(), matched: m[0] }
  }
  return { quantity: '', matched: '' }
}

// 找商品名稱：把原文裡「店鋪、日期、數量」對應的文字拿掉，
// 再清掉一些常見的連接贅字（到貨、需要…），剩下的就是商品名稱
function extractProduct(text: string, storeMatched: string, dateMatched: string, qtyMatched: string): string {
  let s = text
  if (storeMatched) s = s.replace(storeMatched, ' ')
  if (dateMatched) s = s.replace(dateMatched, ' ')
  if (qtyMatched) s = s.replace(qtyMatched, ' ')
  // 移除常見的連接字/贅字（長的詞放前面，避免被短詞先比對掉）
  s = s.replace(/到貨|需要|訂購|要|到|訂|請|共/g, ' ')
  // 整理多餘的標點符號與空白
  s = s.replace(/[,，、.。\-－~\/／：:]+/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

// 把一行文字解析成一筆需求（門市/商品/數量/需要日期）
// 注意：日期一定要先抓、先從文字裡拿掉，再去抓數量，
// 不然「6/25」裡的數字可能會被誤認成數量
export function parseLine(line: string): ParsedDemandItem | null {
  const original = line.trim()
  if (!original) return null

  const storeResult = extractStore(original)
  const dateResult = extractDate(original)

  let textForQty = original
  if (dateResult.matched) {
    textForQty = textForQty.replace(dateResult.matched, ' ')
  }
  const qtyResult = extractQuantity(textForQty)

  const product = extractProduct(original, storeResult.matched, dateResult.matched, qtyResult.matched)

  return {
    store: storeResult.store,
    product,
    quantity: qtyResult.quantity,
    needDate: dateResult.date,
  }
}

// 把一段文字（可能多行）解析成多筆需求。
// 給LINE webhook用：只保留「至少抓到門市/數量/日期其中一項」的行，
// 純聊天訊息（完全沒有結構化資訊）會被忽略，不會塞進「待確認」清單
export function parseDemandText(text: string): ParsedDemandItem[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(parseLine)
    .filter((item): item is ParsedDemandItem =>
      item !== null && (item.store !== '' || item.quantity !== '' || item.needDate !== '')
    )
}
