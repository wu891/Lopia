/**
 * Drive 自動扣帳 — Google Apps Script 鬧鐘
 * ─────────────────────────────────────────────
 * 用途：每 10 分鐘呼叫一次 lopia-status 的掃描端點。
 * 真正的掃描、解析、扣帳都在網站端做，這支只是鬧鐘。
 *
 * 安裝方式（跟請款 webhook 一樣）：
 *   1. 開 https://script.google.com → 新專案 → 貼上這整份
 *   2. 把下面 TOKEN 換成 Colin 拿到的 DRIVE_SCAN_TOKEN 值
 *   3. 左邊「觸發條件」→ 新增觸發條件：
 *      函式選 tick、事件來源選「時間驅動」、類型「分鐘計時器」、間隔「每 10 分鐘」
 *   4. 第一次會要求授權（存取外部服務）→ 允許
 */

var ENDPOINT = 'https://lopia-status.vercel.app/api/drive-scan'
var TOKEN = '請把這裡換成DRIVE_SCAN_TOKEN'   // ← 換成真正的 token

function tick() {
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + TOKEN },
    muteHttpExceptions: true,   // 端點出錯時不要讓 GAS 炸掉，只記 log
  })
  var code = res.getResponseCode()
  if (code !== 200) {
    console.error('drive-scan 回應 ' + code + '：' + res.getContentText().slice(0, 500))
  } else {
    console.log('drive-scan OK：' + res.getContentText().slice(0, 300))
  }
}
