/**
 * src/app/(auth)/login/page.tsx — staff sign-in.
 * Source: 05-app-structure.md §2.4, §4.5, §5.1; brief §16, §27, §32.
 *
 * A Server Component with an inline Server Action, and a plain `<form action>`,
 * which means sign-in works with JavaScript disabled and on the first paint —
 * before any bundle has arrived. There is no client state to get wrong: a
 * failure redirects back here with a code in the query string and the page
 * renders the matching localised message on the server.
 *
 * The credentials themselves never round-trip through the query string: only a
 * failure code, the submitted email (so nobody retypes it), and the sanitised
 * `next`. The password exists for the length of the action and nowhere else.
 *
 * Post-sign-in routing follows §4.5 exactly: compute the role's own landing path
 * FIRST, sanitise `?next=` against it, then accept that candidate only if the
 * role can actually open it. A stale or hostile `next` can therefore only ever
 * narrow the destination to somewhere the caller may already go.
 */

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { isPathReachable, landingPathFor, safeNextPath } from '@/lib/auth/guards';
import { loadStaffContext } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/env';
import { getServerTranslator } from '@/lib/i18n/get-dictionary';
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale';
import { createServerClient } from '@/lib/supabase/server';
import { emailSchema } from '@/lib/validation/common';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The failure codes this page can render. Nothing else is accepted from the URL. */
const LOGIN_ERROR_CODES = [
  'validation',
  'invalid_credentials',
  'no_membership',
  'unavailable',
] as const;
type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

const FIELDS = ['email', 'password'] as const;
type LoginField = (typeof FIELDS)[number];

/** Supabase Auth's own minimum. Longer passwords are welcome; shorter are refused. */
const PASSWORD_MIN = 8;

const signInSchema = z.object({
  email: emailSchema,
  // No strength rules on SIGN-IN: an existing password that predates a rule
  // change must still work. Strength belongs on the set-password screens.
  password: z.string().min(PASSWORD_MIN).max(200),
});

function firstParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const raw = params[key];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

function buildLoginUrl(params: {
  error: LoginErrorCode;
  field?: LoginField;
  email?: string;
  next?: string;
}): string {
  const search = new URLSearchParams({ error: params.error });
  if (params.field !== undefined) search.set('field', params.field);
  if (params.email !== undefined && params.email.length > 0) search.set('email', params.email);
  if (params.next !== undefined && params.next.length > 0) search.set('next', params.next);
  return `/login?${search.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* The Server Action                                                          */
/* -------------------------------------------------------------------------- */

async function signInAction(formData: FormData): Promise<void> {
  'use server';

  const rawEmail = String(formData.get('email') ?? '').trim().slice(0, 254);
  const rawPassword = String(formData.get('password') ?? '');
  // '' rather than the '/admin' default: "no next" must survive a round trip.
  const nextPath = safeNextPath(String(formData.get('next') ?? ''), '');

  const parsed = signInSchema.safeParse({ email: rawEmail, password: rawPassword });
  if (!parsed.success) {
    const field: LoginField = parsed.error.issues.some((issue) => issue.path[0] === 'email')
      ? 'email'
      : 'password';
    redirect(buildLoginUrl({ error: 'validation', field, email: rawEmail, next: nextPath }));
  }

  // Demo mode: no Supabase project, therefore no auth server. Say so rather than
  // throwing an unhandled configuration error at the diner-facing shell.
  if (!isSupabaseConfigured()) {
    redirect(buildLoginUrl({ error: 'unavailable', email: rawEmail, next: nextPath }));
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  // One message for "no such account" and for "wrong password", deliberately:
  // distinguishing them turns this form into an account-enumeration oracle.
  if (error !== null || data.user === null) {
    redirect(
      buildLoginUrl({ error: 'invalid_credentials', email: parsed.data.email, next: nextPath }),
    );
  }

  // The client is already authenticated in memory, so the context is loaded from
  // it directly rather than through the React-cached `getStaffContext()`, whose
  // entry for this request was populated before the credentials existed.
  const context = await loadStaffContext(supabase, data.user);
  if (context === null) {
    // Authenticated, but with no active membership in any active tenant. Leaving
    // the session in place would strand them on a screen they cannot use.
    await supabase.auth.signOut();
    redirect(buildLoginUrl({ error: 'no_membership' }));
  }

  const landing = landingPathFor(context);
  const candidate = safeNextPath(nextPath, landing);
  redirect(isPathReachable(context, candidate) ? candidate : landing);
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [locale, params] = await Promise.all([resolveRequestLocale(), searchParams]);
  const t = getServerTranslator(locale);

  const rawError = firstParam(params, 'error');
  const errorCode = LOGIN_ERROR_CODES.find((code) => code === rawError) ?? null;
  const rawField = firstParam(params, 'field');
  const field = FIELDS.find((name) => name === rawField) ?? null;
  const submittedEmail = firstParam(params, 'email') ?? '';
  const nextPath = safeNextPath(firstParam(params, 'next'), '');

  const emailError =
    errorCode === 'validation' && field === 'email' ? t('errors.validation.email') : undefined;
  const passwordError =
    errorCode === 'validation' && field === 'password'
      ? t('errors.validation.tooShort', { min: PASSWORD_MIN })
      : undefined;

  /*
   * Form-level alerts. `invalid_credentials` has no dedicated catalogue string
   * yet — `auth.errors.invalidCredentials` is reported as a missing key — so it
   * borrows the closest existing pair rather than hard-coding English here.
   */
  const alert =
    errorCode === 'invalid_credentials'
      ? { title: t('errors.generic.title'), description: t('errors.app.VALIDATION_FAILED') }
      : errorCode === 'no_membership'
        ? { title: t('auth.staffOnly.title'), description: t('auth.staffOnly.body') }
        : errorCode === 'unavailable'
          ? { title: t('errors.generic.serverTitle'), description: t('errors.generic.serverBody') }
          : null;

  return (
    <Card padding="lg" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-display-sm text-text">{t('auth.signInTitle')}</h1>
        <p className="text-body-sm text-text-muted text-pretty">{t('auth.signInSubtitle')}</p>
      </div>

      {alert !== null && (
        // live: this is the answer to something the visitor just did (§9.5).
        <ErrorState size="sm" live title={alert.title} description={alert.description} />
      )}

      <form action={signInAction} className="flex flex-col gap-4">
        {nextPath.length > 0 && <input type="hidden" name="next" value={nextPath} />}

        <Input
          label={t('auth.email')}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          defaultValue={submittedEmail}
          placeholder={t('auth.emailPlaceholder')}
          error={emailError}
          announceError
        />

        <Input
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={PASSWORD_MIN}
          placeholder={t('auth.passwordPlaceholder')}
          error={passwordError}
          announceError
        />

        <Button type="submit" variant="primary" size="lg" fullWidth>
          {t('auth.signIn')}
        </Button>
      </form>

      <p className="border-t border-border-subtle pt-4 text-caption text-text-subtle text-pretty">
        {t('auth.staffOnly.body')}
      </p>
    </Card>
  );
}
