# LOPIA 進口貨況追蹤系統 — Claude 工作背景

## 專案概要
Trade Media Japan（日本供應商）→ LOPIA Taiwan（台灣零售門市）進口貨況追蹤網站。  
管理進口批次、通關進度、門市出貨計畫，並提供月曆檢視與門市時程側欄。

- **GitHub**: https://github.com/wu891/Lopia （branch: main）
- **Vercel URL**: lopia-status.vercel.app（wu-2331s-projects / lopia-status project）
- **本地路徑**: `C:\Users\lin76\OneDrive\Desktop\CLAUDE COWORK\CLAUDE OUTPUTS\lopia-status`

---

## Tech Stack
- **Framework**: Next.js 15 App Router（`force-dynamic` for fresh API data）
- **Language**: TypeScript
- **Styling**: Tailwind CSS（custom color: `lopia-red`, `lopia-red-light`, `lopia-red-dark`）
- **Database**: Notion API（`@notionhq/client`）
- **File storage**: Google Drive API（`googleapis`）— Shared Drive（supportsAllDrives: true）
- **Email**: Nodemailer + Gmail SMTP（App Password）
- **Auth**: sessionStorage（`lopia_authed = '1'`）— single shared password via env var
- **Deploy**: Vercel（auto-deploy on push to main）

---

## Environment Variables（Vercel Production）

| 變數名稱 | 用途 |
|---|---|
| `NOTION_API_KEY` | Notion API 金鑰 |
| `NOTION_IMPORT_STATUS_DB` | 進口批次主表 DB ID |
| `NOTION_SHIPMENT_RECORDS_DB` | 出貨紀錄 DB ID |
| `NOTION_CHANGE_LOG_DB` | 修改紀錄 DB ID：`364c74ca4c5a42b69a0b4f502e6a0854` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | GCP 服務帳號 JSON（完整內容，單行） |
| `GOOGLE_DRIVE_FOLDER_ID` | Shared Drive ID：`0ANlmYqjSU_8bUk9PVA` |
| `GMAIL_USER` | 寄件帳號：`wu@tm-japan.jp` |
| `GMAIL_APP_PASSWORD` | Gmail App Password（khga kjgw kphb uogw） |
| `EDIT_PASSWORD` | 編輯密碼（預設 `lopia2026`，可自行修改） |

> ⚠️ env var 用 `printf "value" | npx vercel env add KEY production`（不要用 echo，會多一個 `\n`）

---

## Notion 資料庫結構

### 進口批次（IMPORT_STATUS_DB）
主要欄位：`IV Name`(title)、`班機號`、`AWB／船次號`、`日本出發日`、`抵台日`、`預計出關日`、`實際出關日`、`入倉日`、`入倉箱數`、`商品摘要`、`配送狀態`、`檢疫結果`、`燻蒸狀態`、`輻射檢驗`、`農藥檢驗`、`備註`、`供應商`、`倉庫`

### 出貨紀錄（SHIPMENT_RECORDS_DB）
欄位：`出貨單號`(title)、`關聯批次`(relation)、`出貨門市`(select)、`出貨日期`(date)、`出貨箱數`(number)、`出貨輪次`(number)、`計畫狀態`(select)、`備註`

### 修改紀錄（CHANGE_LOG_DB）
欄位：`動作`(title)、`對象`(rich_text)、`詳細內容`(rich_text)、`時間`(created_time)、`IP`(rich_text)

---

## 目錄結構

```
app/
  page.tsx                  # 主頁：批次列表 + 月曆 + 門市列表（兩個 tab）
  layout.tsx
  api/
    auth/route.ts           # POST 驗證編輯密碼
    log/route.ts            # POST 寫入 Notion 修改紀錄
    notify/route.ts         # POST 寄 Gmail 通知（新增批次時）
    records/route.ts        # GET/POST 出貨紀錄
    records/[id]/route.ts   # DELETE 出貨紀錄
    shipments/route.ts      # GET 所有批次 / POST 新增批次
    upload/route.ts         # POST 上傳檔案到 Google Drive

components/
  Header.tsx                # 頁首（無自動更新橫幅）
  ShipmentCard.tsx          # 批次卡片（含 DeliveryPlan）
  TimelineProgress.tsx      # 進度條（含輻射/農藥/煙燻文字）
  DeliveryPlan.tsx          # 出貨計畫（可折疊、密碼保護、XLS 比對更新）
  CalendarView.tsx          # 月曆檢視（以抵台日為主，點選顯示通關狀態）
  StoreList.tsx             # 門市列表（點選側欄顯示未來出貨，含即將開幕店）
  AddBatchForm.tsx          # 新增批次 Modal（密碼保護）
  PasswordModal.tsx         # 密碼驗證 Modal（含 isAuthed / logChange helper）
  DocumentStatus.tsx        # 文件狀態（IV/PL/AWB/檢疫證明勾選）
  InventoryBar.tsx          # 箱數進度條
  LanguageToggle.tsx        # 中文/日文切換

lib/
  notion.ts                 # Notion API（getShipments, getShipmentRecords, createShipment...）
  stores.ts                 # 門市列表靜態資料（open / coming_soon）
  i18n.ts                   # 中日文翻譯字串
  parseDeliveryExcel.ts     # Excel 出貨計畫解析（ParsedDeliveryRound[]）
  parseSchedule.ts          # 文字排程解析（未使用於主流程）
```

---

## 門市清單（lib/stores.ts）

**營業中（open）11 間**：LaLaport台中、桃園春日、新北中和環球、新莊宏匯、高雄漢神巨蛋、南港LaLaport、IKEA台中南屯、高雄夢時代、台南小北門、台南三井Outlet（= MOP）、台中漢神中港

**即將開幕（coming_soon）3 間**：台北大巨蛋（2026-05）、台南SOGO新天（2026-06）、高雄漢神百貨（2026-09）

> **重要**：MOP / MOP店 = 台南三井 Outlet 店（同一間門市），出貨單上的「MOP」需統一為「台南三井 Outlet 店」
> 新增門市：在 `lib/stores.ts` 的 `STORES` 陣列加入一筆，status 用 `'open'` 或 `'coming_soon'`

---

## 主要功能說明

### 批次列表（進口批次 tab）
- 排序：以抵台日升冪（最早到的排最前）
- 搜尋：批次名稱、航班號、AWB
- 列表 / 月曆 切換
- 月曆以**抵台日**為主，點選批次顯示詳細資料（含通關狀態）

### 新增批次（AddBatchForm）
- 需要密碼驗證
- 欄位：批次名稱（必填）、班機號、AWB、日本出發日、抵台日、入倉箱數、商品摘要、備註、通關文件上傳
- 存 Notion → 上傳 Drive → 寄 Gmail 通知 → 寫 LOG

### 出貨計畫（DeliveryPlan）
- **預設收起**，點 ▶ 展開
- 新增/編輯/刪除輪次均需密碼
- 支援 Excel 帶入（parseDeliveryExcel）
- **上傳修改出貨時程表**：比對新舊 Excel（以輪次編號配對），顯示差異（綠=新增/紅=移除/黃=數量變更），逐輪選擇保留原日期或重新輸入，只更新有差異的輪次

### 密碼系統（PasswordModal）
- `isAuthed()` 檢查 `sessionStorage.lopia_authed === '1'`
- `markAuthed()` 設定 session（關閉分頁後重置）
- `logChange(action, target, detail)` 寫入 Notion 修改紀錄
- 密碼由 `EDIT_PASSWORD` env var 控制（預設 `lopia2026`）

### 門市側欄（StoreList）
- 點選任何門市（含即將開幕）→ 右側抽屜顯示未來出貨計畫
- 「未來」= 出貨日期 >= 今天 且 計畫狀態 != '已取消'
- 即將開幕門市：黃色系設計，若已有出貨計畫顯示數量徽章

---

## 對帳系統（獨立 HTML）

**路徑**：`C:\Users\lin76\OneDrive\Desktop\CLAUDE COWORK\CLAUDE OUTPUTS\lopia-reconciliation-dashboard.html`
**功能**：月結請款管理，從 lopia-status.vercel.app 同步 Notion 出貨紀錄，產生各門市金額佔比與請款單。

### 重要修正記錄（2026-04-13）

**問題 1：商品動態系統（DeliveryPlan）箱數翻倍**
- 原因：`lib/parseDeliveryExcel.ts` 的 `EXCEL_STORE_MAP` 只做完全比對，Excel 分頁名（如「台中LaLaport」）比對失敗會以原始名存入，同一家店出現兩筆導致箱數翻倍。
- 修正：改為「完全比對 → 子字串 fallback（最長 key 優先）→ 原始名」三階段查找。

**問題 2：對帳系統門市佔比重複出現**
- 原因：`syncFromNotion()` 裡 `store: rec.store` 未過 `resolveStore()`，Notion 存的 variant 店名直接進圖表，同店多條。
- 修正：Notion 同步的三個 `allData.push` 都改成 `store: resolveStore(rec.store)`；`renderStoreShare()` 與 `renderStoreAnalysis()` 的 groupBy 也加上 `resolveStore()`。

### 完整 STORE_MAP 對應表（兩個系統共用邏輯，2026-04-13 確認）

> 排列順序重要：長/精確 key 必須在短/模糊 key 之前，防止子字串誤判。

| Excel 分頁 / 縮寫 | 標準門市名稱 | 備註 |
|---|---|---|
| 台南大遠百 | 台南大遠百 | 非 LOPIA 門市，原名保留 |
| 台中漢神 | 台中漢神中港店 | S0805/S1001/S1003/S1004 |
| 漢神台中 | 台中漢神中港店 | S0404/S0802 |
| 漢神(台中) | 台中漢神中港店 | S0803 |
| 高雄巨蛋 | 高雄漢神巨蛋店 | |
| 台北巨蛋、大巨蛋 | 台北大巨蛋店 | |
| 夢時代 | 高雄夢時代店 | |
| 小北門 | 台南小北門店 | |
| 台中、lalaport | LaLaport 台中店 | |
| 桃園、春日 | 桃園春日店 | |
| 中和、環球 | 新北中和環球店 | |
| 新莊、新荘、宏匯 | 新莊宏匯店 | |
| 巨蛋、高雄 | 高雄漢神巨蛋店 | |
| 南港 | 南港 LaLaport 店 | |
| IKEA、南屯 | IKEA 台中南屯店 | |
| 夢時 | 高雄夢時代店 | |
| 北門、台南 | 台南小北門店 | 台南 = 小北門（S1101 確認）|
| MOP、mop、MO、mo、三井 | 台南三井 Outlet 店 | MO = MOP 縮寫（S0401等確認）|
| 漢神、中漢、中港 | 台中漢神中港店 | |
| 北蛋 | 台北大巨蛋店 | |

### 最後同步結果（2026-04-13）
- 總記錄：119 筆，四月份 35 筆，13 家門市，**無重複**。
- 批次單價尚未設定（金額佔比顯示 0%），需在對帳系統手動設定：
  - `CITY20260401`（苺）
  - `CITY20260401F`（冷凍芋加工品）
  - `TW00-01381`（リンゴ10）

### 四月份出貨 Excel 注入結果（2026-04-13）
- 來源：15 張出貨單（S2026040401–S2026041104）
- 注入：**71 筆手動記錄**（source: 'manual'）+ 119 Notion = **190 筆總記錄**
- 四月份業績：**$2,804,450 NTD**（13 家門市，含 0 元贊助）

| 門市 | 箱數 | 營業額 |
|---|---|---|
| 台中漢神中港店 | 983 | $1,038,414 |
| 高雄漢神巨蛋店 | 274 | $378,258 |
| 南港 LaLaport 店 | 178 | $351,806 |
| 台南三井 Outlet 店 | 230 | $286,200 |
| 高雄夢時代店 | 97 | $153,788 |
| 新莊宏匯店 | 97 | $123,938 |
| IKEA 台中南屯店 | 126 | $108,069 |
| LaLaport 台中店 | 89 | $103,717 |
| 新北中和環球店 | 60 | $103,264 |
| 台南小北門店 | 77 | $92,850 |
| 桃園春日店 | 64 | $64,146 |
| 台南大遠百 | 116 | $0（贊助，不請款） |
| 台北大巨蛋店 | 166 | $0（Notion 計畫中，無 Excel 出貨單） |

> ⚠️ 注意：S2026040403（蘋果9.3）、S2026040803（蘋果9.4）檔名含 U+3000 全形空格，
> 讀取時需用 `\u3000` 明確指定，不可重新命名檔案。

---

## 常見修改位置

| 需求 | 修改位置 |
|---|---|
| 新增/修改門市 | `lib/stores.ts` |
| 新增批次欄位 | `lib/notion.ts` + `app/api/shipments/route.ts` + `components/AddBatchForm.tsx` |
| 進度條里程碑 | `components/TimelineProgress.tsx` |
| 月曆邏輯 | `components/CalendarView.tsx` |
| 通知信件格式 | `app/api/notify/route.ts` |
| 翻譯字串 | `lib/i18n.ts` |
| 顏色主題 | `tailwind.config.ts` |
| Excel 分頁→門市對應 | `lib/parseDeliveryExcel.ts`（EXCEL_STORE_MAP） |
| 對帳系統門市正規化 | `lopia-reconciliation-dashboard.html`（STORE_MAP + resolveStore()） |

---

## Git 工作流程
```bash
# 修改後
git add [file]
git commit -m "feat/fix: 說明"
git push origin main   # Vercel 自動部署（約 50 秒）

# 確認部署狀態
npx vercel ls
```

## Vercel env var 設定
```bash
# 正確方式（不會有 trailing newline）
printf "your_value" | npx vercel env add VAR_NAME production

# 更新 env var 需先刪除再新增
npx vercel env rm VAR_NAME production
printf "new_value" | npx vercel env add VAR_NAME production
```
