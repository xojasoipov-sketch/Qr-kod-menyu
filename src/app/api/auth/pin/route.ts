import { NextRequest, NextResponse } from 'next/server';
import type { SessionRole, UserRole } from '@/types/database';
import {
  SESSION_COOKIE,
  createSessionToken,
  landingPathFor,
  sessionCookieOptions,
  sessionTtlFor,
} from '@/lib/auth/session';
import { db } from '@/lib/db/store';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

/** 4 xonali kod atigi 10 000 variant — shuning uchun cheklov majburiy. */
const PIN_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };

/** Xodim lavozimini sessiya roliga o'giradi. */
function toSessionRole(role: UserRole): SessionRole {
  switch (role) {
    case 'KITCHEN':
      return 'KITCHEN';
    case 'WAITER':
      return 'WAITER';
    case 'MANAGER':
    case 'RESTAURANT_OWNER':
    case 'SUPER_ADMIN':
    default:
      return 'ADMIN';
  }
}

export async function POST(req: NextRequest) {
  const limitResult = rateLimit(`auth-pin:${clientIp(req)}`, PIN_LIMIT);
  if (!limitResult.allowed) {
    return tooManyRequests(
      limitResult,
      "Juda ko'p urinish qilindi. Xavfsizlik uchun bir necha daqiqa kutib turing."
    );
  }

  let pin = '';
  try {
    const body = (await req.json()) as { pin?: unknown };
    pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  } catch {
    pin = '';
  }

  // Kodning o'zi hech qachon jurnalga yozilmaydi.
  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "Kod 4 ta raqamdan iborat bo'lishi kerak." }, { status: 400 });
  }

  const staff = db.getStaffByPin(pin);
  if (!staff) {
    return NextResponse.json(
      { error: "Bunday kod topilmadi. Qaytadan urinib ko'ring." },
      { status: 401 }
    );
  }

  const role = toSessionRole(staff.role);

  // Ofitsiant va oshxona "bir marta kiradi" — 30 kun. Ma'muriyat huquqi berilgan
  // sessiya esa qisqaroq: 12 soat.
  const ttl = sessionTtlFor(role);
  const token = await createSessionToken({ role, staffId: staff.id, name: staff.name }, ttl);

  const res = NextResponse.json({
    success: true,
    role,
    name: staff.name,
    redirect: landingPathFor(role),
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(ttl));
  return res;
}
