import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

/**
 * Stolni boshqa ofitsiantga uzatadi.
 *
 * POST /api/tables/[id]/transfer  { to_staff_id }
 *   200 { success, table }
 *   400 — to_staff_id yuborilmagan yoki so'rov noto'g'ri
 *   401 — sessiya yo'q yoki rol mos emas
 *   403 — stol so'rovchida emas (va u administrator ham emas)
 *   404 — stol yoki qabul qiluvchi ofitsiant topilmadi
 *   409 — stol faol emas kabi holat xatolari
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
  const isAdmin = session.role === 'ADMIN';
  const staff = { id: session.staffId || 'admin', name: session.name };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "So'rov noto'g'ri: stol uzatiladigan ofitsiantni yuboring." },
      { status: 400 }
    );
  }

  const toStaffId =
    typeof body === 'object' && body !== null && 'to_staff_id' in body
      ? String((body as { to_staff_id: unknown }).to_staff_id ?? '').trim()
      : '';

  if (!toStaffId) {
    return NextResponse.json(
      { error: 'Stol uzatiladigan ofitsiantni tanlang.' },
      { status: 400 }
    );
  }

  const table = await db.getTable(id);
  if (!table) {
    return NextResponse.json({ error: 'Stol topilmadi.' }, { status: 404 });
  }

  const target = await db.getStaffById(toStaffId);
  if (!target) {
    return NextResponse.json({ error: 'Ofitsiant topilmadi.' }, { status: 404 });
  }

  const result = await db.transferTable(id, staff.id, { id: target.id, name: target.name }, isAdmin);
  if (!result.ok) {
    // Stol so'rovchida bo'lmasa — ruxsat xatosi (403), qolgani holat xatosi (409). `forbidden`
    // qulflangan tranzaksiya ichida, aynan shu xato yuzaga kelgan paytda aniqlanadi — oldindan
    // o'qishdan emas, shu sabab boshqa so'rov stol egasini shu oraliqda o'zgartirsa ham to'g'ri.
    return NextResponse.json({ error: result.error }, { status: result.forbidden ? 403 : 409 });
  }

  return NextResponse.json({ success: true, table: result.table });
}
