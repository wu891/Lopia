# LOPIA 網站部署指南（5步驟）

## 步驟 1：安裝 Node.js

前往 https://nodejs.org → 下載 LTS 版本 → 安裝（一路 Next）

確認安裝成功：打開「命令提示字元」輸入：
```
node -v
```
顯示版本號代表成功。

---

## 步驟 2：安裝套件

在「命令提示字元」中，進入此資料夾：
```
cd "C:\Users\lin76\OneDrive\Desktop\CLAUDE COWORK\CLAUDE OUTPUTS\lopia-status"
npm install
```
等候安裝完成（約1~2分鐘）。

---

## 步驟 3：設定 Notion API 金鑰

### 取得 API 金鑰：
1. 前往 https://www.notion.so/my-integrations
2. 點「+ 新增整合」→ 名稱輸入「LOPIA Status」→ 建立
3. 複製顯示的 **Secret** 金鑰（格式：`secret_xxx...`）

### 授權資料庫存取：
1. 在 Notion 打開「LOPIA 進口貨況追蹤」頁面
2. 右上角「...」→「連線」→ 選擇「LOPIA Status」整合
3. 同樣對「出貨記錄」資料庫做一次

### 建立設定檔：
複製 `.env.example` → 改名為 `.env.local`，填入：
```
NOTION_API_KEY=secret_你的金鑰
NOTION_IMPORT_STATUS_DB=33ceed19d68e801dbb80c9edb2aff863
NOTION_SHIPMENT_RECORDS_DB=b7dc4a371792436c8b1c9c41a6660248
```

---

## 步驟 4：本機測試

```
npm run dev
```
打開瀏覽器前往 http://localhost:3000
確認資料正常顯示後，繼續下一步。

---

## 步驟 5：部署到 Vercel（上線）

### 一次性設定：
```
npm install -g vercel
vercel login
```
選擇「Continue with GitHub」或「Email」登入。

### 部署：
```
vercel --prod
```

過程中會詢問幾個問題，全部按 **Enter** 使用預設值即可。

完成後你會得到一個網址，例如：
```
https://lopia-status.vercel.app
```

### 設定環境變數（重要！）：
1. 前往 https://vercel.com → 找到你的專案
2. Settings → Environment Variables
3. 新增以下3個變數（同 `.env.local` 的內容）：
   - `NOTION_API_KEY`
   - `NOTION_IMPORT_STATUS_DB`
   - `NOTION_SHIPMENT_RECORDS_DB`
4. Settings → Integrations → 搜尋「Blob」→ 安裝 Vercel Blob（免費，用於檔案上傳）
5. 回到 Deployments → 重新部署一次

---

## 完成！

你的網站已上線。把連結分享給：
- 日本廠商（平山先生等）
- 出口商 / 進口商
- 倉庫人員
- 通關公司

網站每小時自動從 Notion 同步最新資料，無需手動更新。

---

## 日後更新資料

所有資料都在 Notion 管理：
- **進口貨況** → 更新「Import Status」資料庫
- **出貨記錄** → 在「出貨記錄」資料庫新增，或透過網站的「排程匯入」功能
- **通關文件** → 網站「工具」頁面上傳

---

## 遇到問題？

1. 資料顯示空白 → 確認 Notion 整合有授權到資料庫
2. 上傳失敗 → 確認 Vercel Blob 已安裝
3. 其他問題 → 聯絡技術支援
