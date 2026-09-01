# 04 — Design System

**Status:** normative. This document is the single source of truth for every visual decision in
Restaurant QR OS. Where it disagrees with an implementer's instinct, this document wins.
Where it disagrees with `docs/BRIEF.md`, the brief wins and this document is a bug.

**Companions:** `01-database-schema.md` (data contracts), `02-security-and-rls.md` (CSP, Storage,
route shapes).

**Contents.** §0 division of authority with `05-app-structure.md` · §1 the governing idea ·
§2 the `@theme` token block · §3 semantic layer and theming · §4 typography · §5 iconography · §6 component inventory · §7 motion · §8 anti-slop rules ·
§9 accessibility · §10 the `DishArtwork` imagery system · §11 file manifest ·
§12 contracts, open risks and the review checklist.

**Frozen stack this document is written against:** Next.js 16.3 App Router · React 19.2 ·
TypeScript strict · **Tailwind CSS v4.3.3, CSS-first (`@import "tailwindcss"` + `@theme` in
`src/app/globals.css`; there is no `tailwind.config.js` and one must never be added)** ·
`lucide-react` 1.38 for icons · `clsx` + `tailwind-merge` for class composition · `zod` 4 ·
Supabase.

**Dependency reality check — read before you reach for a library.** `package.json` contains **no**
Radix UI, no Headless UI, no `class-variance-authority`, no `framer-motion`, no `sonner`, no
`shadcn/ui`. **Do not add any of them.** Every overlay in this system is built on the native
`<dialog>` element, every variant map is a plain `Record<Variant, string>` object, and every
animation is CSS or the Web Animations API. This is a deliberate constraint: it is what keeps the
customer bundle small enough to open in under a second on a 3G phone at a restaurant table, and it
is what stops the product inheriting the default shadcn silhouette that §8 forbids.

---

## 0. Division of authority with `05-app-structure.md`

Both documents are normative and they do not overlap. Where a reader could think they do:

| Question | Authority |
|---|---|
| Token names, colour values, type scale, radius, shadow, motion curves, utilities | **this document** |
| Component props, variants, states, ARIA, visual composition | **this document** |
| File paths, file naming (kebab-case), route groups, Server/Client split, runtime and caching directives | **`05-app-structure.md`** |
| Which provider wraps what, middleware, Server Actions, data fetching | **`05-app-structure.md`** |

Every component path in §6 and §11 has been written in `05-app-structure.md`'s tree and naming.
Where this document requires something 05 does not yet contain, the entry is marked **(new file)**
and 05's tree should be extended, not forked. Seven such files exist: `ui/status-pill.tsx`,
`ui/drawer.tsx`, `ui/segmented-control.tsx`, `customer/featured-card.tsx`, and the three artwork
components `common/dish-artwork.tsx`, `common/dish-image.tsx`, `common/logo-artwork.tsx`.

Three concrete amendments this document requires of `05-app-structure.md` §2.1:

1. **`<html>` must carry `data-surface`.** Only the root layout may render `<html>` in the App
   Router, so a nested layout cannot set it. `src/middleware.ts` sets a request header
   `x-qros-surface` from the pathname (`/t/**` → `customer`, `/kitchen`, `/waiter` → `kitchen`,
   `/admin/**` → `admin`, everything else → `admin`), and the root layout — which already awaits
   `headers()` for locale — reads it and writes the attribute. See C-1.
2. **The root layout's `<body>` classes are `min-h-dvh bg-surface text-text antialiased`.**
   05 §2.1's snippet writes `bg-surface-base text-ink`; those token names do not exist in §3.2 and
   would compile to nothing.
3. **`<html className>` uses `fontVariables` from `src/lib/fonts.ts`** (all three families), and
   `viewport.themeColor` follows §3.6 rather than the single `#0B0B0C` entry in 05's snippet.

---

## 1. The governing idea

> **Three surfaces. Three personalities. One token system.**

| | CUSTOMER | KITCHEN (KDS) | ADMIN |
|---|---|---|---|
| Device | phone, one-handed, 360–430 px | tablet, landscape, 1024–1366 px, viewed from **~2 m** | desktop, 1280–1920 px |
| Feeling | warm, editorial, appetising, cinematic | glanceable, urgent, mechanical | calm, dense, professional |
| Ground | committed dark | committed dark, light escape hatch | light-first, full dark mode |
| Display type | Playfair Display serif, large | Inter, enormous, never serif | Inter, modest |
| Colour role | gold = brand, wine = depth | **colour means status and nothing else** | neutral + one accent, status semantic |
| Ornament | gold hairlines, grain, scrims | **zero** | one hairline rule per page header |
| Density | generous (20–28 px gutters) | huge (min tap 64 px) | tight (12–16 px gutters) |
| Motion | expressive, spring | one pulse on arrival, otherwise none | functional, ≤ 200 ms |
| Radius | 5 px cards / 12 px media | 3 px, everything | 4 px |

**The three personalities do not come from three palettes.** They come from **type scale, spacing
rhythm, radius, ornament density and motion budget**. The colour ramps are shared, byte for byte.
That is why one `@theme` block can serve all three without any surface looking like the others.

Surfaces are selected by a `data-surface` attribute on `<html>`, written by the **single root
layout** (`src/app/layout.tsx`) from the `x-qros-surface` request header that `src/middleware.ts`
derives from the pathname — see §0 amendment 1. A nested layout cannot render `<html>`, so this is
the only place it can be set:

| Path prefix | `x-qros-surface` → `<html data-surface>` | `<html data-theme>` |
|---|---|---|
| `/t/**` (customer) | `customer` | not written — the customer surface is dark-committed and §3.3 reaches the dark mapping through `data-surface` alone |
| `/kitchen`, `/waiter` | `kitchen` | `dark` (default) or `light`, from the device-scoped `localStorage['qros:kds:theme']` |
| `/admin/**` | `admin` | always a concrete `light` or `dark`, written before first paint by the theme script of §3.5 from the `qros:theme` preference (`light` \| `dark` \| `system`) |
| `/`, `/login`, `/demo`, `/legal/**`, 404, 500 | `admin` | absent — falls through to the `:root` light mapping, which is deliberate |

---

## 2. `@theme` — the complete token block

This is the literal, paste-ready contents of `src/app/globals.css` down to the semantic layer.
Every hex comment below was generated by converting the oklch value to sRGB; they are exact, not
approximations. **oklch is the source of truth**; the hex is documentation for designers and for
the two places (`<meta name="theme-color">`, QR PNG generation) that need a hex string.

```css
/* ────────────────────────────────────────────────────────────────────────────
   src/app/globals.css — Restaurant QR OS design system
   Tailwind CSS v4, CSS-first. There is no tailwind.config.js.
   ──────────────────────────────────────────────────────────────────────────── */

@import "tailwindcss";

/* `dark:` follows our explicit attribute, not the OS, because the customer app is
   dark-committed and must never be flipped by a phone's OS setting.
   The OS preference is honoured for admin only, in §3's base layer. */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* Surface variants — for the handful of primitives that genuinely differ per surface
   (Button padding, Card radius). Prefer semantic tokens over these variants. */
@custom-variant customer (&:where([data-surface="customer"], [data-surface="customer"] *));
@custom-variant kds      (&:where([data-surface="kitchen"],  [data-surface="kitchen"] *));
@custom-variant admin    (&:where([data-surface="admin"],    [data-surface="admin"] *));

@theme {
  /* ══════════════════════════════════════════════════════════════════════════
     1. COLOUR RAMPS — the only place a colour literal may appear.
        Nothing else in the codebase writes a hex, rgb(), hsl() or oklch() value.
     ══════════════════════════════════════════════════════════════════════════ */

  /* Tailwind's stock palette is removed. A `bg-slate-700` or `text-blue-500`
     anywhere in this codebase is a build error, which is exactly what we want. */
  --color-*: initial;

  --color-black: #000000;   /* only for `--overlay-scrim` alpha mixes and QR modules */
  --color-white: #ffffff;   /* only for the QR quiet zone. Never a UI ground. */
  --color-transparent: transparent;
  --color-current: currentColor;

  /* ── ink — warm near-neutral. Hue drifts 80° → 60° as it darkens so the deep
        end reads as candle-lit charcoal, not as blue-black. Carries every ground,
        every hairline and every piece of body copy on all three surfaces. ── */
  --color-ink-25:  oklch(0.987 0.003 80);  /* #fcfbf8 */
  --color-ink-50:  oklch(0.972 0.004 80);  /* #f7f5f3 */
  --color-ink-100: oklch(0.945 0.006 80);  /* #efece8 */
  --color-ink-200: oklch(0.900 0.008 78);  /* #e1ddd8 */
  --color-ink-300: oklch(0.830 0.010 76);  /* #cbc6c0 */
  --color-ink-400: oklch(0.730 0.011 74);  /* #aca7a0 */
  --color-ink-500: oklch(0.620 0.012 72);  /* #8b857e */
  --color-ink-600: oklch(0.505 0.012 70);  /* #69645d */
  --color-ink-700: oklch(0.395 0.011 68);  /* #4a4540 */
  --color-ink-800: oklch(0.295 0.010 66);  /* #302c27 */
  --color-ink-850: oklch(0.245 0.009 66);  /* #23201c */
  --color-ink-900: oklch(0.195 0.008 64);  /* #181411 */
  --color-ink-950: oklch(0.152 0.007 62);  /* #0e0b09 */
  --color-ink-975: oklch(0.124 0.006 60);  /* #080605 */

  /* ── gold — the warm brass accent. Peak chroma sits at 500, which is the fill
        colour of the customer primary button. 700–950 are the "bronze" end used
        on light grounds where a bright gold would fail contrast. ── */
  --color-gold-50:  oklch(0.975 0.020 88);  /* #fcf6e8 */
  --color-gold-100: oklch(0.940 0.042 88);  /* #f7eacc */
  --color-gold-200: oklch(0.890 0.068 88);  /* #eed9a8 */
  --color-gold-300: oklch(0.845 0.094 87);  /* #e7c983 */
  --color-gold-400: oklch(0.800 0.114 86);  /* #deb862 */
  --color-gold-500: oklch(0.758 0.128 85);  /* #d6a944 */
  --color-gold-600: oklch(0.690 0.124 82);  /* #c19331 */
  --color-gold-700: oklch(0.590 0.110 78);  /* #a17422 */
  --color-gold-800: oklch(0.470 0.090 74);  /* #795215 */
  --color-gold-900: oklch(0.360 0.068 70);  /* #54360e */
  --color-gold-950: oklch(0.255 0.046 68);  /* #311e07 */

  /* ── wine — the deep secondary. Sets the mood behind hero imagery, fills the
        admin primary button (where gold cannot reach 4.5:1 on a light ground),
        and tints the "featured" and "promotion" surfaces. ── */
  --color-wine-50:  oklch(0.960 0.016 18);  /* #fdeeee */
  --color-wine-100: oklch(0.915 0.034 18);  /* #f9dada */
  --color-wine-200: oklch(0.845 0.060 17);  /* #f1bdbe */
  --color-wine-300: oklch(0.755 0.088 16);  /* #e2999c */
  --color-wine-400: oklch(0.640 0.112 15);  /* #c76e76 */
  --color-wine-500: oklch(0.530 0.128 14);  /* #a84755 */
  --color-wine-600: oklch(0.448 0.118 13);  /* #893342 */
  --color-wine-700: oklch(0.372 0.100 12);  /* #6b2532 */
  --color-wine-800: oklch(0.300 0.080 12);  /* #4e1923 */
  --color-wine-900: oklch(0.238 0.060 12);  /* #361017 */
  --color-wine-950: oklch(0.182 0.042 12);  /* #21090d */

  /* ── success — herb green. Order ready, item available, saved. ── */
  --color-success-100: oklch(0.935 0.040 152); /* #d7f2dd */
  --color-success-300: oklch(0.860 0.090 152); /* #a5e3b4 */
  --color-success-400: oklch(0.800 0.120 152); /* #7fd497 */
  --color-success-500: oklch(0.700 0.140 152); /* #4fb772 */
  --color-success-600: oklch(0.585 0.132 152); /* #2e9153 */
  --color-success-700: oklch(0.480 0.112 152); /* #1c6f3c */
  --color-success-800: oklch(0.385 0.090 152); /* #12512a */
  --color-success-900: oklch(0.270 0.058 152); /* #0b2e18 */

  /* ── warning — saffron. Late ticket, low stock, unsaved changes. ── */
  --color-warning-100: oklch(0.945 0.046 80); /* #fdeacb */
  --color-warning-300: oklch(0.890 0.100 79); /* #ffd38e */
  --color-warning-400: oklch(0.845 0.130 78); /* #fbc162 */
  --color-warning-500: oklch(0.775 0.150 75); /* #eda62e */
  --color-warning-600: oklch(0.680 0.148 68); /* #d38406 */
  --color-warning-700: oklch(0.560 0.128 62); /* #a86003 */
  --color-warning-800: oklch(0.450 0.095 64); /* #79480e */
  --color-warning-900: oklch(0.300 0.060 68); /* #412706 */

  /* ── danger — chilli. Cancelled, destructive, validation failure. ── */
  --color-danger-100: oklch(0.935 0.032 25); /* #ffe2df */
  --color-danger-300: oklch(0.830 0.090 26); /* #fdb1a9 */
  --color-danger-400: oklch(0.720 0.150 27); /* #f47c70 */
  --color-danger-500: oklch(0.620 0.190 27); /* #e24942 */
  --color-danger-600: oklch(0.545 0.200 27); /* #cb2526 */
  --color-danger-700: oklch(0.470 0.175 27); /* #a71a1b */
  --color-danger-800: oklch(0.375 0.140 27); /* #7b1011 */
  --color-danger-900: oklch(0.270 0.085 25); /* #48100f */

  /* ── info — muted slate-teal. Deliberately NOT the #4F46E5 SaaS indigo that
        §8.1 bans. Used for "preparing", neutral notices and the KDS middle lane. ── */
  --color-info-100: oklch(0.935 0.026 228); /* #d9edf7 */
  --color-info-300: oklch(0.845 0.055 226); /* #a7d4e8 */
  --color-info-400: oklch(0.760 0.075 225); /* #7bbcd5 */
  --color-info-500: oklch(0.660 0.090 228); /* #509dbe */
  --color-info-600: oklch(0.560 0.095 232); /* #2d7ea2 */
  --color-info-700: oklch(0.470 0.088 234); /* #196284 */
  --color-info-800: oklch(0.380 0.075 234); /* #094864 */
  --color-info-900: oklch(0.265 0.048 232); /* #062938 */

  /* ══════════════════════════════════════════════════════════════════════════
     2. TYPOGRAPHY
     ══════════════════════════════════════════════════════════════════════════ */

  /* The three `--font-*-var` variables are injected by next/font/google in
     src/app/layout.tsx (see §4). Fallbacks are metric-adjacent so the pre-swap
     paint does not shift layout. */
  --font-display: var(--font-playfair-var), "Iowan Old Style", "Palatino Linotype",
                  Georgia, "Times New Roman", serif;
  --font-sans:    var(--font-inter-var), ui-sans-serif, system-ui, -apple-system,
                  "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  --font-mono:    var(--font-jetbrains-var), ui-monospace, "SF Mono", "Cascadia Mono",
                  Menlo, Consolas, monospace;

  /* ── Customer type scale (mobile-first, 16 px root) ── */
  --text-display-xl: 2.5rem;    /* 40px */
  --text-display-xl--line-height: 1.04;
  --text-display-xl--letter-spacing: -0.026em;
  --text-display-xl--font-weight: 500;

  --text-display-lg: 2rem;      /* 32px */
  --text-display-lg--line-height: 1.10;
  --text-display-lg--letter-spacing: -0.022em;
  --text-display-lg--font-weight: 500;

  --text-display-md: 1.625rem;  /* 26px */
  --text-display-md--line-height: 1.16;
  --text-display-md--letter-spacing: -0.018em;
  --text-display-md--font-weight: 500;

  --text-display-sm: 1.3125rem; /* 21px */
  --text-display-sm--line-height: 1.22;
  --text-display-sm--letter-spacing: -0.012em;
  --text-display-sm--font-weight: 500;

  --text-title: 1.0625rem;      /* 17px — dish name on a MenuItemCard, serif */
  --text-title--line-height: 1.28;
  --text-title--letter-spacing: -0.008em;
  --text-title--font-weight: 500;

  --text-body-lg: 1.0625rem;    /* 17px */
  --text-body-lg--line-height: 1.52;
  --text-body-lg--letter-spacing: -0.002em;

  --text-body: 0.9375rem;       /* 15px */
  --text-body--line-height: 1.56;
  --text-body--letter-spacing: 0em;

  --text-body-sm: 0.84375rem;   /* 13.5px */
  --text-body-sm--line-height: 1.50;
  --text-body-sm--letter-spacing: 0.002em;

  --text-caption: 0.75rem;      /* 12px */
  --text-caption--line-height: 1.40;
  --text-caption--letter-spacing: 0.012em;

  --text-overline: 0.6875rem;   /* 11px — "POPULAR", "UZBEK CUISINE" */
  --text-overline--line-height: 1.18;
  --text-overline--letter-spacing: 0.15em;
  --text-overline--font-weight: 600;

  --text-price: 1.0625rem;      /* 17px, tabular */
  --text-price--line-height: 1.0;
  --text-price--letter-spacing: -0.006em;
  --text-price--font-weight: 600;

  --text-price-lg: 1.5rem;      /* 24px — cart total, product detail */
  --text-price-lg--line-height: 1.0;
  --text-price-lg--letter-spacing: -0.014em;
  --text-price-lg--font-weight: 600;

  /* ── Kitchen type scale. Sized for a 10.5" tablet read at 2 m. Every value here
        is at least 1.6× its customer counterpart. Never serif. ── */
  --text-kds-hero: 4rem;        /* 64px — table number */
  --text-kds-hero--line-height: 1.0;
  --text-kds-hero--letter-spacing: -0.028em;
  --text-kds-hero--font-weight: 700;

  --text-kds-xl: 2.75rem;       /* 44px — order number */
  --text-kds-xl--line-height: 1.04;
  --text-kds-xl--letter-spacing: -0.022em;
  --text-kds-xl--font-weight: 700;

  --text-kds-lg: 1.875rem;      /* 30px — line item name */
  --text-kds-lg--line-height: 1.18;
  --text-kds-lg--letter-spacing: -0.012em;
  --text-kds-lg--font-weight: 600;

  --text-kds-md: 1.5rem;        /* 24px — quantity, elapsed timer */
  --text-kds-md--line-height: 1.24;
  --text-kds-md--letter-spacing: -0.006em;
  --text-kds-md--font-weight: 600;

  --text-kds-sm: 1.125rem;      /* 18px — customer note */
  --text-kds-sm--line-height: 1.34;
  --text-kds-sm--letter-spacing: 0em;
  --text-kds-sm--font-weight: 500;

  --text-kds-label: 0.9375rem;  /* 15px — lane headers, "TABLE", "NOTE" */
  --text-kds-label--line-height: 1.2;
  --text-kds-label--letter-spacing: 0.11em;
  --text-kds-label--font-weight: 700;

  /* ── Admin type scale (14 px base, dense) ── */
  --text-admin-display: 1.5rem;   /* 24px — page title */
  --text-admin-display--line-height: 1.24;
  --text-admin-display--letter-spacing: -0.014em;
  --text-admin-display--font-weight: 600;

  --text-admin-h2: 1.125rem;      /* 18px */
  --text-admin-h2--line-height: 1.34;
  --text-admin-h2--letter-spacing: -0.008em;
  --text-admin-h2--font-weight: 600;

  --text-admin-h3: 0.9375rem;     /* 15px */
  --text-admin-h3--line-height: 1.40;
  --text-admin-h3--letter-spacing: -0.002em;
  --text-admin-h3--font-weight: 600;

  --text-admin-body: 0.84375rem;  /* 13.5px */
  --text-admin-body--line-height: 1.50;
  --text-admin-body--letter-spacing: 0.002em;

  --text-admin-sm: 0.78125rem;    /* 12.5px */
  --text-admin-sm--line-height: 1.44;
  --text-admin-sm--letter-spacing: 0.004em;

  --text-admin-xs: 0.71875rem;    /* 11.5px — table column headers */
  --text-admin-xs--line-height: 1.36;
  --text-admin-xs--letter-spacing: 0.06em;
  --text-admin-xs--font-weight: 600;

  --text-admin-metric: 1.75rem;   /* 28px — StatCard value, tabular */
  --text-admin-metric--line-height: 1.06;
  --text-admin-metric--letter-spacing: -0.020em;
  --text-admin-metric--font-weight: 600;

  --text-admin-mono: 0.75rem;     /* 12px — qr_token, public_code, uuid tails */
  --text-admin-mono--line-height: 1.40;
  --text-admin-mono--letter-spacing: 0em;

  /* Named tracking, for the cases where a utility needs it independently */
  --tracking-tightest: -0.026em;
  --tracking-tighter:  -0.018em;
  --tracking-tight:    -0.010em;
  --tracking-normal:    0em;
  --tracking-wide:      0.05em;
  --tracking-wider:     0.11em;
  --tracking-widest:    0.15em;

  --leading-flat:    1.0;
  --leading-snug:    1.20;
  --leading-normal:  1.50;
  --leading-relaxed: 1.62;

  /* ══════════════════════════════════════════════════════════════════════════
     3. GEOMETRY
     ══════════════════════════════════════════════════════════════════════════ */

  /* Tailwind's spacing multiplier. p-4 = 16px, gap-3 = 12px, and so on. */
  --spacing: 0.25rem;

  /* Radius scale. Deliberately small: see §8.2. Anything above --radius-lg is
     reserved for exactly one component each, named in the comment. */
  --radius-none: 0px;
  --radius-xs:   2px;
  --radius-sm:   3px;
  --radius-base: 4px;
  --radius-md:   5px;
  --radius-lg:   8px;
  --radius-xl:   12px;   /* media wells on the customer surface, only */
  --radius-2xl:  20px;   /* BottomSheet top corners, only */
  --radius-full: 9999px; /* pills, avatars, QuantityStepper track, only */

  /* Shadow scale. Two layers maximum, ever. On dark grounds shadows are all but
     invisible, so elevation there is carried by --elevated + --border (§3.4). */
  --shadow-none:    none;
  --shadow-sm:      0 1px 2px -1px oklch(0.152 0.007 62 / 0.10);
  --shadow-md:      0 2px 6px -2px oklch(0.152 0.007 62 / 0.12),
                    0 1px 2px -1px oklch(0.152 0.007 62 / 0.08);
  --shadow-lg:      0 10px 28px -10px oklch(0.152 0.007 62 / 0.20);
  --shadow-overlay: 0 24px 64px -16px oklch(0.124 0.006 60 / 0.62);
  --inset-shadow-hairline: inset 0 1px 0 0 oklch(1 0 0 / 0.045);

  /* Layout rhythm. These are not the spacing scale — they are the four gutter
     values and the sticky-chrome heights that every page must agree on. */
  --space-gutter-sm: 1.25rem;  /* 20px — customer phone */
  --space-gutter-md: 1.75rem;  /* 28px — tablet */
  --space-gutter-lg: 2rem;     /* 32px — admin desktop */
  --space-section-sm: 2rem;    /* 32px — between customer menu sections */
  --space-section-md: 3rem;    /* 48px */
  --space-section-lg: 4.5rem;  /* 72px — welcome hero breathing room */
  --space-header-h: 3.5rem;    /* 56px — customer sticky header */
  --space-rail-h: 3rem;        /* 48px — CategoryRail */
  --space-cartbar-h: 4rem;     /* 64px — CartBar */
  --space-safe-bottom: calc(var(--space-cartbar-h) + env(safe-area-inset-bottom, 0px) + 0.75rem);
  --space-admin-sidebar-w: 15rem;         /* 240px */
  --space-admin-sidebar-w-collapsed: 3.75rem; /* 60px */
  --space-admin-topbar-h: 3.25rem;        /* 52px */
  --space-kds-lane-gap: 1rem;             /* 16px */

  /* Content measures — enforce them, do not eyeball line length. */
  --measure-prose: 62ch;
  --measure-narrow: 44ch;
  --container-customer: 30rem;  /* 480px — the customer app never gets wider */

  /* Z-index. Native <dialog> promotes Dialog/Sheet/Drawer to the browser's top
     layer, so those tokens exist only for the non-modal fallbacks and for
     ordering the scrims of nested non-dialog overlays. */
  --z-base: 0;
  --z-raised: 10;
  --z-sticky: 100;
  --z-rail: 110;
  --z-cartbar: 200;
  --z-sheet-scrim: 300;
  --z-sheet: 310;
  --z-dialog-scrim: 400;
  --z-dialog: 410;
  --z-toast: 500;
  --z-kds-alert: 600;
  --z-tooltip: 700;
  --z-skip-link: 900;

  /* ══════════════════════════════════════════════════════════════════════════
     4. MOTION
     ══════════════════════════════════════════════════════════════════════════ */

  --ease-standard:   cubic-bezier(0.2, 0, 0, 1);
  --ease-entrance:   cubic-bezier(0.16, 1, 0.3, 1);   /* out-expo */
  --ease-exit:       cubic-bezier(0.4, 0, 1, 1);      /* in-quad */
  --ease-out-quart:  cubic-bezier(0.25, 1, 0.5, 1);
  --ease-in-out:     cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring:     cubic-bezier(0.34, 1.56, 0.64, 1);   /* visible overshoot */
  --ease-spring-soft: cubic-bezier(0.22, 1.18, 0.36, 1);  /* ~4% overshoot */

  --duration-instant: 80ms;
  --duration-fast:    140ms;
  --duration-base:    220ms;
  --duration-slow:    320ms;
  --duration-slower:  480ms;
  --duration-deliberate: 700ms;

  /* Named keyframe animations. Registered here so that `animate-shimmer`,
     `animate-pulse-ring` and the rest exist as utilities; the @keyframes
     themselves are declared in §7.6. */
  --animate-shimmer:     shimmer 1.4s linear infinite;
  --animate-pulse-ring:  pulse-ring 900ms var(--ease-out-quart) 2;
  --animate-badge-bump:  badge-bump 260ms var(--ease-spring) 1;
  --animate-sheet-in:    sheet-in 340ms var(--ease-spring-soft) 1;
  --animate-dialog-in:   dialog-in 220ms var(--ease-entrance) 1;
  --animate-toast-in:    toast-in 260ms var(--ease-spring-soft) 1;
  --animate-late-blink:  late-blink 1.6s var(--ease-in-out) infinite;
  --animate-step-breath: step-breath 2s var(--ease-out-quart) infinite;

  /* ══════════════════════════════════════════════════════════════════════════
     5. TEXTURE
     ══════════════════════════════════════════════════════════════════════════ */

  /* A 128×128 tiling film-grain plate. Generated once at build time by
     src/lib/art/grain.ts (§10.4) and inlined as a data: URI, which the CSP in
     02-security-and-rls.md §8.3 permits under `img-src 'self' data: blob:`.
     Applied only by the `.u-grain` utility (§7.7), only on the customer surface,
     only over photography and hero grounds. Never over text. */
  --texture-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='128' height='128' filter='url(%23g)' opacity='0.5'/%3E%3C/svg%3E");
  --texture-grain-opacity: 0.055;

  /* Scrims. Any cream text sitting over artwork or photography sits over one of
     these, never over the bare image — see §10.5. */
  --scrim-image-bottom: linear-gradient(to top,
      oklch(0.124 0.006 60 / 0.94) 0%,
      oklch(0.124 0.006 60 / 0.62) 34%,
      oklch(0.124 0.006 60 / 0.14) 62%,
      transparent 84%);
  --scrim-image-flat: oklch(0.124 0.006 60 / 0.42);
}
```

---

## 3. The semantic layer, and how theming works without duplicating colours

### 3.1 The rule

**A colour literal is written exactly once, in the ramps of §2.** Everything downstream is a
*mapping*. A theme is not a second palette; it is a different set of arrows from the same ramps to
the same semantic names. When the brand's gold changes, it changes in one line and every surface,
both themes, follows.

There are therefore three layers, and only three:

```
  RAMP            --color-gold-500          (a literal — one per colour, defined once)
      ↓ mapped per surface/theme in @layer base
  SEMANTIC        --accent-strong           (a var() reference — never a literal)
      ↓ registered as a utility namespace in @theme inline
  UTILITY         bg-accent-strong          (what components actually write)
```

`@theme inline` is what makes layer 3 work. A normal `@theme` entry bakes its value into the
generated utility; `inline` makes the utility emit `var(--accent-strong)` instead, so the utility
re-resolves whenever a `data-theme` or `data-surface` boundary changes the mapping. **Every
semantic colour token must live in `@theme inline`. A semantic colour placed in a plain `@theme`
block is a bug that will not theme.**

### 3.2 Registering the semantic namespace

```css
/* Continues src/app/globals.css, immediately after the @theme block of §2. */

@theme inline {
  /* grounds */
  --color-surface:        var(--surface);
  --color-surface-sunken: var(--surface-sunken);
  --color-elevated:       var(--elevated);
  --color-elevated-2:     var(--elevated-2);
  --color-scrim:          var(--scrim);

  /* lines */
  --color-border:        var(--border);
  --color-border-subtle: var(--border-subtle);
  --color-border-strong: var(--border-strong);
  --color-rule-gold:     var(--rule-gold);

  /* text */
  --color-text:          var(--text);
  --color-text-muted:    var(--text-muted);
  --color-text-subtle:   var(--text-subtle);
  --color-text-disabled: var(--text-disabled);
  --color-text-inverse:  var(--text-inverse);

  /* brand */
  --color-accent:          var(--accent);
  --color-accent-strong:   var(--accent-strong);
  --color-accent-contrast: var(--accent-contrast);
  --color-accent-soft:     var(--accent-soft);
  --color-accent-line:     var(--accent-line);
  --color-accent-ring:     var(--accent-ring);
  --color-wine:            var(--wine);
  --color-wine-strong:     var(--wine-strong);
  --color-wine-soft:       var(--wine-soft);

  /* status — four families, four slots each */
  --color-success:          var(--success);
  --color-success-soft:     var(--success-soft);
  --color-success-line:     var(--success-line);
  --color-success-contrast: var(--success-contrast);
  --color-warning:          var(--warning);
  --color-warning-soft:     var(--warning-soft);
  --color-warning-line:     var(--warning-line);
  --color-warning-contrast: var(--warning-contrast);
  --color-danger:           var(--danger);
  --color-danger-soft:      var(--danger-soft);
  --color-danger-line:      var(--danger-line);
  --color-danger-contrast:  var(--danger-contrast);
  --color-info:             var(--info);
  --color-info-soft:        var(--info-soft);
  --color-info-line:        var(--info-line);
  --color-info-contrast:    var(--info-contrast);

  /* per-surface geometry, so a Card does not need a `customer:` variant */
  --radius-control: var(--r-control);
  --radius-card:    var(--r-card);
  --radius-media:   var(--r-media);

  /* elevation, resolved per theme (shadow on light, border-lift on dark) */
  --shadow-card:    var(--elev-card);
  --shadow-float:   var(--elev-float);
}
```

### 3.3 The mappings

Two blocks. One light, one dark. Each semantic name appears once per block, and every value on the
right-hand side is a `var()` into §2 — there is not a single colour literal below.

`prefers-color-scheme` is **not** used as a selector anywhere. The pre-paint script of §3.5 reads
the OS preference and writes a concrete `data-theme="light"` or `data-theme="dark"` onto `<html>`
before first paint. That is what lets the dark mapping exist exactly once instead of being repeated
inside an `@media` block — the one place a design system usually ends up with two copies of its
palette.

```css
@layer base {
  /* ── LIGHT (default; also the admin light theme, and the KDS glare mode) ──
     :root carries it so any page rendered outside a route-group layout
     (404, 500, /) is correct rather than unstyled. ── */
  :root {
    color-scheme: light;

    --surface:        var(--color-ink-50);
    --surface-sunken: var(--color-ink-100);
    --elevated:       var(--color-ink-25);
    --elevated-2:     var(--color-ink-25);   /* separated by --elev-float, not by hue */
    --scrim:          oklch(0.152 0.007 62 / 0.42);

    --border:        var(--color-ink-200);
    --border-subtle: var(--color-ink-100);
    --border-strong: var(--color-ink-300);
    --rule-gold:     color-mix(in oklab, var(--color-gold-700) 34%, transparent);

    --text:          var(--color-ink-900);   /* 16.88:1 on --surface */
    --text-muted:    var(--color-ink-700);   /*  8.69:1 */
    --text-subtle:   var(--color-ink-600);   /*  5.42:1 */
    --text-disabled: var(--color-ink-400);
    --text-inverse:  var(--color-ink-25);

    --accent:          var(--color-gold-800); /*  6.40:1 — the bronze reading of gold */
    --accent-strong:   var(--color-wine-700); /* gold cannot carry a fill here; wine can */
    --accent-contrast: var(--color-ink-25);   /* 10.04:1 on wine-700 */
    --accent-soft:     color-mix(in oklab, var(--color-gold-500) 20%, var(--color-ink-25));
    --accent-line:     color-mix(in oklab, var(--color-gold-700) 42%, transparent);
    --accent-ring:     var(--color-wine-600); /*  7.38:1 */
    --wine:            var(--color-wine-700);
    --wine-strong:     var(--color-wine-700);
    --wine-soft:       var(--color-wine-50);

    --success: var(--color-success-800);  /* 8.67:1 */
    --success-soft: var(--color-success-100);
    --success-line: color-mix(in oklab, var(--color-success-600) 34%, transparent);
    --success-contrast: var(--color-ink-25);
    --warning: var(--color-warning-800);  /* 7.04:1 */
    --warning-soft: var(--color-warning-100);
    --warning-line: color-mix(in oklab, var(--color-warning-600) 34%, transparent);
    --warning-contrast: var(--color-ink-25);
    --danger:  var(--color-danger-800);   /* 10.09:1 */
    --danger-soft:  var(--color-danger-100);
    --danger-line: color-mix(in oklab, var(--color-danger-600) 34%, transparent);
    --danger-contrast: var(--color-ink-25);
    --info:    var(--color-info-800);     /* 9.10:1 */
    --info-soft:    var(--color-info-100);
    --info-line: color-mix(in oklab, var(--color-info-600) 34%, transparent);
    --info-contrast: var(--color-ink-25);

    --r-control: var(--radius-md);
    --r-card:    var(--radius-md);
    --r-media:   var(--radius-sm);

    --elev-card:  var(--shadow-sm);
    --elev-float: var(--shadow-lg);

    --focus: var(--accent-ring);
    --tap-min: 2.75rem;   /* 44px floor; surfaces raise it in §3.4 */
    --ornament: 0;
  }

  /* ── DARK. Written once. Reached by three doors: an explicit admin choice, the
        customer surface (dark-committed by product decision), and the kitchen
        surface (dark by default). ── */
  :root:where([data-theme="dark"], [data-surface="customer"], [data-surface="kitchen"]) {
    color-scheme: dark;

    --surface:        var(--color-ink-950);
    --surface-sunken: var(--color-ink-975);
    --elevated:       var(--color-ink-900);
    --elevated-2:     var(--color-ink-850);
    --scrim:          oklch(0.124 0.006 60 / 0.72);

    --border:        var(--color-ink-800);
    --border-subtle: var(--color-ink-850);
    --border-strong: var(--color-ink-700);
    --rule-gold:     color-mix(in oklab, var(--color-gold-500) 30%, transparent);

    --text:          var(--color-ink-100);  /* 16.71:1 on --surface */
    --text-muted:    var(--color-ink-400);  /*  8.20:1 */
    --text-subtle:   var(--color-ink-500);  /*  5.38:1 */
    --text-disabled: var(--color-ink-600);
    --text-inverse:  var(--color-ink-975);

    --accent:          var(--color-gold-400); /* 10.46:1 */
    --accent-strong:   var(--color-gold-500);
    --accent-contrast: var(--color-ink-975);  /*  9.29:1 on gold-500 */
    --accent-soft:     color-mix(in oklab, var(--color-gold-500) 14%, transparent);
    --accent-line:     color-mix(in oklab, var(--color-gold-500) 40%, transparent);
    --accent-ring:     var(--color-gold-300); /* 12.19:1 */
    --wine:            var(--color-wine-300); /*  8.65:1 */
    --wine-strong:     var(--color-wine-600);
    --wine-soft:       color-mix(in oklab, var(--color-wine-500) 18%, transparent);

    --success: var(--color-success-400);  /* 11.01:1 */
    --success-soft: color-mix(in oklab, var(--color-success-500) 16%, transparent);
    --success-line: color-mix(in oklab, var(--color-success-500) 38%, transparent);
    --success-contrast: var(--color-ink-975);
    --warning: var(--color-warning-400);  /* 12.06:1 */
    --warning-soft: color-mix(in oklab, var(--color-warning-500) 16%, transparent);
    --warning-line: color-mix(in oklab, var(--color-warning-500) 38%, transparent);
    --warning-contrast: var(--color-ink-975);
    --danger:  var(--color-danger-400);   /*  7.42:1 */
    --danger-soft:  color-mix(in oklab, var(--color-danger-500) 18%, transparent);
    --danger-line: color-mix(in oklab, var(--color-danger-500) 40%, transparent);
    --danger-contrast: var(--color-ink-975);
    --info:    var(--color-info-400);     /*  9.32:1 */
    --info-soft:    color-mix(in oklab, var(--color-info-500) 18%, transparent);
    --info-line: color-mix(in oklab, var(--color-info-500) 38%, transparent);
    --info-contrast: var(--color-ink-975);

    /* On a near-black ground a drop shadow is invisible. Elevation is carried by
       --elevated plus a 4.5%-white inset hairline along the top edge — the same
       trick a physical object uses to catch light. */
    --elev-card:  var(--inset-shadow-hairline);
    --elev-float: var(--shadow-overlay);
  }
```

> **Specificity note.** `:where()` contributes zero specificity, so the dark block does not
> outrank `:root`. Both are `(0,1,0)` from `:root`, and the dark block wins on source order alone.
> Every surface override in §3.4 uses a plain attribute selector `(0,2,0)` and therefore wins over
> both, which is exactly the cascade we want: theme first, then surface.

### 3.4 Surface overrides

After the two theme mappings, three short blocks adjust *geometry, ornament and a handful of
role reassignments* — never a fresh palette.

```css
  /* ── CUSTOMER — dark-committed, gold-forward, generous. ────────────────── */
  :root[data-surface="customer"] {
    --r-control: var(--radius-lg);   /*  8px — buttons and inputs */
    --r-card:    var(--radius-md);   /*  5px — MenuItemCard */
    --r-media:   var(--radius-xl);   /* 12px — the only place 12px is allowed */
    --tap-min: 3rem;                 /* 48px */
    --ornament: 1;                   /* gold hairlines + grain are on */
  }

  /* ── KITCHEN — colour means status. Gold is switched OFF: --accent becomes the
        brightest neutral so a KDS primary button is a white slab, not a gold one.
        Borders are one ramp step stronger than elsewhere so they carry at 2 m. ── */
  :root[data-surface="kitchen"] {
    --surface:        var(--color-ink-975);
    --surface-sunken: var(--color-black);
    --elevated:       var(--color-ink-900);
    --elevated-2:     var(--color-ink-850);
    --border:         var(--color-ink-700);
    --border-strong:  var(--color-ink-600);
    --border-subtle:  var(--color-ink-800);
    --rule-gold:      var(--border);              /* no gold hairlines in a kitchen */
    --text:           var(--color-ink-25);        /* 19.49:1 */
    --text-muted:     var(--color-ink-300);       /* 11.97:1 */
    --text-subtle:    var(--color-ink-400);       /*  8.45:1 */
    --accent:          var(--color-ink-25);
    --accent-strong:   var(--color-ink-25);
    --accent-contrast: var(--color-ink-975);
    --accent-soft:     color-mix(in oklab, var(--color-ink-25) 12%, transparent);
    --accent-line:     color-mix(in oklab, var(--color-ink-25) 32%, transparent);
    --accent-ring:     var(--color-ink-25);
    --r-control: var(--radius-sm);   /* 3px */
    --r-card:    var(--radius-sm);
    --r-media:   var(--radius-sm);
    --tap-min: 4rem;                 /* 64px */
    --ornament: 0;                   /* no grain, no gold rules, no scrims */
    /* Lane identity. These are the ONLY decorative colours in the KDS. */
    --lane-new:       var(--color-warning-400);
    --lane-preparing: var(--color-info-400);
    --lane-ready:     var(--color-success-400);
    --lane-late:      var(--color-danger-400);
  }

  /* Glare escape hatch. Some kitchens have overhead lighting that turns a glossy
     tablet into a mirror; a dark KDS is unreadable there. The lane colours move
     to their 800 stops so they still clear 7:1 on a light ground. */
  :root[data-surface="kitchen"][data-theme="light"] {
    color-scheme: light;
    --surface: var(--color-ink-50);      --surface-sunken: var(--color-ink-100);
    --elevated: var(--color-ink-25);     --elevated-2: var(--color-ink-25);
    --border: var(--color-ink-300);      --border-strong: var(--color-ink-400);
    --border-subtle: var(--color-ink-200);
    --text: var(--color-ink-950);        /* 18.10:1 */
    --text-muted: var(--color-ink-700);  /*  8.69:1 */
    --text-subtle: var(--color-ink-600);
    --accent: var(--color-ink-950); --accent-strong: var(--color-ink-950);
    --accent-contrast: var(--color-ink-25); --accent-ring: var(--color-ink-950);
    --success: var(--color-success-800); --warning: var(--color-warning-800);
    --danger:  var(--color-danger-800);  --info:    var(--color-info-800);
    --success-soft: var(--color-success-100); --warning-soft: var(--color-warning-100);
    --danger-soft:  var(--color-danger-100);  --info-soft:    var(--color-info-100);
    --success-line: color-mix(in oklab, var(--color-success-600) 34%, transparent);
    --warning-line: color-mix(in oklab, var(--color-warning-600) 34%, transparent);
    --danger-line:  color-mix(in oklab, var(--color-danger-600) 34%, transparent);
    --info-line:    color-mix(in oklab, var(--color-info-600) 34%, transparent);
    --success-contrast: var(--color-ink-25); --warning-contrast: var(--color-ink-25);
    --danger-contrast:  var(--color-ink-25); --info-contrast:    var(--color-ink-25);
    --lane-new: var(--color-warning-800);      /* 7.04:1 */
    --lane-preparing: var(--color-info-800);   /* 9.10:1 */
    --lane-ready: var(--color-success-800);    /* 8.67:1 */
    --lane-late: var(--color-danger-800);      /* 10.09:1 */
    --elev-card: var(--shadow-sm); --elev-float: var(--shadow-lg);
  }

  /* ── ADMIN — dense, square, quiet. ───────────────────────────────────────── */
  :root[data-surface="admin"] {
    --r-control: var(--radius-sm);    /* 3px */
    --r-card:    var(--radius-base);  /* 4px */
    --r-media:   var(--radius-sm);
    --tap-min: 2rem;                 /* 32px */
    --ornament: 0;
    font-size: 87.5%;                /* 14px base for the whole admin surface */
  }
```

### 3.5 The pre-paint theme script

Placed in `src/app/layout.tsx` as the first child of `<head>` via
`<script nonce={nonce} dangerouslySetInnerHTML>`. It must carry the per-request CSP nonce
(`02-security-and-rls.md` §8.3) and it must be **synchronous and inline** — a deferred script
produces a light flash.

```ts
// src/lib/theme/theme-script.ts
export const THEME_STORAGE_KEY = 'qros:theme'
export type ThemePreference = 'light' | 'dark' | 'system'

/** Serialised into a synchronous inline <script>. Sets a concrete data-theme
 *  before first paint so the dark palette is defined exactly once in CSS. */
export const themeScript = `(function(){try{
var p=localStorage.getItem('${THEME_STORAGE_KEY}')||'system';
var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);
document.documentElement.setAttribute('data-theme',d?'dark':'light');
}catch(e){document.documentElement.setAttribute('data-theme','light');}})()`
```

`src/components/admin/ThemeToggle.tsx` writes the preference and re-runs the same resolution; it
also registers a `matchMedia` change listener that re-resolves while the preference is `'system'`.
The customer and kitchen layouts do **not** ship this script — customer is dark-committed, and
kitchen reads its `data-theme` from a device-scoped setting in `localStorage['qros:kds:theme']`
written by the KDS settings sheet.

### 3.6 `<meta name="theme-color">`

| Surface | Value |
|---|---|
| customer | `#0e0b09` (ink-950) — fixed, no media variant |
| kitchen | `#080605` dark / `#f7f5f3` light |
| admin | two `<meta>` tags with `media="(prefers-color-scheme: light)"` → `#f7f5f3` and `dark` → `#0e0b09` |

---

## 4. Typography

### 4.1 The two families, and why these two

The product is trilingual: **Uzbek Latin, Russian Cyrillic, English**. Uzbek Latin needs
`ʻ` (U+02BB) and `ʼ` (U+02BC) — the *modifier letters*, not apostrophes — for `oʻ` and `gʻ`.
Russian needs a real Cyrillic cut, not a synthesised one. **Any font that cannot render all three
scripts is disqualified, however beautiful.** That single rule eliminates Fraunces, Marcellus,
Spectral and most of the fashionable display serifs, and it is the reason the choices below are
what they are.

| Role | Family | Loader | Subsets | Weights | Why |
|---|---|---|---|---|---|
| **Display** | **Playfair Display** | `next/font/google` | `latin`, `latin-ext`, `cyrillic` | variable 400–600, we use 500 & 600 | A high-contrast transitional serif with a full Cyrillic cut and real optical presence at 26 px+. Its thick/thin modulation is what reads as *fine dining* rather than *restaurant template*. |
| **UI** | **Inter** | `next/font/google` | `latin`, `latin-ext`, `cyrillic` | variable 400–700 | The correct engineering answer for the KDS: the tightest legible letterforms at 2 m, a true tabular-figure feature (`tnum`) for money and timers, and a Cyrillic cut drawn by the same designer as the Latin, so `Стол 12` and `Table 12` have identical colour. |
| **Mono** | **JetBrains Mono** | `next/font/google` | `latin`, `latin-ext`, `cyrillic` | 400, 500 | Only for machine strings: `qr_token`, `public_code`, `order_number` in admin detail views, uuid tails. Its disambiguated `0/O` and `1/l/I` matter when a manager reads a token aloud over the phone. |

**Playfair Display is a common font. Commonness is not the problem — misuse is.** The template
look comes from Playfair at weight 700, tracked loose, centred, over a gradient. §4.3 forbids all
four of those.

### 4.2 Loading

```ts
// src/lib/fonts.ts
import { Playfair_Display, Inter, JetBrains_Mono } from 'next/font/google'

export const displayFont = Playfair_Display({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-playfair-var',
  adjustFontFallback: true,
})

export const sansFont = Inter({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter-var',
  adjustFontFallback: true,
})

export const monoFont = JetBrains_Mono({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains-var',
  adjustFontFallback: true,
})

/** Applied to <html> by the single root layout (05-app-structure.md §2.1). */
export const fontVariables =
  `${sansFont.variable} ${displayFont.variable} ${monoFont.variable}`
```

Three rules that are not optional:

1. **`next/font/google` self-hosts.** It downloads the WOFF2 at build time and serves it from
   `/_next/static/media/*`. That is what makes it compatible with the CSP in
   `02-security-and-rls.md` §8.3, which allows `font-src 'self'` and no external origin. **Never
   add a `<link rel="stylesheet" href="https://fonts.googleapis.com/…">`; it will be blocked and
   the page will silently fall back.**
2. **`adjustFontFallback: true`** on all three. It emits a metric-matched local fallback face so
   the pre-swap paint has the same line box, which keeps CLS at 0 on a cold 3G scan.
3. **All three variables are applied once, on `<html>` in the single root layout**
   (`05-app-structure.md` §2.1 — a nested layout cannot render `<html>`). The KDS therefore *has*
   Playfair and JetBrains Mono available but never uses them, so their WOFF2 files are never
   fetched: `next/font` emits a `@font-face` per family and the browser downloads a face only when
   a glyph needs it. Contract C-12 keeps it that way.

### 4.3 Pairing rules

| # | Rule |
|---|---|
| T1 | **Serif for names, sans for everything else.** Playfair renders: the restaurant name, section headings on the customer surface, dish names on cards and the product detail, the order number on the tracking page, the monogram in `DishArtwork`. Nothing else, on any surface. |
| T2 | **Serif never below 17 px.** Below that its thin strokes disappear on a phone at arm's length and it reads as a rendering artefact. If a name must be 15 px, it is set in Inter 500, not in small Playfair. |
| T3 | **Serif never in a paragraph.** Playfair sets one to three lines. Descriptions, ingredients, notes and every admin string are Inter. |
| T4 | **Serif weight is 500, or 600 for the single largest thing on a screen.** Playfair 700 is the template signature. It is not used. |
| T5 | **Serif is tracked in.** `--text-display-*` all carry negative letter-spacing (−0.012 em to −0.026 em). Loose-tracked Playfair is the other template signature. |
| T6 | **No serif at all on the kitchen surface.** Not the order number, not the table number, not the lane label. |
| T7 | **In admin, serif appears exactly once per session:** the wordmark in the `Sidebar` header. Page titles are `--text-admin-display` in Inter 600. |
| T8 | **All money, all timers, all quantities, all order numbers are tabular.** `font-variant-numeric: tabular-nums` via the `.u-tnum` utility (§7.7). A price column that shifts by a pixel as digits change is the single most common tell of an unconsidered interface. |
| T9 | **Uppercase only at `--text-overline` and `--text-kds-label`,** which carry the 0.11–0.15 em tracking that makes uppercase legible. Uppercase at normal tracking is banned. |
| T10 | **One display size per viewport.** A customer screen has exactly one `--text-display-lg`-or-larger element. If a second is needed, the first was the wrong size. |
| T11 | **Cyrillic runs ~8% wider than Latin and Uzbek Latin ~4% wider than English.** Every fixed-width control (`Button`, `StatusPill`, `SegmentedControl`, `Tabs`) sizes from content with `min-inline-size`, never a fixed `width`. Test every new component with the Russian string, which is the longest of the three in ~80% of our copy. |

### 4.4 Base layer

```css
@layer base {
  html {
    -webkit-text-size-adjust: 100%;
    font-family: var(--font-sans);
    font-synthesis-weight: none;   /* never fake a weight we did not load */
  }
  body {
    background-color: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-body);
    line-height: var(--text-body--line-height);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }
  /* Serif is opt-in, always, everywhere. */
  h1, h2, h3, h4 { font-family: inherit; font-weight: 600; }
  ::selection { background: var(--color-accent-soft); color: var(--color-text); }
  ::placeholder { color: var(--color-text-subtle); opacity: 1; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: inherit; }
  :focus:not(:focus-visible) { outline: none; }
  [hidden] { display: none !important; }
}
```

---

## 5. Iconography

`lucide-react` 1.38, tree-shaken per-icon imports only
(`import { ShoppingBag } from 'lucide-react'` — **never** `import * as Icons`).

| Surface | `strokeWidth` | Sizes (px) |
|---|---|---|
| customer | `1.5` | 16, 20, 24 |
| kitchen | `2.25` | 24, 32, 40 |
| admin | `1.75` | 14, 16, 20 |

Rules:

- **No emoji, anywhere, ever** — not for spice, not for dietary tags, not in empty states, not in
  toast messages, not in seed data. §8.5 gives the alternatives.
- Icons are decorative by default: `aria-hidden="true"` and `focusable="false"`. An icon that
  carries meaning alone lives inside an `IconButton`, which requires a `label` prop.
- Icon and label are optically aligned, not box-aligned: the icon sits on a `-0.5px` translateY
  relative to the cap height of the label beside it (`.u-icon-align`, §7.7).
- The canonical icon per concept is fixed so the same idea never gets two glyphs:

| Concept | Icon | Concept | Icon |
|---|---|---|---|
| cart | `ShoppingBag` | search | `Search` |
| add to cart | `Plus` | remove line | `Trash2` |
| quantity − / + | `Minus` / `Plus` | back | `ChevronLeft` |
| close overlay | `X` | more | `MoreHorizontal` |
| spicy | `Flame` | prep time | `Clock` |
| table | `Utensils` | branch | `Store` |
| call waiter | `BellRing` | order ready | `CheckCheck` |
| preparing | `CookingPot` | cancelled | `XCircle` |
| late | `AlarmClock` | notes | `MessageSquareText` |
| language | `Languages` | QR | `QrCode` |
| upload | `ImageUp` | drag handle | `GripVertical` |
| revenue | `Banknote` | orders | `ReceiptText` |
| staff | `UsersRound` | menu items | `BookOpen` |
| settings | `Settings2` | analytics | `ChartNoAxesColumn` |
| unavailable | `Ban` | featured | `Sparkle` |

---

## 6. Component inventory

### 6.0 Conventions that apply to every component in this section

**Directory map.**

```
src/components/
  ui/         primitives — surface-agnostic, driven entirely by semantic tokens
  common/     used by two or more surfaces (Price, LocaleSwitcher, DishArtwork, DishImage)
  customer/   used only under src/app/(customer)/t/**
  kitchen/    used only under src/app/(staff)/kitchen/**
  waiter/     used only under src/app/(staff)/waiter/**
  admin/      used only under src/app/(admin)/admin/**
src/lib/
  cn.ts       class composition
  fonts.ts    next/font/google instances (§4.2)
  art/        DishArtwork generator (§10)
  motion/     WAAPI helpers (§7)
src/hooks/
  use-elapsed.ts, use-toast.ts, use-media-query.ts   (owned by 05-app-structure.md)
```

**File names are kebab-case; exported component names are PascalCase.** This is
`05-app-structure.md`'s convention and it is binding — `src/components/ui/button.tsx` exports
`Button`. Every path in this section is written in that form.

**Class composition.** One helper, used by every component:

```ts
// src/lib/cn.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
```

**Variants.** There is no `class-variance-authority`. A variant is a plain frozen record; the
component picks from it. This is smaller, fully typed, and greppable:

```ts
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent-strong text-accent-contrast hover:brightness-108 active:brightness-95',
  // …
}
```

**Universal props.** Every component below additionally accepts `className?: string`, merged
**last** so a caller can always override, and forwards `ref`. React 19 passes `ref` as a normal
prop — **do not wrap anything in `forwardRef`.**

**The five states.** Brief §32 requires every important screen to have loading, empty and error.
This system requires it of every *component* that can be in one. Each entry below names its
states explicitly. Where a component has none of them (e.g. `PriceTag`), the entry says so, so a
reviewer can tell "omitted" from "not applicable".

**Server vs client.** Components are Server Components unless the entry says `'use client'`.
Client components are marked **[C]**. Anything with `onClick`, `useState`, a `<dialog>` ref, or a
Realtime subscription is `[C]`; everything else must not be.

---

### 6.1 `ui/` — primitives

#### `Button` — `src/components/ui/button.tsx` **[C]**

```ts
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

export interface ButtonProps extends Omit<React.ComponentPropsWithRef<'button'>, 'children'> {
  variant?: ButtonVariant          // default 'secondary'
  size?: ButtonSize                // default 'md'
  loading?: boolean                // default false
  loadingLabel?: string            // localised; announced while loading
  iconStart?: React.ReactNode
  iconEnd?: React.ReactNode
  fullWidth?: boolean              // default false
  children: React.ReactNode
}
```

| Variant | Fill | Text | Border |
|---|---|---|---|
| `primary` | `bg-accent-strong` | `text-accent-contrast` | none |
| `secondary` | `bg-elevated` | `text-text` | `border border-border` |
| `ghost` | transparent | `text-text-muted` → `text-text` on hover | none |
| `danger` | `bg-danger` | `text-danger-contrast` | none |
| `link` | none | `text-accent`, underline offset 3 px | none |

| Size | Height | Padding-x | Type token |
|---|---|---|---|
| `sm` | 32 px | 12 px | `--text-body-sm` |
| `md` | 40 px | 16 px | `--text-body` |
| `lg` | 48 px | 20 px | `--text-body-lg` |
| `xl` | 64 px | 28 px | `--text-kds-md` — **KDS only** |

Height floor is `min-h-(--tap-min)`, so the same `size="md"` renders 40 px in admin and 48 px on
the customer surface without a surface variant. Radius is `rounded-(--radius-control)`.

**States.** `loading` → the label is replaced by a 3-dot pulse of `currentColor` while the button
keeps its measured width (`min-inline-size` locked on first render, so the row does not reflow),
`aria-busy="true"`, `disabled`, and `loadingLabel` is placed in a visually hidden `<span>`.
`disabled` → `opacity-50 cursor-not-allowed`, pointer events retained so a tooltip can explain
why. `:active` → `scale-[0.985]` over `--duration-instant`. `:focus-visible` → the base-layer ring.
No `empty` or `error` state. **Never render a `<Button>` around a `<Link>`; use
`asChild`-free composition — `<Link className={buttonClasses(...)}>` with the exported
`buttonClasses()` function.**

#### `IconButton` — `src/components/ui/icon-button.tsx` **[C]**

```ts
export interface IconButtonProps extends Omit<React.ComponentPropsWithRef<'button'>, 'children'> {
  icon: React.ReactNode            // a lucide element, already sized
  label: string                    // REQUIRED, localised — becomes aria-label + title
  variant?: 'ghost' | 'solid' | 'danger'   // default 'ghost'
  size?: 'sm' | 'md' | 'lg'                // 32 / 40 / 48 px box
  loading?: boolean
}
```

`label` is not optional and has no default. An `IconButton` without a label is the single most
common accessibility defect in products of this shape; the type system prevents it here. The hit
area is expanded to `--tap-min` with a transparent `::before` when the visual box is smaller, so a
32 px admin icon button still has a 44 px target.

**States.** loading → icon swapped for a rotating `Loader2` at `--duration-slower` linear infinite,
`aria-busy`; disabled → `opacity-45`; no empty/error.

#### `Badge` — `src/components/ui/badge.tsx`

```ts
export type BadgeTone = 'neutral' | 'accent' | 'wine' | 'success' | 'warning' | 'danger' | 'info'
export interface BadgeProps {
  tone?: BadgeTone                 // default 'neutral'
  variant?: 'soft' | 'solid' | 'outline'   // default 'soft'
  size?: 'sm' | 'md'               // 18 / 22 px height
  children: React.ReactNode
  className?: string
}
```

A **static label**, never interactive, never a status. `tone="neutral"` has no ramp of its own and
maps to `bg-surface-sunken text-text-muted border-border`; the other six resolve through their
semantic slots. `soft` = `bg-{tone}-soft text-{tone}`,
`outline` = `border-{tone}-line text-{tone}`, `solid` = `bg-{tone} text-{tone}-contrast`. Radius
`--radius-xs` — **badges are not pills**; the pill shape is reserved for `StatusPill` so the two
are distinguishable at a glance. Type is `--text-overline`, uppercase.
**No states** — Badge is presentational.

#### `StatusPill` — `src/components/ui/status-pill.tsx` **(new file — add to 05's `ui/` tree)**

```ts
import type { Database } from '@/lib/supabase/database.types'
type OrderStatus = Database['public']['Enums']['order_status']
type WaiterCallStatus = Database['public']['Enums']['waiter_call_status']

export interface StatusPillProps {
  kind: 'order' | 'waiter_call' | 'availability'
  status: OrderStatus | WaiterCallStatus | 'available' | 'unavailable'
  size?: 'sm' | 'md' | 'lg'        // lg is KDS-only
  showDot?: boolean                // default true
  className?: string
}
```

The **only** component permitted to map a database status to a colour. That mapping lives here and
nowhere else:

| `order_status` | tone | icon | dot |
|---|---|---|---|
| `pending` | `warning` | `Clock` | pulsing |
| `confirmed` | `info` | `Check` | solid |
| `preparing` | `info` | `CookingPot` | pulsing |
| `ready` | `success` | `CheckCheck` | solid |
| `delivered` | `success` | `HandPlatter` | solid |
| `completed` | `neutral` | `CircleCheckBig` | solid |
| `cancelled` | `danger` | `XCircle` | solid |

`waiter_call_status`: `pending`→`danger` pulsing, `acknowledged`→`warning`, `resolved`→`success`,
`cancelled`/`expired`→`neutral`. `availability`: `available`→`success`, `unavailable`→`neutral`
with a `Ban` icon.

Shape: `rounded-full`, `variant='soft'`, dot 6 px, label from
`t(`status.order.${status}`)`. **Colour is never the only channel** — the icon and the localised
word are always present (WCAG 1.4.1). **No states.**

#### `Card` — `src/components/ui/card.tsx`

```ts
export interface CardProps extends React.ComponentPropsWithRef<'div'> {
  as?: 'div' | 'article' | 'section' | 'li'   // default 'div'
  padding?: 'none' | 'sm' | 'md' | 'lg'       // 0 / 12 / 16 / 24 px
  interactive?: boolean            // adds hover/active affordance; requires the caller to
                                   // put a real <a>/<button> inside for the actual action
  tone?: 'default' | 'accent' | 'danger'      // tints border + adds a 2px left rule
}
```

`bg-elevated`, `border border-border`, `rounded-(--radius-card)`, `shadow-(--shadow-card)`. On dark
that shadow token resolves to the inset hairline, on light to `--shadow-sm`; the component does not
know which. `interactive` adds `hover:border-border-strong hover:-translate-y-px` over
`--duration-fast` and `active:translate-y-0`. **No states** — a Card is a container; its *contents*
carry the states.

#### `Sheet` (bottom sheet) — `src/components/ui/sheet.tsx` **[C]**

```ts
export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string                    // localised; rendered and used as aria-label
  description?: string
  size?: 'auto' | 'half' | 'tall' | 'full'    // max-block-size 88svh / 50svh / 88svh / 100svh
  dismissible?: boolean            // default true — false blocks Esc, backdrop and drag
  footer?: React.ReactNode         // sticky, above the safe-area inset
  children: React.ReactNode
}
```

Implemented on the **native `<dialog>`** element with `showModal()`. This gives us, for free and
without a dependency: focus trap, `inert` on the rest of the page, Escape handling, top-layer
promotion (so no `z-index` fight), and `::backdrop`. Drag-to-dismiss is layered on top with Pointer
Events (§7.5). Corners: `rounded-t-(--radius-2xl)` — this is the only component allowed to use
`--radius-2xl`. A 36 × 4 px `--border-strong` grabber sits 8 px from the top. `bg-elevated`,
`--elev-float`, a `--rule-gold` 1 px hairline directly under the header on the customer surface
(`--ornament: 1`), suppressed elsewhere.

**States.** `loading` → the caller passes `<Skeleton>` children; the sheet itself never spins.
`empty`/`error` → the caller passes `<EmptyState>` / `<ErrorState>` as children. `disabled` n/a.
Body scroll lock is handled by `<dialog>`; do **not** also set `overflow:hidden` on `body`, which
breaks iOS Safari's URL-bar collapse and causes the sheet to jump.

#### `Dialog` — `src/components/ui/dialog.tsx` **[C]**

Same `<dialog>` foundation, centred rather than bottom-anchored.

```ts
export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg'        // max-inline-size 380 / 520 / 720 px
  dismissible?: boolean            // default true
  footer?: React.ReactNode
  children: React.ReactNode
}
```

`rounded-(--radius-lg)`, `bg-elevated`, `border border-border`, `--elev-float`. Enters with
`--animate-dialog-in` (opacity 0→1, `translateY(8px)→0`, `scale(0.98)→1`). Exits by adding
`data-closing` for `--duration-fast` before `close()`, so the backdrop fade is not clipped.
**On the customer surface, `Dialog` is not used** — a phone gets a `Sheet`. `Dialog` is admin and
KDS only.

#### `Drawer` — `src/components/ui/drawer.tsx` **(new file)** **[C]**

```ts
export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  side?: 'left' | 'right'          // default 'right'
  title: string
  width?: 'sm' | 'md' | 'lg'       // 320 / 420 / 560 px
  footer?: React.ReactNode
  children: React.ReactNode
}
```

Admin only: order detail, menu-item editor, filters. `<dialog>` again, sliding from the edge over
`--duration-slow` / `--ease-entrance`. On viewports below `md` it **automatically degrades to
`Sheet`** (the component swaps internally on a `matchMedia('(min-width: 768px)')` check) so no
caller has to branch. **States** as `Sheet`.

#### `Input` — `src/components/ui/input.tsx`

```ts
export interface InputProps extends Omit<React.ComponentPropsWithRef<'input'>, 'size'> {
  label: string                    // REQUIRED, localised — rendered visibly unless hideLabel
  hideLabel?: boolean              // renders label into .sr-only; still associated
  hint?: string
  error?: string                   // presence switches the field to its error state
  iconStart?: React.ReactNode
  suffix?: React.ReactNode         // e.g. the currency code beside a price field
  size?: 'sm' | 'md' | 'lg'
}
```

Structure is fixed: `<label for>` → `<input id aria-describedby aria-invalid>` → hint/error
`<p id>`. **`id` is generated with `React.useId()` when not supplied** — never with a counter,
never with `Math.random()`, both of which break hydration.

Visual: `bg-surface-sunken`, `border border-border`, `rounded-(--radius-control)`,
`focus:border-accent` plus the base focus ring. **No inner glow, no gradient border, no
floating-label animation** (§8.9).

**States.** default · focus · `error` (`border-danger`, `aria-invalid="true"`, message in
`text-danger` with an `AlertCircle` icon, `role="alert"` only when the error appears after a
submit, not while typing) · `disabled` (`bg-surface`, `text-text-disabled`, `cursor-not-allowed`)
· `readOnly` (border-subtle, no focus ring) · `loading` **not supported** — a loading input is a
skeleton, use `<Skeleton variant="input">`.

#### `Textarea` — `src/components/ui/textarea.tsx`

Identical prop shape to `Input`, plus:

```ts
  rows?: number                    // default 3
  maxLength?: number               // when set, a live "142 / 300" counter renders bottom-right
  autoGrow?: boolean               // default true on the customer surface
```

The counter is `--text-caption text-text-subtle`, switches to `text-warning` at 90% and
`text-danger` at 100%, and is `aria-live="polite"` **only** past 90% (announcing every keystroke is
worse than silence). Used for the "No onion" note (brief §6) — `maxLength={300}`, matching the
`order_items.note` CHECK in `01-database-schema.md`. **States** as `Input`.

#### `Select` — `src/components/ui/select.tsx`

```ts
export interface SelectOption<T extends string = string> {
  value: T
  label: string                    // already localised by the caller
  disabled?: boolean
}
export interface SelectProps<T extends string = string>
  extends Omit<React.ComponentPropsWithRef<'select'>, 'size' | 'children'> {
  label: string
  hideLabel?: boolean
  options: readonly SelectOption<T>[]
  placeholder?: string
  hint?: string
  error?: string
  size?: 'sm' | 'md' | 'lg'
}
```

A **styled native `<select>`**, not a custom listbox. Rationale: on a phone the native wheel is
faster and more accessible than anything we would build, it is keyboard- and screen-reader-correct
for free, and it costs zero JS. The only styling is `appearance-none` plus a `ChevronDown` icon
positioned in the padding box; `color-scheme` (set per theme in §3.3) makes the native popup
render dark on dark. **Where a true combobox is needed** (menu-item picker with search in admin),
that is a separate component `admin/ItemCombobox.tsx`, out of scope for this inventory and
explicitly *not* a `Select` variant. **States** as `Input`.

#### `Switch` — `src/components/ui/switch.tsx` **[C]**

```ts
export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string                    // REQUIRED
  hideLabel?: boolean
  description?: string
  size?: 'sm' | 'md'               // track 36×20 / 44×24
  disabled?: boolean
  pending?: boolean                // optimistic write in flight
  className?: string
}
```

`<button role="switch" aria-checked>`, not a checkbox — the ARIA switch role is what makes a screen
reader say "on/off" rather than "checked". Track `bg-border-strong` → `bg-success` when on (this is
the availability toggle; on/off *is* a status, so success is correct here and is paired with the
thumb's position, never colour alone). Thumb travel is `--duration-fast` / `--ease-standard`.

**States.** `pending` → the thumb holds the *optimistic* position at 60% opacity with a 1.5 px ring;
on failure it springs back over `--duration-base` and a `danger` Toast fires. `disabled` →
`opacity-45`. No empty/error/loading beyond `pending`.

#### `Tabs` — `src/components/ui/tabs.tsx` **[C]**

```ts
export interface TabItem { id: string; label: string; count?: number; disabled?: boolean }
export interface TabsProps {
  items: readonly TabItem[]
  value: string
  onValueChange: (id: string) => void
  variant?: 'underline' | 'enclosed'   // default 'underline'
  size?: 'sm' | 'md' | 'lg'
  label: string                        // aria-label for the tablist
}
```

Full ARIA tabs pattern implemented by hand: `role="tablist"`, roving `tabIndex`, Home/End/Arrow
keys, `aria-controls`/`aria-selected`. Indicator is a 2 px `bg-accent` bar that **slides** between
tabs using a CSS custom property for `translateX` and `width` set from `getBoundingClientRect` in a
`useLayoutEffect`, transitioned over `--duration-base` / `--ease-standard`.

**States.** `disabled` per item; `count` renders a `Badge tone="neutral" size="sm"` after the label.
Overflow scrolls horizontally with `scroll-snap-type: x proximity` and edge mask (`.u-edge-fade`).

#### `SegmentedControl` — `src/components/ui/segmented-control.tsx` **(new file)** **[C]**

```ts
export interface SegmentedControlProps<T extends string> {
  options: readonly { value: T; label: string; icon?: React.ReactNode }[]
  value: T
  onValueChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
  fullWidth?: boolean
}
```

`role="radiogroup"` with `role="radio"` children — **not** tabs. Use `Tabs` when the choice swaps a
*panel*; use `SegmentedControl` when it changes a *value* (dine-in/takeaway, the KDS density
setting, an admin date range). Track `bg-surface-sunken` with `--radius-control`; the selected
thumb is `bg-elevated` + `--shadow-card` and slides on `--duration-fast`.
**States.** `disabled` per option; no others.

#### `Skeleton` — `src/components/ui/skeleton.tsx`

```ts
export interface SkeletonProps {
  variant?: 'text' | 'title' | 'block' | 'circle' | 'card' | 'input' | 'row'
  lines?: number                   // 'text' only; last line renders at 62% width
  width?: string | number
  height?: string | number
  className?: string
}
```

`bg-surface-sunken` with a `--animate-shimmer` sweep of `--accent-soft` at 6% — a *warm* shimmer,
not the grey-blue default. `aria-hidden="true"` always; the *container* owns the announcement
(`aria-busy="true"` on the region plus a `.sr-only` "Loading menu…"). Never nest a Skeleton inside
another Skeleton.

**Reduced motion:** the sweep is removed and replaced with a static `--accent-soft` at 4% — the
placeholder still reads as "not real content" without animation (§7.8).

#### `EmptyState` — `src/components/ui/empty-state.tsx`

```ts
export interface EmptyStateProps {
  icon?: React.ReactNode           // lucide, 28px, text-text-subtle
  title: string                    // localised
  description?: string
  action?: { label: string; onClick?: () => void; href?: string }
  secondaryAction?: { label: string; href: string }
  size?: 'sm' | 'md'               // 'sm' inside a Card/Drawer, 'md' full-page
  className?: string
}
```

Covers every case in brief §32: no menu items, no orders, no tables, empty cart, no search results,
no waiter calls. **No illustration, no emoji, no oversized icon.** The pattern is: a 28 px outlined
icon in a 56 px `bg-surface-sunken` square with `--radius-card`, a `--text-admin-h2`/`--text-title`
line, one line of `--text-body-sm text-text-muted` in `max-w-(--measure-narrow)`, then at most one
primary action. Left-aligned in admin, centred only when it fills a whole viewport.
**States:** it *is* a state. No sub-states.

#### `ErrorState` — `src/components/ui/error-state.tsx` **[C]**

```ts
import type { QrErrorCode } from '@/lib/security/errors'
export interface ErrorStateProps {
  code?: QrErrorCode | 'network' | 'unknown'
  title?: string                   // overrides the code-derived title
  description?: string
  onRetry?: () => void             // renders a "Try again" Button when present
  supportHint?: boolean            // customer surface: "Ask your waiter for help"
  size?: 'sm' | 'md'
  className?: string
}
```

`code` maps to a localised title/description pair through
`src/lib/i18n/messages/<locale>.ts` under `error.<code>.*`. `QrErrorCode` is the closed union
exported by `02-security-and-rls.md` §11 — `ErrorState` must handle **every** member, enforced by
an exhaustive `switch` with a `never` default so a new code is a compile error, not a blank screen.
Visual: an `AlertTriangle` in `text-danger` on `bg-danger-soft`, `border border-danger-line`,
`--radius-card`. `role="alert"` when mounted in response to an action; plain `<div>` when it is the
initial render of an error route (a route-level error should not be shouted twice — the page title
already announces it).

#### `Toast` / `Toaster` — `src/components/ui/toast.tsx` + `src/components/ui/toaster.tsx` **[C]**

```ts
export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'
export interface ToastInput {
  tone?: ToastTone                 // default 'neutral'
  title: string
  description?: string
  duration?: number                // ms; default 4000, 0 = sticky
  action?: { label: string; onClick: () => void }
  id?: string                      // supplying an existing id updates in place
}
// src/components/ui/toast-store.ts — a 40-line store, no dependency
export function toast(input: ToastInput): string
export function dismissToast(id: string): void
```

`<Toaster />` is mounted once per surface layout. Placement: **bottom-centre above the CartBar** on
customer (`bottom: var(--space-safe-bottom)`), **top-right** on admin, **top-centre, 2× scale,
duration 6000** on KDS. Max 3 visible; a 4th replaces the oldest. Enter `--animate-toast-in`, exit
opacity + 8 px translate over `--duration-fast`.

**Accessibility.** The Toaster container is `role="region" aria-label="Notifications"` and contains
**two** live regions: `aria-live="polite"` for `neutral`/`success`/`info` and `aria-live="assertive"
role="alert"` for `warning`/`danger`. Toast content is inserted into the matching one. A toast with
an `action` never auto-dismisses in under 6000 ms.
**States.** entering · visible · exiting · paused (hover or focus within pauses the timer).

#### `ConfirmDialog` — `src/components/ui/confirm-dialog.tsx` **[C]**

```ts
export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  tone?: 'default' | 'danger'      // default 'default'
  requireTyped?: string            // when set, Confirm stays disabled until the user
                                   // types this exact string (used for token regeneration)
  onConfirm: () => void | Promise<void>
}
```

Built on `Dialog`, `size="sm"`, `dismissible={false}` when `tone="danger"`. Initial focus lands on
**Cancel**. `onConfirm` returning a promise puts the confirm `Button` into `loading` and keeps the
dialog open until it settles; a rejection renders an inline `ErrorState size="sm"` inside the
dialog rather than closing it.

`requireTyped` is used for exactly two flows, both from brief §13/§14: regenerating a table's
`qr_token` (which invalidates every printed QR on that table) and deleting a menu category that
still has items. **States.** idle · pending · error.

#### `QuantityStepper` — `src/components/ui/quantity-stepper.tsx` **[C]**

```ts
export interface QuantityStepperProps {
  value: number
  onValueChange: (n: number) => void
  min?: number                     // default 1
  max?: number                     // default 99 (order_items.quantity CHECK allows 999,
                                   //  but a diner ordering 100 plov is a typo, not an order)
  size?: 'sm' | 'md' | 'lg'        // 32 / 40 / 48 px
  disabled?: boolean
  pending?: boolean
  removeAtMin?: boolean            // when true and value === min, the − button becomes Trash2
  label: string                    // "Quantity of Plov" — aria-label for the group
}
```

`role="group"` containing two `IconButton`s and a `<span aria-live="polite" aria-atomic="true">`
holding the number in `.u-tnum`. Track is `rounded-full bg-surface-sunken border border-border` —
one of the four components allowed `--radius-full`. Long-press on ± repeats at 350 ms then 90 ms.
The number **rolls**: on change, the outgoing digit translates −8 px and fades while the incoming
enters from +8 px, 140 ms, `--ease-standard`.

**States.** at `min` with `removeAtMin` → the − button turns `danger`-toned; at `max` → + is
disabled with `title` explaining the cap; `pending` → 60% opacity, buttons inert, number holds the
optimistic value.

#### `PriceTag` — `src/components/common/price.tsx` (export `Price`)

*Listed with the primitives because it behaves like one; it lives in `common/` because all three
surfaces render money.*

```ts
import type { Money } from '@/lib/money'
export interface PriceTagProps {
  amount: Money                    // integer minor units
  currency: string                 // ISO 4217, e.g. 'UZS' — from restaurants.currency
  decimals: number                 // restaurants.currency_decimals, 0 for UZS
  locale: 'uz' | 'ru' | 'en'
  size?: 'sm' | 'md' | 'lg' | 'xl' // --text-body-sm / --text-price / --text-price-lg / --text-kds-md
  compareAt?: Money                // menu_items.compare_at_price — renders struck-through before
  tone?: 'default' | 'muted' | 'accent'
  className?: string
}
```

The **only** component that formats money. Nothing else in the codebase may call
`Intl.NumberFormat` on a currency. It delegates to `formatMoney()` in `src/lib/money.ts`, which
divides by `10 ** decimals` **only at the formatting boundary** and asserts
`Number.isSafeInteger(amount)` first. Always `.u-tnum`. `compareAt` renders in `text-text-subtle
line-through` at one size down, before the live price, with the struck value wrapped in
`<s>` and an `.sr-only` "was" / "было" / "avvalgi narx" prefix.
**No states** — a price is either known or the component is not rendered.

---

### 6.2 `customer/` — the QR menu surface

#### `SpicyMeter` — `src/components/customer/spicy-meter.tsx`

```ts
export interface SpicyMeterProps {
  level: 0 | 1 | 2 | 3             // menu_items.spicy_level, CHECK 0..3
  size?: 'sm' | 'md'               // 12 / 16 px glyphs
  showLabel?: boolean              // default false on cards, true on product detail
  locale: 'uz' | 'ru' | 'en'
  className?: string
}
```

Three `Flame` glyphs. Filled ones are `text-danger` at full opacity; unfilled are
`text-text-disabled` at 35%. **Level 0 renders nothing at all** — an empty meter on a plain salad
is visual noise. `showLabel` appends `t('spicy.' + level)` → *not spicy / mild / medium / hot*.

Accessibility: the group is `role="img"` with
`aria-label={t('spicy.aria', { level, max: 3 })}` — "Spiciness: medium, 2 of 3". The individual
flames are `aria-hidden`. **Never a chilli emoji** (§8.5).
**No states.**

#### `DietaryTags` — `src/components/customer/dietary-tags.tsx`

```ts
import type { Database } from '@/lib/supabase/database.types'
type DietaryTag = Database['public']['Enums']['dietary_tag']

export interface DietaryTagsProps {
  tags: readonly DietaryTag[]
  locale: 'uz' | 'ru' | 'en'
  max?: number                     // default 3 on cards, undefined on product detail
  size?: 'sm' | 'md'
  className?: string
}
```

The enum has ten members and splits into two rhetorical classes, which must be styled differently
because they mean opposite things:

| Class | Members | Rendering |
|---|---|---|
| **claims** (a reason to order) | `vegetarian`, `vegan`, `halal`, `gluten_free`, `lactose_free`, `nut_free` | `Badge tone="success" variant="outline"` |
| **warnings** (a reason not to) | `contains_nuts`, `contains_seafood`, `contains_pork`, `contains_alcohol` | `Badge tone="warning" variant="soft"` with an `AlertCircle` 12 px icon |

Warnings always sort first and are **never** hidden by `max`; the `max` overflow chip
(`+2`) may only ever swallow claims. This is a safety property, not a layout preference: an
allergen must not be one tap away. The overflow chip carries a `title` listing the hidden tags and
the full list is always present on the product detail.
**States.** empty array → renders `null` (not an empty row).

#### `CategoryRail` — `src/components/customer/category-rail.tsx` **[C]**

```ts
export interface CategoryRailItem {
  id: string
  label: string                    // localised via pickI18n(name, locale)
  count: number
  imageUrl: string | null
  seed: string                     // for DishArtwork fallback (§10)
}
export interface CategoryRailProps {
  items: readonly CategoryRailItem[]
  activeId: string | null
  onSelect: (id: string) => void
  variant?: 'chips' | 'thumbs'     // default 'chips'
  className?: string
}
```

A horizontally scrolling, scroll-snapping rail that **sticks under the header** at
`top: var(--space-header-h)`, `z-(--z-rail)`, `bg-surface/88` with
`backdrop-filter: blur(12px) saturate(140%)`. A 1 px `--rule-gold` sits along its bottom edge —
this is the signature gold hairline of the customer surface and it appears in exactly three places
(here, under a `Sheet` header, above the `CartBar`).

`activeId` is driven by an `IntersectionObserver` over the section headings, with a 120 ms debounce
so a fast flick does not strobe the rail. Selecting a chip does a `scrollIntoView({ block: 'start',
behavior: prefersReducedMotion ? 'auto' : 'smooth' })` and calls `scrollIntoView` on the chip
itself so the active chip is never off-screen.

Chip: `--text-body-sm`, `rounded-full`, inactive `bg-surface-sunken text-text-muted`, active
`bg-accent-soft text-accent border border-accent-line`. Edge fade via `.u-edge-fade`, never a
gradient overlay div.

**States.** loading → 5 `Skeleton variant="block"` chips at staggered widths (72/96/64/108/80 px);
empty → the rail is not rendered at all (a menu with no categories renders `EmptyState` at the page
level instead); error → not applicable, the rail never fetches on its own.

#### `MenuItemCard` — `src/components/customer/menu-item-card.tsx` **[C]**

```ts
import type { Money } from '@/lib/money'
export interface MenuItemCardProps {
  id: string
  href: string                     // /t/<token>/item/<id>
  name: string                     // already localised
  description: string | null       // already localised
  price: Money
  compareAtPrice: Money | null
  currency: string
  decimals: number
  locale: 'uz' | 'ru' | 'en'
  imageUrl: string | null
  seed: string
  spicyLevel: 0 | 1 | 2 | 3
  dietaryTags: readonly DietaryTag[]
  preparationTime: number          // minutes
  orderable: boolean               // the result of src/lib/menu/orderability.ts — NOT is_available
  unavailableReason?: 'unavailable' | 'daypart' | 'sold_out'
  isPopular?: boolean
  onAdd: (id: string, originRect: DOMRect) => void   // originRect drives the flight (§7.2)
}
```

**Layout — deliberately not a grid of squares.** The default is a *list row*: an 88 × 88 px media
well on the **trailing** edge (right in LTR), text leading. This is the layout that reads as a
menu rather than as an e-commerce catalogue, it puts the dish name at the strongest scan position,
and it lets long Cyrillic names wrap without shrinking the photo. A 2-up grid appears only at
`≥ 640px`, which on this product means a tablet held in portrait, not a phone.

Composition, top to bottom in the text column: overline (`isPopular` → `Badge tone="accent"`),
dish name in **Playfair 500 at `--text-title`** clamped to 2 lines, description in
`--text-body-sm text-text-muted` clamped to 2 lines, a meta row (`SpicyMeter` · `Clock` +
`{preparationTime} min` · `DietaryTags max={2}`), then `PriceTag` and the add button on one line.

The add control is a 40 px `IconButton variant="solid"` with `Plus`, sitting **overlapping the
bottom-trailing corner of the media well by 8 px**. That overlap is the one piece of visual wit on
the card and it is what stops the row reading as a generic list item.

**States.**
- `orderable: false` → media well drops to 55% opacity and gains a `grayscale(0.6)` filter, a
  `StatusPill kind="availability" status="unavailable"` replaces the add button, the whole card
  keeps its link (a diner may still want to read the dish) but `aria-disabled` is set on the add
  control, and the localised reason renders in `--text-caption text-text-subtle`. **The card must
  not collapse, shrink or disappear** — brief §5.
- loading → `MenuItemCardSkeleton` (exported from the same file): the exact same geometry with
  `Skeleton` in each slot, so the list does not reflow on hydration.
- error → not applicable at card level.
- pressed → `active:scale-[0.995]` over `--duration-instant`.

#### `FeaturedCard` — `src/components/customer/featured-card.tsx` **(new file; `featured-rail.tsx` in 05 composes it)** **[C]**

```ts
export interface FeaturedCardProps extends Omit<MenuItemCardProps, 'onAdd'> {
  badgeLabel?: string              // e.g. promotions.badge_label, localised
  onAdd: (id: string, originRect: DOMRect) => void
  priority?: boolean               // passes next/image priority for the first card only
}
```

The editorial counterpart to `MenuItemCard`, used for `menu_items.is_featured` and for
`promotions`. **Portrait 4:5 media, full-bleed**, text laid *over* the lower third on a
`--scrim-image-bottom` gradient (§10.5), dish name in Playfair at `--text-display-md`, price in
`--text-price-lg`. Radius `--radius-media`. Grain overlay at `--texture-grain-opacity` when
`--ornament: 1`.

Presented in a scroll-snapping carousel (`FeaturedRail`, same file) of 78 vw cards with a 20 px
peek of the next — never a full-width one-at-a-time hero, and never dots-and-arrows.

**States.** loading → one full-size `Skeleton variant="card"` at 4:5; empty → the whole section
including its heading is omitted (never an empty carousel); `orderable: false` → the card is
excluded from the featured set upstream, so this state does not occur here.

#### `CartBar` — `src/components/customer/cart-fab.tsx` (05's filename; the export is `CartBar` and it is a bar, not a circular FAB — see R-9) **[C]**

```ts
import type { Money } from '@/lib/money'
export interface CartBarProps {
  itemCount: number
  total: Money
  currency: string
  decimals: number
  locale: 'uz' | 'ru' | 'en'
  onOpen: () => void               // opens the cart Sheet
  disabled?: boolean               // table inactive / restaurant closed
  disabledReason?: string
}
```

Fixed to the bottom, `z-(--z-cartbar)`, `bg-elevated/92` + `backdrop-blur-xl`, a `--rule-gold`
1 px line along its **top** edge, `padding-block-end: env(safe-area-inset-bottom)`. Height
`--space-cartbar-h`. Contents: a 28 px count badge (the flight target, §7.2), the localised item
count, `PriceTag size="lg"`, and a `Button variant="primary" size="lg"` reading *View cart* /
*Place order*.

Every scrollable customer page must reserve `padding-block-end: var(--space-safe-bottom)` so the
bar never covers the last row. This is enforced by the `.customer-scroll` utility (§7.7), not by
each page remembering.

**States.**
- `itemCount === 0` → the bar is **unmounted**, not hidden — it slides out over `--duration-base`
  and is removed, so it is not a focus trap for a keyboard user.
- appearing (0 → 1) → `--animate-sheet-in` from `translateY(100%)`.
- `disabled` → the button is disabled, the bar tints `bg-surface-sunken`, and `disabledReason`
  replaces the price line in `text-warning`.
- pending (order submitting) → the button goes to `loading`; the bar itself is inert.

#### `OrderProgressTracker` — `src/components/customer/order-status-stepper.tsx` (export `OrderStatusStepper`) **[C]**

```ts
type OrderStatus = Database['public']['Enums']['order_status']
export interface OrderProgressTrackerProps {
  status: OrderStatus
  timestamps: Partial<Record<OrderStatus, string>>   // ISO strings from orders.*_at
  estimatedPrepMinutes: number
  locale: 'uz' | 'ru' | 'en'
  orientation?: 'vertical' | 'horizontal'  // default 'vertical' on phone
  cancellationReason?: string | null
}
```

Five visible steps — **pending → confirmed → preparing → ready → delivered** — with `completed`
folded into `delivered` (a diner does not care about the accounting close) and `cancelled` handled
as a **terminal replacement**, not a sixth dot: the whole tracker is swapped for a
`danger`-toned panel showing the localised reason. This mirrors, but does not re-implement, the
state machine in `01-database-schema.md` §5; the component never decides whether a transition is
legal, it only renders the status it is handed.

Rendering: a 2 px vertical rail in `--border`, over which a `--accent` rail fills by
`transform: scaleY()` from `transform-origin: top`. Each step is a 12 px dot; done steps are filled
`--accent` with a 3 px `--surface` ring, the current step is a filled dot inside a pulsing 20 px
`--accent-soft` halo, future steps are hollow with a `--border-strong` stroke. Labels in
`--text-body`, timestamps in `--text-caption text-text-subtle` formatted `HH:mm` in the
**branch's** timezone.

**Accessibility.** The rail itself is `aria-hidden`. A sibling
`<p class="sr-only" aria-live="polite" aria-atomic="true">` holds one full localised sentence —
*"Your order A-014 is being prepared. Estimated ready at 19:42."* — regenerated on every status
change. Never announce the diff ("preparing"), always the sentence. See §9.5.

**States.** loading → 5 skeleton dots with skeleton labels; error → the page-level `ErrorState`
takes over; `cancelled` → as described above; realtime-disconnected → a `warning`-toned
`Badge` reading *Reconnecting…* appears above the tracker after 5 s of a dropped Broadcast
subscription, and the page falls back to a 15 s refetch. That fallback is a **degradation path,
not the primary mechanism** (brief §28).

---

### 6.3 `kitchen/`

#### `KitchenTicketCard` — `src/components/kitchen/ticket-card.tsx` (with `ticket-lines.tsx`, `ticket-timer.tsx`, `ticket-actions.tsx` as its parts) **[C]**

```ts
export interface KitchenTicketLine {
  id: string
  name: string                     // name_snapshot, localised
  quantity: number
  note: string | null
  options: readonly string[]       // pre-formatted option labels
  spicyLevel: 0 | 1 | 2 | 3
}
export interface KitchenTicketCardProps {
  orderId: string
  orderNumber: string              // "A-014"
  tableLabel: string | null        // "12" — null for takeaway
  orderType: 'dine_in' | 'takeaway'
  status: 'pending' | 'confirmed' | 'preparing' | 'ready'
  lines: readonly KitchenTicketLine[]
  placedAt: string                 // ISO
  dueAt: string | null             // ISO
  customerNote: string | null
  isNew: boolean                   // true for 4s after arrival — drives the pulse
  onAdvance: (orderId: string, next: 'confirmed' | 'preparing' | 'ready') => void
  onOpenDetail: (orderId: string) => void
  density: 'comfortable' | 'compact'
}
```

The single most important component in the product for the people who use it most. Rules:

- **No photography.** A cook does not need a picture of the dish; the image column is dead space
  and dead bandwidth on a tablet refreshing every few seconds.
- **No serif, no gold, no grain, no rounded corners beyond 3 px.**
- Header band: `orderNumber` at `--text-kds-xl`, `tableLabel` at `--text-kds-hero` on the trailing
  edge — the table number is the largest thing on the screen because it is what a runner reads
  from across the pass. A `takeaway` ticket shows a `Package` icon at 40 px in place of a number.
- A 6 px left edge bar carries the lane colour (`--lane-new` / `--lane-preparing` / `--lane-ready`,
  or `--lane-late` which **overrides** all three).
- Lines: `quantity ×` in `--text-kds-md` inside a 44 px `bg-surface-sunken` square, then the name at
  `--text-kds-lg`. Options in `--text-kds-sm text-text-muted`. A line note renders on
  `bg-warning-soft` with a 3 px `--warning` left rule and the `MessageSquareText` icon — a note is
  the highest-value, most-missed piece of information on a ticket and it is styled to be impossible
  to skim past.
- Timer: elapsed since `placedAt`, `mm:ss`, `.u-tnum`, `--text-kds-md`. It **ticks client-side from
  a single shared 1 Hz interval** via `useElapsed()` (`src/hooks/use-elapsed.ts`), not
  one interval per card — 40 tickets each with their own `setInterval` is how a KDS tablet dies.
- Late: when `now > dueAt`, the card takes `--lane-late`, the timer turns `text-danger`, an
  `AlarmClock` icon appears, and the edge bar runs `--animate-late-blink`. The blink is the only
  looping animation in the entire product and it exists because a late ticket must catch a
  peripheral glance.
- Action: one full-width `Button size="xl"` per status — *Accept* (pending→confirmed), *Start*
  (confirmed→preparing), *Ready* (preparing→ready). 64 px tall, minimum, per `--tap-min`.

**States.** `isNew` → arrival pulse (§7.3). `pending` write → the action button goes `loading` and
the card gets `aria-busy`; the optimistic status is applied immediately and reverted with a
`danger` Toast on failure. `density="compact"` → line names drop to `--text-kds-md` and options
collapse behind a count; used only when a lane holds more than 8 tickets. Loading (initial lane
fetch) → `KitchenTicketSkeleton`, same geometry. Empty lane → `EmptyState size="sm"` with
`CookingPot`, e.g. *"Nothing preparing"*. Error → lane-level `ErrorState` with `onRetry`.

---

### 6.4 `admin/`

#### `StatCard` — `src/components/admin/stat-card.tsx`

```ts
export interface StatCardProps {
  label: string
  value: string                    // ALREADY formatted by the caller (PriceTag for money)
  icon?: React.ReactNode
  delta?: { value: number; direction: 'up' | 'down'; label: string }
  tone?: 'default' | 'accent'
  sparkline?: readonly number[]    // ≤ 24 points; renders a 1px path, no fill, no axes
  loading?: boolean
  isDemo?: boolean                 // restaurants.is_demo — renders a "Demo data" Badge
  className?: string
}
```

Value in `--text-admin-metric` `.u-tnum`; label above it in `--text-admin-xs` uppercase
`text-text-subtle`. Delta is a `--text-admin-sm` line with `ArrowUp`/`ArrowDown` in `--success` /
`--danger` — **and the direction is not assumed to be good**: the caller supplies the tone-bearing
`direction`, because a rising *cancellation rate* is bad. The sparkline is a bare `<path>` in
`--accent` at 1 px with `vector-effect: non-scaling-stroke`, no gradient fill, no dots.

`isDemo` is mandatory wherever the dashboard may show seeded data (brief §11: *no fake analytics*).
**States.** `loading` → `Skeleton variant="title"` for the value and `variant="text"` for the label,
never a `0`; no data → the value renders as `—` (em dash) in `text-text-subtle`, not `0`, because
"no orders yet" and "zero revenue" are different facts.

#### `DataTable` — `src/components/ui/data-table.tsx` **[C]**

```ts
export interface DataTableColumn<Row> {
  id: string
  header: string                   // localised
  align?: 'start' | 'end'          // 'end' for numerics; also applies .u-tnum
  width?: string                   // CSS grid track, e.g. 'minmax(160px, 1fr)'
  sortable?: boolean
  cell: (row: Row) => React.ReactNode
  sticky?: 'start'                 // at most one column
  hideBelow?: 'md' | 'lg'          // progressive disclosure instead of h-scroll
}
export interface DataTableProps<Row> {
  columns: readonly DataTableColumn<Row>[]
  rows: readonly Row[]
  getRowId: (row: Row) => string
  sort?: { columnId: string; direction: 'asc' | 'desc' }
  onSortChange?: (s: { columnId: string; direction: 'asc' | 'desc' }) => void
  onRowClick?: (row: Row) => void
  selectable?: boolean
  selectedIds?: ReadonlySet<string>
  onSelectionChange?: (ids: ReadonlySet<string>) => void
  loading?: boolean
  skeletonRows?: number            // default 8
  empty?: React.ReactNode          // an <EmptyState>
  error?: { message: string; onRetry: () => void }
  stickyHeader?: boolean           // default true
  density?: 'comfortable' | 'compact'   // row height 44 / 36 px
  caption: string                  // REQUIRED, .sr-only — screen readers need a table name
}
```

A real `<table>` with `role` left intact — **not** a div grid. `stickyHeader` uses
`position: sticky; top: 0` on `<th>` with a `--border` bottom, `bg-surface`. Zebra striping is
**off**; row separation is a single `--border-subtle` bottom rule, which is quieter and survives
theme switching. `onRowClick` requires each row to also contain a real focusable link in its first
cell (the row click is a convenience, not the only path).

**States.** `loading` → `skeletonRows` rows of `Skeleton variant="row"` **inside the real table**,
so column widths do not jump when data lands. `empty` → the `empty` node spans all columns in a
single `<td colSpan>`. `error` → a `danger`-toned row spanning all columns with a retry `Button`.
`selectable` → a leading checkbox column; the header checkbox is tri-state via
`ref.indeterminate`. Sorting → `aria-sort` on the active `<th>` plus a `ChevronUp`/`ChevronDown`,
and an `aria-live="polite"` announcement of *"Sorted by Price, descending"*.

#### `PageHeader` — `src/components/admin/page-header.tsx`

```ts
export interface PageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: readonly { label: string; href?: string }[]
  actions?: React.ReactNode        // Buttons, right-aligned
  tabs?: React.ReactNode           // a <Tabs> rendered flush with the bottom rule
  meta?: React.ReactNode           // StatusPill, timestamps
}
```

`--text-admin-display` title, optional `--text-admin-body text-text-muted` description at
`max-w-(--measure-prose)`, and a single 1 px `--border` rule along the bottom — **this rule is the
only horizontal line above the content on an admin page**, which is what keeps the surface calm.
Breadcrumbs are `<nav aria-label>` + `<ol>` with `ChevronRight` separators at
`--text-admin-sm`. `title` becomes the `<h1>`; there is exactly one per page.
**No states.**

#### `Sidebar` — `src/components/admin/admin-sidebar.tsx` (with `admin-nav-link.tsx` and `branch-switcher.tsx`) **[C]**

```ts
export interface SidebarNavItem {
  id: string
  label: string
  href: string
  icon: React.ReactNode
  badge?: number                   // e.g. pending order count
  requires?: readonly string[]     // permission keys; the item is not rendered without them
}
export interface SidebarProps {
  items: readonly SidebarNavItem[]
  activeId: string
  restaurant: { name: string; logoUrl: string | null; slug: string }
  branch?: { id: string; name: string } | null
  branches?: readonly { id: string; name: string }[]
  onBranchChange?: (id: string) => void
  user: { name: string; role: string; email: string }
  collapsed: boolean
  onCollapsedChange: (v: boolean) => void
}
```

Width `--space-admin-sidebar-w`, collapsing to `--space-admin-sidebar-w-collapsed` (icons only,
labels moved to native `title`). `bg-surface-sunken`, a single `--border` right edge, no shadow.
Nav order is fixed by brief §11: Dashboard · Orders · Menu · Categories · Tables · Branches ·
Staff · Analytics · Settings.

The header holds the restaurant logo (or `LogoArtwork`, §10.6) beside the restaurant name — **the
one place Playfair appears in admin** (rule T7). Below it, a branch `Select` when the user has more
than one branch; a `WAITER` or `KITCHEN` role sees a static branch label instead, because their
scope is fixed (brief §16). Active item: `bg-accent-soft text-text` with a 2 px `--accent` leading
bar and `aria-current="page"`.

Below `lg` the sidebar is not rendered; it becomes a `Drawer` opened from the top bar.
**States.** `badge` count > 99 renders `99+`; `requires` filters items client-side **as a
convenience only** — the real enforcement is RLS (`02-security-and-rls.md`), and a hidden nav item
is never treated as a security control.

---

### 6.5 `common/` and cross-surface components

#### `LanguageSwitcher` — `src/components/common/locale-switcher.tsx` (export `LocaleSwitcher`) **[C]**

```ts
export type AppLocale = 'uz' | 'ru' | 'en'
export interface LanguageSwitcherProps {
  current: AppLocale
  variant?: 'segmented' | 'menu' | 'inline'   // default: 'segmented' customer, 'menu' admin
  size?: 'sm' | 'md'
  onChange?: (locale: AppLocale) => void      // omitted → the component performs the default write
}
```

Labels are the **endonyms**, always: `O'zbekcha` · `Русский` · `English`. Never
`UZ / RU / EN` alone (an abbreviation in a language you cannot read is not a way out), and
**never a flag** — flags denote countries, not languages, and Russian is not a Russian-only
language here.

Default behaviour on change: write the `qros_locale` cookie (`Path=/`, `SameSite=Lax`,
`Max-Age=31536000`, no `Secure` flag omission — it is set with `Secure` in production), then
`router.refresh()`. Because there is **no locale URL prefix** (frozen decision: QR links stay
short), the switcher must **not** rewrite the pathname. The `?lang=` query override exists for
deep links only and is stripped after being persisted to the cookie.

Each option carries `lang={locale}` and `hrefLang` where a link form is used, so a screen reader
switches voice. `aria-label` is *"Language"* in the **current** locale.
**States.** pending → the chosen option shows a 50% opacity until `router.refresh()` settles.

#### `QrPreview` — `src/components/admin/qr-preview.tsx` **[C]**

```ts
export interface QrPreviewProps {
  tableId: string
  tableLabel: string               // "Table 12" / "Стол 12" — printed under the code
  restaurantName: string
  publicUrl: string                // https://<domain>/t/<token> — display only
  pngUrl: string | null            // short-lived signed Storage URL, minted server-side
  size?: 'sm' | 'md' | 'lg'        // 120 / 200 / 320 px module box
  showUrl?: boolean                // default true in admin, false on a print sheet
  onRegenerate?: () => void
  onDownload?: () => void
}
```

The QR **image is never generated in the browser**. `02-security-and-rls.md` §8.2 makes a QR PNG a
bearer credential stored in the private `qr-codes` bucket; `pngUrl` is a 300 s signed URL minted by
a Node route. The component only *displays* it.

Presentation is a **table tent card**, not a bare code: a `--radius-card` panel in `--elevated`,
the restaurant name in Playfair at `--text-display-sm`, a `--rule-gold` hairline, the QR on a solid
`--color-white` plate with a 4-module quiet zone (never on a tinted or textured ground — it breaks
scanning), then `tableLabel` in `--text-overline` and the URL in `--font-mono --text-admin-mono
text-text-subtle`.

`onRegenerate` **must** be routed through `ConfirmDialog` with
`requireTyped={tableLabel}` and `tone="danger"`; regeneration invalidates printed material.

**States.** `pngUrl === null` → `Skeleton variant="block"` at the module box size while the signed
URL is minted; signed-URL expiry (an `onError` on the `<img>`) → `ErrorState size="sm"` with
`onRetry` that re-mints; `onDownload` in flight → the download `Button` goes `loading`.

#### `ImageUploader` — `src/components/admin/image-uploader.tsx` **[C]**

```ts
export interface ImageUploaderProps {
  value: { url: string; path: string } | null
  onChange: (v: { url: string; path: string } | null) => void
  scope: 'menu-item' | 'category' | 'promotion' | 'restaurant-logo'
  restaurantId: string
  branchId: string | null
  aspect?: '1:1' | '4:5' | '4:3' | '16:9'   // default per scope
  seed: string                     // so the empty well shows the dish's own DishArtwork
  maxBytes?: number                // default 5 * 1024 * 1024 — matches the server check
  disabled?: boolean
}
```

Client-side pre-checks mirror the server checks in `02-security-and-rls.md` §8.2 exactly and are
**advisory only** — MIME in `image/jpeg|png|webp`, size ≤ `maxBytes`, and a warning (not a block)
below 800 px on the short edge. The upload itself `POST`s the file to
`/api/admin/media` (Node runtime); the browser never talks to Storage directly and never sees a
service-role key.

The empty well is **not a dashed grey rectangle**. It renders the dish's own `DishArtwork` at 45%
opacity with an `ImageUp` icon and the localised prompt centred over it, inside a
`--radius-media` frame with a 1 px `--border` — so an item with no photo still looks composed in
the admin list, exactly as it will on the customer surface.

**States.** idle · drag-over (`border-accent` + `bg-accent-soft`) · uploading (a determinate 2 px
`--accent` progress bar along the bottom edge, driven by `XMLHttpRequest.upload.onprogress`;
`fetch` cannot report upload progress) · success (the new image crossfades in over
`--duration-base`) · error (`ErrorState size="sm"` inline, with the server's localised reason and
a retry) · `disabled` · replacing (the existing image dims to 50% while the new one uploads, and
the old Storage object is deleted **only after** the new row is written, so a failed write never
orphans the item).

---

## 7. Motion

### 7.1 The motion budget

| Surface | Budget |
|---|---|
| customer | Expressive. Up to 480 ms. Springs allowed. One expressive gesture per screen. |
| kitchen | 240 ms ceiling, and **one** looping animation in the whole surface (the late blink). |
| admin | 200 ms ceiling. No springs. Motion exists to show causality, not delight. |

Three rules everywhere:

1. **Animate `transform` and `opacity` only.** Anything animating `width`, `height`, `top`, `left`,
   `margin` or `box-shadow` is a bug. Layout-affecting change is done by measuring and applying a
   transform, or not at all.
2. **Nothing animates on first paint.** Entrance animations run on *mount after hydration*, gated by
   a `useHasMounted()` flag, so a server-rendered menu is not a slideshow.
3. **Every animation has an exit.** A component that springs in and disappears instantly reads as
   a glitch.

### 7.2 Add-to-cart flight

The signature interaction. Implemented in `src/lib/motion/fly-to-cart.ts` with the Web Animations
API — no library.

```ts
export interface FlyToCartOptions {
  origin: DOMRect          // the media well of the tapped card
  target: DOMRect          // the CartBar count badge
  imageUrl: string | null
  seed: string             // DishArtwork fallback when imageUrl is null
}
export function flyToCart(o: FlyToCartOptions): Promise<void>
```

1. Clone a 44 px circular crop of the dish image (or its `DishArtwork`) into a `position: fixed`
   node appended to `document.body`, `pointer-events: none`, `z-(--z-toast)`.
2. Animate over **460 ms / `--ease-entrance`** through **three keyframes**, so the path arcs rather
   than sliding on a straight line:
   - `offset: 0` — `translate(originX, originY) scale(1)`, `opacity: 1`
   - `offset: 0.45` — `translate(midX, originY - 64px) scale(0.72)`, `opacity: 1`, where
     `midX = originX + (targetX - originX) * 0.55`
   - `offset: 1` — `translate(targetX, targetY) scale(0.36)`, `opacity: 0`
   The `−64 px` lift at the midpoint is what makes it read as a *toss* into the bag.
3. On finish, remove the node and run the badge bump: `--animate-badge-bump`
   (`scale 1 → 1.28 → 1`, **260 ms / `--ease-spring`**), plus a 1-frame `--accent` flash on the
   badge background.
4. The cart count state updates at **`offset: 0.8`**, not on finish, so the number is already
   correct when the clone lands.

If the CartBar is not yet mounted (first item), it mounts *first* with `--animate-sheet-in`, and
the flight target is measured after that animation's `finished` promise resolves.

### 7.3 Kitchen ticket arrival

Composite, 4 seconds total, fired when a Realtime `INSERT` produces a ticket whose `id` was not in
the previous lane set:

| Layer | Spec |
|---|---|
| Card entrance | `translateY(-12px) → 0`, `opacity 0 → 1`, **240 ms / `--ease-standard`** |
| Ring pulse | `--animate-pulse-ring`: `box-shadow: 0 0 0 0 var(--lane-new)` → `0 0 0 10px transparent`, **900 ms / `--ease-out-quart`, 2 iterations** |
| Edge bar | the 6 px `--lane-new` bar animates `opacity 1 → 0.45 → 1` twice over the same 1.8 s |
| Sound | one 880 Hz sine, 120 ms, 0.18 gain, via a shared `AudioContext` in `src/lib/motion/kds-chime.ts` |
| Announcement | see §9.5 |

The `AudioContext` is created **lazily on the first user gesture** on the KDS (browsers refuse
otherwise) and the KDS layout shows a one-time *"Tap to enable sound"* bar until it is unlocked.
The chime is throttled to at most one per 800 ms so a burst of five orders is one ping, not five.
`isNew` clears after 4 s via a per-card timeout registered in the lane, not per card.

### 7.4 Status step fill

On `OrderProgressTracker` receiving a new status:

- Rail: `transform: scaleY(prev) → scaleY(next)`, **700 ms / `--ease-out-quart`**,
  `transform-origin: top`. 700 ms is deliberately slow — this is the one moment in the customer
  app where the product is *telling a story* about the kitchen, and a fast fill undersells it.
- Newly-completed dot: `scale(0.6) → 1`, **420 ms / `--ease-spring`**, starting at 200 ms into the
  rail fill so the rail visibly reaches the dot before it fills.
- New current-step halo: `opacity 0 → 1` over 200 ms, then a 2 s infinite
  `scale(1) → scale(1.35), opacity 0.5 → 0` breath. **This is the only looping animation on the
  customer surface** and it stops entirely at `ready`.
- Label: `opacity 0 → 1`, `translateY(4px) → 0`, 200 ms, delayed 120 ms.

### 7.5 Sheet drag

`src/lib/motion/use-drag-dismiss.ts`, Pointer Events only (no touch/mouse duplication):

```ts
export function useDragDismiss(opts: {
  onDismiss: () => void
  enabled: boolean
  threshold?: number   // px, default 96
  velocity?: number    // px/ms, default 0.6
}): {
  handleProps: React.HTMLAttributes<HTMLElement>   // spread onto the grabber
  sheetProps: React.HTMLAttributes<HTMLElement>    // spread onto the <dialog>
}
```

- `pointerdown` on the grabber → `setPointerCapture`, record `startY` and `startTime`, set
  `--drag-y: 0px` and **remove the transition** (`data-dragging` attribute).
- `pointermove` → `--drag-y: max(0, clientY - startY)px`. The sheet uses
  `translateY(var(--drag-y, 0px))`; the `::backdrop` opacity is
  `calc(1 - var(--drag-y) / var(--sheet-h))` clamped to `0.15`.
- `pointerup` → dismiss when `dragY > threshold` **or** `dragY / elapsed > velocity`; otherwise
  snap back over **260 ms / `--ease-spring-soft`**.
- Dismiss animation: `translateY(100%)`, **220 ms / `--ease-exit`**, then `dialog.close()`.
- Dragging is disabled entirely when the sheet's body is scrolled away from `scrollTop === 0`, so a
  scroll gesture never becomes a dismiss.

`--drag-y` and `--sheet-h` are written to the `<dialog>` element's own `style` attribute.
`::backdrop` **inherits from its originating element** in current browsers, which is what lets the
backdrop's opacity be expressed as a function of `--drag-y` without a second write. These are two
of the five JavaScript-written style attributes in the system; §12 C-4 lists all five and the CSP
directive they require.

### 7.6 Keyframes

```css
@layer base {
  @keyframes shimmer     { from { background-position: -160% 0 } to { background-position: 260% 0 } }
  @keyframes pulse-ring  { 0% { box-shadow: 0 0 0 0 var(--lane-new) }
                           100% { box-shadow: 0 0 0 10px transparent } }
  @keyframes badge-bump  { 0% { transform: scale(1) } 45% { transform: scale(1.28) }
                           100% { transform: scale(1) } }
  @keyframes sheet-in    { from { transform: translateY(100%) } to { transform: translateY(0) } }
  @keyframes dialog-in   { from { opacity: 0; transform: translateY(8px) scale(0.98) }
                           to   { opacity: 1; transform: translateY(0) scale(1) } }
  @keyframes toast-in    { from { opacity: 0; transform: translateY(12px) scale(0.98) }
                           to   { opacity: 1; transform: translateY(0) scale(1) } }
  @keyframes late-blink  { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
  @keyframes step-breath { 0% { transform: scale(1); opacity: 0.5 }
                           100% { transform: scale(1.35); opacity: 0 } }
}
```

### 7.7 Utility classes

The complete set. **No other custom utility may be added without adding it here.**

```css
@layer utilities {
  /* Tabular figures — every price, timer, quantity and order number. */
  .u-tnum { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }

  /* Optical alignment of a lucide icon against adjacent text. */
  .u-icon-align { transform: translateY(-0.5px); flex: none; }

  /* Film grain. Customer surface only; the guard makes it a no-op elsewhere. */
  .u-grain { position: relative; isolation: isolate; }
  .u-grain::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background-image: var(--texture-grain); background-repeat: repeat;
    opacity: calc(var(--ornament) * var(--texture-grain-opacity));
    mix-blend-mode: overlay;
  }

  /* Scroll-rail edge fade. A mask, not an overlay div — it works on any ground. */
  .u-edge-fade {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 16px,
                        #000 calc(100% - 16px), transparent 100%);
            mask-image: linear-gradient(to right, transparent 0, #000 16px,
                        #000 calc(100% - 16px), transparent 100%);
  }

  /* Reserve room for the CartBar on every scrollable customer page. */
  .customer-scroll { padding-block-end: var(--space-safe-bottom); }

  /* Line clamps. Two values only; a 3-line clamp means the copy is too long. */
  .u-clamp-1 { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
  .u-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  /* The gold hairline. Three permitted sites: under the CategoryRail, under a Sheet
     header, above the CartBar. Renders as a plain --border elsewhere via --rule-gold. */
  .u-rule-gold { border-color: var(--color-rule-gold); }

  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
  }
}
```

### 7.8 `prefers-reduced-motion`

The rule is **not** "turn everything off". Motion that communicates causality is kept and
shortened; motion that decorates is removed. Concretely:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
  /* Kept, because they carry meaning rather than decorate: */
  .rm-keep-fade { transition-duration: 100ms !important; }
}
```

| Interaction | Reduced-motion behaviour |
|---|---|
| Add-to-cart flight | **Not run at all.** `flyToCart()` returns immediately. Instead the badge count updates and a `polite` live region announces *"Plov added. 3 items in cart."* — the feedback moves from motion to language, which is the point. |
| Cart bar entrance | No slide. Renders in place with a 100 ms opacity fade (`.rm-keep-fade`). |
| Ticket arrival pulse | No pulse, no ring. The card renders with a **static 6 px `--lane-new` edge bar plus a 2 px `--lane-new` border** that persists for the full 4 s `isNew` window, then eases to the normal border. The chime and the assertive announcement are unchanged — reduced motion is not reduced *information*. |
| Status step fill | Instant. The dot and rail are painted in their final state; the `polite` sentence still fires. |
| Step-breath halo | Removed entirely (decoration). |
| Late blink | Replaced by a **solid** `--lane-late` bar plus the `AlarmClock` icon. |
| Sheet drag | **Unchanged.** Direct manipulation is not animation; a finger dragging a sheet must track the finger. Only the *snap-back* and *dismiss* tweens collapse to 1 ms. |
| Skeleton shimmer | Sweep removed; a static `--accent-soft` 4% tint remains so the placeholder still reads as pending. |
| Tabs indicator | Jumps instead of sliding. |
| `scroll-into-view` | `behavior: 'auto'`. Every call site reads the preference through `prefersReducedMotion()` in `src/lib/motion/prefers-reduced-motion.ts` (and `src/hooks/use-media-query.ts` for the reactive form) rather than hard-coding `'smooth'`. |

---

## 8. Anti-slop rules

These are the specific failure modes that turn a considered product into a generated one. Each is a
**must not**, paired with the thing to do instead. A pull request that trips one of these is
rejected on sight, regardless of how well it works.

| # | MUST NOT | DO INSTEAD |
|---|---|---|
| **8.1** | **No purple-blue gradient hero.** No `linear-gradient(135deg, #6366F1, #8B5CF6)`, no indigo→violet anything, no gradient text, no `bg-clip-text` headline. The `info` ramp is a muted slate-teal precisely so nobody reaches for indigo. | A hero is **photography or `DishArtwork` under a `--scrim-image-bottom` scrim**, with the headline in Playfair on top. Where there is no image, the ground is flat `--surface` and the hierarchy is carried by type size and a single `--rule-gold` hairline. Gradients exist in exactly two places in this product: the image scrim, and the `DishArtwork` mesh. |
| **8.2** | **No `rounded-2xl` on everything.** No 16 px radius on cards, buttons, inputs, badges and images alike. Uniform large radius is the single loudest tell of a template. | Radius is **semantic and small**: `--radius-card` (4–5 px) for cards, `--radius-control` (3–8 px) for controls, `--radius-media` for image wells, `--radius-full` for pills and the `QuantityStepper` only, `--radius-2xl` for the `Sheet`'s top corners only. If a component's radius is not one of those tokens, it is wrong. |
| **8.3** | **No stacked drop shadows.** No `shadow-lg shadow-xl`, no three-layer "soft glow" shadows, no coloured shadow under a card, no shadow on a dark ground pretending to do something. | **Two layers maximum, from the `--shadow-*` scale only.** On dark grounds elevation is `--elevated` + `--border` + the 4.5% inset hairline — the way a real object catches light rather than casts a fake one. `--shadow-overlay` is reserved for `Sheet`/`Dialog`/`Drawer`. |
| **8.4** | **No glassmorphism everywhere.** `backdrop-filter` on cards, panels, modals and nav simultaneously turns the whole UI to mush and costs a phone real frames. | `backdrop-filter` is permitted on **exactly two** elements: the sticky customer header + `CategoryRail`, and the `CartBar`. Both are chrome that overlays scrolling content, which is the only case where the effect means something. Everywhere else, opaque `--elevated`. |
| **8.5** | **No emoji as icons.** Not 🌶 for spice, not 🥗 for vegetarian, not 🎉 in a success toast, not 🍽 as a logo, not in seed data, not in localisation strings. | **lucide-react**, with the fixed concept→glyph mapping in §5. Spice is `Flame` glyphs (`SpicyMeter`); dietary information is `DietaryTags` with a text label, because "vegetarian" must be readable by a screen reader and translatable into three languages — an emoji is neither. |
| **8.6** | **No centred-everything landing layout.** No stack of centred `max-w-3xl mx-auto` blocks, each with a centred eyebrow, centred headline, centred paragraph and a centred pair of buttons. | The customer welcome screen is **left-aligned and asymmetric**: restaurant name in Playfair pushed to the leading edge, table number as a small `--text-overline` above it, welcome message at `max-w-(--measure-narrow)`, and the featured rail bleeding off the trailing edge. Centring is used for exactly two things: a full-viewport `EmptyState`/`ErrorState`, and the `QrPreview` tent card. |
| **8.7** | **No default shadcn silhouette.** No `bg-background text-foreground` naming, no `border border-input bg-background px-3 py-2 text-sm ring-offset-background` button, no `Card / CardHeader / CardTitle / CardDescription / CardContent / CardFooter` six-component ceremony, no `cva` variant strings copied from the registry. | The token names in this document (`--surface`, `--elevated`, `--text-muted`, `--accent-strong`) are deliberately **not** shadcn's, so copied snippets fail to compile rather than silently importing the look. `Card` is one component with a `padding` prop. Variants are plain records (§6.0). |
| **8.8** | **No generic 3-card feature row.** Three equal cards, each with a circled icon on top, a bold 3-word title and two lines of grey filler. | Where three things must be compared — the admin dashboard's revenue / orders / average — use `StatCard` in a row that is **explicitly numeric**: a big tabular figure, a small uppercase label, a real delta. Where three things are a *list*, render a list. The customer menu never has a feature row at all. |
| **8.9** | **No decorative form chrome.** No floating labels that animate into the border, no gradient focus glow, no inner `box-shadow` bevel, no icon-in-a-circle prefix. | `Input` is a flat well: `--surface-sunken`, 1 px `--border`, a persistent visible `<label>` above it, `--border` → `--accent` on focus plus the standard 2 px focus ring. The label never moves. |
| **8.10** | **No colour-only status.** No green/amber/red dot with no text. No red row that is the only signal a ticket is late. | `StatusPill` always renders **icon + localised word + colour**. The KDS late state is colour **and** an `AlarmClock` icon **and** a blinking edge bar **and** a red timer. Any one of them removed, the state is still legible. |
| **8.11** | **No fake data, ever.** No placeholder revenue, no invented chart while the real one loads, no `12,847` in a `StatCard` default, no lorem ipsum dish names shipped in a component. | `StatCard` renders `—` when there is no data and a `Skeleton` while loading. Demo tenants carry `restaurants.is_demo` and every `StatCard` on a demo tenant shows the *Demo data* badge (brief §11). |
| **8.12** | **No `<div onClick>`.** No clickable cards without a real focusable element, no `role="button"` on a div, no `tabIndex={0}` hand-rolled buttons. | Every action is a `<button>` or an `<a>`. `Card interactive` styles the *container* while the caller puts a real `<Link>` inside; the container is `pointer-events` transparent to focus. |
| **8.13** | **No hard-coded colour, radius, duration or font-size in a component.** No `#1a1a1a`, no `rgba(0,0,0,.4)`, no `text-[13px]`, no `duration-[300ms]`, no `rounded-[10px]`. | Every one of those has a token. `--color-*: initial` in §2 deletes Tailwind's stock palette so `bg-gray-800` does not even exist; the remaining escape hatch is arbitrary-value syntax, and it is banned by lint (§12 C-6). |
| **8.14** | **No animation on scroll.** No fade-up-on-reveal, no `IntersectionObserver`-driven entrance for menu items, no parallax. It costs frames on the exact devices our diners use and it delays the food. | Content is present when it paints. The only scroll-linked behaviour in the product is the `CategoryRail`'s active-chip tracking, which is *state*, not decoration. |
| **8.15** | **No stock illustration and no 3D blob.** No undraw figures, no isometric characters, no abstract gradient blobs in empty states. | `EmptyState` uses one 28 px lucide glyph in a `--surface-sunken` square. Where imagery is genuinely needed and absent, `DishArtwork` (§10) fills the space with something derived from the actual content. |
| **8.16** | **No "Powered by" row, no fake testimonials, no fake logos.** | Nothing that is not a real fact about this deployment appears on any screen. |

---

## 9. Accessibility

### 9.1 Contrast targets per surface

The palette in §2 was chosen to hit these; the ratios in the comments of §3.3 are the measured
sRGB values, not aspirations.

| Surface | Body text | Secondary text | Large text (≥ 24 px or ≥ 19 px bold) | Non-text (borders, icons, focus, chart strokes) |
|---|---|---|---|---|
| **customer** | **≥ 7:1** (AAA) — actual `--text` on `--surface` is **16.71:1** | ≥ 4.5:1 — `--text-muted` is **8.20:1**, `--text-subtle` **5.38:1** | ≥ 4.5:1 | ≥ 3:1 |
| **kitchen** | **≥ 12:1** — `--text` on `--surface` is **19.49:1** dark, **18.10:1** light | ≥ 7:1 — `--text-muted` is **11.97:1** | ≥ 7:1 | **≥ 4.5:1** — a KDS border must be visible from 2 m |
| **admin** | ≥ 4.5:1 (target 7:1) — `--text` on `--surface` is **16.88:1** light, **16.71:1** dark | ≥ 4.5:1 — `--text-muted` is **8.69:1** light | ≥ 3:1 | ≥ 3:1 |

Status colours, measured on their own surface ground:

| | dark ground (`ink-950`) | light ground (`ink-50`) |
|---|---|---|
| `--success` | 11.01:1 | 8.67:1 |
| `--warning` | 12.06:1 | 7.04:1 |
| `--danger` | 7.42:1 | 10.09:1 |
| `--info` | 9.32:1 | 9.10:1 |
| `--accent` | 10.46:1 | 6.40:1 |
| `--accent-contrast` on `--accent-strong` | 9.29:1 | 10.04:1 |

`--text-disabled` (`ink-600` dark / `ink-400` light) sits below 4.5:1 deliberately. WCAG exempts
disabled controls, and a disabled control that reads as strongly as an enabled one is a usability
defect. It is **never** used for enabled content.

**Enforcement.** `scripts/check-contrast.ts` reads the `@theme` block, resolves every
semantic mapping in §3.3 and §3.4, and asserts the table above. It runs in CI. Adding a semantic
token without adding it to the assertion list fails the build.

### 9.2 Tap and pointer targets

| Surface | Minimum | Token | Notes |
|---|---|---|---|
| customer | **48 × 48 px** | `--tap-min: 3rem` | `MenuItemCard`'s add button, `QuantityStepper` buttons, `CategoryRail` chips, the `CartBar` CTA. Chips may be visually 34 px tall provided the hit area is padded to 48 and adjacent chips are ≥ 8 px apart. |
| kitchen | **64 × 64 px** | `--tap-min: 4rem` | The advance button is full-card-width × 64 px. Kitchen staff wear gloves and are not looking at the screen while tapping. |
| admin | **32 × 32 px visual, 44 × 44 px hit** | `--tap-min: 2rem` | `IconButton` expands its hit area with a transparent `::before`; the visual box may be 32 or even 24 px in a `density="compact"` `DataTable` row. |

Adjacent targets are never closer than 8 px on customer and 12 px on kitchen.

### 9.3 Focus

- `:focus-visible` only. `:focus:not(:focus-visible)` clears the outline (§4.4). A mouse click on a
  card must not leave a ring; a Tab press must.
- `outline: 2px solid var(--focus); outline-offset: 2px`. `outline` — not `box-shadow` — so it
  follows `border-radius` and survives `overflow: hidden`.
- `--focus` resolves to `--accent-ring`: `gold-300` on dark (**12.19:1** on `--surface`),
  `wine-600` on light (**7.38:1**), `ink-25` in the kitchen. All clear the 3:1 non-text minimum
  against both the component and its ground.
- **Focus is never removed.** `outline: none` appears nowhere in this codebase except the one line
  in §4.4 that scopes it to `:focus:not(:focus-visible)`. This is lint-enforced (§12 C-6).
- A skip link (`z-(--z-skip-link)`) is the first focusable element in every layout: *Skip to menu*
  (customer), *Skip to tickets* (kitchen), *Skip to content* (admin).
- Overlay focus: `<dialog>.showModal()` handles trapping and restoration. Initial focus is set
  explicitly with `autoFocus` on the first interactive element — **except `ConfirmDialog`
  `tone="danger"`, where it goes to Cancel.**
- Keyboard escape hatches: every `Sheet`/`Dialog`/`Drawer` closes on Escape unless
  `dismissible={false}`, and a non-dismissible overlay always has a visible cancel control.

### 9.4 Semantics and language

- `<html lang>` is set from the resolved locale on every layout, and the `LanguageSwitcher`'s
  options each carry their own `lang`.
- `dir` is `ltr` for all three locales; no RTL work is in scope, and no component may assume
  physical direction — **use `inline-start`/`inline-end` logical properties and Tailwind's
  `ps-*`/`pe-*`/`start-*`/`end-*` utilities throughout**, so a future Arabic locale is a
  translation job, not a rewrite.
- One `<h1>` per page, supplied by `PageHeader` in admin and by the page itself elsewhere.
  Headings never skip a level.
- Landmarks: `<header>`, `<nav aria-label>`, `<main id="main">`, `<aside>`, `<footer>`. The KDS
  lanes are three `<section aria-labelledby>` elements inside `<main>`.
- Every icon-only control has a localised `aria-label` (enforced by `IconButton`'s required
  `label`).
- Decorative images (`DishArtwork` behind a real photo) are `aria-hidden="true"` with `alt=""`.
  A real dish photo takes `alt={dishName}` — the name, not "photo of".

### 9.5 Live regions

This is where a real-time product usually fails, so the rules are exact.

| Region | Element | Politeness | Content |
|---|---|---|---|
| **Customer order status** | one `<p class="sr-only" aria-live="polite" aria-atomic="true">` inside `OrderProgressTracker` | `polite` | A **complete localised sentence**, regenerated on every status change: *"Buyurtmangiz A-014 tayyorlanmoqda. Taxminan 19:42 da tayyor boʻladi."* Never the bare status word. Never the diff. |
| **Cart** | one `<p class="sr-only" aria-live="polite" aria-atomic="true">` in the customer layout | `polite` | *"Plov added. 3 items, 84 000 soʻm."* Fires on add, remove and quantity change, debounced 400 ms so a triple-tap on `+` announces once. |
| **Kitchen — new ticket** | one `<p class="sr-only" aria-live="assertive">` in the KDS layout | `assertive` | *"New order A-014, table 12, 3 items."* One announcement per ticket, throttled to one per 800 ms with a batched fallback: *"4 new orders."* |
| **Kitchen — lane counts** | `<span role="status">` in each lane header | `polite` (implicit) | *"Preparing: 6"*. Updated on every change; screen readers coalesce. |
| **Waiter call** | `<p class="sr-only" aria-live="assertive">` in the waiter layout | `assertive` | *"Table 12 is calling. Reason: request bill."* |
| **Toasts** | two containers in `Toaster` | `polite` for neutral/success/info, `assertive` + `role="alert"` for warning/danger | The toast title and description. |
| **Form errors** | the `<p id>` under an `Input` | `role="alert"` **only after a submit attempt**, plain text while typing | The localised message. |
| **DataTable sort** | `<span class="sr-only" aria-live="polite">` | `polite` | *"Sorted by Price, descending."* |

Hard rules:

1. **Never put `aria-live` on a list that reorders.** The KDS lane `<ul>` is not a live region; the
   sibling announcer paragraph is. A live `<ul>` re-announces every ticket on every sort.
2. **The live region must exist in the DOM before the content changes.** All of the above are
   mounted empty by their layout, never created at announcement time.
3. **`assertive` is used four times in the whole product** (new ticket, waiter call, danger toast,
   post-submit form error). Everything else is `polite`.
4. `aria-atomic="true"` on any region whose text is a sentence; omitted where it is an appended
   log.

### 9.6 Motion, sound and reduced-transparency

- `prefers-reduced-motion` is honoured per §7.8, and the reduced path always substitutes
  *information* for the removed motion, never nothing.
- The KDS chime is opt-out from the KDS settings sheet and off until a user gesture unlocks audio.
  Sound is never the only channel: the pulse, the edge bar and the assertive announcement all
  carry the same event.
- `prefers-reduced-transparency: reduce` → the two permitted `backdrop-filter` elements (§8.4) drop
  the blur and become opaque `--elevated`.
- `prefers-contrast: more` → `--border` steps to `--border-strong`, `--text-muted` steps to
  `--text`, and the focus outline widens to 3 px. One block, at the end of §3.

---

## 10. Food imagery — the `DishArtwork` system

### 10.1 The problem, stated honestly

The brief asks for candle-lit food photography. **We have no photo assets, and we will launch
tenants who have none either.** Every menu will therefore contain items with `image_url IS NULL`,
often for months. The three ways this normally goes wrong are: a grey box, a generic stock plate
that lies about the dish, and a broken-image glyph. All three make a premium product look
abandoned.

The answer is a **deterministic generated plate**: a warm gradient mesh derived from a hash of the
dish, a serif monogram, a grain overlay and a gold hairline. It is not pretending to be a
photograph. It reads as *deliberate art direction* — like a menu whose designer chose colour fields
instead of pictures — and because it is deterministic, the same dish is the same plate on every
device, every render and every reload, and a category of dishes acquires a recognisable rhythm.

### 10.2 The seed

```ts
// src/lib/art/seed.ts
/** FNV-1a 32-bit. Stable across V8, JSC and SpiderMonkey; no Math.random, no Date. */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * The seed for a menu item. `name` MUST be the dish name in the RESTAURANT'S
 * default_locale — never the viewer's locale — so a Russian diner and an Uzbek
 * diner see the same plate for the same dish. The id tail keeps two dishes with
 * the same name in different categories visually distinct.
 */
export function dishSeed(nameInDefaultLocale: string, id: string): string {
  return `${nameInDefaultLocale.trim().toLocaleLowerCase('en')}·${id.slice(0, 8)}`
}
```

Renaming a dish changes its plate. That is intentional and acceptable: to a diner a renamed dish is
a different dish. What is **not** acceptable is the plate changing when the *viewer's* language
changes, which is why the seed is pinned to `restaurants.default_locale`.

### 10.3 The plates

Hue is **not** free. Six hand-picked warm plates, selected by `hash % 6`, guarantee that no dish
ever lands on lime green or SaaS indigo, and that the whole menu reads as one restaurant. Each
plate is a `[base, mid, highlight]` triple; the values below are the exact sRGB hexes of the oklch
colours in the comment.

```ts
// src/lib/art/plates.ts
export interface Plate { readonly name: string; readonly base: string; readonly mid: string; readonly hi: string }

export const PLATES: readonly Plate[] = [
  { name: 'wine',    base: '#270c10', mid: '#591f26', hi: '#a7593d' }, // oklch .20/.045/14 · .33/.085/16 · .55/.11/40
  { name: 'ember',   base: '#230c07', mid: '#581d12', hi: '#aa6926' }, // .19/.04/34 · .32/.09/32 · .58/.115/62
  { name: 'saffron', base: '#211205', mid: '#503000', hi: '#a77f23' }, // .20/.035/62 · .34/.075/70 · .62/.115/84
  { name: 'herb',    base: '#151505', mid: '#2f3410', hi: '#837435' }, // .19/.03/110 · .31/.055/116 · .56/.085/96
  { name: 'clove',   base: '#1c0e05', mid: '#432010', hi: '#8b5f18' }, // .18/.03/52 · .29/.06/44 · .52/.10/74
  { name: 'char',    base: '#140e09', mid: '#332619', hi: '#775f32' }, // .17/.014/60 · .28/.03/66 · .50/.07/82
] as const

/** Blob layouts in unit space: [cx, cy, r] × 3. Four arrangements × six plates × 24
 *  rotations = 576 visually distinct plates before the monogram is considered. */
export const LAYOUTS: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0.22, 0.28, 0.62], [0.78, 0.34, 0.55], [0.52, 0.86, 0.70]],
  [[0.80, 0.22, 0.66], [0.18, 0.62, 0.58], [0.62, 0.92, 0.52]],
  [[0.32, 0.80, 0.68], [0.72, 0.58, 0.60], [0.14, 0.16, 0.50]],
  [[0.50, 0.18, 0.72], [0.12, 0.74, 0.56], [0.88, 0.76, 0.54]],
] as const

export const MONOGRAM_FILL = '#eed9a8'   // gold-200
export const HAIRLINE      = '#d6a944'   // gold-500
```

Derivation from the hash — fixed, do not improvise:

| Value | Expression | Range |
|---|---|---|
| plate | `PLATES[h % 6]` | 6 |
| layout | `LAYOUTS[(h >>> 5) % 4]` | 4 |
| rotation | `((h >>> 9) % 25) - 12` | −12°…+12° |
| highlight blob | `(h >>> 14) % 3` | which of the three blobs gets `plate.hi` |
| monogram x | `0.5 + (((h >>> 18) % 9) - 4) / 100` | 0.46…0.54 |

### 10.4 The component

```ts
// src/components/common/dish-artwork.tsx   (Server Component — pure, no 'use client')
export interface DishArtworkProps {
  seed: string                     // from dishSeed()
  monogram: string                 // the localised display name; only its first grapheme is used
  ratio?: '1:1' | '4:5' | '4:3' | '16:9'   // default '1:1'
  showMonogram?: boolean           // default true; false below ~64px, where a letter is noise
  grain?: boolean                  // default true; forced false when --ornament is 0
  className?: string
}
```

Output is a single inline `<svg>` — no network request, no `data:` URI, no hydration mismatch
(the component is a pure function of its props), and no CSP interaction at all.

```tsx
<svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice"
     role="presentation" aria-hidden="true" focusable="false" className={cn('block h-full w-full', className)}>
  <defs>
    <radialGradient id={`${uid}-a`} cx="22%" cy="28%" r="62%">
      <stop offset="0%"   stopColor={plate.mid} stopOpacity="0.95" />
      <stop offset="100%" stopColor={plate.mid} stopOpacity="0" />
    </radialGradient>
    {/* -b and -c identically, from LAYOUTS[layout][1] and [2]; the blob chosen by
        `highlight blob` uses plate.hi instead of plate.mid */}
    <filter id={`${uid}-grain`} x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.86" numOctaves="3" stitchTiles="stitch" result="n" />
      <feColorMatrix in="n" type="saturate" values="0" result="g" />
      <feComponentTransfer in="g"><feFuncA type="linear" slope="0.5" /></feComponentTransfer>
    </filter>
  </defs>

  <rect width="800" height="1000" fill={plate.base} />
  <g transform={`rotate(${rotation} 400 500)`}>
    <rect width="800" height="1000" fill={`url(#${uid}-a)`} />
    <rect width="800" height="1000" fill={`url(#${uid}-b)`} />
    <rect width="800" height="1000" fill={`url(#${uid}-c)`} />
  </g>

  {showMonogram && (
    <text x={monoX} y="512" textAnchor="middle" dominantBaseline="central"
          fontFamily="var(--font-display)" fontWeight="500" fontSize="380"
          letterSpacing="0.02em" fill={MONOGRAM_FILL} fillOpacity="0.13">
      {firstGrapheme(monogram).toLocaleUpperCase('en')}
    </text>
  )}

  {grain && <rect width="800" height="1000" filter={`url(#${uid}-grain)`} opacity="0.055"
                  style={{ mixBlendMode: 'overlay' }} />}
  <rect x="0.5" y="0.5" width="799" height="999" fill="none"
        stroke={HAIRLINE} strokeOpacity="0.10" strokeWidth="1" />
</svg>
```

Three implementation requirements:

- `uid` comes from `React.useId()` in the client wrapper and from a deterministic
  `dish-${hash.toString(36)}` in the server path. SVG `id`s are **document-global**; two artworks
  sharing an id means the second one inherits the first one's gradients. This is the single most
  likely bug in this component.
- `firstGrapheme()` uses `Intl.Segmenter` where available and falls back to `[...s][0]`, so `Oʻ`
  yields `O` and a Cyrillic `Плов` yields `П` rather than a broken surrogate half. Uppercasing is
  pinned to `'en'`: none of `uz`/`ru`/`en` has a locale-specific casing rule that matters here, and
  a fixed locale keeps the plate identical across viewers.
- A `dishArtworkDataUri(seed, monogram, w, h)` variant exists in `src/lib/art/data-uri.ts` for the
  two places that need a CSS `background-image` (the `ImageUploader` empty well and the OG image
  route). It emits the same markup, `encodeURIComponent`-escaped, with the font family resolved to
  the literal `Playfair Display, Georgia, serif` because CSS custom properties do not cross into a
  `data:` URI.

### 10.5 Scrims

Whenever cream text sits over artwork or a photo, a scrim guarantees the contrast. The two tokens
are defined in §2 (texture section) and repeated here for reference:

```css
  --scrim-image-bottom: linear-gradient(to top,
      oklch(0.124 0.006 60 / 0.94) 0%,
      oklch(0.124 0.006 60 / 0.62) 34%,
      oklch(0.124 0.006 60 / 0.14) 62%,
      transparent 84%);
  --scrim-image-flat: oklch(0.124 0.006 60 / 0.42);
```

`--scrim-image-bottom` is used by `FeaturedCard` and the customer hero; `--scrim-image-flat` by the
`MenuItemCard` unavailable state. **Text over an image without a scrim is a review rejection**, no
exceptions — a photograph's local luminance cannot be predicted, so the measured contrast is
against the scrim, not against the picture.

### 10.6 How a real image replaces the artwork

`src/components/common/dish-image.tsx` **(new file; wraps 05's `ui/safe-image.tsx`)** **[C]** is the only component that renders a dish picture,
and it always renders the artwork too:

```ts
export interface DishImageProps {
  src: string | null               // menu_items.image_url
  alt: string                      // the localised dish name — not "photo of …"
  seed: string
  monogram: string
  ratio: '1:1' | '4:5' | '4:3' | '16:9'
  sizes: string                    // REQUIRED — next/image needs it for a correct srcset
  priority?: boolean               // true for the first FeaturedCard only
  dimmed?: boolean                 // the unavailable state
  className?: string
}
```

The layered model:

1. `DishArtwork` renders **first and always**, filling the frame. It is the background, not a
   fallback.
2. When `src` is non-null, a `next/image` sits on top at `opacity-0`, transitioning to
   `opacity-100` over **`--duration-base` / `--ease-standard`** on `onLoad`. Because the artwork is
   already painted at the correct aspect ratio, there is **no grey box, no layout shift and no
   flash** — the photograph fades in over a composed plate.
3. `onError` (an expired signed URL, a deleted object, an offline device) leaves the artwork in
   place and sets `data-image-error` for diagnostics. **The customer never sees a broken image.**
4. `sizes` is required by the prop type because omitting it makes `next/image` request a
   full-viewport-width source for an 88 px thumbnail — the most common performance regression in a
   Next.js image grid. Canonical values: `MenuItemCard` `"88px"`, `FeaturedCard`
   `"(min-width: 640px) 320px, 78vw"`, product detail `"(min-width: 640px) 560px, 100vw"`,
   admin list `"56px"`.
5. `next.config.ts` already restricts `images.remotePatterns` to the project's Supabase host and
   `/storage/v1/object/public/**`. **No other image host is added.**
6. The KDS renders **no images at all** and therefore never mounts `DishImage`.

### 10.7 Logos and category art

- `src/components/common/logo-artwork.tsx` **(new file)** — the same generator seeded with
  `dishSeed(restaurant.name, restaurant.id)`, forced to the `wine` plate, square, monogram at 22%
  opacity. Used in the `Sidebar` header, the customer welcome screen and the `QrPreview` tent card
  when `restaurants.logo_url IS NULL`.
- `menu_categories.image_url IS NULL` → `DishArtwork` seeded from the category, `showMonogram`
  false below 64 px (`CategoryRail` thumbs), true at larger sizes.
- `promotions.image_url IS NULL` → `DishArtwork` with `ratio="16:9"` and the promotion title's
  first grapheme as the monogram.

---

## 11. File manifest

Every file this document creates or owns. An implementer building the design system builds exactly
this list; nothing else under `src/components/ui/**` or `src/components/common/**` is authorised
without an amendment here. Paths follow `05-app-structure.md`'s tree and kebab-case convention;
entries marked **(new file)** extend that tree (§0).

| Path | Owner | Notes |
|---|---|---|
| `src/app/globals.css` | this doc | §2 `@theme` + §3.2 `@theme inline` + §3.3/§3.4 `@layer base` + §7.6 keyframes + §7.7 utilities |
| `src/lib/fonts.ts` | this doc | §4.2 — exports `sansFont`, `displayFont`, `monoFont`, `fontVariables` |
| `src/lib/cn.ts` | this doc | §6.0 |
| `src/lib/theme/theme-script.ts` | this doc | §3.5 |
| `src/lib/motion/fly-to-cart.ts` | this doc | §7.2 |
| `src/lib/motion/kds-chime.ts` | this doc | §7.3 |
| `src/lib/motion/use-drag-dismiss.ts` | this doc | §7.5 |
| `src/hooks/use-elapsed.ts` | `05-app-structure.md` | one shared 1 Hz tick for all KDS timers; this doc specifies its use, 05 owns the file |
| `src/lib/motion/prefers-reduced-motion.ts` (and `src/hooks/use-media-query.ts` for the reactive form) | this doc | §7.8 |
| `src/lib/art/seed.ts` | this doc | §10.2 |
| `src/lib/art/plates.ts` | this doc | §10.3 |
| `src/lib/art/data-uri.ts` | this doc | §10.4 |
| `src/lib/art/grain.ts` | this doc | the `--texture-grain` source string |
| `src/lib/money.ts` | `01-database-schema.md` | this doc only *consumes* `Money` and `formatMoney` |
| `scripts/check-contrast.ts` | this doc | §9.1, runs in CI |
| `src/components/ui/button.tsx` | this doc | also exports `buttonClasses()` |
| `src/components/ui/icon-button.tsx` | this doc | |
| `src/components/ui/badge.tsx` | this doc | |
| `src/components/ui/status-pill.tsx` **(new file — add to 05's `ui/` tree)** | this doc | the only status→colour map |
| `src/components/ui/card.tsx` | this doc | |
| `src/components/ui/sheet.tsx` | this doc | native `<dialog>` |
| `src/components/ui/dialog.tsx` | this doc | native `<dialog>` |
| `src/components/ui/drawer.tsx` **(new file)** | this doc | degrades to `Sheet` below `md` |
| `src/components/ui/input.tsx` | this doc | |
| `src/components/ui/textarea.tsx` | this doc | |
| `src/components/ui/select.tsx` | this doc | styled native `<select>` |
| `src/components/ui/switch.tsx` | this doc | `role="switch"` |
| `src/components/ui/tabs.tsx` | this doc | full ARIA tabs |
| `src/components/ui/segmented-control.tsx` **(new file)** | this doc | `role="radiogroup"` |
| `src/components/ui/skeleton.tsx` | this doc | |
| `src/components/ui/empty-state.tsx` | this doc | |
| `src/components/ui/error-state.tsx` | this doc | exhaustive over `QrErrorCode` |
| `src/components/ui/toast.tsx` | this doc | one toast, five tones |
| `src/components/ui/toaster.tsx` | this doc | per-surface placement, two live regions |
| `src/components/common/toast-provider.tsx` + `src/hooks/use-toast.ts` | `05-app-structure.md` | the store and the `toast()` entry point; this doc specifies tones, placement and the two live regions |
| `src/components/ui/confirm-dialog.tsx` | this doc | |
| `src/components/ui/quantity-stepper.tsx` | this doc | |
| `src/components/customer/spicy-meter.tsx` | this doc | |
| `src/components/customer/dietary-tags.tsx` | this doc | warnings sort first, never hidden |
| `src/components/customer/category-rail.tsx` | this doc | |
| `src/components/customer/menu-item-card.tsx` | this doc | also exports `MenuItemCardSkeleton` |
| `src/components/customer/featured-card.tsx` **(new file; `featured-rail.tsx` in 05 composes it)** | this doc | also exports `FeaturedRail` |
| `src/components/customer/cart-fab.tsx` (05's filename; the export is `CartBar` and it is a bar, not a circular FAB — see R-9) | this doc | |
| `src/components/customer/order-status-stepper.tsx` (export `OrderStatusStepper`) | this doc | |
| `src/components/kitchen/ticket-card.tsx` (with `ticket-lines.tsx`, `ticket-timer.tsx`, `ticket-actions.tsx` as its parts) | this doc | also exports `KitchenTicketSkeleton` |
| `src/components/admin/stat-card.tsx` | this doc | |
| `src/components/ui/data-table.tsx` | this doc | real `<table>` |
| `src/components/admin/page-header.tsx` | this doc | |
| `src/components/admin/admin-sidebar.tsx` (with `admin-nav-link.tsx` and `branch-switcher.tsx`) | this doc | |
| `src/components/admin/theme-toggle.tsx` | this doc | §3.5 |
| `src/components/common/price.tsx` (export `Price`) | this doc | the only money formatter |
| `src/components/common/locale-switcher.tsx` (export `LocaleSwitcher`) | this doc | endonyms, no flags |
| `src/components/admin/qr-preview.tsx` | this doc | displays a server-minted signed URL |
| `src/components/admin/image-uploader.tsx` | this doc | posts to `/api/admin/media` |
| `src/components/common/dish-artwork.tsx` **(new file)** | this doc | §10.4 |
| `src/components/common/dish-image.tsx` **(new file; wraps 05's `ui/safe-image.tsx`)** | this doc | §10.6 |
| `src/components/common/logo-artwork.tsx` **(new file)** | this doc | §10.7 |

---

## 12. Contracts and open items

### 12.1 Contracts other agents must honour verbatim

| # | Contract |
|---|---|
| **C-1** | `src/middleware.ts` sets an `x-qros-surface` request header (`customer` \| `kitchen` \| `admin`) from the pathname, and `src/app/layout.tsx` — the only layout that may render `<html>` — writes it to `data-surface`. For admin and kitchen, `data-theme="light" \| "dark"` is written **before first paint** by the inline script in `src/lib/theme/theme-script.ts`. A page with no `data-surface` renders admin-light by design, which is wrong for a customer route, so the header must never be dropped. |
| **C-2** | `<html className={fontVariables}>` from `src/lib/fonts.ts` (all three families, applied once in the root layout). Do not apply font variables in a nested layout. |
| **C-3** | **`--font-src` must stay `'self'`.** `next/font/google` self-hosts. Nobody adds a `fonts.googleapis.com` `<link>`. |
| **C-4** | **The CSP in `02-security-and-rls.md` §8.3 must gain `style-src-attr 'unsafe-inline'`.** React sets `style={{ … }}` as an inline `style` attribute, and this design system needs exactly five dynamic values that cannot be enumerated as classes: `--drag-y` and `--sheet-h` (§7.5), the `Tabs` indicator `translateX`/`width` (§6.1), the `OrderProgressTracker` rail `scaleY` (§7.4), the `ImageUploader` progress width, and the `Toaster` stack offsets. `style-src-attr 'unsafe-inline'` permits attribute styles **without** permitting `<style>` injection or external stylesheets, so `style-src 'self' 'nonce-…'` stays as written. Without this directive those five interactions silently do nothing in production and work in dev. |
| **C-5** | Every route-group layout mounts, once: `<Toaster />`, the skip link, and its surface's live-region paragraphs from §9.5 — **mounted empty at layout level**, never created at announcement time. |
| **C-6** | ESLint gains three rules, in `eslint.config.mjs`: (a) `no-restricted-syntax` banning Tailwind arbitrary-value class literals matching `/\b(?:bg|text|border|rounded|shadow|duration|ease)-\[/` outside `src/app/globals.css`; (b) `no-restricted-syntax` banning the string `outline: none` and the class `outline-none` outside `globals.css`; (c) `no-restricted-imports` banning `import * as` from `lucide-react`. |
| **C-7** | Money is rendered **only** by `<PriceTag>`. No other file may call `Intl.NumberFormat` with a `currency` style. `PriceTag` receives `currency` and `decimals` from `restaurants.currency` / `restaurants.currency_decimals` (never hard-coded `'UZS'`, never `0`). |
| **C-8** | `order_status` → colour is mapped **only** in `StatusPill`. No page, table cell or ticket may write its own status colour. |
| **C-9** | Menu components receive `orderable: boolean` computed by `src/lib/menu/orderability.ts` (`01-database-schema.md` §6.8). **They must not re-derive availability from `is_available`**, which ignores `unavailable_until` and the daypart window. |
| **C-10** | `DishImage` requires a `sizes` string. Any call site that cannot state one is using the wrong component. |
| **C-11** | Localised strings reach components already resolved — components never call `pickI18n()` themselves and never receive a raw `i18n_text` JSON object, except `DishArtwork`, which receives the **default-locale** name as its seed and the **viewer-locale** name as its monogram. |
| **C-12** | The KDS never renders `DishImage`, `DishArtwork`, Playfair or JetBrains Mono, so their font files are never fetched on a kitchen tablet. Any `font-display`/`font-mono` class under `src/app/(staff)/kitchen/**` is a bug. |
| **C-13** | The customer surface never renders `Dialog` or `Drawer`; it renders `Sheet`. `05-app-structure.md`'s `@modal` parallel slot under `(customer)/t/[token]` is a `Sheet`. |
| **C-14** | Nobody adds `tailwind.config.js`, Radix UI, Headless UI, `class-variance-authority`, `framer-motion`, `sonner`, or shadcn/ui. |
| **C-15** | `qr-codes` Storage objects are never referenced by a raw public URL. `QrPreview` takes a server-minted 300 s signed URL as `pngUrl` and must handle its expiry (§6.5). |
| **C-16** | Every new semantic colour token is added to `scripts/check-contrast.ts`'s assertion list in the same commit. |

### 12.2 Open risks

| # | Risk | Mitigation / who decides |
|---|---|---|
| **R-1** | **The order-tracking URL is specified two ways.** `01-database-schema.md` §5.3 says `/o/<public_code>` (12 chars, 72 bits); `02-security-and-rls.md` §4 says `/t/<qr_token>/order/<orders.public_token>` (24 chars, 144 bits, additionally gated on the table token). No component in this document hard-codes either — `OrderProgressTracker` is route-agnostic and receives status as a prop. **The routing agent must resolve this and update whichever document is wrong.** The security document's shape is the stronger one. |
| **R-2** | **`style-src-attr` (C-4).** If the security owner declines, the five dynamic values must be re-expressed as a bounded set of pre-generated classes (e.g. 21 progress steps at 5% each) and drag-to-dismiss must be dropped in favour of a tap-to-close grabber. That is a real product regression; raise it before implementation rather than discovering it in staging. |
| **R-3** | **Playfair Display's Cyrillic cut is lighter than its Latin.** At `--text-display-xl` a Russian restaurant name will read slightly thinner than the English one. If a side-by-side check shows it, the fix is `font-weight: 600` for `:lang(ru)` display text only — one rule in `globals.css`, not a second font. |
| **R-4** | **`backdrop-filter` on the `CategoryRail` costs frames on low-end Android.** If field testing on a sub-$150 device shows dropped frames while scrolling the menu, drop to opaque `--surface` on the rail (keep it on the `CartBar`, which does not scroll). Measure before optimising. |
| **R-5** | **KDS dark-vs-light under real kitchen lighting is a guess.** §3.4 ships both and defaults to dark because that is the industry norm, but glare on a glossy tablet under overhead fluorescents can invert that. The device-scoped `localStorage['qros:kds:theme']` setting exists so a venue can flip it without a deploy. Validate at the first pilot restaurant. |
| **R-6** | **`--radius-2xl` on the `Sheet` and `--radius-full` on pills are the two places this system is closest to the template look it forbids.** They are permitted because they are load-bearing (a sheet's corners signal draggability; a pill signals non-interactive status). If a design review says the customer surface reads generic, these two are the first tokens to interrogate. |
| **R-7** | **`DishArtwork` at scale.** Six plates × four layouts × 25 rotations is 600 combinations before the monogram. A 200-item menu will contain visible repeats of the same plate+layout pair. That is acceptable — it reads as a series — but if a tenant complains, the fix is more layouts, **not** more hues; widening the hue range is what would make it look random instead of art-directed. |
| **R-8** | **`prefers-reduced-transparency` and `prefers-contrast` have partial support.** Both blocks are progressive enhancement; the base experience must already pass §9.1 without them. Do not use them to rescue a failing contrast pair. |
| **R-9** | **`cart-fab.tsx` is a misleading filename.** `05-app-structure.md` names the customer cart affordance `cart-fab.tsx`, but §6.2 specifies a full-width bottom **bar**, not a circular floating action button — §8.6 and the one-handed reach argument both require the bar. This document keeps 05's path and exports `CartBar` from it. If 05 is amended, rename to `cart-bar.tsx` in both documents in one commit. |
| **R-10** | **`05-app-structure.md` §2.1 uses token names that do not exist here** (`bg-surface-base`, `text-ink`) and a single hard-coded `themeColor` of `#0B0B0C`. Both are §0 amendments 2 and 3. Until they are applied, the root layout's body will render with no background and no colour. This is the highest-priority cross-document fix. |

### 12.3 Review checklist

A screen is not done until every line is true.

- [ ] No hex, `rgb()`, `hsl()` or `oklch()` literal outside `globals.css`.
- [ ] No Tailwind arbitrary value for colour, radius, shadow, duration or font size.
- [ ] Radius is one of `--radius-control` / `--radius-card` / `--radius-media` / `--radius-full`.
- [ ] At most one shadow token per element; none on a dark ground.
- [ ] Every icon is lucide; no emoji anywhere, including in copy and seed data.
- [ ] Every icon-only control has a localised label.
- [ ] Loading, empty and error states exist and were viewed, not assumed.
- [ ] Screen was read in **Russian** (the longest strings) and nothing truncated or wrapped badly.
- [ ] Every price, timer, quantity and order number is `.u-tnum`.
- [ ] Tab order is sane; every interactive element shows the focus ring; nothing is reachable only by mouse.
- [ ] Live-region announcements are complete sentences, and were heard with VoiceOver or NVDA.
- [ ] `prefers-reduced-motion` was toggled on and the screen still communicates every state change.
- [ ] Contrast checked against §9.1 for the surface, in **both** themes where the surface has two.
- [ ] Tap targets meet the surface minimum; the KDS was checked from two metres away.
- [ ] Nothing on screen is fake, placeholder or invented.
