import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

const IMPORT_STATUS_DB = process.env.NOTION_IMPORT_STATUS_DB!
const SHIPMENT_RECORDS_DB = process.env.NOTION_SHIPMENT_RECORDS_DB!

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
  remarks: string | null
  round: number | null
  planStatus: string | null
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
    remarks: getText(p['備註']),
    round: getNumber(p['出貨輪次']),
    planStatus: getSelect(p['計畫狀態']),
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getShipments(): Promise<Shipment[]> {
  const response = await notion.databases.query({
    database_id: IMPORT_STATUS_DB,
    sorts: [{ property: '日本出發日', direction: 'descending' }],
  })
  return response.results.map(pageToShipment)
}

export async function getShipmentRecords(): Promise<ShipmentRecord[]> {
  const response = await notion.databases.query({
    database_id: SHIPMENT_RECORDS_DB,
    sorts: [
      { property: '出貨輪次', direction: 'ascending' },
      { property: '出貨日期', direction: 'ascending' },
    ],
  })
  return response.results.map(pageToRecord)
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createShipmentRecord(data: {
  shipmentNo: string
  batchId: string
  store: string
  date: string
  boxes: number
  round?: number
  planStatus?: string
  remarks?: string
}) {
  const page = await notion.pages.create({
    parent: { database_id: SHIPMENT_RECORDS_DB },
    properties: {
      '出貨單號': { title: [{ text: { content: data.shipmentNo } }] },
      '關聯批次': { relation: [{ id: data.batchId }] },
      '出貨門市': { select: { name: data.store } },
      '出貨日期': { date: { start: data.date } },
      '出貨箱數': { number: data.boxes },
      ...(data.round != null ? { '出貨輪次': { number: data.round } } : {}),
      ...(data.planStatus ? { '計畫狀態': { select: { name: data.planStatus } } } : { '計畫狀態': { select: { name: '計畫中' } } }),
      ...(data.remarks ? { '備註': { rich_text: [{ text: { content: data.remarks } }] } } : {}),
    },
  })
  return pageToRecord(page)
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateShipmentRecord(id: string, data: Partial<{
  store: string
  date: string
  boxes: number
  round: number
  planStatus: string
  remarks: string
  shipmentNo: string
}>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = {}
  if (data.shipmentNo) props['出貨單號'] = { title: [{ text: { content: data.shipmentNo } }] }
  if (data.store) props['出貨門市'] = { select: { name: data.store } }
  if (data.date) props['出貨日期'] = { date: { start: data.date } }
  if (data.boxes != null) props['出貨箱數'] = { number: data.boxes }
  if (data.round != null) props['出貨輪次'] = { number: data.round }
  if (data.planStatus) props['計畫狀態'] = { select: { name: data.planStatus } }
  if (data.remarks != null) props['備註'] = { rich_text: [{ text: { content: data.remarks } }] }

  const page = await notion.pages.update({ page_id: id, properties: props })
  return pageToRecord(page)
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
  if (data.productSummary) props['商品摘要']   = { rich_text: [{ text: { content: data.productSummary } }] }
  if (data.remarks)        props['備註']       = { rich_text: [{ text: { content: data.remarks } }] }

  const page = await notion.pages.create({
    parent: { database_id: IMPORT_STATUS_DB },
    properties: props,
  })
  return pageToShipment(page)
}
