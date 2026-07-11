// Fix non-standard store names in SHIPMENT_RECORDS_DB
// Usage: node scripts/fix-store-names.mjs
import { Client } from '@notionhq/client'
import { readFileSync } from 'fs'

// Load .env.local
const env = readFileSync('.env.local', 'utf8')
for (const line of env.split('\n')) {
  const [k, ...v] = line.split('=')
  if (k && v.length) process.env[k.trim()] = v.join('=').trim()
}

const notion = new Client({ auth: process.env.NOTION_API_KEY })
const DB_ID = process.env.NOTION_SHIPMENT_RECORDS_DB

// Store name corrections: old → new
const CORRECTIONS = {
  '北蛋': '台北大巨蛋店',
}

async function main() {
  console.log('Querying SHIPMENT_RECORDS_DB...')
  let cursor
  const toFix = []

  do {
    const res = await notion.databases.query({
      database_id: DB_ID,
      start_cursor: cursor,
      page_size: 100,
    })

    for (const page of res.results) {
      const store = page.properties['出貨門市']?.select?.name
      if (store && CORRECTIONS[store]) {
        toFix.push({ id: page.id, oldStore: store, newStore: CORRECTIONS[store],
          title: page.properties['出貨單號']?.title?.[0]?.plain_text ?? page.id })
      }
    }

    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  console.log(`Found ${toFix.length} records to fix:`)
  for (const r of toFix) {
    console.log(`  ${r.title}: ${r.oldStore} → ${r.newStore}`)
  }

  if (toFix.length === 0) {
    console.log('Nothing to fix.')
    return
  }

  console.log('\nUpdating...')
  for (const r of toFix) {
    await notion.pages.update({
      page_id: r.id,
      properties: {
        '出貨門市': { select: { name: r.newStore } },
      },
    })
    console.log(`  ✓ ${r.title}`)
  }
  console.log('\nDone!')
}

main().catch(console.error)
