/**
 * Holatsiz (stateless) imzolangan sessiya cookie'si.
 *
 * MUHIM: bu modul `src/middleware.ts` ichida ham ishlatiladi, ya'ni EDGE runtime'da
 * bajariladi. Shu sababli faqat Web Crypto (`crypto.subtle`) ishlatilgan —
 * `node:crypto` bu yerda mavjud emas. `next/headers` esa faqat server
 * komponentlari va route handler'lar uchun kerak bo'lgani sababli, u sekin
 * (lazy) `import()` orqali, faqat `getSession()` chaqirilganda yuklanadi.
 *
 * Token formati:  base64url(JSON payload) + "." + base64url(HMAC-SHA256 imzo)
 */

import type { SessionRole } from '@/types/database';

export const SESSION_COOKIE = 'flavoria_session';

/** Admin smenasi bir ish kunidan uzun bo'lmasin. */
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 soat

/** "Ofitsiant bir marta kiradi" — xodim sessiyasi 30 kun yashaydi. */
export const STAFF_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 kun

export interface SessionData {
  role: SessionRole;
  staffId?: string;
  name: string;
  /** Amal qilish muddati — epoch soniyalarda. */
  exp: number;
}

const VALID_ROLES: readonly SessionRole[] = ['ADMIN', 'WAITER', 'KITCHEN'];

// ==========================================
// MAXFIY KALIT
// ==========================================

const globalForAuth = globalThis as unknown as {
  __authFallbackSecret?: string;
  __authSecretWarned?: boolean;
  __authKeyCache?: { secret: string; key: CryptoKey };
};

/** `AUTH_SECRET` muhit o'zgaruvchisi to'g'ri sozlanganmi? */
export function hasConfiguredSecret(): boolean {
  return readConfiguredSecret() !== null;
}

function readConfiguredSecret(): string | null {
  const raw = typeof process !== 'undefined' ? process.env?.AUTH_SECRET : undefined;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Imzo kaliti. `AUTH_SECRET` berilmagan bo'lsa — jarayon (process) ichida
 * tasodifiy kalit hosil qilinadi. Kodga "zaxira" maxfiy kalit YOZILMAYDI.
 */
function getSecret(): string {
  const configured = readConfiguredSecret();
  if (configured) return configured;

  if (!globalForAuth.__authFallbackSecret) {
    const random = new Uint8Array(32);
    crypto.getRandomValues(random);
    globalForAuth.__authFallbackSecret = bytesToBase64Url(random);
  }

  if (!globalForAuth.__authSecretWarned) {
    globalForAuth.__authSecretWarned = true;
    console.warn(
      '\n[AUTH] DIQQAT: AUTH_SECRET muhit o\'zgaruvchisi sozlanmagan.\n' +
        '[AUTH] Vaqtinchalik tasodifiy kalit ishlatilmoqda — server qayta ishga tushsa,\n' +
        '[AUTH] barcha sessiyalar bekor bo\'ladi va foydalanuvchilar qaytadan kirishi kerak.\n' +
        '[AUTH] Ishlab chiqarish uchun .env fayliga AUTH_SECRET=<uzun tasodifiy satr> qo\'shing.\n'
    );
  }

  return globalForAuth.__authFallbackSecret;
}

async function getSigningKey(): Promise<CryptoKey> {
  const secret = getSecret();
  const cached = globalForAuth.__authKeyCache;
  if (cached && cached.secret === secret) return cached.key;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  globalForAuth.__authKeyCache = { secret, key };
  return key;
}

// ==========================================
// BASE64URL YORDAMCHILARI (Edge'da ham ishlaydi)
// ==========================================

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToString(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

// ==========================================
// IMZO
// ==========================================

async function sign(payload: string): Promise<string> {
  const key = await getSigningKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

/** Vaqt bo'yicha sizib chiqmaydigan (constant-time-ish) satr taqqoslash. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);

  // Uzunliklar farq qilsa ham bir xil hajmdagi ish bajariladi.
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

// ==========================================
// TOKEN HOSIL QILISH / TEKSHIRISH
// ==========================================

export async function createSessionToken(
  data: Omit<SessionData, 'exp'>,
  ttlSeconds: number
): Promise<string> {
  const ttl = Math.max(60, Math.floor(ttlSeconds));
  const payload: SessionData = {
    role: data.role,
    name: data.name,
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  if (data.staffId) payload.staffId = data.staffId;

  const encodedPayload = stringToBase64Url(JSON.stringify(payload));
  const signature = await sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined
): Promise<SessionData | null> {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  // 1) Imzo haqiqiyligi.
  const expected = await sign(encodedPayload);
  if (!constantTimeEquals(expected, signature)) return null;

  // 2) Foydali yuk (payload) o'qiladi.
  const json = base64UrlToString(encodedPayload);
  if (!json) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const candidate = parsed as Partial<SessionData>;

  if (typeof candidate.role !== 'string' || !VALID_ROLES.includes(candidate.role as SessionRole)) {
    return null;
  }
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) return null;
  if (typeof candidate.exp !== 'number' || !Number.isFinite(candidate.exp)) return null;

  // 3) Muddati o'tganmi?
  if (candidate.exp <= Math.floor(Date.now() / 1000)) return null;

  return {
    role: candidate.role as SessionRole,
    name: candidate.name,
    exp: candidate.exp,
    ...(typeof candidate.staffId === 'string' && candidate.staffId
      ? { staffId: candidate.staffId }
      : {}),
  };
}

// ==========================================
// SERVER TOMONIDAGI YORDAMCHILAR
// ==========================================

/**
 * Joriy sessiyani cookie'dan o'qiydi (route handler / server komponentlar uchun).
 * `next/headers` sekin import qilinadi — modul Edge middleware'ga ham kiradi.
 */
export async function getSession(): Promise<SessionData | null> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Sessiya mavjud va ruxsat etilgan rollardan biri bo'lsa — sessiyani qaytaradi. */
export async function requireRole(roles: SessionRole[]): Promise<SessionData | null> {
  const session = await getSession();
  if (!session) return null;
  if (!roles.includes(session.role)) return null;
  return session;
}

/** Muvaffaqiyatli kirishdan keyin har bir rol tushadigan sahifa. */
export function landingPathFor(role: SessionRole): string {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    case 'KITCHEN':
      return '/kitchen';
    case 'WAITER':
    default:
      return '/waiter';
  }
}

/** Rol bo'yicha sessiya muddati. */
export function sessionTtlFor(role: SessionRole): number {
  return role === 'ADMIN' ? ADMIN_SESSION_TTL_SECONDS : STAFF_SESSION_TTL_SECONDS;
}

export function sessionCookieOptions(maxAgeSeconds: number): {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}
