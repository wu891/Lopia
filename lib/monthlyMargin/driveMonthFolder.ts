/**
 * lib/monthlyMargin/driveMonthFolder.ts
 *
 * 泛化版「N月」子資料夾讀取，供月結毛利頁的月份切換用。
 * 跟 lib/driveScan/drive.ts 同一套服務帳號唯讀連線（重用 getReadonlyDrive / downloadAsXlsx），
 * 差別是可以指定「任意」年月的資料夾，不像 driveScan 只認當月／上月。
 *
 * 前提：Colin 要把對應資料夾分享給服務帳號的 email（檢視者即可），不分享會 404/403。
 */
import { getReadonlyDrive, downloadAsXlsx, type DriveFileInfo } from '../driveScan/drive'

export type { DriveFileInfo }
export { downloadAsXlsx }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

/**
 * 列出 rootFolderId 底下「N月」子資料夾（N=month，1-12）裡的所有試算表檔案。
 * 找不到該月子資料夾就回傳空陣列（呼叫端可據此判斷「這個月的資料還沒放進去」）。
 */
export async function listMonthFolderFiles(rootFolderId: string, month: number): Promise<DriveFileInfo[]> {
  const drive = getReadonlyDrive()
  const folderName = `${month}月`

  const folderRes = await drive.files.list({
    q: `'${rootFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id, name, createdTime)',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  const folders = folderRes.data.files ?? []
  // 同名資料夾取最近建立的那個（跟 driveScan/drive.ts 同一套規則）
  const target = folders
    .filter(f => (f.name ?? '').trim() === folderName)
    .sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? ''))[0]
  if (!target?.id) return []

  const out: DriveFileInfo[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: `'${target.id}' in parents and trashed = false and (mimeType = '${XLSX_MIME}' or mimeType = '${GSHEET_MIME}')`,
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
        parentFolderName: folderName,
      })
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  out.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime))
  return out
}
