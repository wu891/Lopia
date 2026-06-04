import { NextRequest, NextResponse } from 'next/server'
import { updateShipmentInspection, updateShipmentDeliveryStatus, updateShipmentRemarks, updateShipmentCost } from '@/lib/notion'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAuth('edit'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const body = await req.json()
    const {
      fumigation, pesticideTest, radiationTest, deliveryStatus, remarks,
      importCost, freightCost, storageCost, costCurrency, taxMode,
    } = body

    if (deliveryStatus !== undefined) {
      await updateShipmentDeliveryStatus(id, deliveryStatus)
    }

    if (remarks !== undefined) {
      await updateShipmentRemarks(id, remarks)
    }

    // 毛利系統：批次成本
    if (
      importCost !== undefined || freightCost !== undefined || storageCost !== undefined ||
      costCurrency !== undefined || taxMode !== undefined
    ) {
      await updateShipmentCost(id, {
        ...(importCost   !== undefined ? { importCost }   : {}),
        ...(freightCost  !== undefined ? { freightCost }  : {}),
        ...(storageCost  !== undefined ? { storageCost }  : {}),
        ...(costCurrency !== undefined ? { costCurrency } : {}),
        ...(taxMode      !== undefined ? { taxMode }      : {}),
      })
    }

    await updateShipmentInspection(id, {
      ...(fumigation    !== undefined ? { fumigation }    : {}),
      ...(pesticideTest !== undefined ? { pesticideTest } : {}),
      ...(radiationTest !== undefined ? { radiationTest } : {}),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to update shipment' }, { status: 500 })
  }
}
