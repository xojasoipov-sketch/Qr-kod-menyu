import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ success: true });
  // Bo'sh qiymat + maxAge 0 => brauzer cookie'ni darhol o'chiradi.
  res.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  return res;
}
