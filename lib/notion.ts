import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

const IMPORT_STATUS_DB = requireEnv('NOTION_IMPORT_STATUS_DB')
const SHIPMENT_RECORDS_DB = requireEnv('NOTION_SHIPMENT_RECORDS_DB')
const LOGISTICS_DB = requireEnv('NOTION_LOGISTICS_DB')
const FURIKOMI_DB = requireEnv('NOTION_FURIKOMI_DB')

export interface Shipment {
  id: string
  url: string
  ivName: string
  supplier: string | null
  flightNo: string | null
  awbNo: string | null
  warehouse: string | null
  departJP: string | null
  arrivalTW: string | null
  estClearance: string | null
  actualClearance: string | null
  warehouseIn: string | null
  totalBoxes: number | null
  productSummary: string | null
  quarantine: string | null
  fumigation: string | null
  deliveryStatus: string | null
  remarks: string | null
  lastEdited: string
  // Documents
  ivDoc: boolean
  plDoc: boolean
  awbDoc: boolean
  quarantineCert: boolean
  // Inspection
  radiationTest: string | null
  pesticideTest: string | null
  // Transport
  transportMode: string | null   // 空運 | 海運
  fclLcl: string | null          // FCL | LCL
  // Supplier Excel
  supplierExcelId: string | null
  // Cost (毛利系統) — 批次成本
  importCost: number | null      // 進貨成本（未稅，原幣別）
  freightCost: number | null     // 運費
  storageCost: number | null     // 倉儲費
  costCurrency: string | null    // 成本幣別：TWD | JPY
  taxMode: string | null         // 課稅別：免稅 | 5%
  // Computed
  shippedBoxes?: number
  remainingBoxes?: number | null
  plannedBoxes?: number
}

export interface ShipmentRecord {
  id: string
  shipmentNo: string
  batchId: string | null
  store: string | null
  date: string | null
  boxes: number | null
  amount: number | null
  remarks: string | null
  round: number | null
  planStatus: string | null
  locked: boolean
}

// ── Property helpers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDate(prop: any): string | null {
  return prop?.type === 'date' ? prop.date?.start ?? null : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getText(prop: any): string | null {
  if (!prop) return null
  if (prop.type === 'rich_text') return prop.rich_text?.map((r: { plain_text: string }) => r.plain_text).join('') || null
  if (prop.type === 'title') return prop.title?.map((r: { plain_text: string }) => r.plain_text).join('') || null
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSelect(prop: any): string | null {
  return prop?.type === 'select' ? prop.select?.name ?? null : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNumber(prop: any): number | null {
  return prop?.type === 'number' ? prop.number : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCheckbox(prop: any): boolean {
  return prop?.type === 'checkbox' ? prop.checkbox : false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLastEdited(prop: any): string {
  return prop?.type === 'last_edited_time' ? prop.last_edited_time : ''
}

// ── Mappers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pageToShipment(page: any): Shipment {
  const p = page.properties
  return {
    id: page.id,
    url: page.url,
    ivName: getText(p['IV Name']) ?? '(無名稱)',
    supplier: getSelect(p['供應商']),
    flightNo: getText(p['班機號']),
    awbNo: getText(p['AWB／船次號']),
    warehouse: getSelect(p['倉庫']),
    departJP: getDate(p['日本出發日']),
    arrivalTW: getDate(p['抵台日']),
    estClearance: getDate(p['預計出關日']),
    actualClearance: getDate(p['實際出關日']),
    warehouseIn: getDate(p['入倉日']),
    totalBoxes: getNumber(p['入倉箱數']),
    productSummary: getText(p['商品摘要']),
    quarantine: getSelect(p['檢疫結果']),
    fumigation: getSelect(p['燻蒸狀態']),
    deliveryStatus: getSelect(p['配送狀態']),
    remarks: getText(p['備註']),
    lastEdited: getLastEdited(p['最後更新時間']),
    ivDoc: getCheckbox(p['IV ✓']),
    plDoc: getCheckbox(p['PL ✓']),
    awbDoc: getCheckbox(p['AWB ✓']),
    quarantineCert: getCheckbox(p['檢疫證明 ✓']),
    radiationTest: getSelect(p['輻射檢驗']),
    pesticideTest: getSelect(p['農藥檢驗']),
    transportMode: getSelect(p['運輸方式']),
    fclLcl: getSelect(p['FCL/LCL']),
    supplierExcelId: getText(p['供應商配送Excel']),
    importCost: getNumber(p['進貨成本']),
    freightCost: getNumber(p['運費']),
    storageCost: getNumber(p['倉儲費']),
    costCurrency: getSelect(p['成本幣別']),
    taxMode: getSelect(p['課稅別']),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pageToRecord(page: any): ShipmentRecord {
  const p = page.properties
  const relation = p['關聯批次']?.relation as Array<{ id: string }> | undefined
  return {
    id: page.id,
    shipmentNo: getText(p['出貨單號']) ?? '',
    batchId: relation?.[0]?.id ?? null,
    store: getSelect(p['出貨門市']),
    date: getDate(p['出貨日期']),
    boxes: getNumber(p['出貨箱數']),
    amount: getNumber(p['金額']),
    remarks: getText(p['備註']),
    round: getNumber(p['出貨輪次']),
    planStatus: getSelect(p['計畫狀態']),
    locked: getCheckbox(p['已鎖定']),
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getShipments(): Promise<Shipment[]> {
  const results: Shipment[] = []
  let cursor: string | undefined
  do {
    const response = await notion.databases.query({
      database_id: IMPORT_STATUS_DB,
      sorts: [{ property: '日本出發日', direction: 'descending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...response.results.map(pageToShipment))
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)
  return results
}

export async function getShipmentRecords(): Promise<ShipmentRecord[]> {
  const results: ShipmentRecord[] = []
  let cursor: string | undefined
  do {
    const response = await notion.databases.query({
      database_id: SHIPMENT_RECORDS_DB,
      sorts: [
        { property: '出貨輪次', direction: 'ascending' },
        { property: '出貨日期', direction: 'ascending' },
      ],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...response.results.map(pageToRecord))
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)
  return results
}

export async function getShipmentRecordById(id: string): Promise<ShipmentRecord> {
  const page = await notion.pages.retrieve({ page_id: id })
  return pageToRecord(page)
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createShipmentRecord(data: {
  shipmentNo: string
  batchId: string
  store: string
  date: string | null
  boxes: number
  amount?: number
  round?: number
  planStatus?: string
  remarks?: string
  locked?: boolean
}) {
  const page = await notion.pages.create({
    parent: { database_id: SHIPMENT_RECORDS_DB },
    properties: {
      '出貨單號': { title: [{ text: { content: data.shipmentNo } }] },
      '關聯批次': { relation: [{ id: data.batchId }] },
      '出貨門市': { select: { name: data.store } },
      ...(data.date ? { '出貨日期': { date: { start: data.date } } } : {}),
      '出貨箱數': { number: data.boxes },
      ...(data.amount != null ? { '金額': { number: data.amount } } : {}),
      ...(data.round != null ? { '出貨輪次': { number: data.round } } : {}),
      ...(data.planStatus ? { '計畫狀態': { select: { name: data.planStatus } } } : { '計畫狀態': { select: { name: '計畫中' } } }),
      ...(data.remarks ? { '備註': { rich_text: [{ text: { content: data.remarks } }] } } : {}),
      ...(data.locked != null ? { '已鎖定': { checkbox: data.locked } } : {}),
    },
  })
  return pageToRecord(page)
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateShipmentRecord(id: string, data: Partial<{
  store: string
  date: string
  boxes: number
  amount: number | null
  round: number
  planStatus: string
  remarks: string
  shipmentNo: string
  locked: boolean
}>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {}
  if (data.shipmentNo) props['出貨單號'] = { title: [{ text: { content: data.shipmentNo } }] }
  if (data.store) props['出貨門市'] = { select: { name: data.store } }
  if (data.date) props['出貨日期'] = { date: { start: data.date } }
  if (data.boxes != null) props['出貨箱數'] = { number: data.boxes }
  if (data.amount !== undefined) props['金額'] = { number: data.amount }
  if (data.round != null) props['出貨輪次'] = { number: data.round }
  if (data.planStatus) props['計畫狀態'] = { select: { name: data.planStatus } }
  if (data.remarks != null) props['備註'] = { rich_text: [{ text: { content: data.remarks } }] }
  if (data.locked != null) props['已鎖定'] = { checkbox: data.locked }

  const page = await notion.pages.update({ page_id: id, properties: props })
  return pageToRecord(page)
}

// ── Logistics Events ──────────────────────────────────────────────────────────

export type LogisticsEventType = '通關放貨' | '配送'
export type DeliveryStatus = '待配送' | '配送中' | '已送達'

export interface LogisticsEvent {
  id: string
  eventNo: string
  eventType: LogisticsEventType | null
  batchId: string | null
  store: string | null
  round: number | null
  releaseDate: string | null
  pickupLocation: string | null
  estDelivery: string | null
  actualDelivery: string | null
  deliveryStatus: DeliveryStatus | null
  remarks: string | null
  createdAt: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pageToLogisticsEvent(page: any): LogisticsEvent {
  const p = page.properties
  const relation = p['關聯批次']?.relation as Array<{ id: string }> | undefined
  return {
    id: page.id,
    eventNo: getText(p['事件編號']) ?? '',
    eventType: (getSelect(p['事件類型']) as LogisticsEventType | null),
    batchId: relation?.[0]?.id ?? null,
    store: getSelect(p['關聯門市']),
    round: getNumber(p['出貨輪次']),
    releaseDate: getDate(p['放貨日期']),
    pickupLocation: getText(p['取貨地點']),
    estDelivery: getDate(p['預計送達']),
    actualDelivery: getDate(p['實際送達']),
    deliveryStatus: (getSelect(p['配送狀態']) as DeliveryStatus | null),
    remarks: getText(p['業者備註']),
    createdAt: p['建立時間']?.created_time ?? '',
  }
}

export async function getLogisticsEvents(): Promise<LogisticsEvent[]> {
  const results: LogisticsEvent[] = []
  let cursor: string | undefined
  do {
    const response = await notion.databases.query({
      database_id: LOGISTICS_DB,
      sorts: [{ property: '建立時間', direction: 'descending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...response.results.map(pageToLogisticsEvent))
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)
  return results
}

export async function createLogisticsEvent(data: {
  eventNo: string
  eventType: LogisticsEventType
  batchId: string
  store?: string
  round?: number
  releaseDate?: string
  pickupLocation?: string
  estDelivery?: string
  actualDelivery?: string
  deliveryStatus?: DeliveryStatus
  remarks?: string
}): Promise<LogisticsEvent> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {
    '事件編號': { title: [{ text: { content: data.eventNo } }] },
    '事件類型': { select: { name: data.eventType } },
    '關聯批次': { relation: [{ id: data.batchId }] },
  }
  if (data.store)          props['關聯門市']  = { select: { name: data.store } }
  if (data.round != null)  props['出貨輪次']  = { number: data.round }
  if (data.releaseDate)    props['放貨日期']  = { date: { start: data.releaseDate } }
  if (data.pickupLocation) props['取貨地點']  = { rich_text: [{ text: { content: data.pickupLocation } }] }
  if (data.estDelivery)    props['預計送達']  = { date: { start: data.estDelivery } }
  if (data.actualDelivery) props['實際送達']  = { date: { start: data.actualDelivery } }
  if (data.deliveryStatus) props['配送狀態']  = { select: { name: data.deliveryStatus } }
  if (data.remarks)        props['業者備註']  = { rich_text: [{ text: { content: data.remarks } }] }

  const page = await notion.pages.create({
    parent: { database_id: LOGISTICS_DB },
    properties: props,
  })
  return pageToLogisticsEvent(page)
}

export async function updateLogisticsEvent(id: string, data: Partial<{
  releaseDate: string
  pickupLocation: string
  estDelivery: string
  actualDelivery: string
  deliveryStatus: DeliveryStatus
  remarks: string
}>): Promise<LogisticsEvent> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {}
  if (data.releaseDate)    props['放貨日期'] = { date: { start: data.releaseDate } }
  if (data.pickupLocation) props['取貨地點'] = { rich_text: [{ text: { content: data.pickupLocation } }] }
  if (data.estDelivery)    props['預計送達'] = { date: { start: data.estDelivery } }
  if (data.actualDelivery) props['實際送達'] = { date: { start: data.actualDelivery } }
  if (data.deliveryStatus) props['配送狀態'] = { select: { name: data.deliveryStatus } }
  if (data.remarks != null) props['業者備註'] = { rich_text: [{ text: { content: data.remarks } }] }

  const page = await notion.pages.update({ page_id: id, properties: props })
  return pageToLogisticsEvent(page)
}

// ── Delete (archive) ──────────────────────────────────────────────────────────

export async function deleteShipmentRecord(id: string) {
  await notion.pages.update({ page_id: id, archived: true })
}

// ── Create Shipment (new batch) ───────────────────────────────────────────────

export async function createShipment(data: {
  ivName: string
  supplier?: string
  flightNo?: string
  awbNo?: string
  warehouse?: string
  departJP?: string
  arrivalTW?: string
  estClearance?: string
  totalBoxes?: number
  productSummary?: string
  remarks?: string
  transportMode?: string
  fclLcl?: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {
    'IV Name': { title: [{ text: { content: data.ivName } }] },
    '配送狀態': { select: { name: '未到' } },
  }
  if (data.supplier)       props['供應商']     = { select: { name: data.supplier } }
  if (data.flightNo)       props['班機號']     = { rich_text: [{ text: { content: data.flightNo } }] }
  if (data.awbNo)          props['AWB／船次號'] = { rich_text: [{ text: { content: data.awbNo } }] }
  if (data.warehouse)      props['倉庫']       = { select: { name: data.warehouse } }
  if (data.departJP)       props['日本出發日'] = { date: { start: data.departJP } }
  if (data.arrivalTW)      props['抵台日']     = { date: { start: data.arrivalTW } }
  if (data.estClearance)   props['預計出關日'] = { date: { start: data.estClearance } }
  if (data.totalBoxes != null) props['入倉箱數'] = { number: data.totalBoxes }
  if (data.productSummary)  props['商品摘要']  = { rich_text: [{ text: { content: data.productSummary } }] }
  if (data.remarks)         props['備註']      = { rich_text: [{ text: { content: data.remarks } }] }
  if (data.transportMode)   props['運輸方式']  = { select: { name: data.transportMode } }
  if (data.fclLcl)          props['FCL/LCL']  = { select: { name: data.fclLcl } }

  const page = await notion.pages.create({
    parent: { database_id: IMPORT_STATUS_DB },
    properties: props,
  })
  return pageToShipment(page)
}

// ── Update Shipment Fields ────────────────────────────────────────────────────

export async function updateBatchSupplierExcel(id: string, fileId: string) {
  await notion.pages.update({
    page_id: id,
    properties: {
      '供應商配送Excel': { rich_text: [{ text: { content: fileId } }] },
    },
  })
}

export async function getShipmentById(id: string): Promise<Shipment> {
  const page = await notion.pages.retrieve({ page_id: id })
  return pageToShipment(page)
}

export async function updateShipmentInspection(id: string, data: {
  fumigation?: string
  pesticideTest?: string
  radiationTest?: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {}
  if (data.fumigation)    props['燻蒸狀態'] = { select: { name: data.fumigation } }
  if (data.pesticideTest) props['農藥檢驗'] = { select: { name: data.pesticideTest } }
  if (data.radiationTest) props['輻射檢驗'] = { select: { name: data.radiationTest } }
  if (Object.keys(props).length === 0) return
  await notion.pages.update({ page_id: id, properties: props })
}

export async function updateShipmentDeliveryStatus(id: string, deliveryStatus: string) {
  await notion.pages.update({
    page_id: id,
    properties: { '配送狀態': { select: { name: deliveryStatus } } },
  })
}

export async function updateShipmentRemarks(id: string, remarks: string) {
  await notion.pages.update({
    page_id: id,
    properties: { '備註': { rich_text: [{ text: { content: remarks } }] } },
  })
}

// 毛利系統：寫入批次成本（進貨成本/運費/倉儲/幣別/課稅）
export async function updateShipmentCost(id: string, data: {
  importCost?: number | null
  freightCost?: number | null
  storageCost?: number | null
  costCurrency?: string | null
  taxMode?: string | null
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {}
  if (data.importCost   !== undefined) props['進貨成本'] = { number: data.importCost }
  if (data.freightCost  !== undefined) props['運費']     = { number: data.freightCost }
  if (data.storageCost  !== undefined) props['倉儲費']   = { number: data.storageCost }
  if (data.costCurrency !== undefined && data.costCurrency) props['成本幣別'] = { select: { name: data.costCurrency } }
  if (data.taxMode      !== undefined && data.taxMode)      props['課稅別']   = { select: { name: data.taxMode } }
  if (Object.keys(props).length === 0) return
  await notion.pages.update({ page_id: id, properties: props })
}

// ── Furikomi (振込明細) ────────────────────────────────────────────────────────

export interface FurikomiRecord {
  id: string
  name: string
  batchId: string | null
  targetMonth: string | null
  originalCost: number | null
  fumigationFee: number | null
  pesticideFee: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pageToFurikomi(page: any): FurikomiRecord {
  const p = page.properties
  return {
    id: page.id,
    name: getText(p['名称']) ?? '',
    batchId: getText(p['BatchID']),
    targetMonth: getSelect(p['対象月']),
    originalCost: getNumber(p['原価合計']),
    fumigationFee: getNumber(p['燻煙費']),
    pesticideFee: getNumber(p['農薬検査費']),
  }
}

export async function getFurikomiRecords(month?: string): Promise<FurikomiRecord[]> {
  const results: FurikomiRecord[] = []
  let cursor: string | undefined
  do {
    const response = await notion.databases.query({
      database_id: FURIKOMI_DB,
      ...(month ? { filter: { property: '対象月', select: { equals: month } } } : {}),
      sorts: [{ property: '名称', direction: 'ascending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...response.results.map(pageToFurikomi))
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)
  return results
}

export async function createFurikomiRecord(data: {
  name: string
  batchId: string
  targetMonth: string
  originalCost: number
  fumigationFee?: number
  pesticideFee?: number
}): Promise<FurikomiRecord> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {
    '名称': { title: [{ text: { content: data.name } }] },
    'BatchID': { rich_text: [{ text: { content: data.batchId } }] },
    '対象月': { select: { name: data.targetMonth } },
    '原価合計': { number: data.originalCost },
  }
  if (data.fumigationFee != null) props['燻煙費'] = { number: data.fumigationFee }
  if (data.pesticideFee != null) props['農薬検査費'] = { number: data.pesticideFee }

  const page = await notion.pages.create({
    parent: { database_id: FURIKOMI_DB },
    properties: props,
  })
  return pageToFurikomi(page)
}

export async function updateFurikomiRecord(id: string, data: Partial<{
  originalCost: number
  fumigationFee: number | null
  pesticideFee: number | null
}>): Promise<FurikomiRecord> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {}
  if (data.originalCost != null) props['原価合計'] = { number: data.originalCost }
  if ('fumigationFee' in data) props['燻煙費'] = { number: data.fumigationFee }
  if ('pesticideFee' in data) props['農薬検査費'] = { number: data.pesticideFee }

  const page = await notion.pages.update({ page_id: id, properties: props })
  return pageToFurikomi(page)
}

export async function deleteFurikomiRecord(id: string): Promise<void> {
  await notion.pages.update({ page_id: id, archived: true })
}

// ── Excel Rows (對帳明細) ─────────────────────────────────────────────────────

export interface ExcelRow {
  shipmentNo: string
  date: string
  store: string
  product: string
  spec: string
  quantity: number
  unitPrice: number
  category: string
}

export async function getExcelRows(): Promise<ExcelRow[]> {
  const DB = process.env.NOTION_EXCEL_ROWS_DB?.trim() // trim 防 env 尾端換行（printf vs echo 陷阱）
  if (!DB) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = []
  let cursor: string | undefined
  do {
    const res = await notion.databases.query({
      database_id: DB,
      sorts: [{ property: '出貨日期', direction: 'ascending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...res.results)
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)

  return results.map(page => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (page as any).properties
    return {
      shipmentNo: getText(p['ShipmentNo']) ?? '',
      date: getDate(p['出貨日期']) ?? '',
      store: getText(p['門市']) ?? '',
      product: getText(p['商品名稱']) ?? '',
      spec: getText(p['入數']) ?? '',
      quantity: getNumber(p['箱數']) ?? 0,
      unitPrice: getNumber(p['單價']) ?? 0,
      category: getSelect(p['類別']) ?? '水果',
    }
  })
}

// Notion 速率限制約每秒 3 筆；遇到 429 / 5xx / conflict 自動退避重試
async function notionRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  let delay = 400
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      const err = e as { code?: string | number; status?: number; headers?: Record<string, string> }
      const code = err?.code ?? err?.status
      const retriable =
        code === 'rate_limited' || code === 429 || code === 'conflict_error' ||
        code === 'internal_server_error' || code === 'service_unavailable' ||
        (typeof code === 'number' && code >= 500)
      if (!retriable || i === tries - 1) throw e
      const ra = Number(err?.headers?.['retry-after'])
      await new Promise(res => setTimeout(res, Number.isFinite(ra) && ra > 0 ? ra * 1000 : delay))
      delay = Math.min(delay * 2, 8000)
    }
  }
  throw new Error('notionRetry: unreachable')
}

// 限制同時併發數（預設 3，貼合 Notion 速率限制），避免一次送上百筆被擋
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker))
  return out
}

export async function saveExcelRows(rows: ExcelRow[], shipmentNos: string[]): Promise<void> {
  const DB = process.env.NOTION_EXCEL_ROWS_DB
  if (!DB) return

  // 先刪掉同出貨單號的舊資料避免重複（限併發 + 重試）
  if (shipmentNos.length > 0) {
    for (const sno of shipmentNos) {
      const existing = await notionRetry(() => notion.databases.query({
        database_id: DB,
        filter: { property: 'ShipmentNo', rich_text: { equals: sno } },
      }))
      await mapLimit(existing.results, 3, p =>
        notionRetry(() => notion.pages.update({ page_id: p.id, archived: true }))
      )
    }
  }

  // 建立新資料（限併發 3 + 遇限流自動重試，避免一次上百筆同時送被 Notion 擋下）
  await mapLimit(rows, 3, r =>
    notionRetry(() => notion.pages.create({
      parent: { database_id: DB },
      properties: {
        '名稱': { title: [{ text: { content: `${r.shipmentNo}_${r.store}_${r.product}` } }] },
        'ShipmentNo': { rich_text: [{ text: { content: r.shipmentNo } }] },
        '出貨日期': r.date ? { date: { start: r.date } } : { date: null },
        '門市': { rich_text: [{ text: { content: r.store } }] },
        '商品名稱': { rich_text: [{ text: { content: r.product } }] },
        '入數': { rich_text: [{ text: { content: r.spec || '' } }] },
        '箱數': { number: r.quantity },
        '單價': { number: r.unitPrice },
        '類別': { select: { name: r.category } },
      },
    }))
  )
}

// ── Batch Prices ──────────────────────────────────────────────────────────────

export interface BatchPriceEntry {
  product: string
  spec: string
  unitPrice: number
  category: string
  sortOrder?: number
}

export async function getBatchPrices(): Promise<Record<string, BatchPriceEntry[]>> {
  const BATCH_PRICES_DB = process.env.NOTION_BATCH_PRICES_DB?.trim() // trim 防 env 尾端換行
  if (!BATCH_PRICES_DB) return {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = []
  let cursor: string | undefined
  do {
    const res = await notion.databases.query({
      database_id: BATCH_PRICES_DB,
      sorts: [{ property: 'SortOrder', direction: 'ascending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...res.results)
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)

  const map: Record<string, BatchPriceEntry[]> = {}
  results.forEach(page => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (page as any).properties
    const batchId = getText(p['BatchId'])
    if (!batchId) return
    if (!map[batchId]) map[batchId] = []
    map[batchId].push({
      product: getText(p['Product']) ?? '',
      spec: getText(p['Spec']) ?? '',
      unitPrice: getNumber(p['UnitPrice']) ?? 0,
      category: getSelect(p['Category']) ?? '水果',
      sortOrder: getNumber(p['SortOrder']) ?? 0,
    })
  })
  return map
}

export async function saveBatchPrices(prices: Record<string, BatchPriceEntry[]>): Promise<void> {
  const BATCH_PRICES_DB = process.env.NOTION_BATCH_PRICES_DB
  if (!BATCH_PRICES_DB) return

  for (const batchId of Object.keys(prices)) {
    const existing = await notion.databases.query({
      database_id: BATCH_PRICES_DB,
      filter: { property: 'BatchId', rich_text: { equals: batchId } },
    })
    await Promise.all(existing.results.map(page =>
      notion.pages.update({ page_id: page.id, archived: true })
    ))
    await Promise.all((prices[batchId] || []).map((e, i) =>
      notion.pages.create({
        parent: { database_id: BATCH_PRICES_DB },
        properties: {
          '名稱': { title: [{ text: { content: `${batchId}_${e.product}` } }] },
          'BatchId': { rich_text: [{ text: { content: batchId } }] },
          'Product': { rich_text: [{ text: { content: e.product } }] },
          'Spec': { rich_text: [{ text: { content: e.spec || '' } }] },
          'UnitPrice': { number: e.unitPrice },
          'Category': { select: { name: e.category } },
          'SortOrder': { number: i },
        },
      })
    ))
  }
}


// ── Batch Items (批次子品項) ──────────────────────────────────────────────────

export interface BatchItem {
  id: string
  batchId: string | null
  productName: string
  origin: string | null
  boxes: number | null
  shippedBoxes: number | null
  status: string | null
  remarks: string | null
  sortOrder: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pageToBatchItem(page: any): BatchItem {
  const p = page.properties
  const relation = p['關聯批次']?.relation as Array<{ id: string }> | undefined
  return {
    id: page.id,
    batchId: relation?.[0]?.id ?? null,
    productName: getText(p['品名']) ?? '',
    origin: getText(p['產地']),
    boxes: getNumber(p['箱數']),
    shippedBoxes: getNumber(p['已出貨箱數']) ?? 0,
    status: getSelect(p['狀態']),
    remarks: getText(p['備註']),
    sortOrder: getNumber(p['SortOrder']),
  }
}

export async function getBatchItems(batchId?: string): Promise<BatchItem[]> {
  const DB = process.env.NOTION_BATCH_ITEMS_DB
  if (!DB) return []

  const results: BatchItem[] = []
  let cursor: string | undefined
  do {
    const response = await notion.databases.query({
      database_id: DB,
      ...(batchId
        ? { filter: { property: '關聯批次', relation: { contains: batchId } } }
        : {}),
      sorts: [{ property: 'SortOrder', direction: 'ascending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...response.results.map(pageToBatchItem))
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)
  return results
}

export async function createBatchItem(data: {
  batchId: string
  productName: string
  origin?: string
  boxes?: number
  shippedBoxes?: number
  status?: string
  remarks?: string
  sortOrder?: number
}): Promise<BatchItem> {
  const DB = process.env.NOTION_BATCH_ITEMS_DB
  if (!DB) throw new Error('Missing NOTION_BATCH_ITEMS_DB env var')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {
    '名稱': { title: [{ text: { content: data.productName } }] },
    '關聯批次': { relation: [{ id: data.batchId }] },
    '品名': { rich_text: [{ text: { content: data.productName } }] },
  }
  if (data.origin) props['產地'] = { rich_text: [{ text: { content: data.origin } }] }
  if (data.boxes != null) props['箱數'] = { number: data.boxes }
  if (data.shippedBoxes != null) props['已出貨箱數'] = { number: data.shippedBoxes }
  if (data.status) props['狀態'] = { select: { name: data.status } }
  if (data.remarks) props['備註'] = { rich_text: [{ text: { content: data.remarks } }] }
  if (data.sortOrder != null) props['SortOrder'] = { number: data.sortOrder }

  const page = await notion.pages.create({
    parent: { database_id: DB },
    properties: props,
  })
  return pageToBatchItem(page)
}

export async function updateBatchItem(id: string, data: Partial<{
  productName: string
  origin: string
  boxes: number
  shippedBoxes: number
  status: string
  remarks: string
  sortOrder: number
}>): Promise<BatchItem> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {}
  if (data.productName != null) {
    props['品名'] = { rich_text: [{ text: { content: data.productName } }] }
    props['名稱'] = { title: [{ text: { content: data.productName } }] }
  }
  if (data.origin != null) props['產地'] = { rich_text: [{ text: { content: data.origin } }] }
  if (data.boxes != null) props['箱數'] = { number: data.boxes }
  if (data.shippedBoxes != null) props['已出貨箱數'] = { number: data.shippedBoxes }
  if (data.status) props['狀態'] = { select: { name: data.status } }
  if (data.remarks != null) props['備註'] = { rich_text: [{ text: { content: data.remarks } }] }
  if (data.sortOrder != null) props['SortOrder'] = { number: data.sortOrder }

  const page = await notion.pages.update({ page_id: id, properties: props })
  return pageToBatchItem(page)
}

export async function deleteBatchItem(id: string): Promise<void> {
  await notion.pages.update({ page_id: id, archived: true })
}

// ── Demand Items (LOPIA需求清單) ──────────────────────────────────────────────

export interface DemandItem {
  id: string
  store: string
  product: string
  quantity: string
  needDate: string | null
  status: string
  note: string
  source: string
  rawMessage: string
  lineMessageId: string
}

// Notion 的 rich_text 欄位不接受 content 為空字串，空值要改傳空陣列才能清空欄位
function richText(content: string) {
  return { rich_text: content ? [{ text: { content } }] : [] }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pageToDemandItem(page: any): DemandItem {
  const p = page.properties
  return {
    id: page.id,
    store: getSelect(p['門市']) ?? '',
    product: getText(p['商品']) ?? '',
    quantity: getText(p['數量']) ?? '',
    needDate: getDate(p['日期']),
    status: getSelect(p['狀態']) ?? '待處理',
    note: getText(p['備註']) ?? '',
    source: getSelect(p['來源']) ?? '手動',
    rawMessage: getText(p['原始訊息']) ?? '',
    lineMessageId: getText(p['LINE訊息ID']) ?? '',
  }
}

export async function getDemandItems(): Promise<DemandItem[]> {
  const DB = process.env.NOTION_DEMAND_DB
  if (!DB) return []

  const results: DemandItem[] = []
  let cursor: string | undefined
  do {
    const response = await notion.databases.query({
      database_id: DB,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...response.results.map(pageToDemandItem))
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)
  return results
}

export async function createDemandItem(data: {
  store?: string
  product?: string
  quantity?: string
  needDate?: string | null
  status?: string
  note?: string
  source?: string
  rawMessage?: string
  lineMessageId?: string
}): Promise<DemandItem> {
  const DB = process.env.NOTION_DEMAND_DB
  if (!DB) throw new Error('Missing NOTION_DEMAND_DB env var')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {
    '項目名稱': { title: [{ text: { content: data.product || data.store || '(未命名需求)' } }] },
    '狀態': { select: { name: data.status || '待處理' } },
    '來源': { select: { name: data.source || '手動' } },
  }
  if (data.store) props['門市'] = { select: { name: data.store } }
  if (data.product != null) props['商品'] = richText(data.product)
  if (data.quantity != null) props['數量'] = richText(data.quantity)
  if (data.needDate) props['日期'] = { date: { start: data.needDate } }
  if (data.note) props['備註'] = richText(data.note)
  if (data.rawMessage) props['原始訊息'] = richText(data.rawMessage)
  if (data.lineMessageId) props['LINE訊息ID'] = richText(data.lineMessageId)

  const page = await notion.pages.create({ parent: { database_id: DB }, properties: props })
  return pageToDemandItem(page)
}

export async function updateDemandItem(id: string, data: Partial<{
  store: string
  product: string
  quantity: string
  needDate: string | null
  status: string
  note: string
}>): Promise<DemandItem> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {}
  if (data.store != null) props['門市'] = data.store ? { select: { name: data.store } } : { select: null }
  if (data.product != null) {
    props['商品'] = richText(data.product)
    props['項目名稱'] = { title: [{ text: { content: data.product || data.store || '(未命名需求)' } }] }
  }
  if (data.quantity != null) props['數量'] = richText(data.quantity)
  if (data.needDate !== undefined) props['日期'] = data.needDate ? { date: { start: data.needDate } } : { date: null }
  if (data.status != null) props['狀態'] = { select: { name: data.status } }
  if (data.note != null) props['備註'] = richText(data.note)

  const page = await notion.pages.update({ page_id: id, properties: props })
  return pageToDemandItem(page)
}

export async function deleteDemandItem(id: string): Promise<void> {
  await notion.pages.update({ page_id: id, archived: true })
}

// 檢查這則LINE訊息是否已經寫過（避免LINE重送造成重複項目）
export async function demandItemExistsForLineMessage(lineMessageId: string): Promise<boolean> {
  const DB = process.env.NOTION_DEMAND_DB
  if (!DB) return false
  const res = await notion.databases.query({
    database_id: DB,
    filter: { property: 'LINE訊息ID', rich_text: { equals: lineMessageId } },
    page_size: 1,
  })
  return res.results.length > 0
}

// 把所有 LINE 訊息（不限格式）存進「LINE 訊息紀錄」DB，供每日 Claude 分析用
export async function saveLineMessage(data: {
  messageId: string
  text: string
  userId: string
  groupId: string | null
  sourceType: '群組' | '個人'
  timestamp: number  // Unix ms
}): Promise<void> {
  const DB = process.env.NOTION_LINE_MESSAGES_DB
  if (!DB) return  // env var 未設定時靜默跳過，不影響現有流程

  // 先查是否已存過（LINE 平台偶爾會重送同一則事件）
  const existing = await notion.databases.query({
    database_id: DB,
    filter: { property: 'LINE訊息ID', rich_text: { equals: data.messageId } },
    page_size: 1,
  })
  if (existing.results.length > 0) return

  const sentAt = new Date(data.timestamp).toISOString()

  await notion.pages.create({
    parent: { database_id: DB },
    properties: {
      '訊息內容': { title: [{ text: { content: data.text.slice(0, 2000) } }] },
      '發送者ID': richText(data.userId),
      '群組ID': richText(data.groupId ?? ''),
      '來源類型': { select: { name: data.sourceType } },
      '發送時間': { date: { start: sentAt } },
      'LINE訊息ID': richText(data.messageId),
      '已分析': { checkbox: false },
    },
  })
}
