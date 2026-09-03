import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/security/rate-limit';
import type { OrderStatus } from '@/types/database';

export const dynamic = 'force-dynamic';

/** Bir IP uchun daqiqasiga nechta buyurtma yuborish mumkin. */
const ORDER_LIMIT_PER_IP = 10;
/** Bitta stol uchun daqiqasiga nechta buyurtma yuborish mumkin. */
const ORDER_LIMIT_PER_TABLE = 4;
const ONE_MINUTE_MS = 60 * 1000;

/** `?status=` filtrida ruxsat etilgan qiymatlar. */
const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'delivered',
  'completed',
  'cancelled',
];

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as string[]).includes(value);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const restaurantId = searchParams.get('restaurant_id') || 'rest-001';
  const branchId = searchParams.get('branch_id');
  const tableId = searchParams.get('table_id');
  // Ixtiyoriy filtrlar: ofitsiant va holat(lar).
  const waiterId = (searchParams.get('waiter_id') || '').trim();
  const statusParam = (searchParams.get('status') || '').trim();

  // `?status=pending,confirmed` — vergul bilan bir nechta holat.
  const requestedStatuses = statusParam
    ? statusParam
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0)
    : [];

  const unknownStatus = requestedStatuses.find((value) => !isOrderStatus(value));
  if (unknownStatus) {
    return NextResponse.json(
      { error: `Noma'lum buyurtma holati: "${unknownStatus}".` },
      { status: 400 }
    );
  }

  let orders = await db.getOrdersByRestaurant(restaurantId);
  if (branchId) {
    orders = orders.filter((o) => o.branch_id === branchId);
  }
  if (tableId) {
    orders = orders.filter((o) => o.table_id === tableId);
  }
  if (waiterId) {
    orders = orders.filter((o) => o.waiter_id === waiterId);
  }
  if (requestedStatuses.length > 0) {
    const statuses = new Set(requestedStatuses);
    orders = orders.filter((o) => statuses.has(o.status));
  }

  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest) {
  // Spamdan himoya: avval IP bo'yicha umumiy cheklov.
  const ipLimit = rateLimit(`order:ip:${clientIp(req)}`, {
    limit: ORDER_LIMIT_PER_IP,
    windowMs: ONE_MINUTE_MS,
  });
  if (!ipLimit.allowed) {
    return tooManyRequests(
      ipLimit,
      "Juda ko'p buyurtma yuborildi. Iltimos, biroz kutib turing."
    );
  }

  try {
    const body = await req.json();
    const { table_id, items, customer_notes } = body;

    if (!table_id || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required order fields: table_id and items list' },
        { status: 400 }
      );
    }

    // So'ngra stol bo'yicha alohida cheklov — bitta stol oshxonani
    // buyurtmalar bilan ko'mib tashlay olmasligi uchun.
    const tableLimit = rateLimit(`order:table:${table_id}`, {
      limit: ORDER_LIMIT_PER_TABLE,
      windowMs: ONE_MINUTE_MS,
    });
    if (!tableLimit.allowed) {
      return tooManyRequests(
        tableLimit,
        "Bu stoldan juda ko'p buyurtma yuborildi. Iltimos, biroz kutib turing."
      );
    }

    const newOrder = await db.createOrder({
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
