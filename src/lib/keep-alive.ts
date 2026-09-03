/**
 * Ish vaqtida serverni uyg'oq tutish (keep-alive).
 *
 * MUAMMO: Render'ning bepul tarifi 15 daqiqa davomida hech qanday so'rov
 * kelmasa xizmatni "uxlatib" qo'yadi. Uyqudan keyingi birinchi so'rov 20-40
 * soniya kutadi — mijoz stolda o'tirib QR kodni skanerlaganda bu juda uzoq,
 * ko'pchilik "ishlamayapti" deb o'ylab, telefonini yopadi.
 *
 * YECHIM: ish vaqti oralig'ida server o'zining ochiq manziliga har 10 daqiqada
 * bitta yengil so'rov yuboradi. So'rov tashqi manzil orqali (DNS -> CDN ->
 * Render) qaytib kelgani uchun Render buni haqiqiy tashrif deb hisoblaydi va
 * uyqu taymeri qaytadan boshlanadi.
 *
 * NIMA UCHUN FAQAT ISH VAQTIDA: bepul tarifda oylik soat chegarasi bor
 * (~750 soat). Kechasi uxlab turgani zaxira soatlarni tejaydi, ya'ni xizmat
 * oy oxirida to'satdan o'chib qolmaydi. Kechqurun oxirgi chertishdan keyin
 * server o'zi uxlab qoladi; ertalab uni tashqi uyg'otish signali turg'izadi
 * (server uxlab yotganda o'zini uyg'ota olmaydi — bu jismoniy cheklov).
 */

/** Toshkent vaqti = UTC+5 (yozgi/qishki o'zgarish yo'q). */
const TASHKENT_UTC_OFFSET_HOURS = 5;

/** Ish vaqti: 09:00 dan 00:00 gacha (Toshkent). */
const WINDOW_START_LOCAL_HOUR = 9;
const WINDOW_END_LOCAL_HOUR = 24;

/** Render 15 daqiqada uxlatadi — 10 daqiqa xavfsiz oraliq qoldiradi. */
const DEFAULT_PING_INTERVAL_MS = 10 * 60 * 1000;

/** Birinchi chertish: server so'rov qabul qilishga ulgursin. */
const FIRST_PING_DELAY_MS = 15_000;

/** Chertish javobini cheksiz kutmaymiz. */
const PING_TIMEOUT_MS = 20_000;

/** Bir jarayonda ikki marta ishga tushmasligi uchun (Next.js qayta yuklashi). */
const globalForKeepAlive = globalThis as unknown as { __keepAliveStarted?: boolean };

/** UTC soatini Toshkent soatiga aylantiradi. */
function tashkentHour(now: Date): number {
  return (now.getUTCHours() + TASHKENT_UTC_OFFSET_HOURS) % 24;
}

/** Hozir ish vaqti oralig'idamizmi? */
export function isInsideActiveWindow(now: Date = new Date()): boolean {
  const hour = tashkentHour(now);
  return hour >= WINDOW_START_LOCAL_HOUR && hour < WINDOW_END_LOCAL_HOUR;
}

async function ping(url: string): Promise<void> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      headers: { 'user-agent': 'keep-alive-internal' },
    });
    // Javob kodi muhim emas — muhimi so'rov Render'ga yetib bordi.
    void res.status;
  } catch {
    // Tarmoq uzilishi keyingi urinishda o'z-o'zidan tuzaladi; jurnalda
    // shovqin qilmaymiz.
  }
}

/**
 * Keep-alive tsiklini boshlaydi. Faqat Render'da (RENDER_EXTERNAL_URL bor
 * joyda) ishlaydi — lokal ishlab chiqishda va boshqa muhitlarda jim turadi.
 */
export function startKeepAlive(): void {
  if (globalForKeepAlive.__keepAliveStarted) return;

  const baseUrl = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!baseUrl) return;

  globalForKeepAlive.__keepAliveStarted = true;
  const target = `${baseUrl.replace(/\/$/, '')}/api/health`;

  // Oraliqni sozlash mumkin (ops uchun), lekin Render'ning 15 daqiqalik
  // chegarasidan oshib ketmasin.
  const configured = Number(process.env.KEEP_ALIVE_INTERVAL_MS);
  const intervalMs =
    Number.isFinite(configured) && configured >= 1000 && configured <= 14 * 60 * 1000
      ? configured
      : DEFAULT_PING_INTERVAL_MS;

  console.log(
    `[keep-alive] ${WINDOW_START_LOCAL_HOUR}:00–24:00 (Toshkent) oralig'ida ` +
      `har ${Math.round(intervalMs / 1000)} soniyada ${target} chertiladi.`
  );

  const tick = () => {
    if (!isInsideActiveWindow()) return;
    void ping(target);
  };

  // Birinchi chertish biroz kechiktiriladi — server tinglashni boshlasin.
  // Oraliqning o'zi shu kechikishdan qisqa bo'lsa, alohida birinchi chertish
  // kerak emas: interval baribir tezroq ishga tushadi (aks holda ikkitasi
  // ustma-ust tushib, bir vaqtda ikki marta chertilardi).
  if (intervalMs > FIRST_PING_DELAY_MS) {
    const firstTimer = setTimeout(tick, FIRST_PING_DELAY_MS);
    firstTimer.unref?.();
  }

  const timer = setInterval(tick, intervalMs);
  // Jarayon to'xtayotganda bu taymerlar uni ushlab turmasin.
  timer.unref?.();
}
