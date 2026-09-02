import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const restaurantId = searchParams.get('restaurant_id') || 'rest-001';
  const branchId = searchParams.get('branch_id');
  const tableId = searchParams.get('table_id');

  let orders = db.getOrdersByRestaurant(restaurantId);
  if (branchId) {
    orders = orders.filter((o) => o.branch_id === branchId);
  }
  if (tableId) {
    orders = orders.filter((o) => o.table_id === tableId);
  }

  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { table_id, items, customer_notes } = body;

    if (!table_id || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required order fields: table_id and items list' },
        { status: 400 }
      );
    }

    const newOrder = db.createOrder({
      table_id,
      customer_notes,
      items,
    });

    return NextResponse.json({ success: true, order: newOrder }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create order';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
