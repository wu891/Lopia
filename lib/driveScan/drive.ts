/**
 * lib/driveScan/drive.ts
 *
 * Drive 自動扣帳 — 讀取 Google Drive 出貨單資料夾。
 * ───────────────────────────────────────────────────────────────
 * 做三件事：
 *   1. 建一個「唯讀」的 Drive 連線（跟上傳用的不同，範圍只有讀，比較安全）
 *   2. 列出出貨單資料夾裡「當月＋上月」子資料夾（如 7月、6月）的所有試算表檔案
 *   3. 把檔案抓下來變成 Excel 位元組（Google 試算表會先轉成 xlsx 再下載）
 *
 * 需要的 env：
 *   GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY … 既有的服務帳號（同上傳用）
 *   DRIVE_SHIPMENT_FOLDER_ID                 … 出貨單資料夾的 ID
 *
 * 前提：Colin 要把出貨單資料夾「分享」給服務帳號的 email（檢視者即可），
 *       不分享的話這裡所有呼叫都會 404/403。
 */

import { google } from 'googleapis'

export interface DriveFileInfo {
  id: string
  name: string
  mimeType: string
  modifiedTime: string   // ISO 字串，如 2026-07-08T04:20:30.937Z
  size: string | null    // Google 原生試算表沒有 size
  md5Checksum: string | null // 只有真 xlsx 檔有；拿來當內容指紋的一部分
  parentFolderName: string   // 所在子資料夾名稱（如「7月」），純顯示用
}

// 唯讀 Drive 連線（scope 是 drive.readonly，只能看不能改）
function getReadonlyDrive() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim()
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) throw new Error('缺 GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY')
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
  return google.drive({ version: 'v3', auth })
}

export function shipmentFolderId(): string {
  const id = process.env.DRIVE_SHIPMENT_FOLDER_ID?.trim()
  if (!id) throw new Error('缺 DRIVE_SHIPMENT_FOLDER_ID env var')
  return id
}

// 試算表類型：真 xlsx 或 Google 原生試算表，其他（資料夾、圖片…）都不碰
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

/**
 * 決定要掃哪幾個子資料夾：名稱是「N月」且 N 等於本月或上月。
 * 注意：資料夾名稱沒有年份（假設清單見 docs），同名時取「最近建立」的那個。
 */
function wantedMonthNames(now: Date): string[] {
  const cur = now.getMonth() + 1
  const prev = cur === 1 ? 12 : cur - 1
  return [`${cur}月`, `${prev}月`]
}

/**
 * 列出「當月＋上月子資料夾＋根目錄」裡的所有試算表檔案。
 * 回傳依 modifiedTime 舊→新排序（先處理舊的，訊息順序比較直覺）。
 */
export async function listShipmentFiles(now: Date = new Date()): Promise<DriveFileInfo[]> {
  const drive = getReadonlyDrive()
  const root = shipmentFolderId()

  // 1) 先列出根目錄底下的子資料夾
  const folderRes = await drive.files.list({
    q: `'${root}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id, name, createdTime)',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  const folders = folderRes.data.files ?? []

  // 挑出當月＋上月的資料夾；同名取最近建立的
  const wanted = wantedMonthNames(now)
  const targets: { id: string; name: string }[] = []
  for (const monthName of wanted) {
    const candidates = folders
      .filter(f => (f.name ?? '').trim() === monthName)
      .sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? ''))
    if (candidates[0]?.id) targets.push({ id: candidates[0].id, name: monthName })
  }
  // 根目錄本身也掃（怕檔案忘了放進月份資料夾）
  targets.push({ id: root, name: '(根目錄)' })

  // 2) 列出每個目標資料夾裡的試算表
  const out: DriveFileInfo[] = []
  for (const t of targets) {
    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: `'${t.id}' in parents and trashed = false and (mimeType = '${XLSX_MIME}' or mimeType = '${GSHEET_MIME}')`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, md5Checksum)',
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name) continue
        out.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType ?? '',
          modifiedTime: f.modifiedTime ?? '',
          size: f.size ?? null,
          md5Checksum: f.md5Checksum ?? null,
          parentFolderName: t.name,
        })
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
  }

  out.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime))
  return out
}

/**
 * 把檔案抓成 Excel 位元組。
 * - Google 原生試算表 → 用 export 轉成 xlsx（所有分頁都會在裡面）
 * - 真 xlsx → 直接下載
 */
export async function downloadAsXlsx(file: Pick<DriveFileInfo, 'id' | 'mimeType'>): Promise<Buffer> {
  const drive = getReadonlyDrive()
  if (file.mimeType === GSHEET_MIME) {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: XLSX_MIME },
      { responseType: 'arraybuffer' },
    )
    return Buffer.from(res.data as ArrayBuffer)
  }
  const res = await drive.files.get(
    { fileId: file.id, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  )
  return Buffer.from(res.data as ArrayBuffer)
}
