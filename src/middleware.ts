import { NextResponse, type NextRequest } from 'next/server';
import type { SessionRole } from '@/types/database';
import {
  SESSION_COOKIE,
  type SessionData,
  hasConfiguredSecret,
  landingPathFor,
  verifySessionToken,
} from '@/lib/auth/session';

/**
 * Kirish nazorati.
 *
 * Qoida oddiy: MEHMON hech qachon to'siqqa uchramaydi (QR menyu, buyurtma berish,
 * ofitsiantni chaqirish — hammasi ochiq), xodim va admin sahifalari esa
 * imzolangan sessiya cookie'sini talab qiladi.
 */

// ==========================================
// OCHIQ (PUBLIC) YO'LLAR
// ==========================================

const PUBLIC_EXACT = new Set<string>([
  '/',
  '/login',
  '/pin',
  '/favicon.ico',
  '/manifest.json',
  '/robots.txt',
]);

const PUBLIC_PREFIXES = [
  '/t/', // mehmonning QR menyusi va buyurtma sahifasi
  '/api/auth/', // kirish/chiqish route'lari
  '/_next/',
  '/images/',
  '/icons/',
  '/fonts/',
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function underSection(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

// ==========================================
// API QOIDALARI
// ==========================================

/**
 * Zal xizmati amallari — ofitsiant (va admin) uchun ochiq.
 * Stolni olish/bo'shatish/uzatish va buyurtmani tasdiqlash/rad etish.
 */
const WAITER_API_PATTERNS: RegExp[] = [
  /^\/api\/tables\/[^/]+\/(claim|release|transfer|guests)$/,
  /^\/api\/orders\/[^/]+\/(accept|reject)$/,
];

/** ADMIN yoki WAITER bajara oladigan API so'rovlari. */
function requiresWaiterApi(pathname: string, method: string): boolean {
  // Zal amallarining aksariyati POST (claim/release/transfer/accept/reject); mehmonlar
  // sonini belgilash esa qisman yangilash bo'lgani uchun PATCH.
  if (method !== 'POST' && method !== 'PATCH') return false;
  return WAITER_API_PATTERNS.some((pattern) => pattern.test(pathname));
}

/** Faqat ADMIN bajara oladigan API so'rovlari. */
function requiresAdminApi(pathname: string, method: string): boolean {
  // Xodimlar ro'yxati PIN kodlarni o'z ichiga oladi — hech qachon oshkor bo'lmasin.
  if (underSection(pathname, '/api/staff')) return true;
  if (underSection(pathname, '/api/notifications')) return true;

  if (!WRITE_METHODS.has(method)) return false;

  // Zal amallari `/api/tables` ostida bo'lsa-da, admin talab qilmaydi —
  // ular ofitsiantning kundalik ishi. Qolgan yozuv so'rovlari (stol qo'shish,
  // QR yangilash) avvalgidek faqat ADMIN uchun qoladi.
  if (requiresWaiterApi(pathname, method)) return false;

  return (
    underSection(pathname, '/api/menu-items') ||
    underSection(pathname, '/api/categories') ||
    underSection(pathname, '/api/tables') ||
    underSection(pathname, '/api/restaurants') ||
    underSection(pathname, '/api/uploads')
  );
}

/** Xodim yoki admin bajara oladigan API so'rovlari. */
function requiresStaffApi(pathname: string, method: string): boolean {
  // Buyurtma holatini o'zgartirish: oshxona / ofitsiant / admin.
  if (method === 'PATCH' && /^\/api\/orders\/[^/]+\/status$/.test(pathname)) return true;

  // Chaqiruvni qabul qilish (acknowledge). Mehmonning POST so'rovi ochiq qoladi.
  if (method === 'PATCH' && underSection(pathname, '/api/waiter-calls')) return true;

  return false;
}

// ==========================================
// SAHIFA QOIDALARI
// ==========================================

interface PageRule {
  section: string;
  roles: SessionRole[];
  /**
   * Sessiya bo'lmasa qaysi kirish ekraniga yuborish kerak.
   *
   * Kirish endi bitta: `/login` sahifasi ikkala usulni ham (xizmat kodi va
   * ma'muriyat paroli) o'zida saqlaydi. Bu yerga `?next=` qo'shib yuboriladi —
   * o'sha sahifa aynan shu parametrga qarab to'g'ri yorliqni ochadi.
   */
  signInPath: '/login';
}

const PAGE_RULES: PageRule[] = [
  { section: '/admin', roles: ['ADMIN'], signInPath: '/login' },
  { section: '/kitchen', roles: ['KITCHEN', 'ADMIN'], signInPath: '/login' },
  { section: '/waiter', roles: ['WAITER', 'ADMIN'], signInPath: '/login' },
];

// ==========================================
// SESSIYANI ANIQLASH
// ==========================================

async function resolveSession(req: NextRequest): Promise<SessionData | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // Odatiy yo'l: imzo shu yerda, Edge runtime'da tekshiriladi.
  if (hasConfiguredSecret()) {
    return verifySessionToken(token);
  }

  // AUTH_SECRET sozlanmagan bo'lsa, Node va Edge runtime'lar bir xil vaqtinchalik
  // kalitni ko'ra olmaydi. Bunday holatda sessiyani tokenni bergan Node tomonidan
  // (/api/auth/me) so'raymiz — shunda ishlab chiqish rejimida ham hammasi ishlaydi.
  try {
    const res = await fetch(new URL('/api/auth/me', req.nextUrl.origin), {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { session?: SessionData | null };
    return data.session ?? null;
  } catch {
    return null;
  }
}

function unauthorizedJson(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

function redirectToSignIn(req: NextRequest, signInPath: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = signInPath;
  url.search = '';
  url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

// ==========================================
// MIDDLEWARE
// ==========================================

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // 1) Mehmonga ochiq yo'llar — hech qanday tekshiruvsiz.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 2) API so'rovlari — javob har doim JSON, hech qachon redirect emas.
  if (pathname.startsWith('/api/')) {
    const needsAdmin = requiresAdminApi(pathname, method);
    const needsWaiter = !needsAdmin && requiresWaiterApi(pathname, method);
    const needsStaff = !needsAdmin && !needsWaiter && requiresStaffApi(pathname, method);

    // Qolgan hamma narsa mehmon uchun ochiq qoladi: stolni aniqlash, menyu,
    // kategoriyalar, filiallar, restoran ma'lumoti, buyurtmalar (ro'yxat + yaratish),
    // buyurtma tarixi, realtime oqimi, rasm fayllari va ofitsiantni chaqirish (POST).
    if (!needsAdmin && !needsWaiter && !needsStaff) {
      return NextResponse.next();
    }

    const session = await resolveSession(req);
    if (!session) {
      return unauthorizedJson('Bu amal uchun tizimga kirish talab etiladi.');
    }

    let allowed: SessionRole[];
    if (needsAdmin) {
      allowed = ['ADMIN'];
    } else if (needsWaiter) {
      allowed = ['ADMIN', 'WAITER'];
    } else {
      allowed = ['ADMIN', 'WAITER', 'KITCHEN'];
    }
    if (!allowed.includes(session.role)) {
      return unauthorizedJson("Sizda bu amalni bajarish uchun ruxsat yo'q.");
    }

    return NextResponse.next();
  }

  // 3) Himoyalangan sahifalar.
  const rule = PAGE_RULES.find((r) => underSection(pathname, r.section));
  if (!rule) {
    return NextResponse.next();
  }

  const session = await resolveSession(req);
  if (!session) {
    return redirectToSignIn(req, rule.signInPath);
  }

  if (!rule.roles.includes(session.role)) {
    // Sessiya bor, lekin rol mos emas — o'z ish o'rniga qaytaramiz.
    const url = req.nextUrl.clone();
    url.pathname = landingPathFor(session.role);
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Statik fayllardan tashqari hamma narsa:
     * _next/static, _next/image, favicon va rasm/shrift fayllari chetlab o'tiladi.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|bmp|woff|woff2|ttf|otf|mp3|wav)$).*)',
  ],
};
