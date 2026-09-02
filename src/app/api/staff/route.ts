import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const restaurantId = searchParams.get('restaurant_id') || 'rest-001';
  const staff = db.staff.filter((s) => s.restaurant_id === restaurantId);
  return NextResponse.json({ staff });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const newStaff = db.createStaff(body);
    return NextResponse.json({ success: true, staff: newStaff }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create staff member';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
