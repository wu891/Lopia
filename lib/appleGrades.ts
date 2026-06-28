/**
 * appleGrades.ts
 *
 * 蘋果11 的品種與「出貨等級優先順序」單一事實來源。
 * 等級只在「同品種同玉數」內互相比；跨品種不比。
 * 優先順序＝貴的先扣（高等級先出），由 Colin 確認（2026-06-29）。
 */

export type AppleVariety = 'サンふじ' | 'ぐんま名月' | '有袋ふじ' | 'シナノゴールド'

export const APPLE_VARIETIES: AppleVariety[] = ['サンふじ', 'ぐんま名月', '有袋ふじ', 'シナノゴールド']

/** 品名 token → 品種（長 token 在前，避免子字串誤判）。'Sun Fuji'/'サンふじ' 同義 */
export const VARIETY_ALIASES: Record<string, AppleVariety> = {
  'ぐんま名月': 'ぐんま名月',
  '有袋ふじ': '有袋ふじ',
  'シナノゴールド': 'シナノゴールド',
  'サンふじ': 'サンふじ',
  'Sun Fuji': 'サンふじ',
}

/**
 * 各品種等級優先順序（高→低，先扣→後扣）。
 * 名稱需與倉庫品名拆出的 grade 完全一致（extractGrade 的輸出）。
 */
export const GRADE_PRIORITY: Record<AppleVariety, string[]> = {
  'サンふじ':        ['特上', '丸秀', '特選', '特'],
  'ぐんま名月':      ['特選', '特A'],
  '有袋ふじ':        ['特選', '秀', '秀A', '特A', '特'],
  'シナノゴールド':  ['特秀(金)', '金特選'],
}

/** 取得某品種的等級排序；未知品種回空陣列 */
export function gradeOrder(variety: AppleVariety): string[] {
  return GRADE_PRIORITY[variety] ?? []
}
