import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get('branch_id') || 'branch-001';
  // Ixtiyoriy filtr: faqat shu ofitsiantga biriktirilgan stollar.
  const waiterId = (searchParams.get('waiter_id') || '').trim();

  const tables = waiterId
    ? (await db.getTablesByWaiter(waiterId)).filter((t) => t.branch_id === branchId)
    : await db.getTablesByBranch(branchId);

  return NextResponse.json({ tables });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const newTable = await db.createTable(body);
    return NextResponse.json({ success: true, table: newTable }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create table';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
