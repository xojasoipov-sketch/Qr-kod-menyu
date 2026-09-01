# RESTAURANT QR OS — 05. Next.js Application Structure

**Status:** FINAL. Binding for everything under `src/app/**`, `src/components/**`, `src/hooks/**`,
`src/middleware.ts`, `src/messages/**`, `public/**`, and for the file layout of
`supabase/migrations/**`.

**Upstream (read these first, they are binding on their own subjects):**
- `docs/BRIEF.md` — product.
- `docs/architecture/01-database-schema.md` — table names, column names, enum labels.
- `docs/architecture/02-security-and-rls.md` — RPC surface, grants, wire error catalogue.
- `docs/architecture/03-domain-and-types.md` — `src/types/**` and `src/lib/**` contracts.

**What this document owns:** route tree, layouts, Server/Client component split, cart state,
auth middleware and session caching, the complete Server Action and Route Handler inventory,
data-fetching and caching directives, environment variables, and demo mode.

Every identifier here — file path, route, action name, header, cookie, env var — is **binding**.
Agents implementing disjoint slices of the tree in §1 must not invent, rename or relocate files.

---

## 0. Frozen decisions restated, and three amendments

### 0.1 Frozen (do not relitigate)

| Decision | Consequence for this layer |
|---|---|
| Next.js 16.3 App Router, React 19.2, TS strict | `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` are **Promises**. Every page/layout that touches them is `async` and `await`s them. |
| Tailwind CSS v4, CSS-first | Exactly one stylesheet, `src/app/globals.css`, starting `@import "tailwindcss";` followed by `@theme { … }`. **No `tailwind.config.js` exists in this repository.** `postcss.config.mjs` (already present) is the only build hookup. |
| Supabase Postgres + Auth + Realtime + Storage, `@supabase/ssr` 0.12 | Cookie auth via `getAll`/`setAll` only. See §4.2. |
| zod v4 | Every boundary parses. Schemas come from `src/lib/validation/*` and `src/lib/rpc/schemas.ts` (doc 03 §7). |
| Money = BIGINT minor units, `type Money = number` | No component ever formats money itself; it renders `<Price>` / `formatMoney` (doc 03 §5). |
| Locales `uz | ru | en`, **no URL prefix** | Locale = cookie `qros_locale` + optional `?lang=` override. `/t/<token>` stays short. §4.6. |
| Public customer routes unauthenticated, `/t/[token]` | Anon capability RPCs only. Never the cookie client. |
| Node runtime for anything touching the service-role key | `export const runtime = 'nodejs'` on every segment under `src/app/(customer)/t/**`, `src/app/api/**`, and on `src/middleware.ts`. |

### 0.2 Amendment A — cart persistence is `sessionStorage`, not `localStorage`

Doc 03 §2.2 describes `src/lib/cart/cart-store.ts` as "`localStorage` persistence". **This document
overrides that to `sessionStorage`**, and doc 03's one-line description is amended accordingly. The
module path, the exported `CartState` shape and every field in it are unchanged.

Rationale, in order of weight:
1. A cart is one sitting at one table. `localStorage` outlives the meal and the diner; a stale cart
   resurfacing three days later at a different restaurant is a defect, not a feature.
2. Shared devices. Restaurant tables see phones handed around. `sessionStorage` dies with the tab.
3. `sessionStorage` is per-tab, so two tabs on the same table cannot fight over one cart and there
   is no `storage`-event reconciliation to write or to get wrong.
4. Brief §34.11 — no customer account — means nothing about the cart is recoverable server-side
   anyway, so long-lived client persistence buys nothing real.

The **recent-orders cache stays in `localStorage`** (`src/lib/customer/session.ts`, doc 02 §2.4,
key `qros:orders:<qrToken>`). That one *must* survive a tab close: a diner who closes the tab and
reopens it needs their tracking links back. Two storages, two lifetimes, each matched to its
purpose. This split is deliberate and is not to be "unified".

### 0.3 Amendment B — pages read through `src/lib/data/*`, not directly from `src/lib/rpc/public.ts`

Doc 03 §9.1 permits a Server Component to call `@/lib/rpc/public.ts` directly. Demo mode (§8)
requires exactly one switch point between "talk to Postgres" and "read the fixture", and that
switch must not be a conditional sprinkled through pages. So a **read facade** is inserted:

```
Server Component  →  src/lib/data/*.ts  →  src/lib/rpc/public.ts        (live)
                                        →  src/lib/demo/repository.ts    (demo)
```

`src/lib/data/*.ts` contains no business logic: it is a `isDemoMode() ? demo : live` dispatch and
nothing else. Doc 03's rule 4 ("only `src/lib/rpc/*` calls `.rpc()`, only `src/lib/services/*`
calls `.from()`") is unchanged and still enforced by the greps in doc 03 §10.

### 0.4 Amendment C — the tracking URL parameter is `publicOrderId`, carrying `orders.public_code`

Doc 02 §2.4 writes the route as `/t/<qr_token>/order/<order_public_token>` against a column named
`orders.public_token`. Doc 03 §1.1 renamed that column to `orders.public_code`. The route segment
in this repository is:

```
src/app/(customer)/t/[token]/order/[publicOrderId]/page.tsx     →  /t/<qrToken>/order/<publicCode>
```

`params.publicOrderId` **is** `orders.public_code` and is validated with `publicCodeSchema`
(doc 03 §7.1). The realtime topic is `order:<publicCode>` (`orderTopic()` in
`src/lib/realtime/channels.ts`). `OrderView.trackingPath` (doc 03 §4) already emits exactly this
shape. Both capabilities stay in the path; neither is ever put in a cookie or a query string.

---

## 1. The complete file tree

This is the repository **as it will exist when finished**. Files already committed are marked
`[exists]`. Everything else is to be created. Agents are assigned disjoint subtrees; nothing outside
an agent's subtree may be created, renamed or deleted.

```
Qr-kod-menyu/
├── .env.example                                    [exists]  — every var in §7, annotated
├── .gitignore                                      [exists]
├── README.md                                       [exists]  — expand: quickstart, demo mode, scripts
├── eslint.config.mjs                               [exists]
├── next.config.ts                                  [exists]  — extend per §6.7 (CSP, headers, images)
├── package.json                                    [exists]  — add vitest + scripts per §9.3
├── package-lock.json                               [exists]
├── postcss.config.mjs                              [exists]  — @tailwindcss/postcss only
├── tsconfig.json                                   [exists]  — strict, noUncheckedIndexedAccess, @/* → ./src/*
├── vitest.config.ts                                          — node env, include src/**/*.test.ts
│
├── docs/
│   ├── BRIEF.md                                    [exists]
│   └── architecture/
│       ├── 01-database-schema.md                   [exists]
│       ├── 02-security-and-rls.md                  [exists]
│       ├── 03-domain-and-types.md                  [exists]
│       ├── 04-design-system.md                               — owned by the design agent
│       └── 05-app-structure.md                     [this file]
│
├── public/
│   ├── favicon.ico
│   ├── icon.svg                                              — monochrome mark, used by manifest
│   ├── apple-icon.png
│   ├── brand/
│   │   ├── wordmark.svg
│   │   └── wordmark-mono.svg
│   └── demo/                                                 — fixture imagery, §8. In-repo, no network.
│       ├── logo.webp
│       ├── cover.webp
│       ├── categories/{popular,uzbek,fast-food,salads,drinks,desserts}.webp     (6 files)
│       └── items/{plov,manti,lagman,somsa,shashlik,shurpa,norin,chuchvara,
│                  burger,club-sandwich,fries,chicken-wings,
│                  achichuk,olivier,caesar,greek,
│                  green-tea,black-tea,ayran,cola,fresh-orange,espresso,
│                  chak-chak,napoleon,halva,ice-cream}.webp                      (26 files)
│
├── supabase/
│   ├── config.toml                                 [exists]
│   ├── seed.sql                                              — one demo restaurant, mirrors §8 fixture 1:1
│   ├── migrations/
│   │   ├── 20260901000000_privilege_baseline.sql            [exists]  doc 02 §2.3
│   │   ├── 20260901000100_extensions_domains_enums.sql      [exists]  doc 01 §2–§4
│   │   ├── 20260901000200_core_tenancy.sql                  [exists]  doc 01 §6.1–6.4
│   │   ├── 20260901000300_tables_qr.sql                     [exists]  doc 01 §6.5–6.6
│   │   ├── 20260901000400_menu.sql                          [exists]  doc 01 §6.7–6.9
│   │   ├── 20260901000500_promotions.sql                    [exists]  doc 01 §6.10–6.11
│   │   ├── 20260901000600_orders.sql                                  doc 01 §6.12–6.16
│   │   ├── 20260901000700_ops.sql                                     doc 01 §6.17–6.19
│   │   ├── 20260901000800_functions_triggers.sql                      doc 01 §5, §7
│   │   ├── 20260901000900_indexes.sql                                 doc 01 §8
│   │   ├── 20260901001000_realtime_rls_enable.sql                     doc 01 §9
│   │   ├── 20260901001100_domain_layer_additions.sql                  doc 03 §1.2 (orders.client_request_id,
│   │   │                                                              orders.payload_fingerprint,
│   │   │                                                              tables.last_order_at,
│   │   │                                                              tables.last_waiter_call_at + their indexes)
│   │   ├── 20260901001200_auth_helpers.sql                            doc 02 §4.3–4.6
│   │   ├── 20260901001300_rls_policies.sql                            doc 02 §3.2–3.16
│   │   ├── 20260901001400_guard_triggers.sql                          doc 02 §3.17–3.18
│   │   ├── 20260901001500_private_machinery.sql                       doc 02 §2.5, §4.8, §5.1, §5.3
│   │   ├── 20260901001600_public_rpc.sql                              doc 02 §2.6 (five) + doc 03 §1.4
│   │   │                                                              public_cancel_order + doc 02 §4.7 staff RPCs
│   │                                                              (this makes SIX public capability
│   │                                                              functions, not five: the reassert
│   │                                                              migration's comment must be updated)
│   │   ├── 20260901001700_realtime_storage.sql                        doc 02 §7, §8.2
│   │   └── 20260901009900_privilege_baseline_reassert.sql   [exists]  doc 02 §2.3 verbatim + the six GRANTs
│   └── tests/                                                          pgTAP, doc 02 §9.1
│       ├── 01_grants.sql
│       ├── 02_rls_enabled.sql
│       ├── 03_cross_tenant.sql
│       ├── 04_branch_scope.sql
│       ├── 05_recursion.sql
│       ├── 06_price_tampering.sql
│       ├── 07_state_machine.sql
│       ├── 08_rate_limits.sql
│       ├── 09_tokens.sql
│       └── 10_escalation.sql
│
└── src/
    ├── middleware.ts                                        — §4.1. Node runtime. Session refresh + coarse gate.
    │
    ├── messages/
    │   ├── uz.json
    │   ├── ru.json
    │   └── en.json
    │
    ├── types/
    │   ├── database.ts                                      doc 03 §3
    │   ├── domain.ts                                        doc 03 §4
    │   ├── rpc.ts                                           doc 03 §2.1
    │   ├── i18n.ts                                          doc 03 §2.1
    │   ├── result.ts                                        doc 03 §8.2
    │   └── supabase.generated.ts                            git-ignored, CI diff only, never imported
    │
    ├── lib/
    │   ├── env/
    │   │   ├── public.ts                                    §7.2 — NEXT_PUBLIC_* only, importable anywhere
    │   │   └── server.ts                                    §7.3 — `import 'server-only'` line 1
    │   ├── result.ts                                        doc 03 §8.3
    │   ├── money.ts                                         doc 03 §5
    │   ├── money.test.ts
    │   ├── log.ts                                           §5.6 — newTraceId(), logError(), logEvent()
    │   ├── fonts.ts                                         next/font/google, self-hosted (CSP-safe)
    │   ├── i18n/
    │   │   ├── locale.ts                                    resolveLocale, LOCALE_COOKIE, setLocaleCookie, bcp47
    │   │   ├── t.ts                                         i18n_text resolver
    │   │   ├── messages.ts                                  getMessages(locale), translate()
    │   │   └── messages.test.ts
    │   ├── orders/
    │   │   ├── state-machine.ts                             doc 03 §6
    │   │   ├── state-machine.test.ts
    │   │   ├── pricing.ts                                   advisory cart preview only
    │   │   ├── pricing.test.ts
    │   │   └── lateness.ts
    │   ├── security/
    │   │   ├── errors.ts                                    doc 03 §8.4
    │   │   ├── errors.test.ts
    │   │   └── rate-limit.ts                                doc 02 §5.4
    │   ├── supabase/
    │   │   ├── public-client.ts                             anon, no cookies
    │   │   ├── server.ts                                    @supabase/ssr cookie client (RSC + actions)
    │   │   ├── middleware.ts                                §4.2 — updateSession(request) for middleware only
    │   │   ├── admin.ts                                     service role, `import 'server-only'`
    │   │   └── browser.ts                                   anon, browser, realtime only
    │   ├── rpc/
    │   │   ├── schemas.ts                                   doc 02 §2.7
    │   │   ├── public.ts                                    resolveTable, getMenu, placeOrder, getOrder,
    │   │   │                                                cancelOrder, callWaiter
    │   │   └── staff.ts                                     rotateTableToken, staffPlaceOrder, voidOrderItem
    │   ├── data/                                            §0.3 read facade — the ONLY demo/live switch
    │   │   ├── table-context.ts                             getTableContext(token)      [React cache()]
    │   │   ├── menu.ts                                      getMenuTree(token)          [React cache()]
    │   │   ├── order.ts                                     getOrderView(token, publicCode)
    │   │   ├── kitchen.ts                                   getKitchenTickets(branchId)
    │   │   ├── waiter.ts                                    getWaiterBoard(branchId)
    │   │   └── admin.ts                                     getDashboard, getAdminOrders, getAdminMenu,
    │   │                                                    getAdminTables, getAdminBranches, getAdminStaff,
    │   │                                                    getAdminSettings, getPlatformRestaurants
    │   ├── validation/
    │   │   ├── common.ts                                    doc 03 §7.1
    │   │   ├── order.ts                                     doc 03 §7.2
    │   │   ├── menu.ts                                      doc 03 §7.3
    │   │   ├── tenancy.ts                                   doc 03 §7.4
    │   │   ├── waiter.ts                                    doc 03 §7.5
    │   │   └── qr.ts                                        §5.5 — qrRenderParamsSchema for /api/qr
    │   ├── services/
    │   │   ├── session.ts                                   §4.4 — getStaffSession, requireStaffSession,
    │   │   │                                                requireCapability, requirePlatformAdmin
    │   │   ├── menu-service.ts
    │   │   ├── order-service.ts
    │   │   ├── table-service.ts
    │   │   ├── branch-service.ts
    │   │   ├── staff-service.ts
    │   │   ├── waiter-service.ts
    │   │   ├── dashboard-service.ts
    │   │   ├── settings-service.ts
    │   │   └── media-service.ts                             §5.5 — WebP re-encode, EXIF strip, Storage put
    │   ├── mappers/
    │   │   ├── menu-mapper.ts
    │   │   ├── order-mapper.ts
    │   │   ├── waiter-mapper.ts
    │   │   └── dashboard-mapper.ts
    │   ├── realtime/
    │   │   ├── channels.ts                                  orderTopic, branchTopic, REALTIME_EVENTS
    │   │   └── subscribe.ts                                 subscribeToOrder, subscribeToBranch
    │   ├── cart/
    │   │   ├── cart-store.ts                                §3.5 — reducer + sessionStorage store
    │   │   ├── cart-store.test.ts
    │   │   └── cart-serialization.ts                        §3.6 — CartState → PlaceOrderInput.items
    │   ├── customer/
    │   │   └── session.ts                                   doc 02 §2.4 — localStorage recent-orders cache
    │   ├── qr/
    │   │   └── render.ts                                    §5.5 — renderQrPng(url,…), renderQrSvg(url,…)
    │   ├── auth/
    │   │   └── redirects.ts                                 §4.5 — landingPathForSession, safeNextPath
    │   ├── http/
    │   │   └── responses.ts                                 §5.4 — jsonOk, jsonError, noStore, imageResponse
    │   ├── demo/                                            §8 — the ONLY place fixtures are read
    │   │   ├── demo-mode.ts                                 isDemoMode(), DEMO_TOKEN, DEMO_NOTICE_KEY
    │   │   ├── repository.ts                                read half — mirrors src/lib/rpc/public.ts
    │   │   ├── store.ts                                     in-memory ephemeral order/call store
    │   │   ├── fixtures/
    │   │   │   ├── restaurant.json
    │   │   │   ├── branches.json
    │   │   │   ├── tables.json
    │   │   │   ├── categories.json
    │   │   │   ├── menu-items.json
    │   │   │   ├── menu-item-options.json
    │   │   │   ├── promotions.json
    │   │   │   ├── orders.json
    │   │   │   ├── waiter-calls.json
    │   │   │   └── staff.json
    │   │   └── fixtures.test.ts                             asserts fixtures satisfy the zod RPC schemas
    │   └── utils/
    │       ├── cn.ts
    │       ├── datetime.ts
    │       ├── id.ts
    │       └── array.ts                                     groupBy, sortBy, uniqueBy — no lodash
    │
    ├── hooks/
    │   ├── use-hydrated.ts                                  §3.4 — false on server + first client render
    │   ├── use-cart.ts                                      §3.4 — useSyncExternalStore over the cart store
    │   ├── use-locale.ts                                    locale + messages from LocaleProvider
    │   ├── use-translate.ts                                 t(key, params) bound to the active locale
    │   ├── use-toast.ts
    │   ├── use-realtime-order.ts                            customer tracking (broadcast, demo → poll)
    │   ├── use-realtime-branch.ts                           staff panels (postgres_changes)
    │   ├── use-elapsed.ts                                   1 s tick for KDS/waiter timers
    │   ├── use-optimistic-status.ts                         useOptimistic wrapper for status buttons
    │   ├── use-debounced-value.ts                           menu search
    │   ├── use-media-query.ts
    │   └── use-wake-lock.ts                                 KDS screen-awake (best effort)
    │
    ├── components/
    │   ├── ui/
    │   │   ├── button.tsx
    │   │   ├── icon-button.tsx
    │   │   ├── input.tsx
    │   │   ├── textarea.tsx
    │   │   ├── select.tsx
    │   │   ├── checkbox.tsx
    │   │   ├── radio-group.tsx
    │   │   ├── switch.tsx
    │   │   ├── form-field.tsx
    │   │   ├── search-input.tsx
    │   │   ├── quantity-stepper.tsx
    │   │   ├── badge.tsx
    │   │   ├── chip.tsx
    │   │   ├── card.tsx
    │   │   ├── divider.tsx
    │   │   ├── sheet.tsx
    │   │   ├── dialog.tsx
    │   │   ├── confirm-dialog.tsx
    │   │   ├── dropdown-menu.tsx
    │   │   ├── tabs.tsx
    │   │   ├── tooltip.tsx
    │   │   ├── toast.tsx
    │   │   ├── toaster.tsx
    │   │   ├── skeleton.tsx
    │   │   ├── spinner.tsx
    │   │   ├── progress.tsx
    │   │   ├── avatar.tsx
    │   │   ├── data-table.tsx
    │   │   ├── pagination.tsx
    │   │   ├── empty-state.tsx
    │   │   ├── error-state.tsx
    │   │   ├── section-header.tsx
    │   │   ├── safe-image.tsx
    │   │   └── visually-hidden.tsx
    │   ├── common/
    │   │   ├── locale-provider.tsx                          'use client' — locale + messages context
    │   │   ├── locale-switcher.tsx                          'use client' — calls setLocaleAction
    │   │   ├── translate.tsx                                'use client' — <T k="…" />
    │   │   ├── i18n-text.tsx                                Server — renders I18nText via t()
    │   │   ├── price.tsx                                    Server — <Price value currency decimals />
    │   │   ├── relative-time.tsx                            'use client' — hydration-safe clock
    │   │   ├── toast-provider.tsx                           'use client'
    │   │   ├── demo-banner.tsx                              §8.5 — the DEMO DATA bar
    │   │   ├── demo-badge.tsx                               §8.5 — inline "demo" pill
    │   │   ├── connection-badge.tsx                         'use client' — realtime up/down/polling
    │   │   ├── error-card.tsx                               shared body of every error.tsx
    │   │   ├── app-error-view.tsx                           AppError → localized full-page state
    │   │   └── brand-mark.tsx
    │   ├── marketing/
    │   │   ├── marketing-header.tsx
    │   │   ├── marketing-footer.tsx
    │   │   ├── hero.tsx
    │   │   ├── feature-grid.tsx
    │   │   ├── surface-showcase.tsx
    │   │   └── demo-cta.tsx
    │   ├── customer/
    │   │   ├── customer-header.tsx                          Server
    │   │   ├── welcome-block.tsx                            Server
    │   │   ├── table-badge.tsx                              Server
    │   │   ├── promo-rail.tsx                               Server
    │   │   ├── category-rail.tsx                            'use client' — sticky scroll-spy chips
    │   │   ├── category-section.tsx                         Server
    │   │   ├── featured-rail.tsx                            Server
    │   │   ├── popular-rail.tsx                             Server
    │   │   ├── menu-item-card.tsx                           Server (button inside is client)
    │   │   ├── add-button.tsx                               'use client'
    │   │   ├── menu-search.tsx                              'use client'
    │   │   ├── menu-search-results.tsx                      'use client'
    │   │   ├── dietary-tags.tsx                             Server
    │   │   ├── spicy-meter.tsx                              Server
    │   │   ├── prep-time.tsx                                Server
    │   │   ├── unavailable-veil.tsx                         Server
    │   │   ├── item-detail-view.tsx                         'use client' — qty, options, note, add
    │   │   ├── option-group.tsx                             'use client'
    │   │   ├── item-sheet.tsx                               'use client' — the @modal wrapper
    │   │   ├── cart-provider.tsx                            'use client' — §3.4
    │   │   ├── cart-fab.tsx                                 'use client'
    │   │   ├── cart-view.tsx                                'use client'
    │   │   ├── cart-line-row.tsx                            'use client'
    │   │   ├── cart-totals.tsx                              'use client'
    │   │   ├── cart-empty.tsx                               Server
    │   │   ├── place-order-button.tsx                       'use client'
    │   │   ├── unavailable-lines-dialog.tsx                 'use client'
    │   │   ├── order-tracker.tsx                            'use client'
    │   │   ├── order-status-stepper.tsx                     'use client'
    │   │   ├── order-receipt.tsx                            Server
    │   │   ├── cancel-order-button.tsx                      'use client'
    │   │   ├── call-waiter-button.tsx                       'use client'
    │   │   ├── call-waiter-sheet.tsx                        'use client'
    │   │   ├── recent-orders-list.tsx                       'use client' — reads localStorage
    │   │   └── customer-error-view.tsx                      'use client' — retry + AppError copy
    │   ├── kitchen/
    │   │   ├── kds-header.tsx                               Server
    │   │   ├── kds-board.tsx                                'use client'
    │   │   ├── kds-column.tsx                               'use client'
    │   │   ├── ticket-card.tsx                              'use client'
    │   │   ├── ticket-lines.tsx                             Server-safe pure render
    │   │   ├── ticket-timer.tsx                             'use client'
    │   │   ├── ticket-actions.tsx                           'use client'
    │   │   ├── new-order-chime.tsx                          'use client'
    │   │   └── kds-empty.tsx                                Server
    │   ├── waiter/
    │   │   ├── waiter-header.tsx                            Server
    │   │   ├── waiter-board.tsx                             'use client'
    │   │   ├── waiter-tabs.tsx                              'use client'
    │   │   ├── active-orders-list.tsx                       'use client'
    │   │   ├── ready-orders-list.tsx                        'use client'
    │   │   ├── table-calls-list.tsx                         'use client'
    │   │   ├── call-card.tsx                                'use client'
    │   │   ├── waiter-order-card.tsx                        'use client'
    │   │   └── call-alert.tsx                               'use client'
    │   └── admin/
    │       ├── admin-sidebar.tsx                            Server (active state via client child)
    │       ├── admin-nav-link.tsx                           'use client'
    │       ├── admin-topbar.tsx                             Server
    │       ├── branch-switcher.tsx                          'use client'
    │       ├── admin-breadcrumbs.tsx                        Server
    │       ├── page-header.tsx                              Server
    │       ├── stat-card.tsx                                Server
    │       ├── stat-grid.tsx                                Server
    │       ├── orders-by-status.tsx                         Server
    │       ├── top-items-table.tsx                          Server
    │       ├── orders-table.tsx                             Server
    │       ├── order-filters.tsx                            'use client' — writes searchParams
    │       ├── order-detail-panel.tsx                       Server
    │       ├── order-status-actions.tsx                     'use client'
    │       ├── void-line-button.tsx                         'use client'
    │       ├── menu-item-table.tsx                          Server
    │       ├── menu-item-form.tsx                           'use client'
    │       ├── option-group-editor.tsx                      'use client'
    │       ├── availability-toggle.tsx                      'use client'
    │       ├── category-table.tsx                           Server
    │       ├── category-form.tsx                            'use client'
    │       ├── sortable-list.tsx                            'use client'
    │       ├── table-grid.tsx                               Server
    │       ├── table-form.tsx                               'use client'
    │       ├── qr-preview.tsx                               'use client'
    │       ├── qr-download-menu.tsx                         'use client'
    │       ├── rotate-token-dialog.tsx                      'use client'
    │       ├── branch-table.tsx                             Server
    │       ├── branch-form.tsx                              'use client'
    │       ├── staff-table.tsx                              Server
    │       ├── staff-form.tsx                               'use client'
    │       ├── invite-staff-dialog.tsx                      'use client'
    │       ├── settings-form.tsx                            'use client'
    │       ├── fee-editor.tsx                               'use client'
    │       ├── money-input.tsx                              'use client' — minor-unit safe
    │       ├── image-uploader.tsx                           'use client'
    │       ├── analytics-range-picker.tsx                   'use client'
    │       ├── revenue-sparkline.tsx                        Server (inline SVG, no chart lib)
    │       ├── status-donut.tsx                             Server (inline SVG)
    │       └── platform-restaurant-table.tsx                Server
    │
    └── app/
        ├── layout.tsx                                       §2.1 root layout — Server
        ├── globals.css                                      Tailwind v4 @import + @theme
        ├── not-found.tsx                                    global 404 — Server
        ├── error.tsx                                        global recoverable error — 'use client'
        ├── global-error.tsx                                 root-layout crash — 'use client', own <html>
        ├── loading.tsx                                      global route skeleton — Server
        ├── manifest.ts                                       PWA manifest
        ├── robots.ts                                        disallow /t/, /admin, /kitchen, /waiter, /api
        ├── icon.svg
        ├── apple-icon.png
        │
        ├── _actions/                                        private folder — NOT routable. All 'use server'.
        │   ├── auth-actions.ts                              §5.2.1
        │   ├── locale-actions.ts                            §5.2.2
        │   ├── cart-actions.ts                              §5.2.3
        │   ├── waiter-call-actions.ts                       §5.2.4
        │   ├── order-actions.ts                             §5.2.5
        │   ├── menu-actions.ts                              §5.2.6
        │   ├── category-actions.ts                          §5.2.7
        │   ├── table-actions.ts                             §5.2.8
        │   ├── branch-actions.ts                            §5.2.9
        │   ├── staff-actions.ts                             §5.2.10
        │   ├── settings-actions.ts                          §5.2.11
        │   └── platform-actions.ts                          §5.2.12
        │
        ├── (marketing)/
        │   ├── layout.tsx                                   §2.2 — Server
        │   ├── page.tsx                                     /            landing
        │   ├── demo/page.tsx                                /demo        "open the demo table" launcher
        │   └── legal/
        │       ├── privacy/page.tsx                         /legal/privacy
        │       └── terms/page.tsx                           /legal/terms
        │
        ├── (customer)/
        │   └── t/
        │       └── [token]/
        │           ├── layout.tsx                           §2.3 / §3.2 — Server, resolves TableContext
        │           ├── loading.tsx                          menu skeleton — Server
        │           ├── error.tsx                            'use client'
        │           ├── not-found.tsx                        invalid QR — Server
        │           ├── page.tsx                             /t/[token]                       §3.3
        │           ├── default.tsx                          parallel-route fallback for children
        │           ├── @modal/
        │           │   ├── default.tsx                      renders null
        │           │   └── (.)item/
        │           │       └── [itemId]/
        │           │           ├── page.tsx                 intercepted → bottom sheet          §3.3.2
        │           │           └── loading.tsx
        │           ├── item/
        │           │   └── [itemId]/
        │           │       ├── page.tsx                     /t/[token]/item/[itemId]          §3.3.2
        │           │       ├── loading.tsx
        │           │       └── not-found.tsx
        │           ├── cart/
        │           │   ├── page.tsx                         /t/[token]/cart                   §3.3.3
        │           │   └── loading.tsx
        │           ├── orders/
        │           │   └── page.tsx                         /t/[token]/orders  recent tracking links
        │           └── order/
        │               └── [publicOrderId]/
        │                   ├── page.tsx                     /t/[token]/order/[publicOrderId]  §3.3.4
        │                   ├── loading.tsx
        │                   ├── error.tsx                    'use client'
        │                   └── not-found.tsx
        │
        ├── (auth)/
        │   ├── layout.tsx                                   §2.4 — Server, redirects if already signed in
        │   ├── login/page.tsx                                /login
        │   ├── forgot-password/page.tsx                      /forgot-password
        │   ├── reset-password/page.tsx                       /reset-password
        │   ├── accept-invite/page.tsx                        /accept-invite
        │   ├── mfa/page.tsx                                  /mfa            TOTP aal2 challenge
        │   └── auth-error/page.tsx                           /auth-error     callback failure landing
        │
        ├── (staff)/
        │   ├── layout.tsx                                   §2.5 — Server, requireStaffSession()
        │   ├── kitchen/
        │   │   ├── layout.tsx                               §2.5.1 — Server, KDS chrome
        │   │   ├── page.tsx                                 /kitchen
        │   │   ├── loading.tsx
        │   │   └── error.tsx                                'use client'
        │   └── waiter/
        │       ├── layout.tsx                               §2.5.2 — Server, waiter chrome
        │       ├── page.tsx                                 /waiter
        │       ├── loading.tsx
        │       └── error.tsx                                'use client'
        │
        ├── (admin)/
        │   └── admin/
        │       ├── layout.tsx                               §2.6 — Server, sidebar + MFA gate
        │       ├── loading.tsx
        │       ├── error.tsx                                'use client'
        │       ├── not-found.tsx
        │       ├── page.tsx                                 /admin                    dashboard
        │       ├── orders/
        │       │   ├── page.tsx                             /admin/orders
        │       │   ├── loading.tsx
        │       │   └── [orderId]/
        │       │       ├── page.tsx                         /admin/orders/[orderId]
        │       │       └── not-found.tsx
        │       ├── menu/
        │       │   ├── page.tsx                             /admin/menu
        │       │   ├── loading.tsx
        │       │   ├── new/page.tsx                         /admin/menu/new
        │       │   └── [itemId]/
        │       │       ├── page.tsx                         /admin/menu/[itemId]
        │       │       └── not-found.tsx
        │       ├── categories/
        │       │   ├── page.tsx                             /admin/categories
        │       │   ├── loading.tsx
        │       │   ├── new/page.tsx                         /admin/categories/new
        │       │   └── [categoryId]/page.tsx                /admin/categories/[categoryId]
        │       ├── tables/
        │       │   ├── page.tsx                             /admin/tables
        │       │   ├── loading.tsx
        │       │   ├── new/page.tsx                         /admin/tables/new
        │       │   └── [tableId]/page.tsx                   /admin/tables/[tableId]
        │       ├── branches/
        │       │   ├── page.tsx                             /admin/branches
        │       │   ├── loading.tsx
        │       │   ├── new/page.tsx                         /admin/branches/new
        │       │   └── [branchId]/page.tsx                  /admin/branches/[branchId]
        │       ├── staff/
        │       │   ├── page.tsx                             /admin/staff
        │       │   ├── loading.tsx
        │       │   └── [staffId]/page.tsx                   /admin/staff/[staffId]
        │       ├── analytics/
        │       │   ├── page.tsx                             /admin/analytics
        │       │   └── loading.tsx
        │       ├── settings/
        │       │   └── page.tsx                             /admin/settings
        │       └── platform/
        │           ├── layout.tsx                           §2.6.1 — Server, requirePlatformAdmin()
        │           ├── page.tsx                             /admin/platform
        │           ├── loading.tsx
        │           └── restaurants/
        │               ├── page.tsx                         /admin/platform/restaurants
        │               └── [restaurantId]/page.tsx          /admin/platform/restaurants/[restaurantId]
        │
        └── api/
            ├── health/route.ts                              GET      §5.3.1
            ├── auth/
            │   ├── callback/route.ts                        GET      §5.3.2
            │   └── signout/route.ts                         POST     §5.3.3
            ├── public/
            │   ├── menu/[token]/route.ts                    GET      §5.3.4
            │   └── order/[token]/[publicOrderId]/route.ts   GET      §5.3.5
            ├── qr/[tableId]/route.ts                        GET      §5.3.6
            └── admin/
                ├── media/route.ts                           POST, DELETE   §5.3.7
                └── staff/invite/route.ts                    POST     §5.3.8
```

**Counts, so a slice owner can verify their subtree is complete:** 5 route groups · 1 root layout
+ 8 nested layouts · 40 `page.tsx` (4 marketing, 6 customer, 6 auth, 2 staff, 22 admin) ·
8 `route.ts` · 17 `loading.tsx` · 6 `error.tsx` + 1 `global-error.tsx` · 7 `not-found.tsx` ·
2 `default.tsx` · 12 Server Action modules · 19 SQL migrations · 10 pgTAP files.

---

## 2. Route groups, layouts and boundaries

### 2.0 The rules that hold everywhere

1. **Server by default.** A file gets `'use client'` only when it needs state, an effect, an event
   handler, a browser API or a React context provider. If a component's only client-ish need is one
   button, the button is the client component and the card around it stays a Server Component.
2. **A layout never fetches what a page also fetches.** Shared reads go through a `React.cache()`d
   function in `src/lib/data/*` so a layout and its page share one round trip per request (§6.2).
3. **`params` and `searchParams` are Promises.** Every page/layout that reads them is `async` and
   `await`s. Passing an un-awaited `params` into a child is a bug.
4. **`loading.tsx` is a real skeleton, never a spinner on a blank page.** It mirrors the layout of
   the content it replaces so nothing shifts when data lands (brief §32).
5. **`error.tsx` is `'use client'` and takes `{ error, reset }`.** It renders
   `<ErrorCard>` with a localized message from `messageKeyFor()` when `error.digest` maps to a known
   `AppError`, otherwise the generic `errors.app.UNKNOWN` copy plus the `digest` in small type.
6. **No layout performs a write.** Layouts re-run on navigation and prefetch.
7. **Every segment that can reach the service-role key, the anon RPCs, or `qrcode` declares
   `export const runtime = 'nodejs'`.** In practice: everything under `(customer)/t/**`, `api/**`,
   `(staff)/**`, `(admin)/**`, plus `src/middleware.ts`.

### 2.1 `src/app/layout.tsx` — the single root layout (Server Component)

**Responsibility.** Document shell, fonts, theme tokens, locale resolution, and the three global
providers. Nothing else. It has no data dependency on Supabase and no knowledge of any tenant.

```tsx
// src/app/layout.tsx  — Server Component
import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { displayFont, sansFont } from '@/lib/fonts';
import { resolveLocale, bcp47 } from '@/lib/i18n/locale';
import { getMessages } from '@/lib/i18n/messages';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { LocaleProvider } from '@/components/common/locale-provider';
import { ToastProvider } from '@/components/common/toast-provider';
import { DemoBanner } from '@/components/common/demo-banner';
import { publicEnv } from '@/lib/env/public';
import '@/app/globals.css';

export const runtime = 'nodejs';

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
  title: { default: 'Restaurant QR OS', template: '%s · Restaurant QR OS' },
  description: 'QR menu, ordering, kitchen display and restaurant management.',
  applicationName: 'Restaurant QR OS',
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0B0B0C' }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale({
    cookie: cookieStore.get('qros_locale')?.value ?? null,
    searchParam: null,                       // ?lang= is applied by middleware, which sets the cookie
    acceptLanguage: headerList.get('accept-language'),
  });
  const messages = await getMessages(locale);

  return (
    <html lang={bcp47(locale)} dir="ltr" className={`${sansFont.variable} ${displayFont.variable}`}>
      <body className="min-h-dvh bg-surface-base text-ink antialiased">
        <LocaleProvider locale={locale} messages={messages}>
          <ToastProvider>
            {isDemoMode() ? <DemoBanner /> : null}
            {children}
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
```

**Why this layout awaits `cookies()`, and what that costs.** Reading a cookie in the root layout
opts the entire application into dynamic rendering — nothing is statically generated. That is the
correct trade here and it is deliberate:

- The locale lives in a cookie by frozen decision (no URL prefix), so the `<html lang>` attribute
  cannot be known at build time for any page.
- Every surface that matters is per-request anyway: `/t/[token]` depends on a capability token,
  `/kitchen`, `/waiter` and `/admin` depend on a session, and all of them must reflect live data.
- The only page that could have been static is the marketing landing page, which has no data
  dependency and renders in well under a millisecond.

Consequently `cacheComponents` stays **off** in `next.config.ts` and no segment uses `'use cache'`.
Caching is expressed through explicit segment config and `React.cache()` request-deduplication
(§6). Anyone tempted to turn on `cacheComponents` must first move locale resolution out of the root
layout, and that is a separate, argued change — not a config flip.

**`global-error.tsx`.** Because there is exactly one root layout, a crash inside it is only
catchable by `src/app/global-error.tsx`. That file is `'use client'`, renders its own `<html>` and
`<body>` (the root layout did not survive), uses **no** provider, and hard-codes English copy —
`getMessages()` is precisely the sort of thing that may have been what failed.

### 2.2 `(marketing)` — `src/app/(marketing)/layout.tsx` (Server Component)

Public, unauthenticated, no tenant. Renders `<MarketingHeader>` (wordmark, locale switcher, "Staff
sign in" → `/login`, "Try the demo" → `/demo`) and `<MarketingFooter>`. Wraps children in a
`max-w-[72rem]` editorial container.

| Path | File | Kind | Notes |
|---|---|---|---|
| `/` | `(marketing)/page.tsx` | Server | Hero, four-surface showcase, feature grid, demo CTA. Zero data fetching. |
| `/demo` | `(marketing)/demo/page.tsx` | Server | In demo mode: a card linking to `/t/<DEMO_TOKEN>` plus staff shortcuts. With live Supabase configured: explains that demo mode is off and links to `/login`. |
| `/legal/privacy` | `(marketing)/legal/privacy/page.tsx` | Server | Static copy. |
| `/legal/terms` | `(marketing)/legal/terms/page.tsx` | Server | Static copy. |

No `loading.tsx` (nothing to wait for). No `error.tsx` — the global one suffices.

### 2.3 `(customer)` — `src/app/(customer)/t/[token]/layout.tsx` (Server Component)

The single most important layout in the application. Full treatment in §3.2; responsibilities in
brief:

1. `await params` → `token`; validate with `qrTokenSchema` before any I/O. A malformed token is
   `notFound()`, never a database round trip.
2. `getTableContext(token)` (React-cached, §6.2) → `Result<TableContext>`.
3. Map the failure to a **full-page state**, never a toast: `INVALID_QR` → `notFound()`;
   `TABLE_INACTIVE` → `<AppErrorView code="TABLE_INACTIVE">`; `RESTAURANT_CLOSED` → closed state
   with branch name; `NETWORK`/`UNKNOWN` → `throw` so `error.tsx` catches and offers retry.
4. Provide `<TableContextProvider>` (client context: token, currency, decimals, fee config,
   timezone, restaurant default locale) and `<CartProvider>` (§3.4), keyed by token.
5. Render `<CustomerHeader>`, the `{modal}` parallel slot, `{children}`, `<CartFab>` and
   `<CallWaiterButton>`.
6. `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`,
   `export const fetchCache = 'default-no-store'`.
7. `generateMetadata` returns `robots: { index: false, follow: false }` and a title of the
   restaurant name. A capability token must never be indexed.

Boundary files under `t/[token]`:

| File | Kind | Purpose |
|---|---|---|
| `loading.tsx` | Server | Full menu skeleton: header block, promo rail, category chips, six card placeholders. |
| `error.tsx` | Client | `<CustomerErrorView>` — localized copy + "Try again" calling `reset()`. |
| `not-found.tsx` | Server | "This QR code is not valid." No retry button; retrying cannot help. |
| `default.tsx` | Server | Returns `null`. Required because the segment has a `@modal` parallel slot. |
| `@modal/default.tsx` | Server | Returns `null` — the slot is empty on a hard navigation. |

**Suspense boundaries inside `/t/[token]`.** The layout itself does not stream: the whole page is
worthless without `TableContext`, so it is awaited before anything renders. Inside `page.tsx` the
menu is one `<Suspense>` with the same skeleton as `loading.tsx`, so a slow menu never delays the
restaurant header and welcome block.

### 2.4 `(auth)` — `src/app/(auth)/layout.tsx` (Server Component)

Centered card on the dark editorial ground; wordmark, locale switcher, no navigation (a signed-out
visitor has nowhere to go). Its one piece of logic:

```tsx
const session = await getStaffSession();
if (session) redirect(landingPathForSession(session));
```

so a signed-in user cannot sit on `/login`. `/mfa` is the exception and lives outside that guard —
see §4.5.

| Path | File | Kind | Notes |
|---|---|---|---|
| `/login` | `(auth)/login/page.tsx` | Server shell + `LoginForm` client | `searchParams.next` is read (awaited) and passed to the form; sanitized by `safeNextPath()`. |
| `/forgot-password` | … | Server + client form | Calls `requestPasswordResetAction`. |
| `/reset-password` | … | Server + client form | Requires a recovery session established by `/api/auth/callback`. |
| `/accept-invite` | … | Server + client form | Sets a password for an invited staff member, then redirects by role. |
| `/mfa` | … | Server + client form | TOTP challenge to reach `aal2`. |
| `/auth-error` | … | Server | Terminal state for a failed or expired auth callback; links back to `/login`. |

### 2.5 `(staff)` — `src/app/(staff)/layout.tsx` (Server Component)

Shared by `/kitchen` and `/waiter`, which are tablet surfaces, not desktop dashboards.

```tsx
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaffSession();   // → /login when absent; sub-layouts add the capability check
  return (
    <StaffSessionProvider session={session}>
      <RealtimeProvider branchId={session.branchId}>
        {children}
      </RealtimeProvider>
    </StaffSessionProvider>
  );
}
```

`RealtimeProvider` ('use client') owns exactly one Supabase browser channel per branch and
multiplexes it to `use-realtime-branch` consumers, so a KDS with three columns opens one WebSocket,
not three.

#### 2.5.1 `(staff)/kitchen/layout.tsx`

Server. Asserts the session may work the kitchen —
`requireCapability(session, 'kitchen')` accepts `KITCHEN`, `MANAGER`, `RESTAURANT_OWNER` and
platform admins; anything else `redirect(landingPathForSession(session))`. Renders `<KdsHeader>`
(branch name, live clock, connection badge, late count) and a `h-dvh` three-column grid with
`overflow-hidden` — the KDS never scrolls the page, each column scrolls independently. Mounts
`<NewOrderChime>` and `use-wake-lock`.

#### 2.5.2 `(staff)/waiter/layout.tsx`

Server. `requireCapability(session, 'waiter')` accepts `WAITER`, `MANAGER`, `RESTAURANT_OWNER`,
platform admins. Renders `<WaiterHeader>` and `<WaiterTabs>` (Active / Ready / Calls with live
counts). A `WAITER` **must** have `branchId` non-null (DB constraint `ck_staff_role_scope`); if it
is null the layout renders `<AppErrorView code="FORBIDDEN">` rather than silently showing every
branch.

### 2.6 `(admin)` — `src/app/(admin)/admin/layout.tsx` (Server Component)

```tsx
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaffSession('/admin');
  requireCapability(session, 'admin');                      // MANAGER | RESTAURANT_OWNER | platform admin
  await requireAal2IfPrivileged(session);                   // doc 02 §8.1 — owners and platform admins
  const branches = await listBranchesForSession(session);   // React-cached; feeds the switcher

  return (
    <div className="grid min-h-dvh grid-cols-[16rem_1fr] max-lg:grid-cols-1">
      <AdminSidebar session={session} />
      <div className="flex min-w-0 flex-col">
        <AdminTopbar session={session} branches={branches} />
        <main className="min-w-0 flex-1 px-8 py-6 max-lg:px-4">{children}</main>
      </div>
    </div>
  );
}
```

- `requireAal2IfPrivileged` reads `supabase.auth.getSession()`'s `aal` claim; when the role is
  `RESTAURANT_OWNER` or the profile is a platform admin and `aal !== 'aal2'`, it
  `redirect('/mfa?next=' + encodeURIComponent(currentPath))`.
- The sidebar is a Server Component; only `<AdminNavLink>` is a client component (it reads
  `usePathname()` for the active state).
- `<BranchSwitcher>` writes the `qros_branch` cookie through `setActiveBranchAction` and calls
  `router.refresh()`. Branch scope is **advisory for the UI only** — every service re-derives the
  allowed branch set from the session (§4.4) and RLS is the real boundary.

Boundaries: `loading.tsx` (sidebar-shaped skeleton + content skeleton), `error.tsx` (client),
`not-found.tsx` (for `[orderId]`, `[itemId]`, … that resolve to nothing the session may see —
deliberately indistinguishable from "belongs to another tenant").

Per-page `loading.tsx` exists for the seven list routes because their queries are the slow ones:
`orders`, `menu`, `categories`, `tables`, `branches`, `staff`, `analytics`, plus `platform`.

**Suspense inside `/admin`.** The dashboard streams: `<StatGrid>` (fast counts) renders first, and
`<TopItemsTable>` plus `<RevenueSparkline>` each sit in their own `<Suspense fallback={<Skeleton/>}>`
because they aggregate over the day's orders. `/admin/orders` streams the table inside a Suspense
keyed on the serialized `searchParams`, so changing a filter shows the skeleton rather than a frozen
stale table.

#### 2.6.1 `(admin)/admin/platform/layout.tsx`

Server. `requirePlatformAdmin()` — `profiles.is_platform_admin` must be true; otherwise
`notFound()`, not `403`. A manager probing `/admin/platform` learns nothing about whether the route
exists.

### 2.7 Boundary-file placement, complete

| File | Where it exists | Why there and not elsewhere |
|---|---|---|
| `global-error.tsx` | `src/app/` only | Only place that can catch a root-layout crash. |
| `error.tsx` | `src/app/`, `t/[token]/`, `t/[token]/order/[publicOrderId]/`, `kitchen/`, `waiter/`, `admin/` | One per surface, because the recovery copy and the retry affordance differ per audience. Order tracking gets its own because its failure ("we lost your order") needs different copy from the menu's. |
| `not-found.tsx` | `src/app/`, `t/[token]/`, `t/[token]/item/[itemId]/`, `t/[token]/order/[publicOrderId]/`, `admin/`, `admin/orders/[orderId]/`, `admin/menu/[itemId]/` | Wherever `notFound()` is called with a domain meaning worth spelling out. |
| `loading.tsx` | `src/app/` + every segment whose page awaits I/O | 17 files, listed in §1. |
| `default.tsx` | `t/[token]/`, `t/[token]/@modal/` | Required by the parallel-route slot. |

---

## 3. The customer routes, in detail

### 3.1 The Server/Client split, and the reasoning

The customer app is the most latency-sensitive surface in the product: a diner on hotel Wi-Fi, on a
mid-range Android, holding the phone in one hand. The split follows one principle — **data and
layout render on the server; only fingertip state runs in the browser.**

| Concern | Where | Why |
|---|---|---|
| Table context, menu tree, order view | Server Component | Anon RPC results, no interactivity, and shipping the menu as HTML rather than as JSON + a renderer removes a whole hydration pass from the critical path. |
| Category sections, item cards, receipts, totals of a *placed* order | Server Component | Pure projections of server data. Zero client JS. |
| Cart (lines, quantities, notes, badge) | Client | Lives in `sessionStorage`; no server copy exists by design (brief §34.11). |
| Item detail (quantity, option selection, note) | Client | Ephemeral form state that must survive nothing. |
| Order tracker | Client | Subscribes to the realtime topic and re-renders on push (brief §28). Seeded with server-rendered HTML so the first paint is correct without JS. |
| Search | Client, over a server-provided `itemsById` index | Typing must not round-trip. The index is already in the payload; searching it costs nothing. |

A component is a Client Component **only** if it appears in the `'use client'` column of §1. There
is no third state: no `"use client"` at the top of a page or layout file anywhere in this repository.

### 3.2 `/t/[token]` — layout: resolving the table, once

```tsx
// src/app/(customer)/t/[token]/layout.tsx  — Server Component
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'default-no-store';

interface TokenParams { token: string }

export async function generateMetadata(
  { params }: { params: Promise<TokenParams> },
): Promise<Metadata> {
  const { token } = await params;                                  // Next 16: params is a Promise
  const parsed = qrTokenSchema.safeParse(token);
  if (!parsed.success) return { title: 'Menu', robots: { index: false, follow: false } };
  const result = await getTableContext(parsed.data);               // React.cache() — free second call
  return {
    title: result.ok ? result.data.restaurant.name : 'Menu',
    robots: { index: false, follow: false },
    other: { referrer: 'no-referrer' },
  };
}

export default async function TableLayout({
  params, children, modal,
}: {
  params: Promise<TokenParams>;
  children: React.ReactNode;
  modal: React.ReactNode;                       // the @modal parallel slot
}) {
  const { token } = await params;

  const parsed = qrTokenSchema.safeParse(token);
  if (!parsed.success) notFound();                                 // malformed → no DB round trip

  const result = await getTableContext(parsed.data);

  if (!result.ok) {
    switch (result.error.code) {
      case 'INVALID_QR':  notFound();                              // → t/[token]/not-found.tsx
      case 'TABLE_INACTIVE':
      case 'RESTAURANT_CLOSED':
        return <AppErrorView error={result.error} token={parsed.data} />;
      default:
        throw new AppErrorException(result.error);                 // → t/[token]/error.tsx (retryable)
    }
  }

  const context = result.data;

  return (
    <TableContextProvider context={context}>
      <CartProvider init={cartInitFromContext(context)}>
        <div className="mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col pb-28">
          <CustomerHeader context={context} />
          {children}
          {modal}
        </div>
        <CartFab token={context.token} />
        <CallWaiterButton token={context.token} />
      </CartProvider>
    </TableContextProvider>
  );
}
```

Notes that are binding:
- **`getTableContext` is called in both `generateMetadata` and the layout body and costs one round
  trip**, because it is wrapped in `React.cache()` (§6.2). Do not "optimise" by dropping the
  metadata call.
- `TableContext` carries **no database ids** (doc 03 §4). The only identifier the browser ever holds
  is the QR token that was already in the URL bar.
- `cartInitFromContext(context)` produces `CartInit` — `{ token, restaurantSlug, currency,
  currencyDecimals, serviceFeeEnabled, serviceFeeBps, locale }` — the deterministic seed for an
  empty cart (§3.5).

### 3.3 The four customer pages

#### 3.3.1 `/t/[token]` — the menu (`page.tsx`, Server Component)

```tsx
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function MenuPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ q?: string; c?: string }>;
}) {
  const [{ token }, { q, c }] = await Promise.all([params, searchParams]);
  const context = unwrapOrThrow(await getTableContext(token));
  return (
    <>
      <WelcomeBlock context={context} />
      <Suspense fallback={<MenuSkeleton />}>
        <MenuSections token={token} initialQuery={q ?? ''} initialCategoryId={c ?? null} />
      </Suspense>
    </>
  );
}
```

`<MenuSections>` is an `async` Server Component that awaits `getMenuTree(token)` and renders, in
brief §4's order: `<PromoRail>`, `<MenuSearch>` (client, seeded with `menu.itemsById`),
`<CategoryRail>` (client, sticky, scroll-spy), `<FeaturedRail>`, `<PopularRail>`, then one
`<CategorySection>` per category. Unavailable items render through `<UnavailableVeil>` — dimmed,
`aria-disabled`, add button replaced by a localized "Unavailable" chip. They are **never hidden**
(brief §5).

`<MenuSearch>` receives a compact search index built server-side:
`{ id, name: I18nText, categoryId, isAvailable }[]`, not the whole `MenuTree` — the full tree is
already HTML and does not need to cross as JSON a second time.

The empty states, all Server-rendered: no categories at all → "This menu is being prepared";
a category with zero items → the category header is not rendered at all; every item unavailable →
the section renders with a "Currently unavailable" note.

#### 3.3.2 `/t/[token]/item/[itemId]` — product detail

Two entry points, one component:

| Route | File | Rendering |
|---|---|---|
| Hard navigation / deep link / refresh | `item/[itemId]/page.tsx` | Full page, Server Component. |
| Tap from a card inside `/t/[token]` | `@modal/(.)item/[itemId]/page.tsx` | Intercepted route, rendered by the layout's `{modal}` slot into `<ItemSheet>` — a bottom sheet over the menu, with the URL updated so Back closes it. |

Both files are Server Components with the same body:

```tsx
export default async function ItemPage({
  params,
}: { params: Promise<{ token: string; itemId: string }> }) {
  const { token, itemId } = await params;
  if (!uuidSchema.safeParse(itemId).success) notFound();

  const [context, menu] = await Promise.all([
    unwrapOrThrow(getTableContext(token)),
    unwrapOrThrow(getMenuTree(token)),
  ]);

  const item = menu.itemsById[itemId];
  if (!item) notFound();                       // → item/[itemId]/not-found.tsx

  return <ItemDetailView context={context} item={item} />;   // 'use client'
}
```

`<ItemDetailView>` is the only client component here. It owns: quantity (1..50), option selection
validated against each group's `minSelect`/`maxSelect`/`selectionType`, the per-line note (max 140
chars, `optionalNoteSchema(140)` mirrored client-side), a live advisory line total from
`priceCart()`, and the "Add to cart" button which dispatches `{ type: 'add', … }` and then
`router.back()` (sheet) or `router.replace('/t/'+token)` (full page).

Server-rendered around it: the large image (`next/image`, `sizes="(max-width: 34rem) 100vw, 34rem"`,
`priority` on the full-page variant only), name, description, ingredients, `<DietaryTags>`,
`<SpicyMeter>`, `<PrepTime>`. Those are props, not client state, so they never re-render.

An item that is `isAvailable === false` renders the whole detail read-only with a disabled add bar
and the localized reason. Brief §34.3: the client refusal is cosmetic — `public_place_order` raises
`QR020_ITEM_UNAVAILABLE` regardless.

#### 3.3.3 `/t/[token]/cart` — review and place

`page.tsx` is a **Server Component** that fetches a *fresh* `MenuTree` and hands it to the client
view:

```tsx
export default async function CartPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [context, menu] = await Promise.all([
    unwrapOrThrow(getTableContext(token)),
    unwrapOrThrow(getMenuTree(token)),
  ]);
  return <CartView context={context} menu={toReconcileIndex(menu)} />;
}
```

`toReconcileIndex(menu)` projects the tree down to what reconciliation needs —
`Record<itemId, { name, imageUrl, price, isAvailable, options: Record<optionId, { name, priceDelta, isAvailable }> }>`
— so the cart page does not ship the entire menu to the browser twice.

`<CartView>` ('use client') on mount dispatches `{ type: 'reconcile', index }`, which:
1. refreshes every line's `name`, `imageUrl`, `unitPrice`, option `priceDelta` and `isAvailable`
   from the server-supplied index;
2. drops option references the server no longer knows;
3. recomputes advisory `lineTotal` and `totals` through `priceCart()`;
4. marks lines whose item vanished or went unavailable, which `<UnavailableLinesDialog>` offers to
   remove — the rest of the cart survives (doc 03 §8.5, `ITEM_UNAVAILABLE` row).

Then: `<CartLineRow>` per line (image, name, chosen extras, `<QuantityStepper>`, per-line price),
`<CartTotals>` (subtotal / service fee when `serviceFeeEnabled` / total, all advisory and labelled
as an estimate), the order note field (280 chars), and `<PlaceOrderButton>`.

Empty cart → `<CartEmpty>` (Server) with a link back to the menu. This is a real designed state,
not a blank page (brief §32).

#### 3.3.4 `/t/[token]/order/[publicOrderId]` — tracking

```tsx
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function OrderPage({
  params,
}: { params: Promise<{ token: string; publicOrderId: string }> }) {
  const { token, publicOrderId } = await params;
  if (!publicCodeSchema.safeParse(publicOrderId).success) notFound();

  const result = await getOrderView(token, publicOrderId);   // public_get_order, both capabilities
  if (!result.ok) {
    if (result.error.code === 'NOT_FOUND') notFound();       // covers QR030 and QR032 (expired)
    throw new AppErrorException(result.error);
  }

  return <OrderTracker token={token} initial={result.data} />;
}
```

`<OrderTracker>` ('use client') is seeded with the fully server-rendered `OrderView`, so the first
paint is correct with JavaScript disabled. It then:
- subscribes via `useRealtimeOrder(publicCode)` to the broadcast topic `order:<publicCode>`
  (doc 02 §7.2 — the topic name *is* the capability; RLS on `realtime.messages` gates it);
- renders `<OrderStatusStepper>` from `statusIndex` with a marker for `cancelled` (`statusIndex === -1`);
- renders `<OrderReceipt>` (Server-shaped pure component) with snapshot lines and server totals —
  **these are the authoritative numbers**, never the cart's advisory ones;
- shows `<CancelOrderButton>` **only** when `status === 'pending'` **and** `public_cancel_order`
  exists (doc 03 §1.4). Until that RPC ships, the button is not rendered at all — a button that
  cannot succeed is worse than no button;
- writes `{ publicCode, orderNumber, placedAt }` into `localStorage['qros:orders:<token>']` through
  `src/lib/customer/session.ts` so `/t/[token]/orders` can list it later;
- if the realtime channel fails to join within 8 seconds, falls back to polling
  `/api/public/order/[token]/[publicOrderId]` every 15 s and shows `<ConnectionBadge state="polling">`.
  Polling is the documented **fallback**, never the primary mechanism (brief §28).

### 3.4 Cart state: the hydration-safe pattern

The cart is the one place where a naive implementation produces a React hydration mismatch, because
the server cannot know what is in `sessionStorage`. The pattern below is binding.

**Three rules.**
1. The **server snapshot is a frozen module-level constant per `CartInit`**, never a fresh object.
   `useSyncExternalStore` compares snapshots by identity; returning a new object each call is an
   infinite render loop.
2. The server snapshot contains **no nondeterministic field**. `clientRequestId` is `''` and
   `updatedAt` is `'1970-01-01T00:00:00.000Z'` until hydration; `crypto.randomUUID()` runs on the
   client only.
3. Nothing that depends on stored contents renders before hydration. The cart badge, the cart page
   body and the place-order button all gate on `useHydrated()`.

```tsx
// src/components/customer/cart-provider.tsx
'use client';

const CartStoreContext = createContext<CartStore | null>(null);

export function CartProvider({ init, children }: { init: CartInit; children: React.ReactNode }) {
  // One store per token. Changing tables creates a new store; the old cart is not carried over.
  const store = useMemo(() => createCartStore(init), [init.token]);

  useEffect(() => {
    store.hydrate();              // reads sessionStorage, then notifies subscribers
  }, [store]);

  return <CartStoreContext.Provider value={store}>{children}</CartStoreContext.Provider>;
}

// src/hooks/use-cart.ts
export function useCart(): { state: CartState; dispatch: (a: CartAction) => void; hydrated: boolean } {
  const store = useContext(CartStoreContext);
  if (!store) throw new Error('useCart must be used inside <CartProvider>');
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const hydrated = useHydrated();
  return { state, dispatch: store.dispatch, hydrated };
}

// src/hooks/use-hydrated.ts
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},          // never changes after mount
    () => true,              // client snapshot
    () => false,             // server snapshot
  );
}
```

Rendering rules that follow:

```tsx
// cart-fab.tsx
const { state, hydrated } = useCart();
// Server HTML and the first client render agree: no badge. The badge appears on the second render.
return (
  <Link href={`/t/${token}/cart`} aria-label={t('cart.open')}>
    <CartIcon />
    {hydrated && state.itemCount > 0 ? <Badge>{state.itemCount}</Badge> : null}
  </Link>
);
```

`<CartView>` renders `<CartSkeleton />` while `!hydrated`, which is one frame, and is visually
identical to the loaded layout so nothing shifts.

**Storage failure is not an error state.** `sessionStorage` throws in some private modes and can be
disabled outright. `createCartStore` wraps every `getItem`/`setItem` in `try/catch` and degrades to
an in-memory store. It records nothing about the degradation in `CartState`, because `CartState` is
a frozen contract (doc 03 §4); the degraded flag is a module-local boolean inside `cart-store.ts`,
exposed as `store.isPersistent()` and surfaced at most once as a toast keyed
`cart.storage_unavailable`. The cart keeps working for the whole visit either way — it is only lost
on a reload, which is precisely the situation the toast warns about.

### 3.5 `src/lib/cart/cart-store.ts` — the exact contract

```ts
// src/lib/cart/cart-store.ts   (no React import; no 'use client' — it is a plain module)
import type { CartLine, CartLineOption, CartState, CartTotals } from '@/types/domain';
import type { Locale } from '@/types/i18n';
import type { Money } from '@/lib/money';

export const CART_STORAGE_PREFIX = 'qros:cart:';
export const CART_SCHEMA_VERSION = 1;
/** A cart older than this is discarded on hydrate: one sitting, not one lifetime. */
export const CART_MAX_AGE_MS = 6 * 60 * 60 * 1000;      // 6 hours

/** sessionStorage key. One cart per QR token; a different table is a different cart. */
export function cartStorageKey(token: string): string {
  return `${CART_STORAGE_PREFIX}${token}`;
}

/** What sessionStorage actually holds. Versioned so a shape change is discarded, never crashes. */
export interface PersistedCart {
  v: typeof CART_SCHEMA_VERSION;
  state: CartState;
}

/** The deterministic seed for an empty cart, derived from TableContext by cartInitFromContext(). */
export interface CartInit {
  token: string;
  restaurantSlug: string;
  currency: string;
  currencyDecimals: number;
  serviceFeeEnabled: boolean;
  serviceFeeBps: number;
  locale: Locale;
}

/** The line payload an item-detail screen hands to the store. No lineId, no totals: derived. */
export interface AddLineInput {
  menuItemId: string;
  name: CartLine['name'];
  imageUrl: string | null;
  unitPrice: Money;
  options: CartLineOption[];
  quantity: number;
  note: string | null;
  isAvailable: boolean;
  spicyLevel: number;
}

/** Fresh server truth for reconciliation, produced by toReconcileIndex(menuTree). */
export interface ReconcileIndex {
  readonly [menuItemId: string]: {
    name: CartLine['name'];
    imageUrl: string | null;
    price: Money;
    isAvailable: boolean;
    options: Readonly<Record<string, { name: CartLineOption['name']; priceDelta: Money; isAvailable: boolean }>>;
  };
}

export type CartAction =
  | { type: 'hydrate'; state: CartState }
  | { type: 'add'; line: AddLineInput }
  | { type: 'setQuantity'; lineId: string; quantity: number }
  | { type: 'removeLine'; lineId: string }
  | { type: 'setLineNote'; lineId: string; note: string | null }
  | { type: 'setOrderNote'; note: string | null }
  | { type: 'setLocale'; locale: Locale }
  | { type: 'reconcile'; index: ReconcileIndex }
  | { type: 'dropUnavailable' }
  | { type: 'clear' };

/** Pure. Fully unit-testable without a DOM. Every action recomputes itemCount and totals. */
export function cartReducer(state: CartState, action: CartAction): CartState;

/** Deterministic, identity-stable per init.token. clientRequestId '' and updatedAt epoch. */
export function emptyCart(init: CartInit): CartState;

export interface CartStore {
  subscribe(listener: () => void): () => void;
  /** Current client state. Stable identity between dispatches. */
  getSnapshot(): CartState;
  /** THE SAME frozen object every call. Never allocates. */
  getServerSnapshot(): CartState;
  dispatch(action: CartAction): void;
  /** Client-only: read sessionStorage, validate, adopt or discard, then notify. Idempotent. */
  hydrate(): void;
  clear(): void;
  /** False when sessionStorage is unavailable and the cart lives in memory only. */
  isPersistent(): boolean;
}

export function createCartStore(init: CartInit): CartStore;
```

**Line identity and merging.** Two additions merge into one line when
`menuItemId` matches **and** the sorted `options[].optionId` arrays are equal **and** the trimmed
notes are equal; then `quantity` is summed and clamped to 50. Otherwise a new line is created with
`lineId = newCartLineId()`. This is why one dish with different extras coexists as two lines
(doc 03 §4, `CartLine.lineId`).

**What `hydrate()` discards, and why each check exists.**

| Check | Action on failure |
|---|---|
| `JSON.parse` throws | Discard, remove the key. Corrupt storage is not recoverable. |
| `parsed.v !== CART_SCHEMA_VERSION` | Discard. A shipped shape change must never crash a diner's phone. |
| `parsed.state.token !== init.token` | Discard. A cart never crosses tables (brief §34.1). |
| `Date.now() - Date.parse(state.updatedAt) > CART_MAX_AGE_MS` | Discard. Yesterday's cart is not this meal. |
| `state.currency !== init.currency` or decimals differ | Discard. Money in the wrong unit is worse than no money. |
| any line fails `cartLineSchema`-shaped validation | Drop that line, keep the rest, recompute totals. |

On success the store adopts the state, **generates `clientRequestId` if it is `''`**, sets
`locale` from `init` (the diner may have switched language since), and notifies.

**Persistence** happens in `dispatch`, after the reducer, debounced by one animation frame, writing
`{ v, state }` to `sessionStorage[cartStorageKey(token)]`. `{ type: 'clear' }` removes the key.

### 3.6 Server-side validation at checkout — the exact pipeline

The cart is client state and is therefore **evidence, not truth**. `placeOrderAction` treats it as
an untrusted request body. Brief §7 and §34.2.

```ts
// src/app/_actions/cart-actions.ts
'use server';

export async function placeOrderAction(input: unknown): Promise<Result<OrderPlacedView>>;
```

Pipeline, in order. Each step is a hard gate; there is no step that logs and continues.

1. **Shape.** `placeOrderSchema.safeParse(input)` (doc 03 §7.2). `strictObject` means an unknown key
   is a 422, and there is **no `price` field in the schema at any depth** — a tampered payload
   carrying prices fails parsing before anything else happens. Failure → `VALIDATION_FAILED` with
   `details.field` from the zod issue path.
2. **Token.** `qrTokenSchema` already ran inside the schema. The token in the payload is the *only*
   table identity accepted; no `table_id`, `branch_id` or `restaurant_id` is accepted from the
   client at any point (brief §34.1).
3. **App-side shedding.** `checkLimit('order', `${clientIp(await headers())}:${input.token}`)`
   (doc 02 §5.4). On refusal → `RATE_LIMITED` with `retryAfterSeconds`. This is noise control, not
   the security limit.
4. **The RPC.** `placeOrder(parsed)` in `src/lib/rpc/public.ts` calls
   `public_place_order(p_token, p_items, p_note, p_client_request_id)` through
   `createPublicClient()` — the **anon** client, never the cookie client (doc 03 §9.2 rule 7).
   Inside Postgres, and only there, the authoritative work happens: token resolution (raising
   `QR001`/`QR002`/`QR003`/`QR004`), per-table cooldown against `tables.last_order_at`
   (`QR010`), availability re-check per line (`QR020`), option membership and group bounds
   (`QR022`), quantity bounds (`QR024`), **price read from `menu_items.price` and
   `menu_item_options.price_delta`**, snapshotting into `order_items`/`order_item_options`, fee
   computed from the restaurant/branch config, totals asserted by the deferred constraint trigger,
   and `order_number` allocated race-safely.
5. **Idempotency.** `client_request_id` is the cart's UUID, generated once and reused on every
   retry. The unique partial index makes a repeat submit return the same order rather than a second
   one. If `QR013_DUPLICATE_ORDER` escapes anyway, the action navigates to the returned order
   instead of surfacing an error (doc 02 §5.5).
6. **Output parsing.** `PublicOrderSchema.parse()` on the JSONB result. A drifted shape fails loudly
   in one file (doc 03 §9.2 rule 9).
7. **Reconciliation.** The action returns the server `OrderView`. `<PlaceOrderButton>` compares
   `server.total` with the advisory `state.totals.total`; **any** difference renders the
   `PRICE_MISMATCH` confirmation (doc 03 §8.5) showing the server figure. The order is already
   placed and correct; this exists so the guest is never shown a number the receipt contradicts.
8. **Cart teardown.** Only after `ok`: `dispatch({ type: 'clear' })`, append to
   `localStorage['qros:orders:<token>']`, then `router.replace(order.trackingPath)`.
9. **Revalidation.** `revalidatePath('/t/' + parsed.token, 'layout')` so a returning diner's menu
   reflects any availability change the order caused.

**What is deliberately absent from this pipeline:** any client-supplied money, any client-supplied
tenant id, any trust in the client's `isAvailable` flag, and any client-side computation that the
server does not repeat.

---

## 4. Authentication, middleware and request-scoped session

### 4.1 `src/middleware.ts`

```ts
// src/middleware.ts
import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { LOCALE_COOKIE, isLocale } from '@/lib/i18n/locale';
import { landingPathForClaims } from '@/lib/auth/redirects';

export const config = {
  runtime: 'nodejs',
  matcher: [
    // Everything except Next internals and static files. Route handlers ARE matched: they need
    // the refreshed session cookie too.
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|brand/|demo/|.*\\.(?:png|jpg|jpeg|webp|avif|svg|ico|woff2)$).*)',
  ],
};

export async function middleware(request: NextRequest) {
  // 1. Refresh the Supabase session and get a response that carries any rotated auth cookies.
  const { response, user } = await updateSession(request);

  // 2. ?lang= override → persist to the locale cookie on the SAME response object.
  const lang = request.nextUrl.searchParams.get('lang');
  if (lang && isLocale(lang) && request.cookies.get(LOCALE_COOKIE)?.value !== lang) {
    response.cookies.set(LOCALE_COOKIE, lang, {
      path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: false, secure: true,
    });
  }

  const { pathname } = request.nextUrl;

  // 3. Coarse gate. UX only — every route below also authorizes server-side, and RLS is the
  //    real boundary. NEVER put an authorization decision only here.
  const isProtected =
    pathname === '/admin' || pathname.startsWith('/admin/') ||
    pathname === '/kitchen' || pathname.startsWith('/kitchen/') ||
    pathname === '/waiter' || pathname.startsWith('/waiter/');

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(url);   // auth cookies from step 1 are not needed on a 302 to /login
  }

  // 4. A signed-in user landing on /login goes to their surface instead.
  if (user && (pathname === '/login' || pathname === '/')) {
    const target = landingPathForClaims(user);          // cheap: JWT only, no DB read
    if (target && pathname === '/login') {
      const url = request.nextUrl.clone();
      url.pathname = target;
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  // 5. ALWAYS return the response produced by updateSession, never a fresh NextResponse.next().
  return response;
}
```

**The three mistakes this file is written to avoid**, all of which produce intermittent, hard-to-
reproduce logouts:

1. **Returning a different response object than the one `setAll` wrote cookies onto.** Rotated
   refresh tokens are then dropped and the user is signed out at random. Step 5 is not stylistic.
2. **Calling `supabase.auth.getSession()` instead of `getUser()`.** `getSession()` reads the cookie
   without verifying it against the auth server; in middleware that is a forgeable identity.
   `updateSession` calls `getUser()`.
3. **Doing real authorization here.** Middleware sees a JWT, not the `staff` table. Membership is
   read live from the database by design (doc 02 §8.1), so a middleware role check would be both
   stale and bypassable by a direct route hit. It is a redirect convenience only.

### 4.2 `src/lib/supabase/middleware.ts` — the Next 16 cookie contract

`@supabase/ssr` 0.12 exposes exactly one cookie interface: `getAll` / `setAll`. The single-cookie
`get`/`set`/`remove` shape is removed; using it is a type error.

```ts
// src/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { publicEnv } from '@/lib/env/public';
import { isDemoMode } from '@/lib/demo/demo-mode';
import type { Database } from '@/types/database';
import type { User } from '@supabase/supabase-js';

export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  // In demo mode there is no auth server to talk to. Skip entirely; §8.4 defines the demo session.
  if (isDemoMode()) return { response: NextResponse.next({ request }), user: null };

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // (a) make the new cookies visible to anything reading `request` later in this pass
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          // (b) rebuild the response so it inherits the mutated request headers
          response = NextResponse.next({ request });
          // (c) write them onto the outgoing response
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // MUST be getUser(): it revalidates the token against the auth server and triggers the rotation
  // that setAll persists. Nothing between createServerClient() and this call may run.
  const { data } = await supabase.auth.getUser();

  return { response, user: data.user ?? null };
}
```

`src/lib/supabase/server.ts`, used from Server Components, Server Actions and Route Handlers:

```ts
// src/lib/supabase/server.ts
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();                 // Next 16: cookies() is async
  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which may not write cookies. Harmless: middleware
            // already refreshed the session for this request. Swallowing here is correct, and is
            // the ONLY place in this codebase where an empty catch is permitted.
          }
        },
      },
    },
  );
}
```

### 4.3 Public vs protected paths

| Path pattern | Auth | Client used | Enforcement |
|---|---|---|---|
| `/`, `/demo`, `/legal/**` | Public | none | — |
| `/t/**` (all customer routes) | **Public, never authenticated** | `createPublicClient()` (anon, **no cookies**) | Capability RPCs; `anon` holds zero table privileges (doc 02 §2.3) |
| `/api/public/**` | Public | `createPublicClient()` | Same, plus `checkLimit` |
| `/api/health` | Public | none / anon HTTP probe | — |
| `/login`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/auth-error` | Public | cookie client (read) | `(auth)/layout.tsx` redirects if already signed in |
| `/mfa` | Requires `aal1` session | cookie client | Own page guard, outside the `(auth)` redirect |
| `/api/auth/callback` | Public (carries a one-time code) | cookie client | Code exchange only |
| `/kitchen`, `/waiter` | Staff | cookie client | middleware gate + `requireStaffSession()` + `requireCapability()` + RLS |
| `/admin/**` | Staff (manager and up) | cookie client | as above + `requireAal2IfPrivileged` |
| `/admin/platform/**` | Platform admin | cookie client | `requirePlatformAdmin()` → `notFound()` |
| `/api/admin/**` | Staff | cookie client (+ admin client for the two documented cases) | Re-authorized in the handler; never trusts middleware |

**The rule stated once:** a route being reachable is decided in four independent places — middleware
(UX), the layout (redirect), the service (`FORBIDDEN` with a good message), and RLS (the truth).
Removing any of the first three degrades the experience. Removing the fourth is a breach.

### 4.4 `getStaffSession()` — loaded once per request, cached with `React.cache()`

```ts
// src/lib/services/session.ts
import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { StaffSession } from '@/types/domain';

/**
 * The one place a staff identity is derived. Wrapped in React.cache() so a layout, its page, a
 * sibling Suspense branch and six services in the same render all share ONE auth round trip and
 * ONE `staff` query. The cache lives for exactly one request/render pass and is never shared
 * between users — React.cache() is per-request by construction.
 *
 * NOT wrapped in unstable_cache / 'use cache': the result depends on a cookie and on live
 * `staff.is_active`, and doc 02 §8.1 requires deactivation to take effect on the NEXT QUERY.
 */
export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  if (isDemoMode()) return demoStaffSession();               // §8.4

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // One query, one round trip. RLS restricts this to the caller's own rows (doc 02 §3.5).
  const { data, error } = await supabase
    .from('staff')
    .select(`
      id, restaurant_id, branch_id, role, is_active,
      profiles!inner ( id, full_name, email, avatar_url, locale, is_platform_admin, is_active ),
      restaurants!inner ( id, name, slug, currency, currency_decimals, is_active, is_demo )
    `)
    .eq('profile_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  if (!data.profiles.is_active || !data.restaurants.is_active) return null;

  return {
    profileId: data.profiles.id,
    staffId: data.id,
    restaurantId: data.restaurant_id,
    branchId: data.branch_id,                 // null for RESTAURANT_OWNER and restaurant-wide MANAGER
    role: data.role,
    isPlatformAdmin: data.profiles.is_platform_admin,
    displayName: data.profiles.full_name ?? data.profiles.email ?? 'Staff',
    email: data.profiles.email,
    avatarUrl: data.profiles.avatar_url,
    locale: data.profiles.locale,
  };
});

/**
 * Redirects to /login?next=<path> when there is no session.
 * `next` is passed explicitly by the caller (a layout knows its own route); there is no reliable
 * "current pathname" header in a Server Component, and guessing from `referer` sends people to
 * the wrong screen. The (admin) layout calls requireStaffSession('/admin'); the (staff)
 * layout uses the default and lets its sub-layouts add the capability check.
 */
export async function requireStaffSession(next = '/admin'): Promise<StaffSession> {
  const session = await getStaffSession();
  if (session) return session;
  redirect(`/login?next=${encodeURIComponent(safeNextPath(next))}`);
}

export type Capability = 'kitchen' | 'waiter' | 'admin' | 'platform';

/** Throws AppErrorException(FORBIDDEN). The caller decides redirect vs render. */
export function requireCapability(session: StaffSession, capability: Capability): void;

export async function requirePlatformAdmin(): Promise<StaffSession> {
  const session = await requireStaffSession();
  if (!session.isPlatformAdmin) notFound();
  return session;
}

/**
 * The branch set this session may read or act on. Also React-cached.
 *  - platform admin           → every branch of every restaurant in scope
 *  - RESTAURANT_OWNER         → every branch of session.restaurantId
 *  - MANAGER, branchId null   → every branch of session.restaurantId
 *  - MANAGER, branchId set    → [branchId]
 *  - WAITER | KITCHEN         → [branchId]  (branchId is NOT NULL for these roles by DB constraint)
 */
export const getBranchScope = cache(async (): Promise<BranchScope> => { /* … */ });

/**
 * The branch the UI is currently pointed at: the `qros_branch` cookie if it is inside
 * getBranchScope(), otherwise the first branch of the scope. UI convenience only — a service
 * NEVER takes the active branch from the cookie without re-checking it against the scope.
 */
export const getActiveBranchId = cache(async (): Promise<string | null> => { /* … */ });
```

**Capability matrix** implemented by `requireCapability`:

| Capability | `SUPER_ADMIN` (platform) | `RESTAURANT_OWNER` | `MANAGER` | `WAITER` | `KITCHEN` |
|---|:--:|:--:|:--:|:--:|:--:|
| `kitchen` | ✓ | ✓ | ✓ | — | ✓ |
| `waiter` | ✓ | ✓ | ✓ | ✓ | — |
| `admin` | ✓ | ✓ | ✓ | — | — |
| `platform` | ✓ | — | — | — | — |

This mirrors doc 02 §4.5's SQL predicates. It exists to produce a good redirect and a good error
message; the SQL predicates and RLS are what make the refusal true.

### 4.5 Post-login redirects

```ts
// src/lib/auth/redirects.ts

/** The surface a role lands on after a successful sign-in. */
export function landingPathForSession(session: StaffSession): string {
  if (session.isPlatformAdmin) return '/admin/platform';
  switch (session.role) {
    case 'KITCHEN':          return '/kitchen';
    case 'WAITER':           return '/waiter';
    case 'MANAGER':
    case 'RESTAURANT_OWNER': return '/admin';
  }
}

/**
 * Middleware-only, JWT-only variant: no database read is possible there, so it can only use what
 * the token carries. Returns '/admin' as a neutral default and lets the (admin) layout redirect
 * onward once the real session is loaded. Never used for authorization.
 */
export function landingPathForClaims(user: User): string { return '/admin'; }

/**
 * Sanitizes a ?next= value. Prevents open redirects and prevents bouncing a signed-in user into
 * the customer app.
 * Accepts only: a same-origin path starting with a single '/', not starting with '//' or '/\',
 * and not starting with '/t/', '/api/' or '/login'.
 * Anything else returns the caller-supplied fallback (default '/admin').
 */
export function safeNextPath(candidate: string | null | undefined, fallback = '/admin'): string;

/**
 * Is this path reachable for this session's capabilities? Used by signInAction and by
 * /api/auth/callback so a KITCHEN user carrying `?next=/admin` lands on /kitchen instead of
 * bouncing off the admin layout. Mirrors the §4.4 capability matrix.
 */
export function isPathReachable(session: StaffSession, path: string): boolean;
```

Required behaviour, exactly:

| Role / state | After `POST` sign-in | After `/api/auth/callback` | After `/mfa` success |
|---|---|---|---|
| `KITCHEN` | `/kitchen` | `/kitchen` | n/a (MFA not required) |
| `WAITER` | `/waiter` | `/waiter` | n/a |
| `MANAGER` | `/admin` | `/admin` | `next` or `/admin` |
| `RESTAURANT_OWNER` | `/mfa?next=/admin` when `aal !== 'aal2'`, else `/admin` | same | `next` or `/admin` |
| platform admin (`profiles.is_platform_admin`) | `/mfa?next=/admin/platform` when `aal !== 'aal2'`, else `/admin/platform` | same | `next` or `/admin/platform` |
| signed in, no active `staff` row | `/auth-error?reason=no_membership` | same | — |
| `?next=` present and `safeNextPath` accepts it | that path | that path | that path |

`signInAction` never renders its own redirect target from user input. It computes
`const landing = landingPathForSession(session)` first, then
`const candidate = safeNextPath(next, landing)`, and returns
`isPathReachable(session, candidate) ? candidate : landing`. So a stale or hostile `?next=` can
only ever narrow the destination to something the role may actually open.

### 4.6 Locale, precisely

- Cookie: `qros_locale`, values `uz | ru | en`, `path=/`, `max-age=31536000`, `SameSite=Lax`,
  `Secure`, **not** `HttpOnly` (a client component reads it for the switcher's initial state).
- Override: `?lang=ru` on any URL. Middleware validates it, writes the cookie, and lets the request
  through unchanged — the query param is not stripped, so a QR poster printed with `?lang=ru`
  keeps working and a share of that URL keeps its language.
- Precedence in `resolveLocale`: `?lang=` (already promoted to cookie) → cookie →
  `Accept-Language` (first `uz`/`ru`/`en` match) → `NEXT_PUBLIC_DEFAULT_LOCALE` → `'uz'`.
- The **restaurant's** `default_locale` is a content fallback, not a UI language: `t()` uses it when
  an `i18n_text` has no entry for the active UI locale (doc 03 §2.2).
- `setLocaleAction` (§5.2.2) writes the cookie server-side and calls `revalidatePath('/', 'layout')`
  so the whole tree re-renders in the new language without a full reload.

---

## 5. Server Actions vs Route Handlers

### 5.1 The rule

> **A Server Action is the default for every mutation initiated by our own UI.**
> **A Route Handler exists only when the response is not a React tree, or the caller is not our
> React tree.**

Concretely, use a **Route Handler** when and only when one of these is true:

1. The response is a **non-JSON, non-RSC payload** — an image (`/api/qr/[tableId]`), a file.
2. The caller is **not our UI** — an uptime monitor (`/api/health`), an OAuth/email redirect from
   Supabase (`/api/auth/callback`).
3. The request is a **browser-native form/`fetch` that must work without React** —
   `/api/auth/signout` (a plain `<form method="post">` so signing out works even if hydration failed).
4. The client needs **polling or `multipart/form-data` streaming** — the realtime fallback
   (`/api/public/order/…`), client-side menu refresh (`/api/public/menu/…`), image upload
   (`/api/admin/media`).

Everything else is a Server Action. In particular: no `/api/orders`, no `/api/menu` CRUD, no
`/api/tables` — those would be a second, weaker copy of the authorization the actions already do.

**Every Server Action obeys these five rules** (they extend doc 03 §9.2):

1. First statement is a zod parse of `input: unknown`. The action signature never types its input
   as the domain type — that would be a lie about where validation happens.
2. Second statement is authorization: `requireStaffSession()` + `requireCapability()` for staff
   actions; nothing for public customer actions (they are anon by design and are authorized by the
   capability token inside the RPC).
3. It returns `Promise<Result<T>>` and **never throws across the boundary**.
4. It never accepts `restaurant_id` from the client. Tenancy comes from the session. A `branch_id`
   argument is verified against `getBranchScope()`.
5. Revalidation (`revalidatePath` / `revalidateTag`) happens in the action after a successful
   `Result`, never inside a service.

Actions live in `src/app/_actions/*.ts` — a Next private folder (leading underscore), so it is not
routable, and every `'use server'` module in the repository is in one directory that a reviewer can
read end to end.

### 5.2 Complete Server Action inventory

Types referenced below come from doc 03 (`Result`, `OrderView`, `MenuItemInput`, …) unless defined
here. `void` results are written `Result<null>`.

#### 5.2.1 `src/app/_actions/auth-actions.ts`

| Action | Input type | Output type | Notes |
|---|---|---|---|
| `signInAction` | `unknown` → `SignInInput` = `{ email: string; password: string; next: string \| null }` | `Result<{ redirectTo: string }>` | `signInWithPassword`; on success computes `landingPathForSession()`, narrows with `safeNextPath`. Failure is always the generic `errors.auth.invalid_credentials` — never "no such user". |
| `signOutAction` | — | `never` (redirects) | `supabase.auth.signOut({ scope: 'local' })` then `redirect('/login')`. |
| `requestPasswordResetAction` | `unknown` → `{ email: string }` | `Result<null>` | `resetPasswordForEmail(email, { redirectTo: APP_URL + '/api/auth/callback?next=/reset-password' })`. **Always returns `ok(null)`**, present or absent, so the form is not an account-existence oracle. |
| `updatePasswordAction` | `unknown` → `{ password: string }` | `Result<{ redirectTo: string }>` | Requires a recovery session. Min 10 chars (doc 02 §8.1). |
| `acceptInviteAction` | `unknown` → `{ password: string; fullName: string; locale: Locale }` | `Result<{ redirectTo: string }>` | Sets the password and `profiles.full_name`/`locale` on the invited user, then role-redirects. |
| `enrollMfaAction` | — | `Result<{ factorId: string; qrSvg: string; secret: string }>` | `auth.mfa.enroll({ factorType: 'totp' })`. |
| `verifyMfaAction` | `unknown` → `{ factorId: string; code: string; next: string \| null }` | `Result<{ redirectTo: string }>` | `challenge` + `verify` → `aal2`. |

#### 5.2.2 `src/app/_actions/locale-actions.ts`

| Action | Input | Output | Notes |
|---|---|---|---|
| `setLocaleAction` | `unknown` → `{ locale: Locale }` (`localeSchema`) | `Result<null>` | Writes `qros_locale` via `(await cookies()).set(...)`, then `revalidatePath('/', 'layout')`. Public — no session needed. |

#### 5.2.3 `src/app/_actions/cart-actions.ts` — public, anon, customer

| Action | Input type | Output type | Notes |
|---|---|---|---|
| `placeOrderAction` | `unknown` → `PlaceOrderInput` (doc 03 §7.2) | `Result<OrderView>` | The §3.6 pipeline. `revalidatePath('/t/'+token, 'layout')`. |
| `cancelOrderAction` | `unknown` → `CancelOrderInput` (doc 03 §7.2) | `Result<OrderView>` | Calls `public_cancel_order` (doc 03 §1.4). Refuses unless `status === 'pending'` — the server decides, the button merely hides. |
| `revalidateCartAction` | `unknown` → `{ token: string; items: { menu_item_id: string; option_ids: string[] }[] }` | `Result<CartRevalidation>` where `CartRevalidation = { unavailableItemIds: string[]; unavailableOptionIds: string[]; priceChanges: { menuItemId: string; price: Money }[]; generatedAt: string }` | A cheap pre-flight the cart page calls before enabling PLACE ORDER. Purely advisory; the real gate is inside `public_place_order`. |

#### 5.2.4 `src/app/_actions/waiter-call-actions.ts` — public (create) + staff (update)

| Action | Input type | Output type | Notes |
|---|---|---|---|
| `callWaiterAction` | `unknown` → `WaiterCallInput` (doc 03 §7.5) | `Result<{ callId: string; createdAt: string; cooldownSeconds: number }>` | Anon client → `public_call_waiter`. `checkLimit('waiter-call', ip+token)` first. `QR011`/`QR012` → `RATE_LIMITED` with `retryAfterSeconds`, rendered as a countdown on the disabled button, never a toast. |
| `acknowledgeCallAction` | `unknown` → `WaiterCallUpdateInput` with `next_status: 'acknowledged'` | `Result<WaiterCallView>` | Staff. `requireCapability(session,'waiter')`. `revalidatePath('/waiter')`. |
| `resolveCallAction` | `unknown` → `WaiterCallUpdateInput` with `next_status: 'resolved'` | `Result<WaiterCallView>` | Staff. Same guards. |

#### 5.2.5 `src/app/_actions/order-actions.ts` — staff

| Action | Input type | Output type | Notes |
|---|---|---|---|
| `updateOrderStatusAction` | `unknown` → `StatusUpdateInput` (doc 03 §7.2) | `Result<OrderView>` | `assertTransition()` mirror check, then the optimistic-concurrency update in `order-service.ts`. `revalidatePath('/kitchen')`, `revalidatePath('/waiter')`, `revalidatePath('/admin/orders')`. |
| `acceptOrderAction` | `unknown` → `{ order_id: string }` | `Result<OrderView>` | Sugar for `pending → confirmed`; exists because the KDS's primary button must be one tap and cannot compose a full `StatusUpdateInput` client-side. |
| `startPreparingAction` | `unknown` → `{ order_id: string }` | `Result<OrderView>` | `confirmed → preparing`. |
| `markReadyAction` | `unknown` → `{ order_id: string }` | `Result<OrderView>` | `preparing → ready`. |
| `markDeliveredAction` | `unknown` → `{ order_id: string }` | `Result<OrderView>` | `ready → delivered`. Waiter panel. |
| `completeOrderAction` | `unknown` → `{ order_id: string }` | `Result<OrderView>` | `delivered → completed`. |
| `cancelOrderStaffAction` | `unknown` → `{ order_id: string; reason: string }` | `Result<OrderView>` | Reason is mandatory (`QR042`). |
| `voidOrderLineAction` | `unknown` → `{ order_item_id: string; reason: string }` | `Result<OrderView>` | Calls `staff_void_order_item` (doc 02 §4.7). |

Each sugar action reads the order's current status server-side and builds the full
`StatusUpdateInput` itself, so `expected_status` is never supplied by the client — that is what
makes the optimistic-concurrency guard meaningful rather than decorative.

#### 5.2.6 `src/app/_actions/menu-actions.ts` — staff

| Action | Input type | Output type |
|---|---|---|
| `createMenuItemAction` | `unknown` → `MenuItemInput` (doc 03 §7.3) | `Result<{ id: string }>` |
| `updateMenuItemAction` | `unknown` → `MenuItemInput & { id: string }` | `Result<{ id: string }>` |
| `deleteMenuItemAction` | `unknown` → `{ id: string }` | `Result<null>` — soft delete (`deleted_at`) |
| `setMenuItemAvailabilityAction` | `unknown` → `MenuItemAvailabilityInput` | `Result<null>` |
| `reorderMenuItemsAction` | `unknown` → `ReorderInput` with `entity: 'menu_item'` | `Result<null>` |
| `reorderMenuItemOptionsAction` | `unknown` → `ReorderInput` with `entity: 'menu_item_option'` | `Result<null>` |

All revalidate `/admin/menu` and, because a menu change is visible to diners immediately,
`revalidateTag('menu:' + session.restaurantId)`.

#### 5.2.7 `src/app/_actions/category-actions.ts` — staff

| Action | Input type | Output type |
|---|---|---|
| `createCategoryAction` | `unknown` → `CategoryInput` | `Result<{ id: string }>` |
| `updateCategoryAction` | `unknown` → `CategoryInput & { id: string }` | `Result<{ id: string }>` |
| `deleteCategoryAction` | `unknown` → `{ id: string }` | `Result<null>` — refuses with `VALIDATION_FAILED` when the category still holds non-deleted items (FK is `RESTRICT`) |
| `setCategoryActiveAction` | `unknown` → `{ id: string; is_active: boolean }` | `Result<null>` |
| `reorderCategoriesAction` | `unknown` → `ReorderInput` with `entity: 'menu_category'` | `Result<null>` |

#### 5.2.8 `src/app/_actions/table-actions.ts` — staff

| Action | Input type | Output type | Notes |
|---|---|---|---|
| `createTableAction` | `unknown` → `TableInput` | `Result<{ id: string; qrToken: string }>` | `qr_token` is a column DEFAULT (`generate_qr_token()`), never client-supplied. |
| `updateTableAction` | `unknown` → `TableInput & { id: string }` | `Result<null>` | `qr_token` is not in `TableInput`; a payload containing it fails `strictObject`. |
| `setTableActiveAction` | `unknown` → `{ id: string; is_active: boolean }` | `Result<null>` | |
| `deleteTableAction` | `unknown` → `{ id: string }` | `Result<null>` | Soft delete. |
| `rotateTableTokenAction` | `unknown` → `RotateTableTokenInput` | `Result<{ qrToken: string; rotationCount: number }>` | Calls `admin_rotate_table_token`; the old token lands in `qr_token_history` and stops resolving (brief §34.10). |
| `setActiveBranchAction` | `unknown` → `{ branchId: string }` | `Result<null>` | Writes the `qros_branch` cookie **after** checking membership in `getBranchScope()`. |

#### 5.2.9 `src/app/_actions/branch-actions.ts` — staff

| Action | Input type | Output type |
|---|---|---|
| `createBranchAction` | `unknown` → `BranchInput` | `Result<{ id: string }>` |
| `updateBranchAction` | `unknown` → `BranchInput & { id: string }` | `Result<null>` |
| `setBranchAcceptingOrdersAction` | `unknown` → `{ id: string; is_accepting_orders: boolean }` | `Result<null>` |
| `setBranchActiveAction` | `unknown` → `{ id: string; is_active: boolean }` | `Result<null>` |

#### 5.2.10 `src/app/_actions/staff-actions.ts` — staff (manager and up)

| Action | Input type | Output type | Notes |
|---|---|---|---|
| `inviteStaffAction` | `unknown` → `StaffInput` with `invite_email` set | `Result<{ staffId: string }>` | Delegates to `POST /api/admin/staff/invite` semantics *in-process*: `createAdminClient()` only for `auth.admin.inviteUserByEmail`, then the `staff` INSERT with the caller's **own cookie client** so `staff_insert_manager` and `trg_staff_guard()` both apply (doc 02 §8.1). |
| `updateStaffAction` | `unknown` → `StaffInput & { id: string }` | `Result<null>` | `QR055` (escalation), `QR056` (self-modification) and `QR051` (last owner) surface as `FORBIDDEN` with distinct message keys. |
| `deactivateStaffAction` | `unknown` → `{ id: string }` | `Result<null>` | |

#### 5.2.11 `src/app/_actions/settings-actions.ts` — owner only

| Action | Input type | Output type |
|---|---|---|
| `updateSettingsAction` | `unknown` → `SettingsInput` (doc 03 §7.4) | `Result<null>` |

Changing `currency` / `currency_decimals` does not rewrite history — every order froze its own
(doc 03 §7.4). The form states this above the field.

#### 5.2.12 `src/app/_actions/platform-actions.ts` — platform admin only

| Action | Input type | Output type | Notes |
|---|---|---|---|
| `setRestaurantActiveAction` | `unknown` → `{ restaurantId: string; is_active: boolean }` | `Result<null>` | Suspends a whole tenant; every `/t/**` route for it then returns `RESTAURANT_CLOSED`. |
| `setRestaurantDemoFlagAction` | `unknown` → `{ restaurantId: string; is_demo: boolean }` | `Result<null>` | Drives the `DashboardStats.isDemo` banner (§8.5). |

### 5.3 Complete Route Handler inventory

Every handler: `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`;
returns through `src/lib/http/responses.ts` so status, `Cache-Control` and the error envelope are
identical everywhere. The error envelope is
`{ error: { code: AppErrorCode; wire?: QrErrorCode; message: string; details?: object; traceId: string } }`
with the HTTP status from `AppError.httpStatus`.

#### 5.3.1 `GET /api/health` — `src/app/api/health/route.ts`

Public, unauthenticated. For uptime monitors and deploy smoke tests.

```
200 {
  "status": "ok" | "degraded",
  "mode": "live" | "demo",
  "version": "0.1.0",              // package.json version, inlined at build
  "commit": "<VERCEL_GIT_COMMIT_SHA | 'local'>",
  "uptimeSeconds": 1234,
  "checks": { "supabaseAuth": "ok" | "unreachable" | "skipped" },
  "checkedAt": "2026-09-01T10:00:00.000Z"
}
503 when checks.supabaseAuth === 'unreachable'
```

In live mode `checks.supabaseAuth` is a `fetch` of `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`
with a 2 s `AbortSignal.timeout`. In demo mode it is `"skipped"` and `status` is `"ok"` — a demo
deployment is healthy by definition. Never touches the database and never uses the service-role
key, so it is safe to expose. Headers: `Cache-Control: no-store`.

#### 5.3.2 `GET /api/auth/callback` — `src/app/api/auth/callback/route.ts`

Supabase redirect target for magic links, invitations, password recovery and email confirmation.
Reads `?code` and `?next`; calls `supabase.auth.exchangeCodeForSession(code)` with the cookie
client; on success `redirect(safeNextPath(next, landingPathForSession(await getStaffSession())))`;
on failure `redirect('/auth-error?reason=' + reason)`. `?next` is **always** passed through
`safeNextPath`. This URL is registered in `supabase/config.toml` `additional_redirect_urls` and in
the hosted project's auth settings.

#### 5.3.3 `POST /api/auth/signout` — `src/app/api/auth/signout/route.ts`

Exists as a Route Handler, not only as an action, so a plain `<form method="post"
action="/api/auth/signout">` signs a user out even when hydration failed. Calls
`signOut({ scope: 'local' })`, then `303 See Other` to `/login`.

#### 5.3.4 `GET /api/public/menu/[token]` — `src/app/api/public/menu/[token]/route.ts`

Client-side menu refresh: the cart page's availability re-check and the tracker's "order again"
path. Anon client → `public_get_menu`.

- `params` is a Promise: `const { token } = await params;`
- `qrTokenSchema` parse → 404 on failure.
- `checkLimit('menu', clientIp(request.headers))` → 429 with `Retry-After`.
- `200` body: `{ menu: MenuTree }`. Headers: `Cache-Control: private, no-store`,
  `X-Robots-Tag: noindex`.

#### 5.3.5 `GET /api/public/order/[token]/[publicOrderId]` — realtime fallback

Anon client → `public_get_order`. Both path segments are capabilities and both are validated
(`qrTokenSchema`, `publicCodeSchema`). `checkLimit('order-read', ip)`. `200 { order: OrderView }`;
`404` for `QR030`/`QR032`; `410` is **not** used — an expired order is indistinguishable from a
missing one on purpose. `Cache-Control: private, no-store`.

#### 5.3.6 `GET /api/qr/[tableId]` — the QR image endpoint

The one endpoint that emits bytes, not JSON.

```
GET /api/qr/<tableId>?format=png|svg&size=<256..2048>&margin=<0..8>&download=<0|1>
```

- **Auth: required.** A QR image embeds a live capability token, so this is not public. Flow:
  `requireStaffSession()` → `requireCapability(session, 'admin')` → read the table through the
  **cookie client** (`table-service.getTable(id)`); if RLS returns nothing, `404`. There is no
  separate ownership check to get wrong — invisibility *is* the check.
- Query parsed by `qrRenderParamsSchema` (`src/lib/validation/qr.ts`); defaults
  `format=png`, `size=1024`, `margin=2`, `download=0`. Out-of-range → `422`.
- Content: `${publicEnv.NEXT_PUBLIC_APP_URL}/t/${table.qr_token}` rendered by `qrcode` at error
  correction level `M`, black on white (a warm-tinted QR is a scanning defect, not a brand asset).
- Response: `image/png` (a `Buffer` from `qrcode.toBuffer`) or `image/svg+xml`
  (`qrcode.toString({ type: 'svg' })`).
- Headers, all mandatory: `Cache-Control: private, no-store, max-age=0`, `X-Robots-Tag: noindex,
  nofollow`, `Content-Disposition: attachment; filename="table-<number>-<slug>.png"` when
  `download=1` (`inline` otherwise), `X-Content-Type-Options: nosniff`.
- **Never cached at any shared layer.** A CDN copy of a table's QR outliving a token rotation would
  silently defeat brief §34.10.

#### 5.3.7 `POST /api/admin/media` · `DELETE /api/admin/media` — image upload

`multipart/form-data`, which is why it is a handler and not an action.

- `POST` fields: `file` (required), `kind` (`menu_item | menu_category | promotion | restaurant_logo | restaurant_cover`).
- Guards, in order: `requireStaffSession()` → `requireCapability(session,'admin')` → content-length
  ≤ 5 MB → sniff the real MIME from magic bytes (`image/jpeg|png|webp` only; the browser-supplied
  `Content-Type` is ignored) → re-encode to WebP, strip EXIF, cap the longest edge at 2048 px →
  upload to `menu-images/<restaurant_id>/<branch_id|'_'>/<uuid>.webp`.
  **`restaurant_id` comes from the session, never from the body** (doc 02 §8.2).
- `200 { url, path, width, height, bytes }`.
- `DELETE` body `{ path }`: refuses any path whose first segment is not `session.restaurantId`,
  then removes the object.

#### 5.3.8 `POST /api/admin/staff/invite` — staff invitation

Kept as a handler because doc 02 §8.1 names this URL and because it is the only place
`createAdminClient()` is reachable from a request path; a single URL is easier to audit and to rate
limit than a hidden action. Body: `StaffInput` with `invite_email`.
`createAdminClient().auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL + '/api/auth/callback?next=/accept-invite' })`,
then the `public.staff` INSERT with the **caller's cookie client**. `201 { staffId }`.
`inviteStaffAction` (§5.2.10) performs the identical sequence in-process for the admin UI; both
paths share `staff-service.inviteStaff()` so there is one implementation, not two.

### 5.4 `src/lib/http/responses.ts`

```ts
export function jsonOk<T>(data: T, init?: { status?: number; headers?: HeadersInit }): Response;
export function jsonError(error: AppError, traceId: string): Response;   // status = error.httpStatus
export function noStore(response: Response): Response;                   // Cache-Control: private, no-store
export function imageResponse(
  body: Buffer | string,
  contentType: 'image/png' | 'image/svg+xml',
  options: { filename?: string; download: boolean },
): Response;
export function rateLimited(retryAfterSeconds: number, traceId: string): Response;  // 429 + Retry-After
```

### 5.5 Supporting modules named by the handlers

| Module | Exports |
|---|---|
| `src/lib/qr/render.ts` | `renderQrPng(url: string, opts: { size: number; margin: number }): Promise<Buffer>` · `renderQrSvg(url: string, opts: { size: number; margin: number }): Promise<string>` · `qrTargetUrl(qrToken: string): string` |
| `src/lib/validation/qr.ts` | `qrRenderParamsSchema` → `{ format: 'png' \| 'svg'; size: number; margin: number; download: boolean }` |
| `src/lib/services/media-service.ts` | `uploadImage(input: UploadImageInput): Promise<Result<UploadedImage>>` · `deleteImage(path: string): Promise<Result<null>>` |

### 5.6 `src/lib/log.ts`

```ts
export function newTraceId(): string;                       // 16 hex chars from crypto.randomUUID()
export function logError(traceId: string, error: AppError, context: Record<string, unknown>): void;
export function logEvent(name: string, fields: Record<string, unknown>): void;
```

One line of JSON to stderr/stdout. **Never logs**: a QR token, an order `public_code`, a password,
a JWT, a service-role key, or a customer note. Tokens are logged as
`token.slice(0, 4) + '…'` when they must be correlated at all.

---

## 6. Data fetching, caching and revalidation

### 6.1 Next 16 correctness: the dynamic APIs are Promises

This is the single most common source of silently wrong code in a Next 16 codebase, so it is stated
once, exactly:

```ts
// page.tsx / layout.tsx / route.ts / generateMetadata — ALL of these are Promises in Next 16
export default async function Page({
  params,          // Promise<{ token: string }>
  searchParams,    // Promise<{ [key: string]: string | string[] | undefined }>
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);   // await both, in parallel
}

import { cookies, headers, draftMode } from 'next/headers';
const cookieStore = await cookies();     // Promise<ReadonlyRequestCookies>
const headerList  = await headers();     // Promise<ReadonlyHeaders>
const draft       = await draftMode();   // Promise<DraftMode>

// Route Handlers: the second argument's `params` is a Promise too.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; publicOrderId: string }> },
) {
  const { token, publicOrderId } = await params;
}
```

Binding consequences:
- **Never** destructure `params` in the function signature (`{ params: { token } }`) — it does not
  type-check and, if forced, yields `undefined`.
- **Never** pass an un-awaited `params` down to a child component.
- `await Promise.all([params, searchParams])` rather than two sequential awaits: they are
  independent and sequential awaits add a needless microtask hop on every render.
- Reading `cookies()` or `headers()` makes the segment dynamic. That is already true globally here
  (§2.1), so it costs nothing extra — but it is why `cacheComponents` stays off.

### 6.2 `React.cache()` — per-request deduplication

Supabase calls are not `fetch`-based from our perspective (the client wraps its own transport), so
Next's fetch-level dedupe does not apply. Deduplication is explicit:

```ts
// src/lib/data/table-context.ts
import { cache } from 'react';

/** Deduped per request/render pass. Called by generateMetadata, the layout, the page, and the
 *  cart page — one RPC round trip. */
export const getTableContext = cache(
  async (token: string): Promise<Result<TableContext>> =>
    isDemoMode() ? demoRepository.resolveTable(token) : publicRpc.resolveTable(token),
);

// src/lib/data/menu.ts
export const getMenuTree = cache(
  async (token: string): Promise<Result<MenuTree>> =>
    isDemoMode() ? demoRepository.getMenu(token) : publicRpc.getMenu(token),
);
```

Every function in `src/lib/data/*` that can be called more than once in one render is wrapped in
`cache()`. `getStaffSession()` and `getBranchScope()` likewise (§4.4). `React.cache()` is
**per-request** — it is never a cross-user cache and never survives a response, which is exactly
what a multi-tenant app needs.

### 6.3 What is fetched server-side

| Surface | Fetched on the server | Function |
|---|---|---|
| `/t/[token]` layout | `TableContext` | `getTableContext(token)` |
| `/t/[token]` page | `MenuTree` (categories, items, options, promotions) | `getMenuTree(token)` |
| `/t/[token]/item/[itemId]` | `TableContext` + `MenuTree` (deduped) | both above |
| `/t/[token]/cart` | `TableContext` + fresh `MenuTree` → `ReconcileIndex` | both above |
| `/t/[token]/order/[publicOrderId]` | `OrderView` incl. snapshot lines + history | `getOrderView(token, code)` |
| `/kitchen` | `KitchenTicket[]` for the active branch, statuses `pending, confirmed, preparing, ready` | `getKitchenTickets(branchId)` |
| `/waiter` | active orders, ready orders, open `WaiterCallView[]` | `getWaiterBoard(branchId)` |
| `/admin` | `DashboardStats` for today's business date in the branch timezone | `getDashboard(branchId, businessDate)` |
| `/admin/orders` | paginated orders filtered by the awaited `searchParams` | `getAdminOrders(scope, filters)` |
| `/admin/menu`, `/categories`, `/tables`, `/branches`, `/staff`, `/settings` | the corresponding lists / records | `src/lib/data/admin.ts` |
| every `(staff)` / `(admin)` layout | `StaffSession`, `BranchScope` | `getStaffSession()`, `getBranchScope()` |

### 6.4 What is subscribed to client-side

Brief §28: push, not polling.

| Consumer | Transport | Topic / filter | On event |
|---|---|---|---|
| `<OrderTracker>` (customer, `anon`) | Realtime **Broadcast from Database** | `order:<publicCode>` — the topic *is* the capability; RLS on `realtime.messages` via `order_topic_is_valid()` (doc 02 §7.2) | Merge the pushed `{ status, order_number, table_number, at }` into local state; on `ready`/`delivered` also fire a haptic + sound cue. |
| `<KdsBoard>` (kitchen, `authenticated`) | `postgres_changes` | `orders`, `order_items` with `filter: branch_id=eq.<uuid>` — a **bandwidth** filter; RLS decides what may be delivered | `INSERT` → prepend to NEW + `<NewOrderChime>`; `UPDATE` → move between columns; `DELETE` → remove. |
| `<KdsBoard>` | `postgres_changes` on `menu_items` | same branch filter | Reflect an availability toggle without a refetch. |
| `<WaiterBoard>` | `postgres_changes` on `waiter_calls`, `orders` | same branch filter | New `pending` call → `<CallAlert>` "TABLE 12 IS CALLING" until acknowledged (brief §10). |
| `/admin` dashboard | `postgres_changes` on `orders` | branch filter | Debounced 3 s `router.refresh()` — the numbers are aggregates and re-deriving them client-side would be a second, divergent implementation. |

All of it runs through `<RealtimeProvider>` (one channel per branch) and
`src/lib/realtime/subscribe.ts`. Topic strings are built **only** by
`src/lib/realtime/channels.ts`; a string literal `'order:'` anywhere else is a review rejection.

**Fallbacks, and their honesty.** If a channel does not reach `SUBSCRIBED` within 8 s, or emits
`CHANNEL_ERROR`/`TIMED_OUT`, the consumer flips to polling (customer 15 s, staff 10 s) and renders
`<ConnectionBadge state="polling">` so the operator can see the difference. Demo mode always
polls (§8.6) and labels itself the same way. Polling is never the primary mechanism.

### 6.5 Caching directives, per segment — the complete table

| Segment | `runtime` | `dynamic` | `revalidate` | `fetchCache` | Why |
|---|---|---|---|---|---|
| `src/app/layout.tsx` | `nodejs` | (inherited dynamic — reads cookies) | — | — | Locale from cookie. |
| `(marketing)/**` | default | default | — | — | No data. Dynamic in practice because of the root layout; render cost ≈ 0. |
| `(customer)/t/[token]/layout.tsx` | `nodejs` | `force-dynamic` | — | `default-no-store` | Capability token, live availability. |
| `(customer)/t/[token]/page.tsx` | `nodejs` | `force-dynamic` | — | — | An 86'd dish must vanish on the next load. |
| `(customer)/t/[token]/item/**`, `@modal/**` | `nodejs` | `force-dynamic` | — | — | Same menu freshness. |
| `(customer)/t/[token]/cart/page.tsx` | `nodejs` | `force-dynamic` | — | — | Reconciliation is only meaningful against fresh data. |
| `(customer)/t/[token]/order/**` | `nodejs` | `force-dynamic` | — | — | Live order state. |
| `(auth)/**` | `nodejs` | `force-dynamic` | — | — | Session-dependent. |
| `(staff)/**` | `nodejs` | `force-dynamic` | — | — | Session + live orders. |
| `(admin)/**` | `nodejs` | `force-dynamic` | — | — | Session + tenant data. |
| `api/**` | `nodejs` | `force-dynamic` | — | — | All handlers. |

**There is no `revalidate` anywhere, and no `unstable_cache`, and no `'use cache'`.** Every value
this app renders is either per-request identity (session, token) or data whose staleness has an
operational cost measured in minutes of a wrong kitchen queue. A Data Cache entry keyed on a tenant
is also a cross-tenant leak waiting for one wrong cache key; not having one removes the class.

The one thing that *is* cached is HTTP-level and per-response: `Cache-Control: private, no-store`
on every public and staff response (`noStore()` in §5.4), and Next's client-side Router Cache,
whose `staleTime` for dynamic pages is 0 — which is why mutations still call `revalidatePath`.

### 6.6 Revalidation strategy

| Trigger | Call | Effect |
|---|---|---|
| Any menu/category mutation | `revalidatePath('/admin/menu')`, `revalidatePath('/admin/categories')` | Admin list refreshes on the next navigation. |
| Any menu/category mutation | `revalidateTag('menu:' + restaurantId)` | Reserved tag: harmless today (nothing is tagged), and the single line to change if a menu Data Cache is ever introduced. Declaring it now keeps the call sites correct. |
| Order status change | `revalidatePath('/kitchen')`, `revalidatePath('/waiter')`, `revalidatePath('/admin/orders')`, `revalidatePath('/admin')` | Server-rendered lists agree with what realtime already pushed. |
| Table create / update / rotate | `revalidatePath('/admin/tables')` | |
| Branch / staff / settings mutation | `revalidatePath('/admin/branches' \| '/admin/staff' \| '/admin/settings')` and `revalidatePath('/admin', 'layout')` when the branch list or the fee changed | The layout holds the branch switcher and the currency. |
| `setLocaleAction` | `revalidatePath('/', 'layout')` | Whole tree re-renders in the new language. |
| `placeOrderAction` | `revalidatePath('/t/' + token, 'layout')` | The diner's next menu view reflects any availability change. |
| Realtime `postgres_changes` on the dashboard | `router.refresh()` debounced 3 s | Aggregates recomputed server-side. |

`revalidatePath` is called **only from Server Actions and Route Handlers**, after a successful
`Result`, never from a service and never from a Server Component.

### 6.7 `next.config.ts` additions required by this document

The committed file already sets `reactStrictMode`, `poweredByHeader: false`, `images.remotePatterns`
and four security headers. It must additionally:

1. Add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` and change
   `X-Frame-Options` to `DENY` (doc 02 §8.3 — `SAMEORIGIN` is weaker than what that document
   specifies, and nothing in this app is framed).
2. Add the `Content-Security-Policy` of doc 02 §8.3, with `<project-ref>` derived from
   `NEXT_PUBLIC_SUPABASE_URL` and a per-request nonce supplied by `src/middleware.ts` via the
   `x-nonce` request header. In demo mode `connect-src` drops the Supabase origins entirely.
3. Keep `images.remotePatterns` empty in demo mode — every demo image is a local `/demo/**` file, so
   no remote host needs allowing.
4. Set `experimental.serverActions.bodySizeLimit: '1mb'` — no action legitimately takes more, and
   the one large payload in the product (an image) goes to `/api/admin/media` instead.
5. **Not** enable `cacheComponents`. See §2.1.

---

## 7. Environment variables

### 7.1 The complete list

`Public` = inlined into the client bundle at build time, visible to anyone. Everything else is
server-only and must never appear in a file a client component can transitively import.

| Variable | Public | Required | Default | Purpose |
|---|:--:|:--:|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✔ | no¹ | — | Project URL, e.g. `https://abc.supabase.co`. Absent ⇒ demo mode. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✔ | no¹ | — | Publishable anon key. Safe in the browser: `anon` holds zero table privileges and may execute six functions (doc 02 §2.3). |
| `NEXT_PUBLIC_APP_URL` | ✔ | yes | `http://localhost:3000` | Absolute origin. Used to build QR targets, auth `redirectTo`, and `metadataBase`. Must be the origin diners actually reach. |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | ✔ | no | `uz` | Fallback when no cookie and no usable `Accept-Language`. One of `uz \| ru \| en`. |
| `NEXT_PUBLIC_DEMO_MODE` | ✔ | no | unset | `'true'` forces demo mode even when Supabase vars are present. Used for the public showcase deployment. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✘ | conditional² | — | Service role. Only `src/lib/supabase/admin.ts` reads it. Never `NEXT_PUBLIC_`. |
| `SUPABASE_DB_URL` | ✘ | no | — | Direct Postgres URL. Migrations and pgTAP only; the app never opens it. |
| `LOG_LEVEL` | ✘ | no | `info` | `debug \| info \| warn \| error` for `src/lib/log.ts`. |
| `RATE_LIMIT_DISABLED` | ✘ | no | unset | `'true'` disables the in-process shedder. **Refused when `NODE_ENV === 'production'`** — `src/lib/env/server.ts` throws at startup. The database limits are unaffected either way. |
| `QR_SIGNED_URL_TTL_SECONDS` | ✘ | no | `300` | TTL for signed `qr-codes` Storage URLs (doc 02 §8.2). Range 60–3600. |
| `NODE_ENV` | ✘ | (set by Next) | — | |
| `VERCEL_GIT_COMMIT_SHA` | ✘ | no | `local` | Reported by `/api/health`. |

¹ Required **together**: either both are set (live mode) or neither is (demo mode). One without the
other is a misconfiguration and fails fast — see §7.4.
² Required when live mode is on **and** the deployment must serve staff invitations or platform-admin
cross-tenant analytics — the two legitimate `createAdminClient()` callers (doc 03 §9.2 rule 6).
Absent, those two features return `FORBIDDEN` with a precise message rather than crashing.

### 7.2 `src/lib/env/public.ts`

```ts
// src/lib/env/public.ts
// Safe to import from anywhere, including client components.
// Every process.env access below is a STATIC property read on a literal name — that is what makes
// Next inline the value into the client bundle. Never process.env[key], never a spread.
import { z } from 'zod';

const publicEnvSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20).optional(),
    NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
    NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['uz', 'ru', 'en']).default('uz'),
    NEXT_PUBLIC_DEMO_MODE: z.enum(['true', 'false']).optional(),
  })
  .refine(
    (e) => Boolean(e.NEXT_PUBLIC_SUPABASE_URL) === Boolean(e.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      error:
        'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY together, or set neither ' +
        '(which runs the app in demo mode). One without the other cannot work.',
      path: ['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    },
  );

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
});

if (!parsed.success) {
  // Fails the build and the boot, with the offending variables named.
  throw new Error(
    'Invalid public environment:\n' +
      parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
  );
}

export const publicEnv = Object.freeze(parsed.data);

/** True when there is no Supabase project to talk to, or demo mode was forced. */
export const IS_DEMO =
  publicEnv.NEXT_PUBLIC_DEMO_MODE === 'true' || !publicEnv.NEXT_PUBLIC_SUPABASE_URL;
```

### 7.3 `src/lib/env/server.ts`

```ts
// src/lib/env/server.ts
import 'server-only';                 // line 1 — importing this from a client component is a build error
import { z } from 'zod';
import { IS_DEMO } from '@/lib/env/public';

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    SUPABASE_DB_URL: z.string().optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    RATE_LIMIT_DISABLED: z.enum(['true', 'false']).optional(),
    QR_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
    VERCEL_GIT_COMMIT_SHA: z.string().default('local'),
  })
  .refine((e) => !(e.NODE_ENV === 'production' && e.RATE_LIMIT_DISABLED === 'true'), {
    error: 'RATE_LIMIT_DISABLED=true is refused in production.',
    path: ['RATE_LIMIT_DISABLED'],
  })
  .refine((e) => IS_DEMO || e.NODE_ENV !== 'production' || Boolean(e.SUPABASE_SERVICE_ROLE_KEY), {
    error:
      'SUPABASE_SERVICE_ROLE_KEY is required for a live production deployment (staff invitations ' +
      'and platform analytics). Omit every Supabase variable to run in demo mode instead.',
    path: ['SUPABASE_SERVICE_ROLE_KEY'],
  });

const parsed = serverEnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(
    'Invalid server environment:\n' +
      parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
  );
}

export const serverEnv = Object.freeze(parsed.data);
```

### 7.4 Fail-fast behaviour, exactly

- Both modules parse **at module load**, so a bad value fails the first render, the `next build`, or
  the container start — never at 2 a.m. inside a checkout.
- The thrown message **names every offending variable and says what to do**. It never prints a value
  (a half-correct service-role key in a build log is still a leaked secret).
- `src/lib/supabase/admin.ts` additionally throws if `SUPABASE_SERVICE_ROLE_KEY` is absent **at the
  moment it is called**, so a deployment missing it still boots and serves everything else.
- `src/app/api/health/route.ts` never imports `env/server.ts` transitively in a way that could make
  a missing optional variable take down the health check.
- `.env.example` (already committed) lists every variable above with the same comments. Any variable
  added to this table must be added there in the same change.

---

## 8. Demo mode

### 8.1 The requirement and the danger

`git clone && npm install && npm run dev` must open a complete, explorable Restaurant QR OS with no
Supabase project, no migrations run and no network access. Someone must be able to scan the demo
table, browse a real-looking menu, place an order, watch it appear on the kitchen display, move it
through the state machine, see the tracker update, raise a waiter call, and open the admin
dashboard.

The danger is equally clear and is stated in the brief twice (§11: "No fake analytics — real data
only; demo data clearly separated"; §35: "Real functional system, not a fake prototype"). A demo
that is not conspicuously labelled becomes a screenshot that becomes a claim. So the rules are:

1. **One module boundary.** Fixtures are read by `src/lib/demo/**` and by nothing else.
2. **One switch point.** `src/lib/data/*` chooses `demo` or `live`. No `if (isDemoMode())` appears
   in a page, a layout, a component, a service, an RPC module or a mapper.
3. **Never mixed.** There is no code path where a fixture value and a database value appear in the
   same response. Demo mode is whole-application, decided once at boot from the environment.
4. **Always labelled.** Every screen that shows demo data says so, and every number that would be
   an analytic claim carries the label next to it, not merely at the top of the page.

### 8.2 `src/lib/demo/demo-mode.ts`

```ts
// src/lib/demo/demo-mode.ts
import { IS_DEMO } from '@/lib/env/public';

/** The single predicate. Safe on the server and in the browser (it is a build-time constant). */
export function isDemoMode(): boolean {
  return IS_DEMO;
}

/** The QR token of the demo table. Deliberately shaped like a real token (22–64 base64url chars)
 *  so nothing in the validation path is special-cased for demo. */
export const DEMO_TOKEN = 'DEMOxK9f3PqA7xLmZ2vRt6' as const;

/** Additional demo tables, so table switching and the tables admin screen are explorable. */
export const DEMO_TOKENS = [DEMO_TOKEN, 'DEMOb4Wn8sTq1EyJ3hCvA5', 'DEMOr7Zd2Mk6UoXp9LfGi0'] as const;

/** i18n key of the banner copy. Present in uz/ru/en. */
export const DEMO_NOTICE_KEY = 'demo.banner' as const;

/** Thrown-shaped refusal for a write that demo mode does not simulate. */
export function demoReadOnly(what: string): AppError {
  return appError('FORBIDDEN', `demo mode does not persist ${what}`, {
    details: { demo: true, messageKey: 'demo.write_blocked' },
  });
}
```

### 8.3 `src/lib/demo/repository.ts` — the read half

Exposes **exactly the function set of `src/lib/rpc/public.ts` plus the read functions of every
service**, with identical signatures and identical `Result<T>` returns:

```ts
export const demoRepository = {
  // mirrors src/lib/rpc/public.ts
  resolveTable(token: string): Promise<Result<TableContext>>;
  getMenu(token: string): Promise<Result<MenuTree>>;
  getOrder(token: string, publicCode: string): Promise<Result<OrderView>>;
  placeOrder(input: PlaceOrderInput): Promise<Result<OrderView>>;
  cancelOrder(input: CancelOrderInput): Promise<Result<OrderView>>;
  callWaiter(input: WaiterCallInput): Promise<Result<WaiterCallView>>;

  // mirrors the read half of src/lib/services/*
  getKitchenTickets(branchId: string): Promise<Result<KitchenTicket[]>>;
  getWaiterBoard(branchId: string): Promise<Result<WaiterBoard>>;
  getDashboardStats(branchId: string, businessDate: string): Promise<Result<DashboardStats>>;
  listOrders(filters: AdminOrderFilters): Promise<Result<Paginated<OrderView>>>;
  listMenuItems(): Promise<Result<MenuItemView[]>>;
  listCategories(): Promise<Result<MenuCategoryView[]>>;
  listTables(): Promise<Result<TableAdminView[]>>;
  listBranches(): Promise<Result<BranchAdminView[]>>;
  listStaff(): Promise<Result<StaffAdminView[]>>;
  getSettings(): Promise<Result<SettingsView>>;
  listPlatformRestaurants(): Promise<Result<PlatformRestaurantView[]>>;
};
```

It reads the JSON in `src/lib/demo/fixtures/`, maps it through the **same mappers** the live path
uses (`src/lib/mappers/*`), and applies the **same state machine** (`src/lib/orders/state-machine`).
The fixture files are shaped as the RPC JSONB payloads, not as view models, so
`src/lib/demo/fixtures.test.ts` can assert every fixture parses against `PublicMenuSchema`,
`PublicTableContextSchema` and `PublicOrderSchema`. A fixture that drifts from the wire contract
fails CI — the demo cannot rot away from the real shape.

Errors are simulated faithfully: an unknown token returns `INVALID_QR`, the third demo table is
`is_active = false` and returns `TABLE_INACTIVE`, one demo dish is `is_available = false`, and one
demo branch has `is_accepting_orders = false` — so every error screen in brief §32 is reachable in
the demo without touching a database.

### 8.4 `src/lib/demo/store.ts` — ephemeral writes, so the loop is explorable

Read-only demos cannot show the product. The demo therefore simulates exactly the customer-to-
kitchen loop and nothing else:

| Operation | Demo behaviour |
|---|---|
| `placeOrder` | Creates an order in an in-process `Map`, allocating `order_number` `D-001`, `D-002`, … and a `public_code`. Prices, fees and totals are computed from the **fixture** menu with `src/lib/money.ts` — the same arithmetic as production. |
| `updateOrderStatus`, `acceptOrder`, … | Applies `assertTransition()` and mutates the in-memory order, appending to its history. Illegal transitions are refused exactly as Postgres would. |
| `callWaiter` / acknowledge / resolve | In-memory waiter calls, including the per-table cooldown. |
| `cancelOrder` (customer) | Allowed only from `pending`. |
| Everything else — menu CRUD, categories, tables, branches, staff, settings, token rotation, image upload, invitations | Refused with `demoReadOnly(...)`. The form renders, validates, and shows the localized `demo.write_blocked` notice on submit, so the UI is fully explorable without pretending to persist. |

Properties, stated so nobody mistakes it for a database: the store is **per server process**, resets
on restart, is not shared between instances, has no durability and no transactions, and holds at
most 200 orders (oldest evicted). It is seeded from `fixtures/orders.json` so the KDS and the admin
lists are not empty on first load.

`demoStaffSession()` returns a fixed `StaffSession` — `role: 'RESTAURANT_OWNER'`,
`isPlatformAdmin: true`, `displayName: 'Demo Owner'` — so `/kitchen`, `/waiter`, `/admin` and
`/admin/platform` are all reachable without an auth server. `/login` in demo mode renders a notice
explaining that authentication is disabled and a button that goes straight to `/admin`. **This
identity exists only when `isDemoMode()` is true**, and `isDemoMode()` is false whenever a Supabase
URL is configured without `NEXT_PUBLIC_DEMO_MODE=true`; there is no runtime path from a live
deployment to a demo session.

### 8.5 How the UI labels it

| Placement | Component | Content |
|---|---|---|
| Global, top of `<body>`, every route | `<DemoBanner>` (rendered by the root layout when `isDemoMode()`) | A full-width amber bar, not dismissible: "DEMO DATA — this deployment is not connected to a database. Orders reset when the server restarts." Localized (`demo.banner`). |
| `<title>` | root `metadata` | Prefixed `[DEMO] ` when `isDemoMode()`. Screenshots carry the label. |
| Every dashboard stat tile | `<StatCard demo>` | A `<DemoBadge>` pill **inside the tile**, beside the number — not only in the page header. A cropped screenshot of one tile still says "demo". |
| Analytics page | `<DemoBadge>` + an explanatory paragraph | "These figures are generated from an in-repo fixture and describe nothing real." |
| Admin tables/menu/staff lists | `<DemoBadge>` in the page header | |
| Customer menu | `<DemoBadge>` next to the restaurant name in `<CustomerHeader>` | A diner-facing surface must not silently look like a real restaurant. |
| Order tracker | `<ConnectionBadge state="polling">` + `<DemoBadge>` | |
| `/api/health` | `"mode": "demo"` | Machine-readable, for anyone wiring the demo into a monitor. |

`DashboardStats.isDemo` (doc 03 §4) is the flag the tiles read. It is true in demo mode, **and also**
in live mode when the queried scope contains a restaurant with `restaurants.is_demo = true` — one
flag, two sources, one banner. A seeded demo tenant inside a real production database is labelled
by exactly the same machinery.

### 8.6 Demo mode and the rest of the system

| Subsystem | Live | Demo |
|---|---|---|
| Realtime | Broadcast (customer) + `postgres_changes` (staff) | No WebSocket. `use-realtime-order` / `use-realtime-branch` detect demo and poll the same `/api/public/**` handlers, showing `<ConnectionBadge state="polling">`. Brief §28's rule is about the product, and the product is the live path. |
| Middleware | `updateSession()` refreshes the Supabase session | Returns `NextResponse.next({ request })` immediately; no auth server exists. The protected-path gate still runs, but `demoStaffSession()` makes every staff route reachable. |
| Storage / images | Supabase Storage, `next/image` with `remotePatterns` | Local files under `public/demo/**`. `next.config.ts` needs no remote host. |
| Rate limiting | `checkLimit` + the Postgres limits | `checkLimit` only, with the same budgets, so the countdown UI is exercisable. |
| Service-role key | `createAdminClient()` for two callers | Never constructed. Any call throws before touching `process.env`. |
| `npm run db:reset` | Applies migrations + `supabase/seed.sql` | Not applicable; `seed.sql` mirrors the fixture 1:1 so a developer who *does* run Supabase locally sees the same restaurant, the same menu and the same table numbers. |

### 8.7 The fixture content

One restaurant — **"Oshxona"**, slug `oshxona`, `currency: 'UZS'`, `currency_decimals: 0`,
`default_locale: 'uz'`, `service_fee_enabled: true`, `service_fee_bps: 1000` (10 %) — with two
branches (`Chorsu`, `Yunusobod`, timezone `Asia/Tashkent`), three tables (one deliberately
inactive), the six categories the brief names (Popular, Uzbek Cuisine, Fast Food, Salads, Drinks,
Desserts), 26 menu items with real photography under `public/demo/items/**`, option groups on at
least four of them (size, extras, spice), two active promotions, four seeded orders spread across
`pending`, `preparing`, `ready` and `completed`, one open waiter call, and five staff rows covering
every role. Every translatable field carries all three locales, so the language switcher is
demonstrably real rather than an English-only shell.

All prices are whole UZS soms as `Money` integers (`45000` = 45 000 UZS), which also exercises the
0-decimal formatting path that a USD-only demo would never touch.

---

## 9. Definition of done for this layer

1. `npm run typecheck` and `npm run lint` pass. No `any`, no `@ts-expect-error` outside a test.
2. `npm run dev` with an empty `.env.local` boots into demo mode, and `/`, `/demo`,
   `/t/DEMOxK9f3PqA7xLmZ2vRt6`, its item / cart / tracking routes, `/kitchen`, `/waiter`, `/admin`
   and `/admin/platform` all render with the demo banner and no console error.
3. `grep -rn "'use client'" src/app --include=page.tsx --include=layout.tsx` returns **nothing**.
4. `grep -rn "params\." src/app --include=*.tsx --include=*.ts | grep -v "await"` shows no
   un-awaited dynamic-API access.
5. `grep -rln "'use server'" src` returns only files under `src/app/_actions/`.
6. `grep -rln "fixtures\|demoRepository\|demoStore" src | grep -v "^src/lib/demo/"` returns only
   `src/lib/data/*.ts` — the single switch point.
7. `grep -rn "localStorage\|sessionStorage" src` returns only `src/lib/cart/cart-store.ts` and
   `src/lib/customer/session.ts`.
8. `grep -rn "SUPABASE_SERVICE_ROLE_KEY" src` returns only `src/lib/env/server.ts` and
   `src/lib/supabase/admin.ts`.
9. `grep -rn "createServerClient" src/app/\(customer\)` returns nothing — the customer app never
   touches the cookie client.
10. Every file listed in §1 exists; nothing outside §1 exists under `src/app`, `src/components`,
    `src/hooks`, `src/lib` or `supabase/migrations`.
11. `src/lib/cart/cart-store.test.ts` proves: merge-identical-lines, quantity clamping, discard on
    token mismatch, discard on schema-version mismatch, discard on age, line-drop on reconcile, and
    that `getServerSnapshot()` returns the same object identity across 100 calls.
12. `src/lib/demo/fixtures.test.ts` proves every fixture parses against the zod RPC schemas.
13. A production build with `NEXT_PUBLIC_SUPABASE_URL` set but `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    missing **fails the build** with the message from §7.2, not at runtime.

---

## 10. Open questions this document deliberately does not answer

- **Visual design.** Colour tokens, type scale, spacing, motion and the `@theme` block belong to
  `docs/architecture/04-design-system.md`. This document names component files and their
  Server/Client kind; it does not specify how they look.
- **Analytics beyond brief §11.** `/admin/analytics` renders the same `DashboardStats` over a chosen
  date range. Cohorts, funnels and forecasting are out of MVP scope (brief §33).
- **Payments.** Brief §33: not until ordering is stable. No route, action or column is reserved.
- **`public_cancel_order`.** Specified in doc 03 §1.4 but not yet in a migration. Until
  `20260901001600_public_rpc.sql` contains it, `<CancelOrderButton>` must not render (§3.3.4).
