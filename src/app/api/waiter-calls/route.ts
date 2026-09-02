import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get('branch_id') || 'branch-001';
  const calls = db.getWaiterCalls(branchId);
  return NextResponse.json({ calls });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { table_id, call_type } = body;

    if (!table_id) {
      return NextResponse.json({ error: 'Table ID is required' }, { status: 400 });
    }

    const call = db.callWaiter({ table_id, call_type });
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

    const acknowledgedCall = db.acknowledgeWaiterCall(call_id);
    return NextResponse.json({ success: true, call: acknowledgedCall });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to acknowledge call';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
