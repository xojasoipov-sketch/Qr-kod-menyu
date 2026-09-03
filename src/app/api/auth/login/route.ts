import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  constantTimeEquals,
  createSessionToken,
  landingPathFor,
  sessionCookieOptions,
} from '@/lib/auth/session';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

/** Bir IP uchun 15 daqiqada 8 ta urinish — kuch bilan tanlashga (brute-force) qarshi. */
const LOGIN_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };

const DEFAULT_ADMIN_PASSWORD = 'admin1234';

const globalForLogin = globalThis as unknown as { __adminPasswordWarned?: boolean };

/** Amaldagi admin paroli. Parol hech qachon jurnalga yozilmaydi va qaytarilmaydi. */
function getAdminPassword(): string {
  const configured = process.env.ADMIN_PASSWORD?.trim();
  if (configured) return configured;

  if (!globalForLogin.__adminPasswordWarned) {
    globalForLogin.__adminPasswordWarned = true;
    console.warn(
      '\n[AUTH] DIQQAT: ADMIN_PASSWORD sozlanmagan — standart parol ishlatilmoqda.\n' +
        '[AUTH] Ishlab chiqarishga chiqarishdan oldin .env fayliga ADMIN_PASSWORD qo\'shing.\n'
    );
  }

  return DEFAULT_ADMIN_PASSWORD;
}

export async function POST(req: NextRequest) {
  const limitResult = rateLimit(`auth-login:${clientIp(req)}`, LOGIN_LIMIT);
  if (!limitResult.allowed) {
    return tooManyRequests(
      limitResult,
      "Juda ko'p urinish qilindi. Xavfsizlik uchun bir necha daqiqa kutib turing."
    );
  }

  let password = '';
  try {
    const body = (await req.json()) as { password?: unknown };
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    password = '';
  }

  if (!password) {
    return NextResponse.json({ error: 'Parolni kiriting.' }, { status: 400 });
  }

  if (!constantTimeEquals(password, getAdminPassword())) {
    return NextResponse.json(
      { error: "Parol noto'g'ri. Qaytadan urinib ko'ring." },
      { status: 401 }
    );
  }

  const name = 'Administrator';
  const token = await createSessionToken({ role: 'ADMIN', name }, ADMIN_SESSION_TTL_SECONDS);

  const res = NextResponse.json({
    success: true,
    role: 'ADMIN' as const,
    name,
    redirect: landingPathFor('ADMIN'),
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(ADMIN_SESSION_TTL_SECONDS));
  return res;
}
