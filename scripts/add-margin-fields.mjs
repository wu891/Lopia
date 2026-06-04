// 一次性：在 進口狀態/批次 DB (IMPORT_STATUS_DB) 新增毛利系統所需的 5 個欄位。
// 冪等：已存在的欄位會略過。用法：node scripts/add-margin-fields.mjs
import { readFileSync } from 'node:fs'
import { Client } from '@notionhq/client'

// 讀 .env.local（只取需要的兩個 key）
const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=')
  if (i > 0 && !line.startsWith('#')) {
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    env[line.slice(0, i).trim()] = v
  }
}

const notion = new Client({ auth: env.NOTION_API_KEY })
const DB = env.NOTION_IMPORT_STATUS_DB
if (!env.NOTION_API_KEY || !DB) { console.error('缺 NOTION_API_KEY 或 NOTION_IMPORT_STATUS_DB'); process.exit(1) }

const desired = {
  '進貨成本': { number: { format: 'number' } },
  '運費':     { number: { format: 'number' } },
  '倉儲費':   { number: { format: 'number' } },
  '成本幣別': { select: { options: [{ name: 'TWD', color: 'blue' }, { name: 'JPY', color: 'red' }] } },
  '課稅別':   { select: { options: [{ name: '免稅', color: 'green' }, { name: '5%', color: 'orange' }] } },
}

const db = await notion.databases.retrieve({ database_id: DB })
console.log('資料庫：', db.title?.map(t => t.plain_text).join('') || DB)

const existing = db.properties
const toAdd = {}
for (const [name, schema] of Object.entries(desired)) {
  if (existing[name]) console.log(`  ⏭  已存在，跳過：${name}（${existing[name].type}）`)
  else { toAdd[name] = schema; console.log(`  ＋ 將新增：${name}`) }
}

if (Object.keys(toAdd).length === 0) {
  console.log('全部欄位已存在，無需變更。')
} else {
  await notion.databases.update({ database_id: DB, properties: toAdd })
  console.log(`✅ 已新增 ${Object.keys(toAdd).length} 個欄位：`, Object.keys(toAdd).join('、'))
}
