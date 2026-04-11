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

**營業中（open）11 間**：LaLaport台中、桃園春日、新北中和環球、新莊宏匯、高雄漢神巨蛋、南港LaLaport、IKEA台中南屯、高雄夢時代、台南小北門、台南三井Outlet、台中漢神中港

**即將開幕（coming_soon）3 間**：台北大巨蛋（2026-05）、台南SOGO新天（2026-06）、高雄漢神百貨（2026-09）

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
