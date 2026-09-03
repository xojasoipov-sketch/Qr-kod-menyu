import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

/**
 * Ofitsiant buyurtmani tasdiqlaydi: 'pending' -> 'confirmed'.
 * Faqat shundan keyin oshxona tayyorlashni boshlay oladi.
 *
 * POST /api/orders/[id]/accept
 *   200 { success, order }
 *   401 — sessiya yo'q yoki rol mos emas
 *   404 — buyurtma topilmadi
 *   409 — buyurtma 'pending' holatida emas
 */
export async function POST(
  _req: Request,
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

  if (!db.getOrder(id)) {
    return NextResponse.json({ error: 'Buyurtma topilmadi.' }, { status: 404 });
  }

  const result = db.acceptOrder(id, staff);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ success: true, order: result.order });
}
