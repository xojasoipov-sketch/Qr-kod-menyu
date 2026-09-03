import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await db.regenerateQrToken(id);

    if (!result) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      table: result.table,
      oldToken: result.oldToken,
      newToken: result.table.qr_token,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to regenerate QR token';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
