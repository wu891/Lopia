/**
 * apple11Stores.ts
 *
 * 蘋果11 的 12 間門市對照表（含新店 美麗華，取代舊的北蛋）。
 * 樂比亞店名(yushuName) 依「出庫總單範例 20260703 第2回」校正過。
 * LPA 碼格式：LPA{兩碼}-5（"-5" 為固定 department 碼，非回目；依範例固定）。
 */

export interface Apple11Store {
  lpaNo: number      // 1-12
  code: string       // 計画書分頁主名（台中…）
  aliases: string[]  // 其他可對應的分頁名
  fullName: string   // 店鋪貨單顯示全名
  yushuName: string  // 出庫總單「出貨門市名稱」
}

export const APPLE11_STORES: Apple11Store[] = [
  { lpaNo: 1,  code: '台中', aliases: ['らら台中'],     fullName: 'LaLaport 台中店',    yushuName: '樂比亞台中LaLaport店青果部' },
  { lpaNo: 2,  code: '桃園', aliases: ['春日'],         fullName: '桃園春日店',          yushuName: '樂比亞桃園春日店青果部' },
  { lpaNo: 3,  code: '中和', aliases: ['環球'],         fullName: '新北中和環球店',      yushuName: '樂比亞中和環球店青果部' },
  { lpaNo: 4,  code: '新荘', aliases: ['新莊', '宏匯'], fullName: '新莊宏匯店',          yushuName: '樂比亞新莊宏匯店青果部' },
  { lpaNo: 5,  code: '高雄', aliases: ['巨蛋'],         fullName: '高雄漢神巨蛋店',      yushuName: '樂比亞高雄漢神巨蛋店青果部' },
  { lpaNo: 6,  code: '南港', aliases: [],               fullName: '南港 LaLaport 店',    yushuName: '樂比亞南港LaLaport店青果部' },
  { lpaNo: 7,  code: 'IKEA', aliases: ['イケア', '南屯'], fullName: 'IKEA 台中南屯店',    yushuName: '樂比亞IKEA台中南屯店青果部' },
  { lpaNo: 8,  code: '夢時', aliases: ['夢時代'],       fullName: '高雄夢時代店',        yushuName: '樂比亞高雄夢時代店青果部' },
  { lpaNo: 9,  code: '北門', aliases: ['台南', '小北門'], fullName: '台南小北門店',       yushuName: '樂比亞台南新光三越小北門店青果部' },
  { lpaNo: 10, code: 'MOP',  aliases: ['mop', 'MO'],     fullName: '台南三井 Outlet 店',  yushuName: '樂比亞台南MOP店青果部' },
  { lpaNo: 11, code: '中漢', aliases: ['中港', '台中漢神'], fullName: '台中漢神中港店',    yushuName: '樂比亞台中漢神中港店青果部' },
  { lpaNo: 12, code: '美麗', aliases: ['美麗華'],       fullName: '台北大直美麗華店',    yushuName: '樂比亞台北大直美麗華店青果部' },
]

/** 固定 department 碼（LPA{nn}-{DEPT}），依範例為 '5' */
export const LPA_DEPT = '5'

/** 計画書店名 code/alias → 門市；找不到回 undefined */
export function resolveApple11Store(code: string): Apple11Store | undefined {
  const key = code.trim()
  return APPLE11_STORES.find(s => s.code === key || s.aliases.includes(key))
}
