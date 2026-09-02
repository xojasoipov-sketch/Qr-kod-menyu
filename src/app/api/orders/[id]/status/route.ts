import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { OrderStatus } from '@/types/database';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { status, changed_by, reason } = body;

    if (!status) {
      return NextResponse.json({ error: 'Target status is required' }, { status: 400 });
    }

    const updatedOrder = db.updateOrderStatus(
      id,
      status as OrderStatus,
      changed_by || 'STAFF',
      reason
    );

    return NextResponse.json({ success: true, order: updatedOrder });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update order status';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
