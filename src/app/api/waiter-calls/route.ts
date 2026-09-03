import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

/** Bir IP uchun daqiqasiga nechta chaqiruv yuborish mumkin. */
const CALL_LIMIT_PER_IP = 15;
/** Bitta stol uchun 5 daqiqada nechta chaqiruv yuborish mumkin. */
const CALL_LIMIT_PER_TABLE = 5;
const ONE_MINUTE_MS = 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get('branch_id') || 'branch-001';
  const calls = await db.getWaiterCalls(branchId);
  return NextResponse.json({ calls });
}

export async function POST(req: NextRequest) {
  // Spamdan himoya: avval IP bo'yicha umumiy cheklov.
  const ipLimit = rateLimit(`waiter-call:ip:${clientIp(req)}`, {
    limit: CALL_LIMIT_PER_IP,
    windowMs: ONE_MINUTE_MS,
  });
  if (!ipLimit.allowed) {
    return tooManyRequests(
      ipLimit,
      "Juda ko'p chaqiruv yuborildi. Iltimos, biroz kutib turing."
    );
  }

  try {
    const body = await req.json();
    const { table_id, call_type } = body;

    if (!table_id) {
      return NextResponse.json({ error: 'Table ID is required' }, { status: 400 });
    }

    // So'ngra stol bo'yicha alohida cheklov — bitta stol ofitsiantni
    // chaqiruvlar bilan ko'mib tashlay olmasligi uchun.
    const tableLimit = rateLimit(`waiter-call:table:${table_id}`, {
      limit: CALL_LIMIT_PER_TABLE,
      windowMs: FIVE_MINUTES_MS,
    });
    if (!tableLimit.allowed) {
      return tooManyRequests(
        tableLimit,
        "Bu stoldan ofitsiant juda ko'p chaqirildi. Iltimos, biroz kutib turing."
      );
    }

    const call = await db.callWaiter({ table_id, call_type });
    return NextResponse.json({ success: true, call }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to call waiter';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { call_id } = body;

    if (!call_id) {
      return NextResponse.json({ error: 'Call ID is required' }, { status: 400 });
    }

    const acknowledgedCall = await db.acknowledgeWaiterCall(call_id);
    return NextResponse.json({ success: true, call: acknowledgedCall });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to acknowledge call';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
