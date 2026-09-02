import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const restaurantId = searchParams.get('restaurant_id') || 'rest-001';
  const categories = db.getCategories(restaurantId);
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const newCategory = db.createCategory(body);
    return NextResponse.json({ success: true, category: newCategory }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create category';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
