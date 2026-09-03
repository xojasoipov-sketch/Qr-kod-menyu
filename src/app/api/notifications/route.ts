import { NextResponse } from 'next/server';
import { db } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications — yuborilgan bildirishnomalar jurnali.
 *
 * Eng yangisi birinchi, oxirgi 50 ta yozuv. Har bir yozuvda kanal
 * (konsol / email / SMS / Telegram), kimga, holati ('sent' | 'failed' |
 * 'skipped') va xato sababi ko'rinadi.
 *
 * Jurnalda PIN kodlar ham uchraydi — shuning uchun bu yo'l middleware
 * tomonidan faqat ADMIN uchun ochiq.
 */
export async function GET() {
  return NextResponse.json({ notifications: db.getNotifications(50) });
}
