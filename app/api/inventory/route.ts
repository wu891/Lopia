import { NextResponse } from 'next/server'
import { getInventory } from '@/lib/inventoryNotion'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await getInventory()
    return NextResponse.json({ items })
  } catch (err) {
    console.error('[inventory GET]', err)
    return NextResponse.json({ error: 'Failed to fetch inventory' }, { status: 500 })
  }
}
