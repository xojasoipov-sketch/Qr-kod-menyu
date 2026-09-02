import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const item = db.toggleItemAvailability(id);

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to toggle availability';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
