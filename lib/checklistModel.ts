/**
 * 三重檢查體制 — 純邏輯模型（不碰 Notion，前後端都能 import）
 * ───────────────────────────────────────────────────────────────
 * 這裡只有「人員／層級定義」與「狀態怎麼算、能不能勾、勾/退回怎麼變」的純函式，
 * 沒有任何 Notion / 網路呼叫，所以：
 *   - 伺服器端 lib/checklist.ts 會 import 它來做讀寫
 *   - 前端頁面也能直接 import（不會把 Notion SDK 打包進瀏覽器）
 */

export type PersonId = 'kido' | 'colin' | 'hayashi' | 'cai' | 'kawagoe'

export interface Person { id: PersonId; name: string }

export const PEOPLE: Person[] = [
  { id: 'kido',    name: 'KIDO' },
  { id: 'colin',   name: 'COLIN' },
  { id: 'hayashi', name: '林さん' },
  { id: 'cai',     name: '蔡さん' },
  { id: 'kawagoe', name: '川越さん' },
]

export function personName(id: PersonId | string): string {
  return PEOPLE.find(p => p.id === id)?.name ?? String(id)
}

// 蔡さん可代理任何一層（請假／不在時不會卡死）；代理時會記錄「代○○確認」
export const PROXY_PERSON: PersonId = 'cai'

// 本週出貨計畫：只有川越さん（資料來源本人）與 COLIN（備援）可以新增/編輯/刪除；其他人唯讀
export const WEEKLY_EDITORS: PersonId[] = ['kawagoe', 'colin']
export function canEditWeekly(who: PersonId | null | undefined): boolean {
  return !!who && WEEKLY_EDITORS.includes(who)
}

export interface SubItem {
  key: string                     // 穩定不變的識別碼（存進 JSON 的 key）
  label: string                   // 顯示文字（互查項用短標籤，靠區塊標題交代「誰查誰」）
  role: PersonId | PersonId[]     // 誰有權勾這一項（第一重互查要指定不同人；不能勾自己做的）
  checker?: PersonId              // 互查專用：這一項是「誰」在檢查（給畫面分區塊、上色）
  target?: PersonId               // 互查專用：檢查的是「誰」做的文件（給區塊標題顯示）
  note?: string                   // 補充備註（顯示在項目文字下方的小字，純顯示用）
}

export interface Layer {
  id: number
  title: string
  who: string                     // 這一層負責人（顯示用）
  items: SubItem[]
}

export const LAYERS: Layer[] = [
  {
    id: 1,
    title: '第一重：製作・互查',
    who: 'KIDO ＆ COLIN',
    items: [
      // KIDO 檢查 COLIN 做的文件（區塊 A）；短標籤 + checker/target 讓畫面分區塊上色
      { key: 'kido_colin_store', label: '店鋪正確',   role: 'kido',  checker: 'kido',  target: 'colin' },
      { key: 'kido_colin_item',  label: '品項正確',   role: 'kido',  checker: 'kido',  target: 'colin' },
      { key: 'kido_colin_qty',   label: '數量正確',   role: 'kido',  checker: 'kido',  target: 'colin' },
      { key: 'kido_colin_date',  label: '配送日正確', role: 'kido',  checker: 'kido',  target: 'colin' },
      // COLIN 檢查 KIDO 做的文件（區塊 B）
      { key: 'colin_kido_store', label: '店鋪正確',   role: 'colin', checker: 'colin', target: 'kido' },
      { key: 'colin_kido_item',  label: '品項正確',   role: 'colin', checker: 'colin', target: 'kido' },
      { key: 'colin_kido_qty',   label: '數量正確',   role: 'colin', checker: 'colin', target: 'kido' },
      { key: 'colin_kido_date',  label: '配送日正確', role: 'colin', checker: 'colin', target: 'kido' },
      // 兩人都查完後，共同送出（不屬於任一區塊，整寬顯示）
      { key: 'l1_reported',      label: '已送出出貨總表(優儲)、店鋪貨單納品書(三義)或美福出庫單。並告知林さん檢查', role: ['kido', 'colin'] },
    ],
  },
  {
    id: 2,
    title: '第二重：送達確認',
    who: '林さん',
    items: [
      { key: 'l2_warehouse', label: '出貨指示已確實送達倉庫（優儲、美福或三義）', role: 'hayashi', note: '如商品庫存於美福倉儲時，須向三義送達出貨指示' },
      { key: 'l2_logistics', label: '出貨指示已確實送達物流公司（三義）', role: 'hayashi' },
      { key: 'l2_reported',  label: '已報告蔡さん並請他確認', role: 'hayashi' },
    ],
  },
  {
    id: 3,
    title: '第三重：總合確認',
    who: '蔡さん',
    items: [
      { key: 'l3_step1',    label: '步驟 1 文件正確（互查已完成）', role: 'cai' },
      { key: 'l3_step2',    label: '步驟 2 指示已送達（倉庫＋物流）', role: 'cai' },
      { key: 'l3_reported', label: '已報告川越さん', role: 'cai' },
    ],
  },
  {
    id: 4,
    title: '第四重：對外共享',
    who: '川越さん',
    items: [
      { key: 'l4_shared', label: '已把資訊共享給平山さん（此單完結）', role: 'kawagoe' },
      { key: 'l4_reminder', label: '出貨前一日提醒倉庫(美福OR優儲)和物流商確認配送時程', role: 'kawagoe' },
    ],
  },
]

export const LAST_LAYER_ID = LAYERS[LAYERS.length - 1].id

// 倉儲選項：新增檢查單時要選這批貨放在哪個倉儲（優儲／美福／三義）
export const WAREHOUSES = ['優儲', '美福', '三義'] as const
export type Warehouse = typeof WAREHOUSES[number]

// ── 狀態結構 ──────────────────────────────────────────────────────────────

export interface CheckMark {
  checked: boolean
  by?: PersonId       // 誰勾的
  at?: string         // 勾的時間（ISO）
  proxyFor?: PersonId // 若為代理，記錄代誰確認（蔡さん代理時）
}

export interface Rejection {
  at: string
  by: PersonId
  toLayer: number     // 退回到第幾層（該層以上的勾會被清掉）
  reason: string
}

export interface ChecklistState {
  version: 1
  checks: Record<string, CheckMark>
  rejections: Rejection[]
  completedAt?: string
  content?: string    // 這批要出什麼（品項／店鋪），建立時帶入，純顯示用，不影響勾選邏輯
  warehouse?: string  // 這批貨放哪個倉儲（優儲／美福／三義），純顯示用，不影響勾選邏輯
}

export function emptyState(): ChecklistState {
  return { version: 1, checks: {}, rejections: [] }
}

// 把 Notion 讀回來的字串安全轉成狀態（壞掉就當空的，不讓頁面爆掉）
export function parseState(raw: string | null | undefined): ChecklistState {
  if (!raw) return emptyState()
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return emptyState()
    return {
      version: 1,
      checks: obj.checks && typeof obj.checks === 'object' ? obj.checks : {},
      rejections: Array.isArray(obj.rejections) ? obj.rejections : [],
      completedAt: typeof obj.completedAt === 'string' ? obj.completedAt : undefined,
      content: typeof obj.content === 'string' ? obj.content : undefined,
      warehouse: typeof obj.warehouse === 'string' ? obj.warehouse : undefined,
    }
  } catch {
    return emptyState()
  }
}

// ── 階段、鎖定、權限 ──────────────────────────────────────────────────────

function layerById(id: number): Layer {
  const l = LAYERS.find(x => x.id === id)
  if (!l) throw new Error(`Unknown layer id: ${id}`)
  return l
}

/** 某一層是否全部小項目都勾了 */
export function isLayerComplete(state: ChecklistState, layerId: number): boolean {
  return layerById(layerId).items.every(it => state.checks[it.key]?.checked === true)
}

/** 某一層是否有任何小項目已勾 */
export function layerHasAnyCheck(state: ChecklistState, layerId: number): boolean {
  return layerById(layerId).items.some(it => state.checks[it.key]?.checked === true)
}

/** 目前進行到第幾層（1..4）。全部完成回傳 LAST_LAYER_ID + 1 代表「已完結」 */
export function currentLayerId(state: ChecklistState): number {
  for (const l of LAYERS) {
    if (!isLayerComplete(state, l.id)) return l.id
  }
  return LAST_LAYER_ID + 1
}

export function isCompleted(state: ChecklistState): boolean {
  return currentLayerId(state) > LAST_LAYER_ID
}

/** 這一層現在能不能動（前面每一層都完成才解鎖） */
export function isLayerUnlocked(state: ChecklistState, layerId: number): boolean {
  return LAYERS.every(l => l.id >= layerId || isLayerComplete(state, l.id))
}

/** 給前端顯示用的階段文字 */
export function stageLabel(state: ChecklistState): string {
  if (isCompleted(state)) return '已完結'
  const cur = currentLayerId(state)
  const map: Record<number, string> = { 1: '待互查', 2: '待林さん確認', 3: '待蔡さん確認', 4: '待川越さん共享' }
  return map[cur] ?? '進行中'
}

function roleMatches(role: PersonId | PersonId[], person: PersonId): boolean {
  return Array.isArray(role) ? role.includes(person) : role === person
}

function roleNames(role: PersonId | PersonId[]): string {
  const arr = Array.isArray(role) ? role : [role]
  return arr.map(personName).join(' / ')
}

export interface CanCheckResult {
  ok: boolean
  proxy: boolean       // 是否以代理身分（蔡さん代其他層）
  reason?: string      // 不行的原因（給前端顯示）
}

/**
 * 判斷某人現在能不能勾某個小項目。
 * 規則：①該層必須已解鎖 ②本人角色符合，或本人是代理者（蔡さん）
 */
export function canCheck(state: ChecklistState, itemKey: string, person: PersonId): CanCheckResult {
  const layer = LAYERS.find(l => l.items.some(it => it.key === itemKey))
  const item = layer?.items.find(it => it.key === itemKey)
  if (!layer || !item) return { ok: false, proxy: false, reason: '找不到這個檢查項目' }

  if (!isLayerUnlocked(state, layer.id)) {
    return { ok: false, proxy: false, reason: '上一層還沒完成，這層先鎖住' }
  }
  if (roleMatches(item.role, person)) return { ok: true, proxy: false }
  if (person === PROXY_PERSON) return { ok: true, proxy: true }

  return { ok: false, proxy: false, reason: `這項只有 ${roleNames(item.role)} 能勾` }
}

/**
 * 勾 / 取消勾一個小項目，回傳新的狀態（不改原物件）。
 * - checked=true：勾。若是代理，記 proxyFor＝該項原負責角色。
 * - checked=false：取消勾。只有在「更上層都還沒開始」時才允許（否則要用退回）。
 */
export function applyCheck(
  state: ChecklistState,
  itemKey: string,
  person: PersonId,
  checked: boolean,
  nowIso: string,
): ChecklistState {
  const can = canCheck(state, itemKey, person)
  if (!can.ok) throw new Error(can.reason ?? '無法勾選')

  const layer = LAYERS.find(l => l.items.some(it => it.key === itemKey))!
  const item = layer.items.find(it => it.key === itemKey)!

  if (!checked) {
    // 取消勾：更上層若已有進度就擋下（改用退回，避免破壞已鎖定的上層）
    const higherHasProgress = LAYERS.some(l => l.id > layer.id && layerHasAnyCheck(state, l.id))
    if (higherHasProgress) {
      throw new Error('上層已開始，不能直接取消勾；請用「退回」')
    }
  }

  const next: ChecklistState = { ...state, checks: { ...state.checks } }
  if (checked) {
    const primaryRole: PersonId = Array.isArray(item.role) ? item.role[0] : item.role
    next.checks[itemKey] = {
      checked: true,
      by: person,
      at: nowIso,
      ...(can.proxy ? { proxyFor: primaryRole } : {}),
    }
  } else {
    delete next.checks[itemKey]
  }

  // 剛好把第四層勾完 → 標記完結時間；被退回導致未完成 → 清掉
  if (isCompleted(next) && !next.completedAt) next.completedAt = nowIso
  if (!isCompleted(next)) next.completedAt = undefined

  return next
}

/**
 * 退回：把 toLayer（含）以上的所有勾清掉，記一筆退回原因。
 * 任何登入者都能退回（對應「任何一層發現問題就停下」）。
 */
export function applyReject(
  state: ChecklistState,
  toLayer: number,
  person: PersonId,
  reason: string,
  nowIso: string,
): ChecklistState {
  if (!reason.trim()) throw new Error('退回一定要寫原因')
  if (toLayer < 1 || toLayer > LAST_LAYER_ID) throw new Error('退回層級不正確')

  const next: ChecklistState = {
    ...state,
    checks: { ...state.checks },
    rejections: [...state.rejections, { at: nowIso, by: person, toLayer, reason: reason.trim() }],
    completedAt: undefined,
  }
  for (const l of LAYERS) {
    if (l.id >= toLayer) {
      for (const it of l.items) delete next.checks[it.key]
    }
  }
  return next
}
