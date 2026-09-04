import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

/**
 * Stol uchun mehmonlar sonini belgilaydi/tozalaydi — hisobni kishi boshiga bo'lish uchun.
 *
 * PATCH /api/tables/[id]/guests  { guest_count: number | null }
 *   200 { success, table }
 *   400 — guest_count noto'g'ri yoki so'rov tuzilishi xato
 *   401 — sessiya yo'q yoki rol mos emas
 *   403 — stol boshqa ofitsiantga biriktirilgan (yoki hech kimga biriktirilmagan va so'rovchi admin emas)
 *   404 — stol topilmadi
 */
export async function PATCH(
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "So'rov noto'g'ri: mehmonlar sonini yuboring." },
      { status: 400 }
    );
  }

  // `guest_count` maydoni albatta bo'lishi shart (array, bo'sh {} yoki boshqa noto'g'ri
  // tuzilishlarni sukut bo'yicha "tozalash" deb qabul qilmaslik uchun — aks holda mijozning
  // haqiqiy mehmonlar sonini tasodifan tozalab qo'yish mumkin edi).
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('guest_count' in body)) {
    return NextResponse.json(
      { error: "So'rovda guest_count maydoni bo'lishi shart." },
      { status: 400 }
    );
  }
  const rawGuestCount = (body as { guest_count: unknown }).guest_count;

  let guestCount: number | null;
  if (rawGuestCount === null) {
    guestCount = null;
  } else if (
    typeof rawGuestCount === 'number' &&
    Number.isInteger(rawGuestCount) &&
    rawGuestCount >= 1
  ) {
    guestCount = rawGuestCount;
  } else {
    return NextResponse.json(
      { error: "Mehmonlar soni musbat butun son bo'lishi kerak." },
      { status: 400 }
    );
  }

  const table = await db.getTable(id);
  if (!table) {
    return NextResponse.json({ error: 'Stol topilmadi.' }, { status: 404 });
  }

  const isAdmin = session.role === 'ADMIN';
  const staffId = session.staffId || 'admin';
  // release/transfer'dagi kabi: faqat stolni olgan ofitsiant yoki administrator mehmonlar sonini
  // o'zgartira oladi — aks holda boshqa ofitsiant begona stolning hisobini o'zgartirib qo'yishi
  // mumkin edi.
  if (!isAdmin && table.claimed_by !== staffId) {
    const owner = table.claimed_by_name || (table.claimed_by ? 'boshqa ofitsiant' : null);
    return NextResponse.json(
      {
        error: owner
          ? `Bu stol ${owner} ga biriktirilgan. Mehmonlar sonini faqat o'sha ofitsiant yoki administrator o'zgartira oladi.`
          : "Bu stol hech kimga biriktirilmagan. Avval stolni o'zingizga oling.",
      },
      { status: 403 }
    );
  }

  const updated = await db.updateTable(id, { guest_count: guestCount });
  if (!updated) {
    return NextResponse.json({ error: 'Stol topilmadi.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, table: updated });
}
