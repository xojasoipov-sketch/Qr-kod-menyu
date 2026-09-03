import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/store';
import { getSession } from '@/lib/auth/session';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

/** Ruxsat etilgan rasm turlari (menyu taomlari uchun). */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

type AllowedType = (typeof ALLOWED_TYPES)[number];

/** Maksimal fayl hajmi: 3 MB. */
const MAX_SIZE_BYTES = 3 * 1024 * 1024;
const MAX_SIZE_LABEL = '3 MB';

/** Bir IP uchun soatiga nechta rasm yuklash mumkin. */
const UPLOAD_LIMIT_PER_HOUR = 20;

/**
 * Fayl boshidagi "sehrli baytlar" orqali haqiqiy rasm turini aniqlaydi.
 * Brauzer yuborgan `content-type` ni ishonchli deb bo'lmaydi — uni istalgan
 * odam o'zgartira oladi, shuning uchun baytlarning o'zini tekshiramiz.
 */
function detectImageType(bytes: Buffer): AllowedType | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // GIF: "GIF8" (GIF87a / GIF89a)
  if (bytes.length >= 6 && bytes.toString('ascii', 0, 4) === 'GIF8') {
    return 'image/gif';
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

/** `image/JPEG; charset=x` kabi qiymatlarni sof MIME turiga keltiradi. */
function normalizeContentType(raw: string): string {
  return raw.split(';')[0].trim().toLowerCase();
}

function isAllowedType(value: string): value is AllowedType {
  return (ALLOWED_TYPES as readonly string[]).includes(value);
}

/**
 * POST /api/uploads — menyu uchun rasm yuklash.
 *
 * `multipart/form-data`, maydon nomi: `file`.
 * Javobdagi `url` ni `menu_items.image_url` ga saqlash mumkin.
 */
export async function POST(req: NextRequest) {
  // 1) Spamdan himoya: bir IP uchun soatiga 20 ta yuklash.
  const ip = clientIp(req);
  const limit = rateLimit(`upload:ip:${ip}`, {
    limit: UPLOAD_LIMIT_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) {
    return tooManyRequests(
      limit,
      "Juda ko'p rasm yuklandi. Iltimos, biroz kutib turing."
    );
  }

  // 2) Himoyaning ikkinchi qatlami: middleware dan tashqari bu yerda ham
  //    sessiyani tekshiramiz — faqat administrator rasm yuklay oladi.
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Rasm yuklash uchun administrator sifatida kiring.' },
      { status: 401 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Fayl yuborilmadi. Iltimos, rasmni qaytadan tanlang." },
      { status: 400 }
    );
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json(
      { error: "Rasm topilmadi. \"file\" maydonida fayl yuboring." },
      { status: 400 }
    );
  }

  // 3) E'lon qilingan turni tekshiramiz.
  const declaredType = normalizeContentType(file.type || '');
  if (!isAllowedType(declaredType)) {
    return NextResponse.json(
      {
        error:
          "Faqat JPEG, PNG, WEBP yoki GIF formatidagi rasmlar qabul qilinadi.",
      },
      { status: 415 }
    );
  }

  // 4) Hajmni baytlarni o'qishdan oldin tekshiramiz.
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Rasm hajmi ${MAX_SIZE_LABEL} dan oshmasligi kerak.` },
      { status: 413 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  if (bytes.length === 0) {
    return NextResponse.json({ error: "Fayl bo'sh." }, { status: 400 });
  }

  if (bytes.length > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Rasm hajmi ${MAX_SIZE_LABEL} dan oshmasligi kerak.` },
      { status: 413 }
    );
  }

  // 5) Haqiqiy baytlar e'lon qilingan turga mos kelishi shart.
  const realType = detectImageType(bytes);
  if (!realType || realType !== declaredType) {
    return NextResponse.json(
      { error: 'Fayl haqiqiy rasm emas yoki formati mos kelmadi.' },
      { status: 415 }
    );
  }

  const record = await db.saveUpload(bytes, realType);

  return NextResponse.json(
    {
      success: true,
      url: `/api/uploads/${record.id}`,
      id: record.id,
      size: record.size,
      content_type: record.content_type,
    },
    { status: 201 }
  );
}
