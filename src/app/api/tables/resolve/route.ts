import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'QR token is required' }, { status: 400 });
  }

  const resolution = db.getTableByQrToken(token);

  if (!resolution) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 });
  }

  return NextResponse.json({ resolution });
}
