/**
 * Bildirishnoma yuborish qatlami (email / SMS / Telegram / konsol).
 *
 * DIQQAT — bu modul FAQAT server tomonida ishlaydi va provayder kalitlarini
 * `process.env` dan oladi. Arxitektura qoidasiga ko'ra ma'lumotlar bazasi
 * modulini FAQAT `src/app/api/**` route handler'laridan import qilish kerak —
 * shuning uchun bu modul bazaga bevosita murojaat qilmaydi: jurnalga yozish
 * (`logEntry`) va restoran nomini olish chaqiruvchidan (route handler'dan)
 * parametr sifatida uzatiladi.
 * Uni hech qachon 'use client' fayldan yoki komponentdan import qilmang —
 * faqat `src/app/api/**` ichidagi route handler'lardan chaqiring.
 *
 * Asosiy qoidalar:
 *  1. Bu yerdagi hech bir funksiya xato "otmaydi" (throw qilmaydi). Provayder
 *     ishlamasa ham xodim qo'shilishi kerak — xabar yuborish qo'shimcha amal.
 *  2. Har bir urinish berilgan `logEntry` callback orqali jurnalga yoziladi:
 *     'sent' (yuborildi), 'failed' (xato) yoki 'skipped' (sozlanmagan).
 *  3. Har bir tarmoq so'roviga 8 soniyalik muddat qo'yilgan — osilib qolgan
 *     provayder admin so'rovini ushlab turmasligi uchun.
 *  4. Hech qanday yangi npm paketi kerak emas — faqat `fetch`.
 *
 * Sozlamalar (hammasi ixtiyoriy; yo'q bo'lsa kanal 'skipped' bo'ladi):
 *   RESEND_API_KEY, NOTIFY_EMAIL_FROM          — email (Resend HTTP API)
 *   ESKIZ_EMAIL, ESKIZ_PASSWORD, ESKIZ_FROM    — SMS (Eskiz.uz)
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID       — Telegram bot
 *   NEXT_PUBLIC_APP_URL yoki APP_URL           — xabardagi havola uchun
 */

import type { NotificationLog, Staff, UserRole } from '@/types/database';

/** Chaqiruvchi (route handler) tomonidan uzatiladigan jurnalga yozish funksiyasi. */
export type NotificationLogger = (
  entry: Omit<NotificationLog, 'id' | 'created_at'>
) => Promise<NotificationLog> | NotificationLog;

/** `logEntry` berilmasa ishlatiladigan zaxira — faqat xotirada, bazaga yozmaydi. */
const fallbackLogger: NotificationLogger = (entry) => ({
  id: `ntf-local-${Date.now().toString(36)}`,
  created_at: new Date().toISOString(),
  ...entry,
});

export interface NotifyInput {
  email?: string;
  phone?: string;
  subject: string;
  body: string;
}

/** Bitta provayder so'rovi uchun maksimal kutish vaqti. */
const FETCH_TIMEOUT_MS = 8000;

/** Jurnaldagi xato matnining maksimal uzunligi. */
const MAX_ERROR_LENGTH = 300;

/** Eskiz sukut bo'yicha test alfa-nomi. */
const ESKIZ_DEFAULT_FROM = '4546';

/** Lavozimlarning o'zbekcha nomlari (xabar matni uchun). */
const ROLE_LABELS_UZ: Record<UserRole, string> = {
  SUPER_ADMIN: 'Bosh administrator',
  RESTAURANT_OWNER: 'Restoran egasi',
  MANAGER: 'Menejer',
  WAITER: 'Ofitsiant',
  KITCHEN: 'Oshxona xodimi',
};

// ==========================================
// KICHIK YORDAMCHILAR
// ==========================================

function env(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function shorten(text: string, max = MAX_ERROR_LENGTH): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

/** Muvaffaqiyatsiz HTTP javobini o'qiladigan xato matniga aylantiradi. */
async function describeFailure(res: Response): Promise<string> {
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    detail = '';
  }
  return shorten(`HTTP ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ''}`);
}

/** Tarmoq xatosini (shu jumladan timeout'ni) tushunarli matnga aylantiradi. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return `Provayder javob bermadi (${FETCH_TIMEOUT_MS / 1000} soniya kutildi).`;
    }
    return shorten(err.message || err.name);
  }
  return shorten(String(err));
}

/**
 * Jurnalga yozadi. Berilgan `logEntry` (odatda `db.logNotification`, chaqiruvchi
 * route handler orqali uzatiladi) ishlamay qolsa ham chaqiruvchi kod
 * to'xtamasligi uchun natija baribir qaytariladi.
 */
async function record(
  logEntry: NotificationLogger,
  entry: Omit<NotificationLog, 'id' | 'created_at'>
): Promise<NotificationLog> {
  try {
    return await logEntry(entry);
  } catch {
    return fallbackLogger(entry);
  }
}

// ==========================================
// KANAL: KONSOL (har doim ishlaydi)
// ==========================================

/**
 * Konsol kanali hech qachon o'chirilmaydi: hech bir provayder sozlanmagan
 * bo'lsa ham taklif "yo'qolib ketmasligi" kerak — u serverda ko'rinadi va
 * jurnalda saqlanadi.
 */
async function deliverConsole(input: NotifyInput, logEntry: NotificationLogger): Promise<NotificationLog> {
  const to = input.email || input.phone || 'server-console';
  try {
    console.info(`[BILDIRISHNOMA] ${to} | ${input.subject}\n${input.body}`);
  } catch {
    // Konsol ham ishlamasa, jurnal yozuvining o'zi yetarli.
  }
  return record(logEntry, {
    channel: 'console',
    to,
    subject: input.subject,
    body: input.body,
    status: 'sent',
  });
}

// ==========================================
// KANAL: EMAIL (Resend HTTP API)
// ==========================================

async function deliverEmail(input: NotifyInput, logEntry: NotificationLogger): Promise<NotificationLog> {
  const to = input.email || '';
  const base = {
    channel: 'email' as const,
    to: to || '-',
    subject: input.subject,
    body: input.body,
  };

  if (!to) {
    return record(logEntry, { ...base, status: 'skipped', error: "Elektron pochta manzili ko'rsatilmagan." });
  }

  const apiKey = env('RESEND_API_KEY');
  const from = env('NOTIFY_EMAIL_FROM');
  if (!apiKey || !from) {
    return record(logEntry, {
      ...base,
      status: 'skipped',
      error: "RESEND_API_KEY va NOTIFY_EMAIL_FROM sozlanmagan - email yuborilmadi.",
    });
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: input.subject,
        text: input.body,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return record(logEntry, { ...base, status: 'failed', error: await describeFailure(res) });
    }
    return record(logEntry, { ...base, status: 'sent' });
  } catch (err) {
    return record(logEntry, { ...base, status: 'failed', error: describeError(err) });
  }
}

// ==========================================
// KANAL: SMS (Eskiz.uz)
// ==========================================

interface EskizToken {
  token: string;
  /** Epoch-millisekund: shu vaqtdan keyin token qayta olinadi. */
  expiresAt: number;
}

/**
 * Token modul doirasida keshlanadi. `globalThis` ga osib qo'yamiz — shunda
 * `next dev` HMR paytida ham har bir SMS uchun qaytadan login qilinmaydi.
 */
const globalForEskiz = globalThis as unknown as { __eskizToken?: EskizToken | null };

/** Eskiz tokeni 30 kun yashaydi; biz ehtiyot uchun sutkada bir marta yangilaymiz. */
const ESKIZ_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

async function getEskizToken(
  email: string,
  password: string,
  forceRefresh = false
): Promise<string> {
  const cached = globalForEskiz.__eskizToken;
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const form = new FormData();
  form.append('email', email);
  form.append('password', password);

  const res = await fetch('https://notify.eskiz.uz/api/auth/login', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(await describeFailure(res));
  }

  const data = (await res.json()) as { data?: { token?: string } };
  const token = data?.data?.token;
  if (!token) {
    throw new Error('Eskiz tokeni qaytmadi.');
  }

  globalForEskiz.__eskizToken = { token, expiresAt: Date.now() + ESKIZ_TOKEN_TTL_MS };
  return token;
}

/**
 * Raqamni Eskiz kutadigan ko'rinishga keltiradi: faqat raqamlar, 998XXXXXXXXX.
 * Keltirib bo'lmasa `null` qaytaradi.
 */
function normalizeUzPhone(raw: string): string | null {
  let digits = String(raw ?? '').replace(/\D/g, '');
  digits = digits.replace(/^0+/, ''); // "0 90 ..." yoki "00998..." holatlari

  if (digits.length === 9) {
    digits = `998${digits}`;
  }

  return digits.length === 12 && digits.startsWith('998') ? digits : null;
}

function postEskizSms(
  token: string,
  mobilePhone: string,
  message: string,
  from: string
): Promise<Response> {
  const form = new FormData();
  form.append('mobile_phone', mobilePhone);
  form.append('message', message);
  form.append('from', from);

  return fetch('https://notify.eskiz.uz/api/message/sms/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function deliverSms(input: NotifyInput, logEntry: NotificationLogger): Promise<NotificationLog> {
  const rawPhone = input.phone || '';
  const base = {
    channel: 'sms' as const,
    to: rawPhone || '-',
    subject: input.subject,
    body: input.body,
  };

  if (!rawPhone) {
    return record(logEntry, { ...base, status: 'skipped', error: "Telefon raqami ko'rsatilmagan." });
  }

  const eskizEmail = env('ESKIZ_EMAIL');
  const eskizPassword = env('ESKIZ_PASSWORD');
  if (!eskizEmail || !eskizPassword) {
    return record(logEntry, {
      ...base,
      status: 'skipped',
      error: 'ESKIZ_EMAIL va ESKIZ_PASSWORD sozlanmagan - SMS yuborilmadi.',
    });
  }

  const mobilePhone = normalizeUzPhone(rawPhone);
  if (!mobilePhone) {
    return record(logEntry, {
      ...base,
      status: 'failed',
      error: `Telefon raqamini 998XXXXXXXXX ko'rinishiga keltirib bo'lmadi: ${shorten(rawPhone, 40)}`,
    });
  }

  const from = env('ESKIZ_FROM') || ESKIZ_DEFAULT_FROM;
  const withPhone = { ...base, to: mobilePhone };

  try {
    let token = await getEskizToken(eskizEmail, eskizPassword);
    let res = await postEskizSms(token, mobilePhone, input.body, from);

    // Keshlangan token eskirgan bo'lsa — bir marta yangilab, qayta urinamiz.
    if (res.status === 401 || res.status === 403) {
      token = await getEskizToken(eskizEmail, eskizPassword, true);
      res = await postEskizSms(token, mobilePhone, input.body, from);
    }

    if (!res.ok) {
      return record(logEntry, { ...withPhone, status: 'failed', error: await describeFailure(res) });
    }
    return record(logEntry, { ...withPhone, status: 'sent' });
  } catch (err) {
    return record(logEntry, { ...withPhone, status: 'failed', error: describeError(err) });
  }
}

// ==========================================
// KANAL: TELEGRAM
// ==========================================

async function deliverTelegram(input: NotifyInput, logEntry: NotificationLogger): Promise<NotificationLog> {
  const botToken = env('TELEGRAM_BOT_TOKEN');
  const chatId = env('TELEGRAM_CHAT_ID');
  const base = {
    channel: 'telegram' as const,
    to: chatId || '-',
    subject: input.subject,
    body: input.body,
  };

  if (!botToken || !chatId) {
    return record(logEntry, {
      ...base,
      status: 'skipped',
      error: 'TELEGRAM_BOT_TOKEN va TELEGRAM_CHAT_ID sozlanmagan - Telegram xabari yuborilmadi.',
    });
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${input.subject}\n\n${input.body}`,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return record(logEntry, { ...base, status: 'failed', error: await describeFailure(res) });
    }
    return record(logEntry, { ...base, status: 'sent' });
  } catch (err) {
    return record(logEntry, { ...base, status: 'failed', error: describeError(err) });
  }
}

// ==========================================
// OMMAVIY API
// ==========================================

/**
 * Xabarni barcha mavjud kanallar orqali yuboradi va har bir urinishning
 * jurnal yozuvini qaytaradi. Hech qachon xato otmaydi.
 *
 * Kanallar parallel ishlaydi — eng sekin provayder ham javobni 8 soniyadan
 * ortiq ushlab tura olmaydi.
 */
export async function sendNotification(
  input: NotifyInput,
  logEntry: NotificationLogger = fallbackLogger
): Promise<NotificationLog[]> {
  const normalized: NotifyInput = {
    email: input?.email?.trim() || undefined,
    phone: input?.phone?.trim() || undefined,
    subject: input?.subject?.trim() || 'Bildirishnoma',
    body: input?.body?.trim() || '',
  };

  const consoleLog = await deliverConsole(normalized, logEntry);

  try {
    const rest = await Promise.all([
      deliverEmail(normalized, logEntry),
      deliverSms(normalized, logEntry),
      deliverTelegram(normalized, logEntry),
    ]);
    return [consoleLog, ...rest];
  } catch (err) {
    // Bu yerga tushish deyarli imkonsiz (har bir adapter o'z xatosini yutadi),
    // lekin kafolat uchun: hech qachon otmaymiz.
    return [
      consoleLog,
      await record(logEntry, {
        channel: 'console',
        to: normalized.email || normalized.phone || 'server-console',
        subject: normalized.subject,
        body: normalized.body,
        status: 'failed',
        error: describeError(err),
      }),
    ];
  }
}

/** PIN sahifasining to'liq havolasi (agar manzil sozlangan bo'lsa). */
function pinPageLocation(): string {
  const base = env('NEXT_PUBLIC_APP_URL') || env('APP_URL');
  if (!base) return '/pin';
  return `${base.replace(/\/+$/, '')}/pin`;
}

/**
 * Yangi xodimga taklif xabarini yuboradi: restoran nomi, ismi, lavozimi,
 * 4 xonali PIN kodi va uni qayerga kiritish kerakligi.
 *
 * Matn ataylab qisqa — bitta SMS ga sig'adi.
 *
 * `restaurantName` va `logEntry` chaqiruvchi route handler tomonidan
 * uzatiladi (masalan, `db.getRestaurant(...)?.name` va
 * `db.logNotification`) — bu modul bazaga bevosita murojaat qilmaydi.
 */
export async function notifyStaffInvite(
  staff: Staff,
  restaurantName: string,
  logEntry: NotificationLogger = fallbackLogger
): Promise<NotificationLog[]> {
  const roleLabel = ROLE_LABELS_UZ[staff.role] || 'Xodim';
  const pin = staff.pin ? String(staff.pin).trim() : '';

  const subject = `${restaurantName} - tizimga kirish uchun PIN kod`;
  const body = pin
    ? `${restaurantName}: salom, ${staff.name}! Lavozim: ${roleLabel}. PIN kod: ${pin}. Kirish: ${pinPageLocation()}`
    : `${restaurantName}: salom, ${staff.name}! Lavozim: ${roleLabel}. PIN kodni administratordan oling. Kirish: ${pinPageLocation()}`;

  return sendNotification({ email: staff.email, phone: staff.phone, subject, body }, logEntry);
}
