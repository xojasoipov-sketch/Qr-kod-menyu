/**
 * src/lib/fonts.ts — the three type families, loaded once.
 * Source: docs/architecture/04-design-system.md §4.1–4.2.
 *
 * The product is trilingual: Uzbek Latin, Russian Cyrillic, English. Uzbek Latin
 * needs the modifier letters `ʻ` (U+02BB) and `ʼ` (U+02BC) for `oʻ` and `gʻ`;
 * Russian needs a real Cyrillic cut, not a synthesised one. Any family that cannot
 * render all three scripts is disqualified, however beautiful — which is why every
 * loader below requests the `cyrillic` subset explicitly.
 *
 * Three rules that are not optional:
 *
 * 1. `next/font/google` SELF-HOSTS. It downloads the WOFF2 at build time and serves
 *    it from /_next/static/media/*, which is what makes it compatible with the CSP
 *    in 02-security-and-rls.md §8.3 (`font-src 'self'`, no external origin).
 *    Never add a <link rel="stylesheet" href="https://fonts.googleapis.com/…">;
 *    it will be blocked and the page will silently fall back. (Contract C-3.)
 * 2. `adjustFontFallback: true` on all three. It emits a metric-matched local
 *    fallback face so the pre-swap paint has the same line box, which keeps CLS at
 *    0 on a cold 3G scan. The human-readable fallback stacks that sit behind that
 *    face are declared once, on `--font-display` / `--font-sans` / `--font-mono`
 *    in src/app/globals.css §2.2 — not here.
 * 3. All three variables are applied ONCE, on <html> in the single root layout
 *    (`<html className={fontVariables}>`, contract C-2). A nested layout cannot
 *    render <html>, and must not re-apply them.
 *
 * The KDS therefore *has* Playfair and JetBrains Mono available but never uses
 * them, so their WOFF2 files are never fetched: next/font emits a @font-face per
 * family and the browser downloads a face only when a glyph needs it. Contract
 * C-12 keeps it that way.
 */

import { Inter, JetBrains_Mono, Playfair_Display } from 'next/font/google'

/**
 * Display — Playfair Display. A high-contrast transitional serif with a full
 * Cyrillic cut and real optical presence at 26 px and up; its thick/thin
 * modulation is what reads as *fine dining* rather than *restaurant template*.
 *
 * Weights are pinned to 500 and 600 on purpose: Playfair 700, tracked loose and
 * centred, is the template signature that §4.3 T4 forbids. Italic is loaded for
 * the one editorial case the customer surface allows (a quoted chef's note).
 */
export const displayFont = Playfair_Display({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-playfair-var',
  adjustFontFallback: true,
})

/**
 * UI — Inter. The correct engineering answer for the KDS: the tightest legible
 * letterforms at two metres, a true tabular-figure feature (`tnum`, exposed as
 * `.u-tnum`) for money and timers, and a Cyrillic cut drawn by the same designer
 * as the Latin, so `Стол 12` and `Table 12` have identical colour.
 */
export const sansFont = Inter({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter-var',
  adjustFontFallback: true,
})

/**
 * Mono — JetBrains Mono. Machine strings only: `qr_token`, `public_code`,
 * `order_number` in admin detail views, uuid tails. Its disambiguated `0/O` and
 * `1/l/I` matter when a manager reads a token aloud over the phone.
 */
export const monoFont = JetBrains_Mono({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains-var',
  adjustFontFallback: true,
})

/**
 * The className applied to <html> by the single root layout
 * (05-app-structure.md §2.1, contract C-2). It declares all three CSS variables;
 * globals.css binds them to `--font-display`, `--font-sans` and `--font-mono`.
 */
export const fontVariables = `${sansFont.variable} ${displayFont.variable} ${monoFont.variable}`
