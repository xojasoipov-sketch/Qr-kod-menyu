import { NextResponse } from 'next/server';

import { isInsideActiveWindow } from '@/lib/keep-alive';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health — xizmat tirikligini bildiruvchi eng yengil endpoint.
 *
 * Keep-alive tsikli va tashqi uyg'otish signali shu manzilni chertadi: to'liq
 * sahifani yuklashdan ko'ra arzon, lekin Render uchun baribir haqiqiy tashrif
 * hisoblanadi. Ochiq qoldirilgan (middleware uni himoyalamaydi), chunki uni
 * chertuvchi tomonda hech qanday hisob ma'lumoti bo'lmaydi.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    keep_alive_window_active: isInsideActiveWindow(),
  });
}
