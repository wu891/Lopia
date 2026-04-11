#!/usr/bin/env node
/**
 * check-i18n.mjs
 * PostToolUse hook — checks that every key in the zh section of lib/i18n.ts
 * also exists in the ja section.  If any are missing it prints a warning and
 * exits with code 1 so Claude Code surfaces the message in the conversation.
 *
 * Only runs when the edited file is lib/i18n.ts.
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Read the hook payload from stdin
let payload = {}
try {
  const raw = readFileSync('/dev/stdin', 'utf8')
  payload = JSON.parse(raw)
} catch { /* no stdin or not JSON — continue */ }

// Only care about edits to i18n.ts
const filePath = payload?.tool_input?.file_path ?? ''
if (!filePath.includes('i18n.ts')) process.exit(0)

// Read the actual file
const __dirname = dirname(fileURLToPath(import.meta.url))
const i18nPath = join(__dirname, '..', 'lib', 'i18n.ts')
let src
try {
  src = readFileSync(i18nPath, 'utf8')
} catch {
  process.exit(0)
}

// ── Extract keys from a section body string ──────────────────
function extractKeys(body) {
  const keys = []
  // Match lines like:   keyName: 'value', or   keyName: "value",
  for (const line of body.split('\n')) {
    const m = line.match(/^\s+(\w+)\s*:/)
    if (m) keys.push(m[1])
  }
  return keys
}

// ── Parse zh and ja bodies ────────────────────────────────────
// The file structure is:  export const t = { zh: { ... }, ja: { ... } }
const zhBodyMatch = src.match(/\bzh\s*:\s*\{([\s\S]*?)\n  \},/)
const jaBodyMatch = src.match(/\bja\s*:\s*\{([\s\S]*?)\n  \}/)

if (!zhBodyMatch || !jaBodyMatch) {
  console.error('⚠️  i18n check: could not parse zh/ja sections')
  process.exit(0)
}

const zhKeys = extractKeys(zhBodyMatch[1])
const jaKeys = new Set(extractKeys(jaBodyMatch[1]))

const missing = zhKeys.filter(k => !jaKeys.has(k))
const extra   = [...jaKeys].filter(k => !zhKeys.includes(k))

if (missing.length === 0 && extra.length === 0) {
  console.log('✅ i18n: zh and ja sections are in sync')
  process.exit(0)
}

if (missing.length > 0) {
  console.error(`\n⚠️  i18n: ${missing.length} key(s) in zh but MISSING from ja:\n  ${missing.join(', ')}\n`)
  console.error('Please add the missing Japanese translations before finishing.\n')
}
if (extra.length > 0) {
  console.warn(`ℹ️  i18n: ${extra.length} key(s) in ja but not in zh (stale?):\n  ${extra.join(', ')}\n`)
}

process.exit(missing.length > 0 ? 1 : 0)
