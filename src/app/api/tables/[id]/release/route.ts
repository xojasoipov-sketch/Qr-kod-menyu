import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

/**
 * Stolni bo'shatadi — faqat stolni olgan ofitsiant yoki administrator.
 *
 * POST /api/tables/[id]/release
 *   200 { success, table }
 *   401 — sessiya yo'q yoki rol mos emas
 *   403 — stol boshqa ofitsiantda
 *   404 — stol topilmadi
 *   409 — stol bo'sh yoki tugallanmagan buyurtmasi bor
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
  const isAdmin = session.role === 'ADMIN';
  const staff = { id: session.staffId || 'admin', name: session.name };

  const table = db.getTable(id);
  if (!table) {
    return NextResponse.json({ error: 'Stol topilmadi.' }, { status: 404 });
  }

  // Begona stolni bo'shatishga urinish — bu ruxsat masalasi (403),
  // qolgan xatolar esa holat masalasi (409).
  const forbidden = !isAdmin && !!table.claimed_by && table.claimed_by !== staff.id;

  const result = db.releaseTable(id, staff, isAdmin);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: forbidden ? 403 : 409 });
  }

  return NextResponse.json({ success: true, table: result.table });
}
