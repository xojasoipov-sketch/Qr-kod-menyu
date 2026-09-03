import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

/**
 * Stolni ofitsiant o'z zimmasiga oladi.
 *
 * POST /api/tables/[id]/claim
 *   200 { success, table } — biriktirildi (takroriy so'rov ham muvaffaqiyatli)
 *   401 — sessiya yo'q yoki rol mos emas
 *   404 — stol topilmadi
 *   409 — stol boshqa ofitsiantda yoki faol emas
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

  // Parol bilan kirgan administratorda xodim id si bo'lmaydi — u ham stol ola olsin.
  const staff = { id: session.staffId || 'admin', name: session.name };

  const table = db.getTable(id);
  if (!table) {
    return NextResponse.json({ error: 'Stol topilmadi.' }, { status: 404 });
  }

  const result = db.claimTable(id, staff);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ success: true, table: result.table });
}
