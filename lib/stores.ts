export interface Store {
  id: string
  name_zh: string
  name_ja: string
  address_zh: string
  city_zh: string
  opened: string
  status: 'open' | 'coming_soon'
  excelSheetName?: string
}

export const EXCEL_SHEET_ORDER = [
  '台中', '桃園', '中和', '新荘', '巨蛋',
  '南港', 'IKEA', '夢時', '北門', 'MOP', '中漢', '北蛋'
]

export function sortedStores(stores: Store[]): Store[] {
  return [...stores].sort((a, b) => {
    const ai = a.excelSheetName ? EXCEL_SHEET_ORDER.indexOf(a.excelSheetName) : 999
    const bi = b.excelSheetName ? EXCEL_SHEET_ORDER.indexOf(b.excelSheetName) : 999
    return ai - bi
  })
}

export const STORES: Store[] = [
  { id: 'taichung-lalaport', name_zh: 'LaLaport 台中店', name_ja: 'LaLaport台中店', address_zh: '台中市東區進德路700號 B1', city_zh: '台中', opened: '2023-01-17', status: 'open', excelSheetName: '台中' },
  { id: 'taoyuan-chunri', name_zh: '桃園春日店', name_ja: '桃園春日店', address_zh: '桃園市桃園區春日路618號 1F', city_zh: '桃園', opened: '2023-12-16', status: 'open', excelSheetName: '桃園' },
  { id: 'zhonghe-global', name_zh: '新北中和環球店', name_ja: '新北中和環球店', address_zh: '新北市中和區中山路三段122號 B1', city_zh: '新北', opened: '2024-02-01', status: 'open', excelSheetName: '中和' },
  { id: 'xinzhuang-honghui', name_zh: '新莊宏匯店', name_ja: '新荘宏匯店', address_zh: '新北市新莊區新北大道4段3號 B1', city_zh: '新北', opened: '2024-06-01', status: 'open', excelSheetName: '新荘' },
  { id: 'kaohsiung-hanshin-dome', name_zh: '高雄漢神巨蛋店', name_ja: '高雄漢神巨蛋店', address_zh: '高雄市左營區博愛二路777號 B1', city_zh: '高雄', opened: '2024-10-04', status: 'open', excelSheetName: '巨蛋' },
  { id: 'nangang-lalaport', name_zh: '南港 LaLaport 店', name_ja: '南港LaLaport店', address_zh: '台北市南港區經貿二路131號 B1', city_zh: '台北', opened: '2025-03-20', status: 'open', excelSheetName: '南港' },
  { id: 'taichung-ikea', name_zh: 'IKEA 台中南屯店', name_ja: 'IKEA台中南屯店', address_zh: '台中市南屯區向上路二段168號 1F', city_zh: '台中', opened: '2025-05-09', status: 'open', excelSheetName: 'IKEA' },
  { id: 'kaohsiung-dream-times', name_zh: '高雄夢時代店', name_ja: '高雄夢時代店', address_zh: '高雄市前鎮區中華五路789號 B1', city_zh: '高雄', opened: '2025-07-10', status: 'open', excelSheetName: '夢時' },
  { id: 'tainan-xiaobei', name_zh: '台南小北門店', name_ja: '台南小北門店', address_zh: '台南市北區西門路四段135號', city_zh: '台南', opened: '2025-08-29', status: 'open', excelSheetName: '北門' },
  { id: 'tainan-mitsui', name_zh: '台南三井 Outlet 店', name_ja: '台南三井アウトレット店', address_zh: '台南市歸仁區歸仁大道101號 1F', city_zh: '台南', opened: '2026-03-17', status: 'open', excelSheetName: 'MOP' },
  { id: 'taichung-hanshin', name_zh: '台中漢神中港店', name_ja: '台中漢神中港店', address_zh: '台中市北屯區崇德路三段865號 B1', city_zh: '台中', opened: '2026-04-10', status: 'open', excelSheetName: '中漢' },
  { id: 'taipei-dajuyuan', name_zh: '台北大巨蛋店', name_ja: '台北ドーム店', address_zh: '台北市信義區忠孝東路四段505號 B2', city_zh: '台北', opened: '2026-05-01', status: 'coming_soon', excelSheetName: '北蛋' },
  { id: 'tainan-sogo-xintian', name_zh: '台南 SOGO 新天店', name_ja: '台南SOGO新天店', address_zh: '台南市中西區西門路一段658號 B2', city_zh: '台南', opened: '2026-06-01', status: 'coming_soon' },
  { id: 'kaohsiung-hanshin-dept', name_zh: '高雄漢神百貨店', name_ja: '高雄漢神百貨店', address_zh: '高雄市前金區成功一路266-1號 B3', city_zh: '高雄', opened: '2026-09-01', status: 'coming_soon' },
]
