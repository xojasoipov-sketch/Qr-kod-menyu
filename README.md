# Restaurant QR OS

A multi-tenant restaurant QR menu and ordering platform. A diner scans the code
on their table, the menu opens in their browser with no app and no account, they
order, and the order reaches the kitchen in real time.

Built as an operating system for a restaurant group rather than a single
restaurant: many restaurants, each with many branches, tables, staff and menus,
isolated from one another at the database level.

---

## Table of contents

- [What it does](#what-it-does)
- [The four surfaces](#the-four-surfaces)
- [Running it](#running-it)
- [Architecture](#architecture)
- [The security model](#the-security-model)
- [Verifying the database](#verifying-the-database)
- [Project layout](#project-layout)
- [Conventions that are not negotiable](#conventions-that-are-not-negotiable)
- [Status](#status)

---

## What it does

```
        scan                resolve                    order
  QR ─────────▶ /t/<token> ─────────▶ restaurant ─────────────▶ kitchen
                            token      branch                    (real time)
                            is the     table
                            capability                          ─▶ waiter
                                                                ─▶ live tracking
```

The QR code carries an unguessable random token, never a table id. Resolving it
yields exactly one table's restaurant, branch and menu — nothing else, and
nothing about any other tenant.

---

## The four surfaces

| Surface | Route | Device | Character |
|---|---|---|---|
| Customer | `/t/[token]` | phone | warm, editorial, cinematic; dark-committed |
| Kitchen display | `/kitchen` | tablet | huge type, readable at two metres, colour carries status only |
| Waiter console | `/waiter` | tablet | active orders, ready orders, table calls |
| Admin | `/admin` | desktop | calm, dense, professional SaaS |

Three personalities, one token system. The kitchen screen is deliberately the
least decorated surface in the product: it is read by someone holding a pan.

---

## Running it

Requires **Node 20.9+**. A database is optional for a first look.

```bash
npm install
cp .env.example .env.local     # optional — see below
npm run dev
```

### Demo mode

With **no** Supabase variables set, the app serves an in-repo fixture restaurant
so the whole flow can be walked without a database. Fixture data is labelled as
demo everywhere it appears; the dashboard never presents it as real analytics.

Setting *some but not all* Supabase variables is treated as a misconfiguration
and fails loudly, rather than silently falling back to the fixture — a
half-configured deployment that looks like it works is worse than one that stops.

### With a real database

```bash
supabase start
supabase db reset          # applies every migration in supabase/migrations, in order
```

Then fill in `.env.local`:

| Variable | Public | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | safe in the browser: `anon` holds no table privileges at all |
| `SUPABASE_SERVICE_ROLE_KEY` | **no** | bypasses RLS; server only, never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_APP_URL` | yes | absolute origin encoded into QR codes |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | yes | `uz` \| `ru` \| `en` |

### Scripts

```bash
npm run dev         # development server
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run lint
npm run check       # typecheck + lint
./scripts/db/verify.sh   # apply the whole migration chain to a throwaway database
```

---

## Architecture

**Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 ·
Supabase (PostgreSQL, Auth, Realtime, Storage) · zod v4**

Tailwind v4 is configured CSS-first in `src/app/globals.css`; there is no
`tailwind.config.js` and adding one would be a regression.

### Multi-tenant isolation is structural

Isolation does not depend on every policy being written correctly. Each parent
table exposes a redundant key `UNIQUE (restaurant_id, id)`, and each child
references the parent through the **pair**:

```sql
FOREIGN KEY (restaurant_id, menu_item_id)
  REFERENCES public.menu_items (restaurant_id, id)
```

An order for restaurant A that references restaurant B's dish is rejected by the
storage engine with a foreign-key violation. No policy has to be correct for
that to hold. Row-level security is the second layer, not the only one.

### Money never touches a float

Every amount is a `BIGINT` count of **minor units**, in the database and in
TypeScript (`type Money = number`). Restaurants carry their own `currency` and
`currency_decimals`, so UZS (0 decimals) and USD (2) both work. Formatting
happens once, at the edge, in `formatMoney`. There is no `toFixed` and no
division by 100 anywhere in the data path.

### Time belongs to the branch

A group can span timezones, so "today's revenue" is computed against the
**branch's** business date, not the server's UTC midnight. See
`businessDateFor()` in `src/lib/utils/datetime.ts`.

### Real time, not polling

| Event | Channel | Who hears it |
|---|---|---|
| order placed | `branch:{id}` | kitchen, waiter, admin |
| status changed | `order:{public_code}` | the diner tracking it |
| order ready | `branch:{id}` | waiter |
| table calls | `branch:{id}` | waiter |

Panels resync on reconnect, so a tablet that slept through an event recovers
instead of drifting silently. Every payload carries a protocol version; an
unknown version triggers a resync rather than a guess.

---

## The security model

### `anon` cannot read a single table

The unauthenticated role holds **no** privilege on any table, view or sequence.
It may execute exactly five `SECURITY DEFINER` functions:

```
public_resolve_table(token)
public_get_menu(token)
public_place_order(token, items, note, client_request_id)
public_get_order(token, public_code)
public_call_waiter(token, reason)
```

Each takes the QR token as a bearer capability and returns a fixed, reviewed
JSON shape scoped to one table. The public attack surface is five function
bodies that can be read end to end in a review, rather than every column of
eleven tables — including the ones added next quarter.

A migration re-asserts this at the end of every release and **raises** if `anon`
has acquired a privilege it should not have, so a careless `CREATE TABLE` fails
the deploy instead of quietly widening the API.

### Prices are computed server-side, always

The order payload carries dish ids, quantities, option ids and notes — and
nothing else. No price, no name, no subtotal. The input schema is `.strict()`,
so an attempt to smuggle a `price` field is rejected at the edge. Every amount
is read from `menu_items.price` inside the transaction, under row locks, so a
concurrent "mark unavailable" cannot slip between the check and the write.

A tampered client can change what it *displays*. It cannot change what it is
*charged*.

### Historical orders are immutable

`order_items` snapshot the name, description, image, price and spicy level at
the moment of ordering. Renaming a dish, repricing it, or deleting it does not
alter an order placed last week.

### The state machine is role-aware

```
pending ─▶ confirmed ─▶ preparing ─▶ ready ─▶ delivered ─▶ completed
   └──────────┴───────────┴──────────┴──▶ cancelled
```

Both the edge *and* the actor are checked. A kitchen account cannot cancel a
confirmed order; a waiter cannot mark food ready. Enforcement is in Postgres;
the TypeScript copy exists so a button that the database would reject is never
rendered.

### Order tracking without an account

`/t/<qr_token>/order/<order_public_code>` carries **two** capabilities. The order
code alone is useless without the table's QR token, so a tracking link forwarded
to a group chat only works for people who could already sit at that table.

### Guard triggers

Column-level grants and `BEFORE` triggers together prevent staff from writing
what a role should never write: order money and identity, menu prices from a
kitchen account, a hand-chosen `qr_token`, the anti-spam clocks, or
`is_platform_admin` on their own profile.

---

## Verifying the database

The whole migration chain runs on stock PostgreSQL 15+ with no Docker and no
Supabase account:

```bash
./scripts/db/verify.sh          # drop, recreate, bootstrap, apply, test
./scripts/db/verify.sh --keep   # leave the database for inspection
```

`scripts/db/bootstrap-supabase.sql` recreates the subset of the platform the
migrations depend on — the `anon`/`authenticated`/`service_role` roles,
`auth.users`, `auth.uid()`, `realtime.messages` and the publication — so the
schema is testable in CI without the platform.

Tests in `scripts/db/tests/` impersonate PostgREST properly, setting
`request.jwt.claims` and `SET LOCAL ROLE` together so `auth.uid()` behaves as it
does in production instead of returning `NULL` and passing policies by accident.

---

## Project layout

```
docs/
  BRIEF.md                  the product requirements
  architecture/             7 specifications the implementation was built against
  audit/                    findings from the adversarial reviews, and their status
supabase/migrations/        18 files, applied in filename order
scripts/db/                 bootstrap, verify.sh, SQL security tests
src/
  app/                      routes: marketing, /t/[token], kitchen, waiter, admin, api
  components/ui/            24 design-system primitives
  components/{customer,kitchen,waiter,admin}/
  lib/
    rpc/                    the public capability API — the only door for diners
    services/               staff-side operations (RLS applies)
    orders/                 state machine, advisory pricing, lateness
    i18n/                   uz/ru/en catalogues, plural rules, formatting
    supabase/               four clients, one per trust level
    realtime/               channels, subscription manager, hooks
    cart/                   client cart reducer and persistence
  types/                    database rows, domain view models, wire types
```

---

## Conventions that are not negotiable

1. A public user cannot change their table identity.
2. Prices are calculated on the server.
3. An unavailable dish cannot be ordered.
4. Historical orders keep their snapshots.
5. No restaurant can reach another's data.
6. Waiters see only their assigned branch.
7. Kitchen staff see only kitchen-relevant orders.
8. Invalid status transitions are rejected, by role as well as by edge.
9. QR tokens are unpredictable.
10. An old QR token can be invalidated.
11. Ordering never requires an account.
12. Every important action gives clear feedback.

Localisation covers **Uzbek, Russian and English** across every surface, with
key parity enforced at compile time: the `Dictionary` type is derived from the
English catalogue, so a missing translation is a build error rather than a blank
string discovered by a diner.

---

## Status

The database, domain, design-system and localisation layers are complete and
verified. The application layer is under active construction; see the git log
for what has landed. Where something is incomplete, the commit message says so.
