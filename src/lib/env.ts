/**
 * Environment contract.
 *
 * Read every variable through this module. A missing or malformed value fails
 * loudly here, at first access, rather than surfacing later as an
 * `undefined` in a URL or a silently unauthenticated Supabase client.
 *
 * DEMO MODE: with no Supabase variables set the app serves the in-repo fixture
 * restaurant instead of a database. That is a deliberate, visible state — see
 * `isDemoMode()` — not a fallback that hides a misconfiguration. Setting SOME
 * but not ALL of the Supabase variables is a misconfiguration, and is treated
 * as one.
 */
import { z } from 'zod'

import { LOCALES, DEFAULT_LOCALE } from '@/types/i18n'

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20).optional(),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(LOCALES).default(DEFAULT_LOCALE),
})

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when each is
 * referenced as a full static property access. Destructuring `process.env`
 * would leave these undefined in the browser bundle, so they are spelled out.
 */
const rawPublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
}

const parsedPublic = publicEnvSchema.safeParse(rawPublicEnv)

if (!parsedPublic.success) {
  throw new Error(
    `Invalid public environment:\n${z.prettifyError(parsedPublic.error)}\n` +
      'See .env.example for the full contract.',
  )
}

export const publicEnv = parsedPublic.data

/**
 * True when Supabase is configured. Both variables are required together: a URL
 * with no key, or a key with no URL, is a broken deployment rather than a
 * request to run the demo.
 */
export function isSupabaseConfigured(): boolean {
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL
  const key = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url && key) return true
  if (!url && !key) return false
  throw new Error(
    'Supabase is half-configured: set BOTH NEXT_PUBLIC_SUPABASE_URL and ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY, or neither (which runs the app in demo mode).',
  )
}

/** The app serves fixture data. Every surface that can show data must label this. */
export function isDemoMode(): boolean {
  return !isSupabaseConfigured()
}

/**
 * The Supabase URL and anon key, asserted present. Call only after
 * `isSupabaseConfigured()` — the throw here means a code path forgot to check.
 */
export function requireSupabasePublicConfig(): { url: string; anonKey: string } {
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'Supabase client requested while the app is in demo mode. Guard the call ' +
        'with isSupabaseConfigured() and serve the demo fixture instead.',
    )
  }
  return { url, anonKey }
}

/**
 * Server-only secrets. Reading this from a Client Component is a build error
 * because every caller is in a module that starts with `import 'server-only'`.
 */
export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key || key.length < 20) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is missing. It is required for administrative ' +
        'operations that must bypass RLS, and must never be exposed to the browser.',
    )
  }
  return key
}

/** Absolute origin used to build QR payloads. Never a relative path. */
export function appUrl(): string {
  return publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')
}
