/**
 * src/middleware.ts — session refresh, surface selection, locale promotion, coarse gate.
 * Source: 05-app-structure.md §4.1–§4.3; 04-design-system.md §0 amendment 1 and C-1.
 *
 * FOUR THINGS HAPPEN HERE, IN THIS ORDER, AND THE ORDER MATTERS.
 *
 *  1. `@supabase/ssr` revalidates the access token with `getUser()` and, when it
 *     rotates, hands back new cookies through `setAll`.
 *  2. Those cookies are written back onto the *request* so the RSC render in this
 *     same pass reads the fresh token rather than the expired one it arrived with.
 *  3. The outgoing response is built from the mutated request headers, plus the
 *     `x-qros-surface` header the root layout turns into `<html data-surface>`.
 *  4. The rotated cookies are written onto whatever response actually leaves —
 *     including a redirect.
 *
 * THE THREE MISTAKES THIS FILE IS WRITTEN TO AVOID, all of which show up as
 * intermittent logouts mid-shift rather than as a reproducible bug:
 *
 *  - Returning a response object other than the one the rotated cookies were
 *    written onto. The refresh token is then silently dropped.
 *  - Calling `auth.getSession()` instead of `auth.getUser()`. `getSession()`
 *    decodes the cookie without asking the auth server, so in middleware it is a
 *    forgeable identity — and it never triggers the rotation step 1 depends on.
 *  - Doing real authorization here. Middleware sees a JWT, never the `staff`
 *    table; membership is read live from the database by design (doc 02 §8.1).
 *    The gate below is a redirect convenience. RLS is the boundary.
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { isSupabaseConfigured, requireSupabasePublicConfig } from '@/lib/env';
import { LOCALE_COOKIE, isLocale } from '@/lib/i18n/config';
import { localeCookieOptions } from '@/lib/i18n/resolve-locale';
import type { Database } from '@/types/database';

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static files. Route handlers ARE
     * matched on purpose: they need the refreshed session cookie too, and
     * /api/admin/** must not be reachable with a stale token.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|robots.txt|sitemap.xml|brand/|demo/|.*\\.(?:png|jpg|jpeg|webp|avif|svg|ico|woff2|txt|xml)$).*)',
  ],
};

/** The header the root layout reads to write `<html data-surface>`. */
const SURFACE_HEADER = 'x-qros-surface';

/**
 * Path → design-system surface (04 §1, §3.4).
 *
 * DELIBERATE DEVIATION from doc 04 §3.6's table, which sends `/` and `/login` to
 * `admin` (light). Both are the product's front door and the brief's visual
 * reference for them is explicit — "dark, warm, cinematic fine-dining" — so they
 * are served on the `customer` surface, which is the dark-committed, gold-forward,
 * generously-spaced personality the landing page and the sign-in card are drawn
 * for. No token is added or changed to achieve it; only this mapping differs.
 */
function surfaceFor(pathname: string): 'customer' | 'kitchen' | 'admin' {
  if (pathname === '/' || pathname.startsWith('/t/')) return 'customer';
  if (pathname === '/login' || pathname.startsWith('/login/')) return 'customer';
  if (pathname === '/forgot-password' || pathname === '/reset-password') return 'customer';
  if (pathname === '/accept-invite' || pathname === '/auth-error' || pathname === '/mfa') {
    return 'customer';
  }
  if (pathname === '/kitchen' || pathname.startsWith('/kitchen/')) return 'kitchen';
  if (pathname === '/waiter' || pathname.startsWith('/waiter/')) return 'kitchen';
  return 'admin';
}

/**
 * Public paths, exhaustively. Everything not listed here requires a session.
 *
 * Deny-by-default is the point: a route added later is protected until somebody
 * deliberately opens it, rather than open until somebody remembers to close it.
 * `/t/**` is public *and unauthenticated by design* — the anon role holds no table
 * privileges at all, so those routes reach the database only through the
 * capability RPCs in `@/lib/rpc/public`.
 */
function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname.startsWith('/t/')) return true;
  if (pathname.startsWith('/api/public/')) return true;
  if (pathname === '/api/health') return true;
  // The auth family must be reachable while signed out, or nobody can sign in.
  if (pathname.startsWith('/api/auth/')) return true;
  if (
    pathname === '/login' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname === '/accept-invite' ||
    pathname === '/auth-error'
  ) {
    return true;
  }
  // Marketing and legal copy, owned by other slices but public by definition.
  if (pathname === '/demo' || pathname.startsWith('/legal/')) return true;
  return false;
}

interface PendingCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const surface = surfaceFor(pathname);

  /* --------------------------------------------------------------------- */
  /* 1 + 2. Refresh the session. Cookies land on the request first.         */
  /* --------------------------------------------------------------------- */

  const pendingCookies: PendingCookie[] = [];
  let user: { id: string } | null = null;

  // Demo mode: no Supabase project is configured, so there is no auth server to
  // talk to and nothing to refresh. Staff surfaces are simply unreachable.
  if (isSupabaseConfigured()) {
    const { url, anonKey } = requireSupabasePublicConfig();

    const supabase = createServerClient<Database>(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            // (a) visible to the rest of THIS pass — NextRequest's cookie jar
            //     writes through to the request headers, which step 3 snapshots.
            request.cookies.set(name, value);
            // (b) queued for whichever response ends up leaving.
            pendingCookies.push({ name, value, options });
          }
        },
      },
    });

    // MUST be getUser(). Nothing may run between createServerClient() and here.
    const { data } = await supabase.auth.getUser();
    user = data.user;
  }

  /* --------------------------------------------------------------------- */
  /* 3. Build the response from the request as it now stands.               */
  /* --------------------------------------------------------------------- */

  // Snapshotted AFTER the cookie writes above, so the downstream render sees the
  // rotated access token instead of the expired one the browser sent.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(SURFACE_HEADER, surface);

  /** Attach the rotated auth cookies to any response that leaves this function. */
  const withSessionCookies = (response: NextResponse): NextResponse => {
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options);
    }

    // `?lang=ru` on any URL: validate, persist, and let the request through
    // unchanged. The parameter is NOT stripped, so a poster printed with it keeps
    // working and sharing that URL keeps its language (doc 05 §4.6).
    const lang = request.nextUrl.searchParams.get('lang');
    if (isLocale(lang) && request.cookies.get(LOCALE_COOKIE)?.value !== lang) {
      response.cookies.set(LOCALE_COOKIE, lang, localeCookieOptions());
    }

    return response;
  };

  /* --------------------------------------------------------------------- */
  /* 4. The coarse gate. UX only — every route below re-authorizes.         */
  /* --------------------------------------------------------------------- */

  if (user === null && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return withSessionCookies(NextResponse.redirect(url));
  }

  /*
   * A signed-in staff member sitting on /login is NOT redirected from here.
   * Middleware can read a JWT but not the `staff` table, so it cannot tell a
   * KITCHEN member from an owner, and guessing sends half of them to a screen
   * they immediately bounce off. `(auth)/layout.tsx` does it correctly, one
   * database read later, with `landingPathFor()`.
   */

  return withSessionCookies(NextResponse.next({ request: { headers: requestHeaders } }));
}
