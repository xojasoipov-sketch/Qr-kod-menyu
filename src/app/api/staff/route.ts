import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { notifyStaffInvite } from '@/lib/notify';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/security/rate-limit';
import type { NotificationLog, UserRole } from '@/types/database';

export const dynamic = 'force-dynamic';

/** Xodim qo'shish SMS/email sarflaydi — bir IP uchun soatiga 30 ta yetarli. */
const CREATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };

const VALID_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'RESTAURANT_OWNER',
  'MANAGER',
  'WAITER',
  'KITCHEN',
];

function isValidRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (VALID_ROLES as string[]).includes(value);
}

/** Juda qattiq emas, lekin "ism@joy.uz" shaklini talab qiladigan tekshiruv. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Telefon: faqat raqam, bo'sh joy, +, -, ( ) va 7-15 ta raqam. */
function looksLikePhone(value: string): boolean {
  if (!/^[\d\s()+-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const restaurantId = searchParams.get('restaurant_id') || 'rest-001';
  const staff = db.staff.filter((s) => s.restaurant_id === restaurantId);
  return NextResponse.json({ staff });
}

/**
 * POST /api/staff — yangi xodim qo'shadi va unga taklif xabarini yuboradi.
 *
 * Javob: `{ success, staff, deliveries }` — `deliveries` da har bir kanal
 * (konsol / email / SMS / Telegram) bo'yicha nima bo'lgani ko'rinadi, shunda
 * admin panel "SMS yuborildimi?" degan savolga aniq javob bera oladi.
 */
export async function POST(req: NextRequest) {
  const limitResult = rateLimit(`staff-create:${clientIp(req)}`, CREATE_LIMIT);
  if (!limitResult.allowed) {
    return tooManyRequests(
      limitResult,
      "Juda ko'p xodim qo'shildi. Iltimos, biroz kutib turing."
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid body');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return badRequest("Ma'lumotlar noto'g'ri yuborildi. Formani qaytadan to'ldiring.");
  }

  // --- Tekshiruvlar (xabarlar admin ko'radigan holatda) ---
  const name = text(body.name);
  if (!name) {
    return badRequest('Xodimning ism-familiyasini kiriting.');
  }

  const email = text(body.email).toLowerCase();
  if (!email) {
    return badRequest('Elektron pochta manzilini kiriting.');
  }
  if (!EMAIL_PATTERN.test(email)) {
    return badRequest("Elektron pochta manzili noto'g'ri. Masalan: ism@restoran.uz");
  }

  const role = body.role;
  if (!isValidRole(role)) {
    return badRequest(
      "Lavozimni tanlang: Restoran egasi, Menejer, Ofitsiant yoki Oshxona xodimi."
    );
  }

  const phone = text(body.phone);
  if (phone && !looksLikePhone(phone)) {
    return badRequest("Telefon raqami noto'g'ri. Masalan: +998 90 123 45 67");
  }

  const pin = text(body.pin);
  if (pin && !/^\d{4}$/.test(pin)) {
    return badRequest("PIN kod 4 ta raqamdan iborat bo'lishi kerak.");
  }

  const restaurantId = text(body.restaurant_id) || 'rest-001';
  const branchId = text(body.branch_id) || undefined;

  if (
    db.staff.some(
      (s) => s.restaurant_id === restaurantId && s.email.toLowerCase() === email
    )
  ) {
    return badRequest('Bu elektron pochta bilan xodim allaqachon mavjud.');
  }

  // --- Yaratish ---
  let created;
  try {
    created = db.createStaff({
      restaurant_id: restaurantId,
      branch_id: branchId,
      name,
      email,
      role,
      phone: phone || undefined,
      pin: pin || undefined,
    });
  } catch (err: unknown) {
    // Masalan: band PIN kod.
    const message = err instanceof Error ? err.message : "Xodimni qo'shib bo'lmadi.";
    return badRequest(message);
  }

  // --- Xabar berish ---
  // Xabar yuborish qo'shimcha amal: u muvaffaqiyatsiz bo'lsa ham xodim
  // yaratilgan, shuning uchun javob baribir 201 bo'ladi.
  let deliveries: NotificationLog[] = [];
  try {
    const restaurantName = db.getRestaurant(created.restaurant_id)?.name || 'Restoran';
    deliveries = await notifyStaffInvite(created, restaurantName, (entry) => db.logNotification(entry));
  } catch {
    deliveries = [];
  }

  return NextResponse.json({ success: true, staff: created, deliveries }, { status: 201 });
}
