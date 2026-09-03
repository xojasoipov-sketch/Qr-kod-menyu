/**
 * Oddiy, tashqi kutubxonasiz "sliding window" so'rov cheklovchisi.
 *
 * Holat `globalThis` ga osib qo'yilgan (event-bus.ts dagi kabi), shuning uchun
 * `next dev` HMR paytida ham cheklov hisoblari yo'qolmaydi.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface RateLimitBucket {
  /** Oynadagi so'rovlarning epoch-millisekund vaqtlari (o'sish tartibida). */
  hits: number[];
  /** Ushbu kalitni qachon butunlay o'chirsa bo'ladi. */
  expiresAt: number;
}

const globalForRateLimit = globalThis as unknown as {
  __rateLimitBuckets?: Map<string, RateLimitBucket>;
};

const buckets: Map<string, RateLimitBucket> =
  globalForRateLimit.__rateLimitBuckets ||
  (globalForRateLimit.__rateLimitBuckets = new Map<string, RateLimitBucket>());

/** Muddati o'tgan kalitlarni tozalaydi — map cheksiz o'smasligi uchun. */
function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) {
      buckets.delete(key);
    }
  }
}

/**
 * Berilgan kalit uchun so'rovni hisobga oladi va ruxsat bor-yo'qligini qaytaradi.
 *
 * @param key  Cheklov kaliti, masalan `order:${ip}` yoki `login:${ip}`.
 * @param opts `limit` — oynadagi maksimal so'rovlar soni, `windowMs` — oyna uzunligi (ms).
 */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const limit = Math.max(1, Math.floor(opts.limit));
  const windowMs = Math.max(1, Math.floor(opts.windowMs));

  // Har murojaatda eskirgan yozuvlarni tozalaymiz.
  pruneExpired(now);

  const windowStart = now - windowMs;
  const bucket = buckets.get(key) || { hits: [], expiresAt: now + windowMs };

  // Oynadan chiqib ketgan urinishlarni tashlab yuboramiz.
  let firstFresh = 0;
  while (firstFresh < bucket.hits.length && bucket.hits[firstFresh] <= windowStart) {
    firstFresh++;
  }
  if (firstFresh > 0) {
    bucket.hits = bucket.hits.slice(firstFresh);
  }

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    const retryAfterMs = Math.max(0, oldest + windowMs - now);
    bucket.expiresAt = now + windowMs;
    buckets.set(key, bucket);

    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  bucket.hits.push(now);
  bucket.expiresAt = now + windowMs;
  buckets.set(key, bucket);

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - bucket.hits.length),
    retryAfterSeconds: 0,
  };
}

/**
 * So'rov jo'natgan mijozning IP manzilini aniqlaydi:
 * `x-forwarded-for` ning birinchi manzili, so'ng `x-real-ip`, aks holda 'unknown'.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const firstHop = forwarded.split(',')[0]?.trim();
    if (firstHop) return firstHop;
  }

  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return 'unknown';
}

export const RATE_LIMIT_MESSAGE_UZ =
  "Juda ko'p so'rov yuborildi. Iltimos, biroz kutib turing.";

/** Cheklovga tushgan so'rov uchun 429 javobi (Retry-After sarlavhasi bilan). */
export function tooManyRequests(result: RateLimitResult, message?: string): Response {
  const retryAfter = Math.max(1, result.retryAfterSeconds || 1);

  return new Response(
    JSON.stringify({ error: message || RATE_LIMIT_MESSAGE_UZ }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
      },
    }
  );
}
