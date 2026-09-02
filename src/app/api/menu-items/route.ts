import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const restaurantId = searchParams.get('restaurant_id') || 'rest-001';
  const items = db.getMenuItems(restaurantId);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const newItem = db.createMenuItem(body);
    return NextResponse.json({ success: true, item: newItem }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create menu item';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
