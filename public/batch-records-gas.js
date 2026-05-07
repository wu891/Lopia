/**
 * LOPIA 批號試算紀錄 - Google Apps Script
 *
 * 部署步驟：
 * 1. 開啟 Google Sheets（新建或現有皆可）
 * 2. 點選「擴充功能」→「Apps Script」
 * 3. 貼上此檔案全部內容，存檔
 * 4. 點「部署」→「新增部署作業」
 *    - 類型：網頁應用程式
 *    - 執行身分：我
 *    - 存取權限：所有人
 * 5. 複製部署後的「網頁應用程式網址」
 * 6. 貼到 price-calculator.html 裡的 GAS_URL 變數
 */

const SHEET_NAME = 'BatchRecords';

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['batchId', 'savedAt', 'data']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doGet(e) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  const records = [];
  if (lastRow > 1) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    rows.forEach(function(row) {
      if (row[0]) {
        try { records.push(JSON.parse(row[2])); } catch(err) {}
      }
    });
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, records: records }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const sheet = getSheet();

  if (body.action === 'save') {
    const rec = body.record;
    sheet.appendRow([rec.batchId, rec.savedAt, JSON.stringify(rec)]);
    return ok();
  }

  if (body.action === 'delete') {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === body.batchId && rows[i][1] === body.savedAt) {
          sheet.deleteRow(i + 2);
          break;
        }
      }
    }
    return ok();
  }

  if (body.action === 'clearAll') {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
    return ok();
  }

  if (body.action === 'migrate') {
    const recs = body.records || [];
    recs.forEach(function(rec) {
      sheet.appendRow([rec.batchId, rec.savedAt, JSON.stringify(rec)]);
    });
    return ok();
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
