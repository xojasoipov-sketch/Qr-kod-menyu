import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

/** Rad etish sababi shuncha belgidan qisqa bo'lmasin. */
const MIN_REASON_LENGTH = 3;

/**
 * Ofitsiant buyurtmani rad etadi: 'pending' -> 'cancelled'. Sabab majburiy.
 *
 * POST /api/orders/[id]/reject  { reason }
 *   200 { success, order }
 *   400 — sabab bo'sh yoki juda qisqa
 *   401 — sessiya yo'q yoki rol mos emas
 *   404 — buyurtma topilmadi
 *   409 — buyurtma 'pending' holatida emas
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || (session.role !== 'ADMIN' && session.role !== 'WAITER')) {
    return NextResponse.json(
      { error: "Bu amal uchun ofitsiant yoki administrator sifatida kirish kerak." },
      { status: 401 }
    );
  }

  const { id } = await params;
  const staff = { id: session.staffId || 'admin', name: session.name };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Rad etish sababini yozing.' },
      { status: 400 }
    );
  }

  const reason =
    typeof body === 'object' && body !== null && 'reason' in body
      ? String((body as { reason: unknown }).reason ?? '').trim()
      : '';

  if (!reason) {
    return NextResponse.json({ error: 'Rad etish sababini yozing.' }, { status: 400 });
  }
  if (reason.length < MIN_REASON_LENGTH) {
    return NextResponse.json(
      { error: `Sabab juda qisqa — kamida ${MIN_REASON_LENGTH} ta belgi yozing.` },
      { status: 400 }
    );
  }

  if (!db.getOrder(id)) {
    return NextResponse.json({ error: 'Buyurtma topilmadi.' }, { status: 404 });
  }

  const result = db.rejectOrder(id, staff, reason);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ success: true, order: result.order });
}
