# 02 — Authorization Model, Row-Level Security & Public Capability API

**Status:** normative specification. Implementers MUST follow it literally.
**Owns:** the security posture of RESTAURANT QR OS — Postgres roles, grants, RLS policies,
`SECURITY DEFINER` RPC surface, rate limiting, and the DB-enforced invariants.
**Source of truth for requirements:** `docs/BRIEF.md` (§15, §16, §27, §34).
**Depends on:** `01-data-model.md` (schema/DDL) — every column this document requires is listed in
§0.3 as a hard contract; the data-model agent MUST create them exactly as named.

---

## 0. Foundations

### 0.1 Frozen decisions this document builds on

| Decision | Value |
|---|---|
| Runtime | Next.js 16.3 App Router, React 19.2, TypeScript strict |
| DB / Auth / Realtime / Storage | Supabase (PostgreSQL 15+) |
| Auth transport | `@supabase/ssr` 0.12, cookie-based |
| Validation | zod v4 (server-side, on every RPC boundary in both directions) |
| Money | `BIGINT` minor units; `restaurants.currency CHAR(3)` default `'UZS'`, `restaurants.currency_decimals SMALLINT` default `0`. TS: `type Money = number` (integer minor units) |
| Locales | `'uz' \| 'ru' \| 'en'`, cookie + `?lang=` override, **no** locale URL prefix |
| Public route | `/t/[token]` — unauthenticated |
| Service-role key | Node runtime only, never in the browser |

### 0.2 Postgres roles in play

| Role | Who | RLS |
|---|---|---|
| `anon` | every public QR customer (the Supabase anon JWT, used **server-side** by Next.js route handlers) | irrelevant — `anon` gets **zero** table privileges (§2) |
| `authenticated` | every logged-in staff member (owner, manager, waiter, kitchen, super admin) | **fully policy-controlled**, this is the RLS surface |
| `service_role` | Next.js server only, admin/back-office and system jobs | `BYPASSRLS` — treated as a break-glass credential (§1.11) |
| `postgres` | migrations and the owner of every object | owns tables and `SECURITY DEFINER` functions; the app **never** connects as `postgres` |

There is **no** database role per application role. Owner / manager / waiter / kitchen /
super_admin are *data* (`public.staff.role`, `public.profiles.is_super_admin`), evaluated by RLS
policies. This keeps user provisioning in application space and lets a person hold different roles
in different restaurants.

### 0.3 Hard schema contracts (the data-model agent MUST provide these exactly)

Beyond the columns named in the brief, the security model requires:

```sql
-- enums
create type public.app_role         as enum ('super_admin','owner','manager','waiter','kitchen');
create type public.order_status     as enum ('pending','confirmed','preparing','ready','delivered','completed','cancelled');
create type public.waiter_call_status as enum ('open','acknowledged','resolved','expired');
create type public.waiter_call_reason as enum ('service','bill','water','cleaning','other');
```

| Table | Required additional columns | Why |
|---|---|---|
| `public.profiles` | `id uuid primary key references auth.users(id) on delete cascade`, `is_super_admin boolean not null default false`, `is_active boolean not null default true`, `locale text not null default 'uz'` | platform admin flag + kill switch |
| `public.staff` | `user_id uuid not null references public.profiles(id) on delete cascade`, `restaurant_id uuid not null`, `branch_id uuid null`, `role public.app_role not null check (role <> 'super_admin')`, `is_active boolean not null default true` | membership = authorization |
| `public.branches` | `service_fee_enabled boolean not null default false`, `service_fee_bps integer not null default 0 check (service_fee_bps between 0 and 2000)`, `timezone text not null default 'Asia/Tashkent'` | server-side fee computation |
| `public.tables` | `qr_token text not null unique`, `last_order_at timestamptz`, `last_waiter_call_at timestamptz`, `restaurant_id uuid not null` (denormalised) | token lookup + DB cooldowns + tenant checks without joins |
| `public.qr_tokens` | **new table** — `id uuid pk`, `table_id uuid not null`, `branch_id uuid not null`, `restaurant_id uuid not null`, `token text not null unique`, `is_active boolean not null default true`, `revoked_at timestamptz`, `created_at timestamptz not null default now()` | token rotation + revocation history |
| `public.menu_items` | `branch_id uuid not null`, `restaurant_id uuid not null`, `price bigint not null check (price >= 0)`, `is_available boolean not null default true` | branch scoping, integer money |
| `public.menu_item_options` | `menu_item_id uuid not null`, `restaurant_id uuid not null`, `branch_id uuid not null`, `price_delta bigint not null default 0`, `is_available boolean not null default true`, `group_key text not null`, `is_required boolean not null default false`, `max_select smallint not null default 1` | option pricing is server-side too |
| `public.orders` | `public_token text not null unique`, `client_request_id uuid unique`, `restaurant_id`, `branch_id`, `table_id`, `subtotal bigint`, `service_fee bigint`, `total bigint`, `note text`, `placed_by_staff_id uuid null`, `cancelled_reason text null` | capability URL, idempotency, integer money |
| `public.order_items` | `restaurant_id uuid not null`, `branch_id uuid not null` (denormalised), `price_snapshot bigint not null`, `name_snapshot text not null`, `total bigint not null` | RLS without joins; historical accuracy |
| `public.order_item_options` | **new table** — `id`, `order_item_id`, `order_id`, `restaurant_id`, `branch_id`, `name_snapshot text not null`, `price_delta_snapshot bigint not null`, `created_at` | option snapshots |
| `public.order_status_history` | `restaurant_id uuid not null`, `branch_id uuid not null`, `changed_by uuid null references public.profiles(id)`, `changed_by_kind text not null check (changed_by_kind in ('customer','staff','system'))` | RLS without joins; audit |
| `public.waiter_calls` | `restaurant_id`, `branch_id`, `table_id`, `status public.waiter_call_status not null default 'open'`, `reason public.waiter_call_reason not null default 'service'`, `note text`, `acknowledged_by uuid null`, `acknowledged_at timestamptz`, `resolved_at timestamptz` | spam control + branch scoping |
| `public.notifications` | `restaurant_id`, `branch_id`, `target_role public.app_role null`, `target_user_id uuid null`, `kind text not null`, `payload jsonb not null default '{}'::jsonb`, `read_at timestamptz` | fan-out addressing |
| `public.promotions` | **new table** — `id`, `restaurant_id`, `branch_id null`, `title jsonb`, `description jsonb`, `image_url`, `starts_at`, `ends_at`, `is_active`, `sort_order` | display-only in MVP (§1.3) |

**Tenant-consistency constraint (mandatory, DB-enforced).** Every child table that carries both
`restaurant_id` and `branch_id` must reference the composite key, so a row can never mix tenants:

```sql
alter table public.branches      add constraint branches_id_restaurant_uk unique (id, restaurant_id);
alter table public.tables        add constraint tables_branch_restaurant_fk
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on update cascade;
alter table public.tables        add constraint tables_id_branch_uk unique (id, branch_id);
alter table public.menu_items    add constraint menu_items_branch_restaurant_fk
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on update cascade;
alter table public.menu_categories add constraint menu_categories_branch_restaurant_fk
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on update cascade;
alter table public.orders        add constraint orders_branch_restaurant_fk
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on update cascade;
alter table public.orders        add constraint orders_table_branch_fk
  foreign key (table_id, branch_id) references public.tables (id, branch_id) on update cascade;
alter table public.order_items   add constraint order_items_branch_restaurant_fk
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on update cascade;
alter table public.staff         add constraint staff_branch_restaurant_fk
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on update cascade;
alter table public.staff         add constraint staff_branch_required_ck
  check ((role in ('waiter','kitchen') and branch_id is not null) or role in ('owner','manager'));
create unique index staff_membership_uk on public.staff (user_id, restaurant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
```

A composite FK with a `NULL` branch component is satisfied trivially (MATCH SIMPLE), which is what
we want for restaurant-wide `staff` and restaurant-wide `menu_categories`.

### 0.4 The `app_private` schema

```sql
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to postgres;
comment on schema app_private is
  'Internal security machinery. NEVER add app_private to the PostgREST exposed-schema list.';
```

Supabase project setting **API → Exposed schemas** must remain exactly
`public, storage, graphql_public`. `app_private` is unreachable over HTTP by construction.

---

## 1. Threat model

Each threat below has (a) the concrete attack, (b) the control, (c) *where* the control lives.
A control is only accepted if it lives in the database or in a Node-only server module — never in
React code.

### 1.1 Cross-tenant read

**Attack.** Restaurant B's manager authenticates normally and issues
`GET /rest/v1/orders?select=*` or `supabase.from('menu_items').select('*')` with no filter, hoping
PostgREST returns every tenant's rows. Or they craft an embedded select
(`orders?select=*,branches(*,restaurants(*))`) to walk the FK graph out of their tenant.

**Control.** Every staff-facing table has `ENABLE ROW LEVEL SECURITY` **and**
`FORCE ROW LEVEL SECURITY` (§3), with `SELECT` policies whose `USING` clause is
`public.has_restaurant_access(restaurant_id)` / `public.has_branch_access(branch_id)`. PostgREST
embeds are ordinary joins and are filtered by the embedded table's own policies, so the FK walk
returns zero rows. `restaurant_id`/`branch_id` are denormalised onto `order_items`,
`order_item_options`, `order_status_history` and `waiter_calls` specifically so no policy needs a
join it could get wrong.

**Lives in:** Postgres RLS.

### 1.2 Cross-tenant write

**Attack.** Restaurant B's owner `POST`s a `menu_items` row with
`restaurant_id = <restaurant A>`, or `PATCH`es an existing row to move it into A ("tenant hop"),
or updates their own row setting `branch_id` to a branch of A.

**Control.** Three layers:
1. Every `INSERT` policy has a `WITH CHECK` that re-asserts tenancy; every `UPDATE` policy has
   **both** `USING` (may I see the old row) and `WITH CHECK` (is the new row still mine). An
   `UPDATE` policy without `WITH CHECK` is a review-blocking defect.
2. The composite FKs of §0.3 make `(branch_id, restaurant_id)` pairs that do not exist in
   `branches` a constraint violation (`23503`), independent of RLS.
3. `public.trg_guard_tenant_columns()` (§3.14) is a `BEFORE UPDATE` trigger on every tenant table
   that raises if `restaurant_id`, `branch_id` or the primary key changed.

**Lives in:** RLS `WITH CHECK` + FK constraints + trigger.

### 1.3 Price tampering

**Attack.** Customer opens devtools and posts
`{"menu_item_id": "...", "quantity": 1, "price": 1}` or patches the cart JSON so `subtotal`,
`service_fee` and `total` are attacker-chosen; or sends `option_ids` belonging to a cheaper item;
or sends `quantity: -3` to produce a negative line and a negative total.

**Control.**
- `public_place_order` (§2.6) accepts **only** `menu_item_id`, `quantity`, `option_ids`, `note`
  per line. There is no price field anywhere in the input contract; the zod schema
  (`PlaceOrderInput` in `src/lib/rpc/schemas.ts`) uses `.strict()` so unknown keys are rejected
  before the RPC is even called, and the SQL re-validates the shape with
  `jsonb_typeof` + explicit key extraction — any extra key in the JSON is ignored by construction.
- Prices are read inside the function from `public.menu_items.price` and
  `public.menu_item_options.price_delta`, both `BIGINT` minor units.
- `service_fee` is computed as
  `(v_subtotal * b.service_fee_bps + 5000) / 10000` in integer arithmetic when
  `b.service_fee_enabled`, else `0`. No floating point anywhere.
- `quantity` is `check (quantity between 1 and 50)` in the function *and*
  `check (quantity >= 1)` on the table.
- **There is no `INSERT` policy on `orders`, `order_items` or `order_item_options` for any role.**
  Not for `anon`, not for `authenticated`, not for owners. Rows appear only through
  `SECURITY DEFINER` functions. This removes the entire client-supplied-price attack surface
  rather than trying to validate it.
- `public.trg_orders_immutable_money()` rejects any `UPDATE` that changes `subtotal`,
  `service_fee`, `total`, `restaurant_id`, `branch_id`, `table_id`, `order_number`,
  `public_token` or `created_at`.
- Promotions in MVP are **display-only metadata**: `public_get_menu` returns them for rendering,
  and `public_place_order` never reads the `promotions` table. A promotion therefore cannot alter
  a price, so a forged promotion id buys nothing.

**Lives in:** absence of INSERT policies + `SECURITY DEFINER` pricing + immutability trigger.

### 1.4 Ordering an unavailable item

**Attack.** Customer loads the menu, the kitchen 86's the dish, the customer (or a replayed
request from a cached page) still submits it. Or the customer submits a `menu_item_id` copied from
another branch of the same restaurant, or from a deactivated category.

**Control.** Inside `public_place_order`, every line is resolved with a single query that requires
*all* of: `mi.id = <given>`, `mi.branch_id = <token's branch>`,
`mi.restaurant_id = <token's restaurant>`, `mi.is_available`, `mc.is_active` (its category),
`b.is_active`, `r.is_active`. Rows are read `FOR SHARE` inside the same transaction, so a
concurrent `UPDATE menu_items SET is_available = false` blocks until the order commits or the
order sees the new value — no lost-update window. A miss raises `QR020_ITEM_UNAVAILABLE` with
`DETAIL` naming the offending `menu_item_id` so the UI can grey out that exact card.
Options are validated the same way and additionally must satisfy
`mio.menu_item_id = <the line's item>`.

**Lives in:** `public_place_order` (Postgres), with row locks.

### 1.5 Forged table identity

**Attack.** Customer edits the request to claim `table_id = <table 1, the VIP booth>`, or posts
`branch_id` of a different branch so the order lands on someone else's kitchen screen, or replays
a friend's `/t/<token>` while sitting elsewhere to charge a different table.

**Control.** Table identity is **never an input**. `public_place_order` takes only `p_token`;
`table_id`, `branch_id` and `restaurant_id` are *derived* by `app_private.resolve_token()` from
`public.qr_tokens`. The RPC contract has no table parameter to forge. `orders.table_id` is then
immutable (§1.3 trigger). "Replaying a friend's token" is not a privilege escalation — possessing
the token *is* being at that table; that is the intended capability semantics, and it is bounded
by the per-table rate limits of §5.

**Lives in:** function signature + `app_private.resolve_token`.

### 1.6 Replaying a stale or revoked QR token

**Attack.** A table's QR is reprinted after the sticker was photographed and posted online; the
old token is used months later to spam orders. Or a departed employee kept a printed sheet of
tokens.

**Control.** `public.qr_tokens` is the authority, not `tables.qr_token`.
`app_private.resolve_token(p_token, p_allow_revoked => false)` requires
`qr_tokens.is_active = true`; `admin_rotate_table_token()` sets `is_active = false,
revoked_at = now()` on the old row in the same transaction that inserts the new one. A revoked
token raises `QR001_INVALID_QR_TOKEN` — deliberately the *same* error as a nonexistent token, so
an attacker cannot distinguish "was valid, now revoked" from "never existed".
One documented exception: `public_get_order` calls
`resolve_token(p_token, p_allow_revoked => true)` and additionally accepts tokens with
`revoked_at > now() - interval '12 hours'`, so a customer mid-meal during a rotation can still
watch their order. That path is read-only and additionally requires the per-order token.

**Lives in:** `public.qr_tokens.is_active` + `app_private.resolve_token`.

### 1.7 Order spam

**Attack.** A script hammers `public_place_order` with a valid token, flooding the KDS with
hundreds of fake orders; or a customer double-taps PLACE ORDER on a flaky connection and gets
three identical orders; or a botnet distributes the flood across IPs so the app-side limiter never
sees a repeat.

**Control.** Layered, DB-authoritative — full design in §5:
per-table `SELECT ... FOR UPDATE` serialisation, a 20-second per-table cooldown
(`tables.last_order_at`), 12 orders/hour per table, 300 orders/hour per branch circuit breaker,
`orders.client_request_id` unique idempotency key, and a 60-second identical-payload dedupe. The
DB limits are keyed on *table* and *branch*, not IP, so distributing the attack across IPs does
not help. The app-side IP limiter is a cheap first filter, not the control.

**Lives in:** Postgres counters + `app_private.rate_limit_hit` + unique index.

### 1.8 Waiter-call spam

**Attack.** A child at table 7 taps CALL WAITER forty times; the waiter panel becomes unusable.

**Control.** §5.3: partial unique index `waiter_calls_one_open_per_table_uk` makes a second open
call for the same table a `23505` constraint violation, a 90-second cooldown on
`tables.last_waiter_call_at`, and 5 calls/hour/table. The DB, not the UI, is what refuses.

**Lives in:** partial unique index + cooldown column + counter.

### 1.9 Status-transition forgery by a customer

**Attack.** Customer calls `PATCH /rest/v1/orders?public_token=eq.X` with
`{"status":"completed"}` to get free food, or `{"status":"ready"}` to jump the queue.

**Control.** `anon` has **zero** privileges on `public.orders` — PostgREST answers `401/404`
before RLS is even consulted. There is no public RPC that writes `orders.status`. The only public
mutation verbs are `public_place_order` (creates `pending`) and `public_call_waiter`. Even if a
customer somehow obtained an `authenticated` JWT, `public.trg_orders_status_guard()` re-checks the
transition against `public.order_transition_allowed(old, new, actor_role)` and the actor's staff
membership in that branch.

**Lives in:** no grants for `anon` + status trigger.

### 1.10 Staff of branch A touching branch B

**Attack.** A waiter at branch A of the same restaurant marks orders delivered at branch B, or
reads branch B's revenue, or acknowledges branch B's waiter calls.

**Control.** `public.current_branch_ids()` expands a staff row to the branches it actually covers
(a `branch_id IS NULL` membership means all branches of that restaurant; a waiter/kitchen row must
have `branch_id NOT NULL` by `staff_branch_required_ck`). Every branch-scoped policy uses
`public.has_branch_access(branch_id)`. `UPDATE` policies carry the same predicate in `WITH CHECK`,
so a waiter cannot move a row into another branch either.

**Lives in:** RLS + `staff_branch_required_ck`.

### 1.11 Service-role key leakage

**Attack.** The service-role key ends up in a client bundle via `NEXT_PUBLIC_`, in a Server
Component that serialises it into RSC payload props, in a middleware bundle (Edge), or in an error
message returned to the browser. Anyone with it reads and writes every tenant.

**Control.**
- Env var is named `SUPABASE_SERVICE_ROLE_KEY` — the `NEXT_PUBLIC_` prefix is forbidden and CI
  greps for it (§6.11).
- It is read in exactly one module, `src/lib/supabase/admin.ts`, whose first line is
  `import 'server-only';`. Any client-component import chain that reaches it fails the build.
- Every route/handler that transitively imports it declares `export const runtime = 'nodejs'`.
- ESLint rule `no-restricted-imports` blocks `@/lib/supabase/admin` from `src/components/**` and
  from any file containing `'use client'`.
- The admin client is used for exactly three things: QR PNG generation, Storage signed uploads,
  and platform-level super-admin operations. **Never** for ordinary staff reads/writes — those go
  through the cookie-bound `authenticated` client so RLS applies.
- `src/lib/security/errors.ts` maps Postgres errors to a whitelist of client-safe shapes; raw
  `PostgrestError.details` is logged server-side and never returned.

**Lives in:** module boundary + `server-only` + lint + CI grep.

### 1.12 PostgREST introspection of tables `anon` must not see

**Attack.** `GET /rest/v1/` returns the OpenAPI document, which lists every table and column the
requesting role has *any* privilege on. Supabase's default grants give `anon` `ALL` on newly
created tables in `public`, so a careless migration silently publishes the entire schema. Even
with RLS enabled and zero policies (returning no rows), the *structure* leaks: table names, column
names, enum values, FK topology.

**Control.** Privileges, not policies, are the control. §2.3 revokes every table, sequence,
routine and default privilege from `anon`, then grants back exactly five `EXECUTE`s. With no table
privileges, `anon`'s OpenAPI document contains no tables and `GET /rest/v1/orders` returns
`401 Unauthorized` / `PGRST301`-class errors, not an empty array. `ALTER DEFAULT PRIVILEGES` is
also rewritten so a future `CREATE TABLE` does not re-open the hole.

**Lives in:** `REVOKE` + `ALTER DEFAULT PRIVILEGES`.

### 1.13 Enumeration of `qr_tokens`

**Attack.** Walk `/t/aaaa`, `/t/aaab`, … to discover live tables; or scrape `qr_tokens` through
PostgREST; or use response-time differences to confirm a guess.

**Control.**
- Tokens are 16 cryptographically random bytes rendered base64url → 22 characters, **128 bits of
  entropy**. At 1,000 guesses/second an attacker needs ~10²⁹ years for one hit. The brief's
  `/t/a8F3kP9x` is illustrative of *shape*, not of length; 22 characters is the floor.
  Generated by `app_private.generate_token()` using `extensions.gen_random_bytes` (CSPRNG). Never
  sequential, never derived from ids, never from `random()`.
- `public.qr_tokens` has no `anon` privileges and its staff `SELECT` policy is restricted to
  owners/managers of that branch.
- `public_resolve_table` returns the *same* `QR001_INVALID_QR_TOKEN` error for malformed,
  unknown, and revoked tokens. It returns `QR002/QR003/QR004` only for a *valid* token whose
  table/branch/restaurant is inactive — which is not information an enumerator can reach without
  already holding a valid token.
- Lookup is a single indexed equality on `qr_tokens.token`; entropy makes timing analysis
  irrelevant, so no constant-time comparison is specified.
- App-side: `src/lib/security/rate-limit.ts` limits `/t/[token]` resolution to 30 requests per IP
  per minute, and `ALTER ROLE anon SET statement_timeout = '4s'` caps any single anon query.
- Failed resolutions are counted in `app_private.security_events` by the route handler (not by the
  DB read path, which stays `STABLE`), so scanning is observable.

**Lives in:** entropy + zero grants + uniform errors.

### 1.14 Additional threats covered

| Threat | Control |
|---|---|
| Privilege escalation via `staff` self-insert | `staff` INSERT/UPDATE policies require `public.can_manage_staff(restaurant_id)`; `public.trg_staff_guard()` forbids granting a role above your own, forbids editing your own row's `role`/`is_active`, and forbids removing the last active owner (`QR051_LAST_OWNER`). |
| Self-promotion to super admin | `public.trg_profiles_guard()` raises `QR052_FORBIDDEN_FIELD` if `is_super_admin` changes unless the actor is already a super admin **and** is not the row's owner. |
| Order-token brute force | `orders.public_token` is 18 random bytes → 24 base64url chars (144 bits). `public_get_order` additionally requires a matching table QR token, so both capabilities are needed. |
| Realtime channel eavesdropping | §7. `authenticated` `postgres_changes` subscriptions are RLS-filtered. Customers use Broadcast-from-DB on topic `order:<public_token>`; `realtime.messages` RLS for `anon` authorises via `public.order_topic_is_valid(text)` (`SECURITY DEFINER`), so a subscription requires possession of the unguessable token. |
| Storage object traversal | §8. Objects are keyed `menu/<restaurant_id>/<branch_id>/<uuid>.webp`; write policies parse the path and require `public.can_manage_menu()`. |
| Log/metadata leakage | Error mapper strips `detail`/`hint` from anything returned to `anon`; only the stable `MESSAGE` code and whitelisted `DETAIL` fields cross the boundary. |
| SQL injection through RPC args | All arguments are typed (`text`, `jsonb`, `uuid`); no function builds SQL by concatenation; no `EXECUTE` with interpolation exists anywhere in this spec. |
| `search_path` hijacking of `SECURITY DEFINER` functions | Every function pins `SET search_path = ''` and fully schema-qualifies every identifier and operator input. `REVOKE CREATE ON SCHEMA public FROM public` removes the ability to shadow objects at all. |

---

## 2. THE CENTRAL DECISION — `anon` gets zero table access; the public API is a capability RPC

### 2.1 The decision

> **Public QR customers have no account, therefore they get no rows. `anon` is granted no
> privilege on any table, view, sequence or function in `public` except `EXECUTE` on exactly five
> `SECURITY DEFINER` functions. Every public read and every public write goes through those five
> functions, each of which takes the QR token as a bearer capability and returns only that table's
> restaurant/branch context.**

### 2.2 Why the obvious alternative is wrong

The tempting design is: grant `anon` `SELECT` on `restaurants`, `branches`, `tables`,
`menu_categories`, `menu_items`, `menu_item_options`, `promotions`, plus `INSERT` on `orders`,
and write RLS policies that scope them by a token carried in a request header or a
`current_setting`. Reject it, for six reasons:

1. **RLS is row-scoped, not query-scoped.** A policy such as
   `menu_items.is_available AND branch_id = <branch of header token>` filters rows correctly but
   still exposes the *whole table shape and query language* to an unauthenticated internet
   endpoint. `anon` can then ask `menu_items?select=price&order=price.desc` or use
   `count=exact` to derive business metrics for any branch whose token has ever leaked, and can
   probe columns added later and forgotten (cost price, supplier notes, internal flags). With RPC
   the response shape is a fixed, reviewed, versioned JSON contract.
2. **The token has to travel somewhere.** Carrying it in a header means the policy depends on
   `current_setting('request.headers', true)::json ->> 'x-qr-token'`. That value is
   attacker-controlled on every request, untyped, and silently `NULL` in every non-PostgREST
   context (psql, `pg_cron`, triggers, Realtime), where the policy then fails open or closed
   unpredictably. Making the token a *function argument* makes it explicit and typed.
3. **`INSERT` policies cannot compute prices.** Any design where `anon` inserts into `orders` must
   accept client-supplied `subtotal`/`total` and repair them in a trigger. That is a
   validate-after-the-fact posture. `SECURITY DEFINER` lets the server be the only party that ever
   authors those numbers (brief §7: *"Never trust prices from the frontend"*).
4. **Multi-row atomicity.** An order is `orders` + N `order_items` + M `order_item_options` +
   `order_status_history` + counter updates. Over PostgREST that is several requests with no shared
   transaction; a dropped connection leaves a headless order on the KDS. One RPC = one
   transaction = all-or-nothing.
5. **Rate limiting needs a chokepoint.** Counters, cooldowns and `FOR UPDATE` serialisation must
   run in the same transaction as the write. Policies cannot do that; functions can.
6. **Auditability and blast radius.** The public attack surface becomes five function bodies that
   can be read end-to-end in a review, instead of "every column of eleven tables, forever,
   including the ones added next quarter." A new column becomes public only if someone adds it to
   a `jsonb_build_object`.

**Cost we accept.** RPC responses are not PostgREST-shaped, so the customer app cannot use
generated table types for public data; it uses hand-written zod schemas in
`src/lib/rpc/schemas.ts` that are the single source of truth for public payloads. This is a
feature: the public contract is explicitly versioned instead of tracking the schema by accident.

### 2.3 The privilege baseline (first migration, re-asserted as the last migration)

```sql
-- supabase/migrations/0001_privilege_baseline.sql
-- Re-run verbatim as the FINAL migration of every release (guards against a careless CREATE TABLE).

-- 1. Nobody may create objects in public.
revoke create on schema public from public, anon, authenticated;

-- 2. anon and authenticated may traverse public (needed to call functions), nothing more.
grant usage on schema public to anon, authenticated, service_role;

-- 3. Strip everything anon has today.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all routines  in schema public from anon;

-- 4. Functions are EXECUTE-to-PUBLIC by default in PostgreSQL. Close that permanently.
revoke all on all routines in schema public from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- 5. Future tables/sequences must not auto-grant to anon.
alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- 6. app_private is sealed.
revoke all on schema app_private                 from public, anon, authenticated;
revoke all on all tables   in schema app_private from public, anon, authenticated;
revoke all on all routines in schema app_private from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  revoke execute on functions from public, anon, authenticated;

-- 7. anon queries are cheap or they do not run.
alter role anon          set statement_timeout = '4s';
alter role authenticated set statement_timeout = '15s';

-- 8. The ONLY five things anon may do.
grant execute on function public.public_resolve_table(text)                  to anon;
grant execute on function public.public_get_menu(text)                       to anon;
grant execute on function public.public_place_order(text, jsonb, text, uuid) to anon;
grant execute on function public.public_get_order(text, text)                to anon;
grant execute on function public.public_call_waiter(text, text)              to anon;
```

Supabase project setting **API → Exposed schemas** must stay exactly
`public, storage, graphql_public`.

**Verification queries — both MUST return zero rows in CI (§9.2):**

```sql
-- (a) anon holds no table privilege anywhere
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon';

-- (b) anon may execute nothing but the five public entry points
select n.nspname, p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where has_function_privilege('anon', p.oid, 'execute')
  and n.nspname in ('public','app_private')
  and p.proname not in ('public_resolve_table','public_get_menu','public_place_order',
                        'public_get_order','public_call_waiter');
```

### 2.4 How a customer re-opens order tracking without an account

**Decision: an unguessable per-order public token embedded in the URL.**

- Column: `public.orders.public_token text not null unique`, produced by
  `app_private.generate_token(18)` -> 24 base64url characters, **144 bits of entropy**.
- URL: **`/t/<qr_token>/order/<order_public_token>`**, e.g.
  `/t/K9f3PqA7xLmZ2vRt6bQn4w/order/Xr7-Qa2mB9pLz0KsN4dVuE1t`.
- The path deliberately carries **both** capabilities. `public_get_order` requires the order to
  belong to the table the QR token resolves to. An order token alone is useless without the
  matching table token, so a tracking link forwarded to a group chat still only works for people
  who also hold that table's QR — the same trust boundary as physically sitting there.
- Customer-side persistence: `src/lib/customer/session.ts` writes
  `localStorage['qros:orders:<qr_token>']` = an array of the 10 most recent
  `{ orderToken, orderNumber, placedAt }`. This is a **convenience cache only**: losing it loses
  nothing the server treats as authoritative, and holding it grants nothing the URL did not
  already grant. No cookie is used for order tracking, so the token never rides along on unrelated
  requests and never lands in a `Cookie` header in access logs.
- Rendering: `src/app/t/[token]/order/[orderToken]/page.tsx` is a Server Component with
  `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'`, calling
  `public_get_order` with the anon key. Because the capability is in the path,
  `next.config.ts` sets `Referrer-Policy: no-referrer` globally and no third-party script is
  permitted on `/t/**` (CSP, §8.3).
- Expiry: `public_get_order` refuses orders older than 24 hours (`QR032_ORDER_EXPIRED`), bounding
  the useful life of a leaked link. Staff retain full history through the authenticated panels.

**Rejected alternatives.** (a) *Signed cookie set at order time* — breaks when the diner scans on
one phone and checks on another, and breaks in in-app browsers that drop cookies across
navigations. (b) *Order number + table number* — `A12-260901-007` is guessable in a few hundred
tries and is printed on the receipt. (c) *Supabase anonymous sign-in* — creates an `auth.users`
row per diner, contradicts brief §1 "No customer account", and burns MAU.

### 2.5 Shared internals used by the public functions

```sql
-- ------------------------------------------------------------------ token generator
create or replace function app_private.generate_token(p_bytes integer default 16)
returns text
language sql
volatile
security definer
set search_path = ''
as $fn$
  select translate(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/=', '-_');
$fn$;
-- 16 bytes -> 22 chars (128 bit) for qr_tokens.token
-- 18 bytes -> 24 chars (144 bit) for orders.public_token
-- translate() deletes '=' because it has no replacement character.

revoke all on function app_private.generate_token(integer) from public, anon, authenticated;

comment on function app_private.generate_token(integer) is
  'CSPRNG URL-safe token. The ONLY approved source of qr_tokens.token and orders.public_token. Never use random().';

-- ------------------------------------------------------------------ structured error raiser
create or replace function app_private.raise_app_error(
  p_code   text,                       -- stable machine code, e.g. 'QR020_ITEM_UNAVAILABLE'
  p_status integer,                    -- intended HTTP status; PostgREST maps SQLSTATE 'PT<status>'
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  raise exception using
    errcode = 'PT' || p_status::text,
    message = p_code,
    detail  = p_detail::text,
    hint    = 'RESTAURANT_QR_OS';
end;
$fn$;

revoke all on function app_private.raise_app_error(text, integer, jsonb) from public, anon, authenticated;
```

**Error contract (normative).** Every function in this document signals failure through
`app_private.raise_app_error`. PostgREST maps `SQLSTATE 'PTnnn'` to HTTP status `nnn` and returns:

```json
{ "code": "PT409",
  "message": "QR012_WAITER_CALL_ALREADY_OPEN",
  "details": "{\"retry_after_seconds\": 42}",
  "hint": "RESTAURANT_QR_OS" }
```

- `message` — the stable machine code the TypeScript layer switches on. It is the API contract.
- `details` — a JSON string of structured fields (documented per function).
- `hint` — the constant `RESTAURANT_QR_OS`, used by `src/lib/security/errors.ts` to distinguish
  deliberate application errors from incidental Postgres errors. Anything without that hint is
  logged server-side and collapsed to `QR999_INTERNAL` / HTTP 500 before it reaches a browser.

```sql
-- ------------------------------------------------------------------ human-friendly order number
-- Brief §25: "Order number human-friendly, internal id separate." The sequence is per branch and
-- per business date in the BRANCH's timezone, so two branches never collide and the number resets
-- each service day. Kept in app_private so no application role can read or skew the counter.
create table if not exists app_private.order_counters (
  branch_id     uuid    not null,
  business_date date    not null,
  last_value    integer not null default 0,
  primary key (branch_id, business_date)
);

alter table app_private.order_counters enable row level security;
alter table app_private.order_counters force  row level security;
-- No policies, no grants.

create or replace function app_private.next_order_number(p_branch_id uuid, p_timezone text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_date date;
  v_seq  integer;
begin
  v_date := (now() at time zone coalesce(p_timezone, 'UTC'))::date;

  insert into app_private.order_counters as oc (branch_id, business_date, last_value)
  values (p_branch_id, v_date, 1)
  on conflict (branch_id, business_date) do update
    set last_value = oc.last_value + 1
  returning oc.last_value into v_seq;

  -- e.g. 260901-014  (YYMMDD in branch-local time, then a zero-padded per-day sequence)
  return to_char(v_date, 'YYMMDD') || '-' || lpad(v_seq::text, 3, '0');
end;
$fn$;

revoke all on function app_private.next_order_number(uuid, text) from public, anon, authenticated;

-- The ON CONFLICT DO UPDATE takes a row lock, so concurrent orders in one branch are serialised
-- on that single counter row and can never receive the same number. The corresponding uniqueness
-- guarantee is asserted, not assumed:
create unique index if not exists orders_branch_number_uk
  on public.orders (branch_id, order_number);

-- ------------------------------------------------------------------ table context type
create type app_private.table_context as (
  restaurant_id       uuid,
  restaurant_name     text,
  restaurant_slug     text,
  restaurant_logo_url text,
  currency            char(3),
  currency_decimals   smallint,
  branch_id           uuid,
  branch_name         text,
  branch_timezone     text,
  service_fee_enabled boolean,
  service_fee_bps     integer,
  table_id            uuid,
  table_name          text,
  table_number        integer
);

-- ------------------------------------------------------------------ token resolver
create or replace function app_private.resolve_token(
  p_token         text,
  p_allow_revoked boolean default false
) returns app_private.table_context
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v          app_private.table_context;
  v_token_ok boolean;
  v_r_active boolean;
  v_b_active boolean;
  v_t_active boolean;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22,64}$' then
    perform app_private.raise_app_error('QR001_INVALID_QR_TOKEN', 404, '{}'::jsonb);
  end if;

  select
    r.id, r.name, r.slug, r.logo_url, r.currency, r.currency_decimals,
    b.id, b.name, b.timezone, b.service_fee_enabled, b.service_fee_bps,
    t.id, t.name, t.number,
    (qt.is_active or (p_allow_revoked and qt.revoked_at > now() - interval '12 hours')),
    r.is_active, b.is_active, t.is_active
  into
    v.restaurant_id, v.restaurant_name, v.restaurant_slug, v.restaurant_logo_url,
    v.currency, v.currency_decimals,
    v.branch_id, v.branch_name, v.branch_timezone, v.service_fee_enabled, v.service_fee_bps,
    v.table_id, v.table_name, v.table_number,
    v_token_ok, v_r_active, v_b_active, v_t_active
  from public.qr_tokens qt
  join public.tables      t on t.id = qt.table_id
  join public.branches    b on b.id = t.branch_id
  join public.restaurants r on r.id = b.restaurant_id
  where qt.token = p_token;

  -- Unknown, malformed and revoked tokens are indistinguishable to the caller (§1.13).
  if not found or not coalesce(v_token_ok, false) then
    perform app_private.raise_app_error('QR001_INVALID_QR_TOKEN', 404, '{}'::jsonb);
  end if;

  if not v_r_active then
    perform app_private.raise_app_error('QR004_RESTAURANT_INACTIVE', 423, '{}'::jsonb);
  end if;
  if not v_b_active then
    perform app_private.raise_app_error('QR003_BRANCH_INACTIVE', 423, '{}'::jsonb);
  end if;
  if not v_t_active then
    perform app_private.raise_app_error('QR002_TABLE_INACTIVE', 423, '{}'::jsonb);
  end if;

  return v;
end;
$fn$;

revoke all on function app_private.resolve_token(text, boolean) from public, anon, authenticated;

create unique index if not exists qr_tokens_token_uk on public.qr_tokens (token);
create index        if not exists qr_tokens_table_active_idx
  on public.qr_tokens (table_id) where is_active;
create unique index if not exists qr_tokens_one_active_per_table_uk
  on public.qr_tokens (table_id) where is_active;
```

**Public-payload rule (normative).** `restaurant_id`, `branch_id` and `table_id` exist in
`app_private.table_context` for internal use and are **never** emitted in a JSON response to
`anon`. `menu_item_id` and option ids *are* emitted, because the cart needs identifiers, and those
ids are inert: `public_place_order` re-validates that each belongs to the token's branch, so
knowing one grants nothing.

### 2.6 The five public functions

---

#### `public.public_resolve_table(p_token text) -> jsonb`

| Property | Value |
|---|---|
| Security | `SECURITY DEFINER`, owner `postgres` |
| `search_path` | `''` (empty; every identifier schema-qualified) |
| Volatility | `STABLE` — no writes, so the hot QR-scan path stays cacheable and replica-safe |
| Grants | `EXECUTE` to `anon`, `authenticated`; revoked from `public` |
| Raises | `QR001_INVALID_QR_TOKEN` (404) · `QR002_TABLE_INACTIVE` (423) · `QR003_BRANCH_INACTIVE` (423) · `QR004_RESTAURANT_INACTIVE` (423) |

```sql
create or replace function public.public_resolve_table(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  c app_private.table_context;
begin
  c := app_private.resolve_token(p_token, false);

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
        'name',              c.restaurant_name,
        'slug',              c.restaurant_slug,
        'logo_url',          c.restaurant_logo_url,
        'currency',          c.currency,
        'currency_decimals', c.currency_decimals),
    'branch', jsonb_build_object(
        'name',                c.branch_name,
        'timezone',            c.branch_timezone,
        'service_fee_enabled', c.service_fee_enabled,
        'service_fee_bps',     c.service_fee_bps),
    'table', jsonb_build_object(
        'name',   c.table_name,
        'number', c.table_number),
    'token', p_token);
end;
$fn$;

revoke all     on function public.public_resolve_table(text) from public;
grant  execute on function public.public_resolve_table(text) to anon, authenticated;
```

Output validated by `PublicTableContextSchema` (`src/lib/rpc/schemas.ts`).

---

#### `public.public_get_menu(p_token text) -> jsonb`

| Property | Value |
|---|---|
| Security | `SECURITY DEFINER`, owner `postgres` |
| `search_path` | `''` |
| Volatility | `STABLE` |
| Grants | `EXECUTE` to `anon`, `authenticated` |
| Raises | `QR001` (404) · `QR002` / `QR003` / `QR004` (423) |

Returns the menu for the token's **branch only**, plus the same context block, so the customer app
needs one round trip. Unavailable items are **included and flagged** (`is_available: false`), per
brief §5 — the UI greys them out; it does not discover them by their absence.

```sql
create or replace function public.public_get_menu(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  c        app_private.table_context;
  v_cats   jsonb;
  v_promos jsonb;
begin
  c := app_private.resolve_token(p_token, false);

  select coalesce(jsonb_agg(s.cat order by s.cat_sort, s.cat_id), '[]'::jsonb)
  into v_cats
  from (
    select
      mc.sort_order as cat_sort,
      mc.id         as cat_id,
      jsonb_build_object(
        'id',         mc.id,
        'name',       mc.name,                 -- jsonb {"uz":...,"ru":...,"en":...}
        'image_url',  mc.image_url,
        'sort_order', mc.sort_order,
        'items', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'id',               mi.id,
                     'name',             mi.name,
                     'description',      mi.description,
                     'price',            mi.price,            -- BIGINT minor units
                     'image_url',        mi.image_url,
                     'ingredients',      mi.ingredients,
                     'dietary',          mi.dietary,
                     'spicy_level',      mi.spicy_level,
                     'preparation_time', mi.preparation_time,
                     'is_available',     mi.is_available,
                     'is_featured',      mi.is_featured,
                     'is_popular',       mi.is_popular,
                     'options', coalesce((
                       select jsonb_agg(
                                jsonb_build_object(
                                  'id',           mio.id,
                                  'group_key',    mio.group_key,
                                  'name',         mio.name,
                                  'price_delta',  mio.price_delta,
                                  'is_required',  mio.is_required,
                                  'max_select',   mio.max_select,
                                  'is_available', mio.is_available)
                                order by mio.sort_order, mio.id)
                       from public.menu_item_options mio
                       where mio.menu_item_id = mi.id
                         and mio.branch_id    = c.branch_id), '[]'::jsonb))
                   order by mi.sort_order, mi.id)
          from public.menu_items mi
          where mi.category_id   = mc.id
            and mi.branch_id     = c.branch_id
            and mi.restaurant_id = c.restaurant_id
            and mi.is_archived is not true), '[]'::jsonb)
      ) as cat
    from public.menu_categories mc
    where mc.restaurant_id = c.restaurant_id
      and (mc.branch_id is null or mc.branch_id = c.branch_id)
      and mc.is_active
  ) s;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',          p.id,
             'title',       p.title,
             'description', p.description,
             'image_url',   p.image_url,
             'sort_order',  p.sort_order)
           order by p.sort_order, p.id), '[]'::jsonb)
  into v_promos
  from public.promotions p
  where p.restaurant_id = c.restaurant_id
    and (p.branch_id is null or p.branch_id = c.branch_id)
    and p.is_active
    and (p.starts_at is null or p.starts_at <= now())
    and (p.ends_at   is null or p.ends_at   >  now());

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
        'name', c.restaurant_name, 'slug', c.restaurant_slug,
        'logo_url', c.restaurant_logo_url,
        'currency', c.currency, 'currency_decimals', c.currency_decimals),
    'branch', jsonb_build_object(
        'name', c.branch_name, 'timezone', c.branch_timezone,
        'service_fee_enabled', c.service_fee_enabled, 'service_fee_bps', c.service_fee_bps),
    'table', jsonb_build_object('name', c.table_name, 'number', c.table_number),
    'categories', v_cats,
    'promotions', v_promos);
end;
$fn$;

revoke all     on function public.public_get_menu(text) from public;
grant  execute on function public.public_get_menu(text) to anon, authenticated;
```

Promotions carry **no pricing effect** in MVP (§1.3). If a later release makes them affect price,
that logic goes inside `public_place_order` and nowhere else.

---

#### `public.public_place_order(p_token text, p_items jsonb, p_note text, p_client_request_id uuid default null) -> jsonb`

> The fourth parameter is defaulted, so the three-argument call form specified in the assignment
> stays valid. Clients **should** always pass a v4 UUID: it is the idempotency key that makes a
> retry safe (§5.2).

| Property | Value |
|---|---|
| Security | `SECURITY DEFINER`, owner `postgres` |
| `search_path` | `''` |
| Volatility | `VOLATILE` |
| Grants | `EXECUTE` to `anon`, `authenticated` |
| Raises | `QR001` (404) · `QR002` / `QR003` / `QR004` (423) · `QR023_INVALID_PAYLOAD` (422) · `QR024_QUANTITY_OUT_OF_RANGE` (422) · `QR020_ITEM_UNAVAILABLE` (409) · `QR022_INVALID_OPTION` (409) · `QR010_ORDER_RATE_LIMITED` (429) · `QR013_DUPLICATE_ORDER` (409) |

`p_items` contract — a JSON array, 1..40 elements, each element exactly:

```jsonc
{ "menu_item_id": "uuid",        // required
  "quantity":      1,            // required, integer 1..50
  "option_ids":  ["uuid", ...],  // optional, default [], max 20
  "note":        "No onion" }    // optional, max 140 chars
```

`p_note` (order level) max 280 chars. **There is no price field anywhere in the input.** Unknown
keys are ignored by the SQL (keys are extracted explicitly, never iterated) and rejected earlier by
`PlaceOrderInput` (zod `.strict()`).

```sql
create or replace function public.public_place_order(
  p_token             text,
  p_items             jsonb,
  p_note              text,
  p_client_request_id uuid default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c               app_private.table_context;
  v_existing      public.orders%rowtype;
  v_now           timestamptz := now();
  v_last_order    timestamptz;
  v_cooldown      interval := interval '20 seconds';
  v_line          jsonb;
  v_item_id       uuid;
  v_qty           integer;
  v_opt_ids       uuid[];
  v_opt_id        uuid;
  v_item          record;
  v_opt           record;
  v_line_unit     bigint;
  v_line_total    bigint;
  v_subtotal      bigint := 0;
  v_fee           bigint := 0;
  v_total         bigint := 0;
  v_order_id      uuid;
  v_order_item_id uuid;
  v_public_token  text;
  v_order_number  text;
  v_note          text;
  v_fingerprint   text;
begin
  ------------------------------------------------------------------ 1. capability
  c := app_private.resolve_token(p_token, false);

  ------------------------------------------------------------------ 2. idempotency (fast path)
  if p_client_request_id is not null then
    select * into v_existing from public.orders o where o.client_request_id = p_client_request_id;
    if found then
      return app_private.order_payload(v_existing.id);
    end if;
  end if;

  ------------------------------------------------------------------ 3. payload shape
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    perform app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field', 'items', 'reason', 'not_an_array'));
  end if;
  if jsonb_array_length(p_items) = 0 then
    perform app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field', 'items', 'reason', 'empty'));
  end if;
  if jsonb_array_length(p_items) > 40 then
    perform app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field', 'items', 'reason', 'too_many', 'max', 40));
  end if;

  v_note := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), '');
  if length(coalesce(v_note, '')) > 280 then
    perform app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field', 'note', 'reason', 'too_long', 'max', 280));
  end if;

  ------------------------------------------------------------------ 4. serialise per table
  -- Row lock held to COMMIT: two concurrent submits from the same table are strictly ordered,
  -- so the cooldown below cannot be raced by parallel requests.
  select t.last_order_at into v_last_order
  from public.tables t
  where t.id = c.table_id
  for update;

  if v_last_order is not null and v_last_order > v_now - v_cooldown then
    perform app_private.raise_app_error('QR010_ORDER_RATE_LIMITED', 429,
      jsonb_build_object(
        'scope', 'table_cooldown',
        'retry_after_seconds', ceil(extract(epoch from (v_last_order + v_cooldown - v_now)))::int));
  end if;

  if not app_private.rate_limit_hit('order:table:' || c.table_id::text, 12, interval '1 hour') then
    perform app_private.raise_app_error('QR010_ORDER_RATE_LIMITED', 429,
      jsonb_build_object('scope', 'table_hourly', 'retry_after_seconds', 600));
  end if;

  if not app_private.rate_limit_hit('order:branch:' || c.branch_id::text, 300, interval '1 hour') then
    perform app_private.raise_app_error('QR010_ORDER_RATE_LIMITED', 429,
      jsonb_build_object('scope', 'branch_hourly', 'retry_after_seconds', 300));
  end if;

  ------------------------------------------------------------------ 5. duplicate-payload guard
  v_fingerprint := encode(
      extensions.digest(c.table_id::text || '|' || p_items::text, 'sha256'), 'hex');

  if exists (select 1
             from public.orders o
             where o.table_id            = c.table_id
               and o.payload_fingerprint = v_fingerprint
               and o.created_at          > v_now - interval '60 seconds'
               and o.status <> 'cancelled') then
    perform app_private.raise_app_error('QR013_DUPLICATE_ORDER', 409,
      jsonb_build_object('window_seconds', 60));
  end if;

  ------------------------------------------------------------------ 6. order shell
  v_public_token := app_private.generate_token(18);
  v_order_number := app_private.next_order_number(c.branch_id, c.branch_timezone);

  insert into public.orders (
    id, restaurant_id, branch_id, table_id, order_number, public_token,
    client_request_id, payload_fingerprint, status, subtotal, service_fee, total,
    note, placed_by_staff_id, created_at, updated_at)
  values (
    extensions.gen_random_uuid(), c.restaurant_id, c.branch_id, c.table_id,
    v_order_number, v_public_token, p_client_request_id, v_fingerprint,
    'pending', 0, 0, 0, v_note, null, v_now, v_now)
  returning id into v_order_id;

  ------------------------------------------------------------------ 7. price every line, server-side
  for v_line in select jsonb_array_elements(p_items) loop

    if jsonb_typeof(v_line) <> 'object' then
      perform app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
        jsonb_build_object('field', 'items[]', 'reason', 'not_an_object'));
    end if;

    begin
      v_item_id := (v_line ->> 'menu_item_id')::uuid;
      v_qty     := (v_line ->> 'quantity')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      perform app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
        jsonb_build_object('field', 'items[]', 'reason', 'bad_types'));
    end;

    if v_qty is null or v_qty < 1 or v_qty > 50 then
      perform app_private.raise_app_error('QR024_QUANTITY_OUT_OF_RANGE', 422,
        jsonb_build_object('menu_item_id', v_item_id, 'min', 1, 'max', 50));
    end if;

    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_opt_ids
    from jsonb_array_elements_text(coalesce(v_line -> 'option_ids', '[]'::jsonb)) as x;

    if coalesce(array_length(v_opt_ids, 1), 0) > 20 then
      perform app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
        jsonb_build_object('field', 'option_ids', 'reason', 'too_many', 'max', 20));
    end if;

    -- Availability + tenancy + branch + category state, in ONE predicate.
    -- FOR SHARE blocks a concurrent "mark unavailable" from committing under us.
    select mi.id, mi.name, mi.price
    into v_item
    from public.menu_items mi
    join public.menu_categories mc on mc.id = mi.category_id
    where mi.id            = v_item_id
      and mi.branch_id     = c.branch_id
      and mi.restaurant_id = c.restaurant_id
      and mi.is_available
      and mi.is_archived is not true
      and mc.is_active
    for share of mi;

    if not found then
      perform app_private.raise_app_error('QR020_ITEM_UNAVAILABLE', 409,
        jsonb_build_object('menu_item_id', v_item_id));
    end if;

    v_line_unit := v_item.price;

    insert into public.order_items (
      id, order_id, restaurant_id, branch_id, menu_item_id,
      name_snapshot, price_snapshot, quantity, total, note, created_at)
    values (
      extensions.gen_random_uuid(), v_order_id, c.restaurant_id, c.branch_id, v_item.id,
      v_item.name #>> '{}', v_line_unit, v_qty, 0,
      nullif(btrim(left(regexp_replace(coalesce(v_line ->> 'note', ''), '[[:cntrl:]]', ' ', 'g'), 140)), ''),
      v_now)
    returning id into v_order_item_id;

    foreach v_opt_id in array v_opt_ids loop
      select mio.id, mio.name, mio.price_delta
      into v_opt
      from public.menu_item_options mio
      where mio.id           = v_opt_id
        and mio.menu_item_id = v_item.id
        and mio.branch_id    = c.branch_id
        and mio.is_available
      for share of mio;

      if not found then
        perform app_private.raise_app_error('QR022_INVALID_OPTION', 409,
          jsonb_build_object('menu_item_id', v_item_id, 'option_id', v_opt_id));
      end if;

      insert into public.order_item_options (
        id, order_item_id, order_id, restaurant_id, branch_id,
        menu_item_option_id, name_snapshot, price_delta_snapshot, created_at)
      values (
        extensions.gen_random_uuid(), v_order_item_id, v_order_id, c.restaurant_id, c.branch_id,
        v_opt.id, v_opt.name #>> '{}', v_opt.price_delta, v_now);

      v_line_unit := v_line_unit + v_opt.price_delta;
    end loop;

    if v_line_unit < 0 then
      v_line_unit := 0;                    -- negative price deltas can never make a line negative
    end if;

    v_line_total := v_line_unit * v_qty;

    update public.order_items
       set price_snapshot = v_line_unit, total = v_line_total
     where id = v_order_item_id;

    v_subtotal := v_subtotal + v_line_total;
  end loop;

  ------------------------------------------------------------------ 8. fee + total, integers only
  if c.service_fee_enabled and c.service_fee_bps > 0 then
    v_fee := (v_subtotal * c.service_fee_bps + 5000) / 10000;   -- half-up in BIGINT arithmetic
  end if;
  v_total := v_subtotal + v_fee;

  update public.orders
     set subtotal = v_subtotal, service_fee = v_fee, total = v_total, updated_at = v_now
   where id = v_order_id;

  update public.tables set last_order_at = v_now where id = c.table_id;

  ------------------------------------------------------------------ 9. audit + fan-out
  insert into public.order_status_history (
    id, order_id, restaurant_id, branch_id, previous_status, new_status,
    changed_by, changed_by_kind, created_at)
  values (extensions.gen_random_uuid(), v_order_id, c.restaurant_id, c.branch_id,
          null, 'pending', null, 'customer', v_now);

  insert into public.notifications (
    id, restaurant_id, branch_id, target_role, target_user_id, kind, payload, created_at)
  values (extensions.gen_random_uuid(), c.restaurant_id, c.branch_id, 'kitchen', null,
          'order.created',
          jsonb_build_object('order_number', v_order_number,
                             'table_number', c.table_number,
                             'total',        v_total),
          v_now);

  perform realtime.send(
    jsonb_build_object('event','order.created','order_number',v_order_number,
                       'status','pending','table_number',c.table_number),
    'order.created', 'branch:' || c.branch_id::text, true);

  perform realtime.send(
    jsonb_build_object('event','order.created','status','pending',
                       'order_number',v_order_number),
    'order.created', 'order:' || v_public_token, true);

  return app_private.order_payload(v_order_id);

exception
  when unique_violation then
    -- A concurrent retry with the same client_request_id won the race: return its order.
    if p_client_request_id is not null then
      select * into v_existing from public.orders o where o.client_request_id = p_client_request_id;
      if found then
        return app_private.order_payload(v_existing.id);
      end if;
    end if;
    raise;
end;
$fn$;

revoke all     on function public.public_place_order(text, jsonb, text, uuid) from public;
grant  execute on function public.public_place_order(text, jsonb, text, uuid) to anon, authenticated;
```

Supporting objects:

```sql
alter table public.orders add column if not exists payload_fingerprint text;

create index if not exists orders_dup_guard_idx
  on public.orders (table_id, payload_fingerprint, created_at desc);

create unique index if not exists orders_client_request_id_uk
  on public.orders (client_request_id) where client_request_id is not null;

create index if not exists orders_branch_status_created_idx
  on public.orders (branch_id, status, created_at desc);

create unique index if not exists orders_public_token_uk on public.orders (public_token);
```

`app_private.order_payload(uuid)` is the single renderer of a customer-facing order document.
`SECURITY DEFINER`, `STABLE`, `search_path = ''`, granted to **nobody** (called only from other
definer functions):

```sql
create or replace function app_private.order_payload(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'order_number',      o.order_number,
    'public_token',      o.public_token,
    'tracking_path',     '/t/' || qt.token || '/order/' || o.public_token,
    'status',            o.status,
    'subtotal',          o.subtotal,
    'service_fee',       o.service_fee,
    'total',             o.total,
    'currency',          r.currency,
    'currency_decimals', r.currency_decimals,
    'note',              o.note,
    'created_at',        o.created_at,
    'table',             jsonb_build_object('name', t.name, 'number', t.number),
    'items', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'name',     oi.name_snapshot,
                 'unit',     oi.price_snapshot,
                 'quantity', oi.quantity,
                 'total',    oi.total,
                 'note',     oi.note,
                 'options', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'name',        oio.name_snapshot,
                            'price_delta', oio.price_delta_snapshot)
                          order by oio.created_at, oio.id)
                   from public.order_item_options oio
                   where oio.order_item_id = oi.id), '[]'::jsonb))
               order by oi.created_at, oi.id)
      from public.order_items oi where oi.order_id = o.id), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('status', h.new_status, 'at', h.created_at)
             order by h.created_at, h.id)
      from public.order_status_history h where h.order_id = o.id), '[]'::jsonb))
  from public.orders o
  join public.tables      t  on t.id = o.table_id
  join public.restaurants r  on r.id = o.restaurant_id
  join public.qr_tokens   qt on qt.table_id = o.table_id and qt.is_active
  where o.id = p_order_id;
$fn$;

revoke all on function app_private.order_payload(uuid) from public, anon, authenticated;
```

Note what the payload does **not** contain: no `orders.id`, no `restaurant_id` / `branch_id` /
`table_id`, no `changed_by`, no staff names, no internal or cancellation notes.

---

#### `public.public_get_order(p_token text, p_order_public_id text) -> jsonb`

`p_order_public_id` **is** `orders.public_token` — the per-order capability of §2.4.

| Property | Value |
|---|---|
| Security | `SECURITY DEFINER`, owner `postgres` |
| `search_path` | `''` |
| Volatility | `STABLE` |
| Grants | `EXECUTE` to `anon`, `authenticated` |
| Raises | `QR001` (404) · `QR002` / `QR003` / `QR004` (423) · `QR030_ORDER_NOT_FOUND` (404) · `QR032_ORDER_EXPIRED` (410) |

```sql
create or replace function public.public_get_order(p_token text, p_order_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  c       app_private.table_context;
  v_order public.orders%rowtype;
begin
  -- Read-only path tolerates a token revoked within the last 12h (rotation mid-meal, §1.6).
  c := app_private.resolve_token(p_token, true);

  if p_order_public_id is null or p_order_public_id !~ '^[A-Za-z0-9_-]{24,64}$' then
    perform app_private.raise_app_error('QR030_ORDER_NOT_FOUND', 404, '{}'::jsonb);
  end if;

  select * into v_order
  from public.orders o
  where o.public_token = p_order_public_id
    and o.table_id     = c.table_id;         -- BOTH capabilities must match

  if not found then
    -- Wrong order token, or right order token at the wrong table: identical error either way.
    perform app_private.raise_app_error('QR030_ORDER_NOT_FOUND', 404, '{}'::jsonb);
  end if;

  if v_order.created_at < now() - interval '24 hours' then
    perform app_private.raise_app_error('QR032_ORDER_EXPIRED', 410, '{}'::jsonb);
  end if;

  return app_private.order_payload(v_order.id);
end;
$fn$;

revoke all     on function public.public_get_order(text, text) from public;
grant  execute on function public.public_get_order(text, text) to anon, authenticated;
```

---

#### `public.public_call_waiter(p_token text, p_reason text) -> jsonb`

| Property | Value |
|---|---|
| Security | `SECURITY DEFINER`, owner `postgres` |
| `search_path` | `''` |
| Volatility | `VOLATILE` |
| Grants | `EXECUTE` to `anon`, `authenticated` |
| Raises | `QR001` (404) · `QR002` / `QR003` / `QR004` (423) · `QR023_INVALID_PAYLOAD` (422) · `QR011_WAITER_CALL_COOLDOWN` (429) · `QR012_WAITER_CALL_ALREADY_OPEN` (409) |

```sql
create or replace function public.public_call_waiter(p_token text, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c          app_private.table_context;
  v_now      timestamptz := now();
  v_last     timestamptz;
  v_cooldown interval := interval '90 seconds';
  v_reason   public.waiter_call_reason;
begin
  c := app_private.resolve_token(p_token, false);

  begin
    v_reason := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'service')::public.waiter_call_reason;
  exception when invalid_text_representation then
    perform app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field', 'reason',
        'allowed', jsonb_build_array('service','bill','water','cleaning','other')));
  end;

  select t.last_waiter_call_at into v_last
  from public.tables t where t.id = c.table_id for update;

  if v_last is not null and v_last > v_now - v_cooldown then
    perform app_private.raise_app_error('QR011_WAITER_CALL_COOLDOWN', 429,
      jsonb_build_object('scope', 'table_cooldown',
        'retry_after_seconds', ceil(extract(epoch from (v_last + v_cooldown - v_now)))::int));
  end if;

  if not app_private.rate_limit_hit('call:table:' || c.table_id::text, 5, interval '1 hour') then
    perform app_private.raise_app_error('QR011_WAITER_CALL_COOLDOWN', 429,
      jsonb_build_object('scope', 'table_hourly', 'retry_after_seconds', 900));
  end if;

  begin
    insert into public.waiter_calls (
      id, restaurant_id, branch_id, table_id, status, reason, created_at, updated_at)
    values (extensions.gen_random_uuid(), c.restaurant_id, c.branch_id, c.table_id,
            'open', v_reason, v_now, v_now);
  exception when unique_violation then
    perform app_private.raise_app_error('QR012_WAITER_CALL_ALREADY_OPEN', 409, '{}'::jsonb);
  end;

  update public.tables set last_waiter_call_at = v_now where id = c.table_id;

  insert into public.notifications (
    id, restaurant_id, branch_id, target_role, target_user_id, kind, payload, created_at)
  values (extensions.gen_random_uuid(), c.restaurant_id, c.branch_id, 'waiter', null,
          'waiter_call.created',
          jsonb_build_object('table_number', c.table_number,
                             'table_name',   c.table_name,
                             'reason',       v_reason),
          v_now);

  perform realtime.send(
    jsonb_build_object('event','waiter_call.created',
                       'table_number', c.table_number, 'reason', v_reason),
    'waiter_call.created', 'branch:' || c.branch_id::text, true);

  return jsonb_build_object(
    'status',           'open',
    'reason',           v_reason,
    'cooldown_seconds', 90,
    'table',            jsonb_build_object('name', c.table_name, 'number', c.table_number));
end;
$fn$;

revoke all     on function public.public_call_waiter(text, text) from public;
grant  execute on function public.public_call_waiter(text, text) to anon, authenticated;
```

### 2.7 TypeScript boundary (contract for the app agents)

| Path | Responsibility |
|---|---|
| `src/lib/supabase/public-client.ts` | `createPublicClient()` — anon key, **no cookies**, only inside Node route handlers / Server Components under `/t/**` |
| `src/lib/supabase/server.ts` | `createServerClient()` — `@supabase/ssr` cookie client for `authenticated` staff |
| `src/lib/supabase/admin.ts` | `createAdminClient()` — service role; `import 'server-only'` is line 1 |
| `src/lib/rpc/schemas.ts` | zod v4: `PlaceOrderInput` (`.strict()`), `PublicTableContextSchema`, `PublicMenuSchema`, `PublicOrderSchema`, `WaiterCallResultSchema` |
| `src/lib/rpc/public.ts` | `resolveTable`, `getMenu`, `placeOrder`, `getOrder`, `callWaiter` — zod-parse input, `.rpc()`, zod-parse output, `mapPgError` on failure |
| `src/lib/security/errors.ts` | `AppError`, `QrErrorCode` union, `mapPgError(e: PostgrestError): AppError` |
| `src/lib/security/rate-limit.ts` | app-side limiter (§5.4) |

Every route handler and page under `src/app/t/**` and `src/app/api/public/**` declares
`export const runtime = 'nodejs'`.

---

## 3. Full RLS policy DDL for the staff-facing tables

Helper functions used below are defined in §4. Read §4 first if you are implementing.

### 3.0 Rules that apply to every policy in this section

1. Every table gets `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`, with the two
   documented exceptions in §4.2 (`public.profiles`, `public.staff`) whose rationale is the
   recursion trap.
2. Every policy is `TO authenticated`. There is **no** policy `TO anon` and **no** policy
   `TO public` anywhere in this system. `service_role` bypasses RLS by role attribute and needs no
   policies.
3. Every `UPDATE` policy has both `USING` and `WITH CHECK`. A missing `WITH CHECK` is a
   review-blocking defect: it permits tenant hopping.
4. Policy names are `<table>_<verb>_<audience>` so `pg_policies` is greppable.
5. `auth.uid()` is always wrapped as `(select auth.uid())` so the planner treats it as an InitPlan
   and evaluates it once per query instead of once per row.
6. Helper functions returning arrays are used as `col = any(public.helper())` — the helper is
   `STABLE`, so it is evaluated once per query.

### 3.1 Table-level grants for `authenticated` (defence in depth beneath RLS)

Policies decide *which rows*; grants decide *which verbs exist at all*. Both are set, so a
forgotten policy cannot become a write hole.

```sql
-- Step 1: start from nothing. Supabase's defaults grant ALL to authenticated on new tables.
revoke all on all tables in schema public from authenticated;

-- Step 2: SELECT everywhere (RLS narrows it to the caller's tenant).
grant select on
  public.restaurants, public.branches, public.profiles, public.staff, public.tables,
  public.qr_tokens, public.menu_categories, public.menu_items, public.menu_item_options,
  public.promotions, public.orders, public.order_items, public.order_item_options,
  public.order_status_history, public.waiter_calls, public.notifications
to authenticated;

-- Step 3: full direct-write verbs, only where a legitimate direct-write path exists.
grant insert, update, delete on
  public.restaurants,          -- INSERT/DELETE reachable by super admin only, per policy
  public.branches,
  public.staff,
  public.tables,
  public.menu_categories,
  public.menu_items,
  public.menu_item_options,
  public.promotions
to authenticated;

-- Step 4: narrow verbs where only one kind of change is legal.
grant insert, update on public.profiles      to authenticated;  -- own row; guarded by trigger
grant update          on public.orders        to authenticated;  -- status only; guarded by trigger
grant update          on public.waiter_calls  to authenticated;  -- acknowledge / resolve
grant update          on public.notifications to authenticated;  -- read_at only; guarded by trigger

-- Step 5: everything not granted above stays denied. In particular NO role ever receives
--   INSERT / UPDATE / DELETE on order_items, order_item_options, order_status_history
--   INSERT / UPDATE / DELETE on qr_tokens
--   INSERT / DELETE          on orders, waiter_calls, notifications
--   DELETE                   on profiles
-- Those rows exist only because a SECURITY DEFINER function created them.
```

### 3.2 `public.restaurants`

```sql
alter table public.restaurants enable  row level security;
alter table public.restaurants force   row level security;

create policy restaurants_select_staff on public.restaurants
  for select to authenticated
  using ( public.has_restaurant_access(id) );

create policy restaurants_insert_superadmin on public.restaurants
  for insert to authenticated
  with check ( public.is_super_admin() );

create policy restaurants_update_owner on public.restaurants
  for update to authenticated
  using      ( public.can_manage_settings(id) )
  with check ( public.can_manage_settings(id) );

create policy restaurants_delete_superadmin on public.restaurants
  for delete to authenticated
  using ( public.is_super_admin() );
```

### 3.3 `public.branches`

```sql
alter table public.branches enable row level security;
alter table public.branches force  row level security;

-- A waiter/kitchen member sees only their own branch; owners and restaurant-wide
-- managers see every branch of their restaurant (current_branch_ids() expands them).
create policy branches_select_staff on public.branches
  for select to authenticated
  using ( public.has_branch_access(id) );

create policy branches_insert_owner on public.branches
  for insert to authenticated
  with check ( public.can_manage_branches(restaurant_id) );

-- Owners may edit any branch of their restaurant; a branch manager may edit their own branch.
create policy branches_update_manager on public.branches
  for update to authenticated
  using      ( public.can_manage_branches(restaurant_id) or public.can_manage_branch(id) )
  with check ( public.can_manage_branches(restaurant_id) or public.can_manage_branch(id) );

create policy branches_delete_owner on public.branches
  for delete to authenticated
  using ( public.can_manage_branches(restaurant_id) );
```

### 3.4 `public.profiles`

RLS **enabled**, **not forced** — see §4.2.

```sql
alter table public.profiles enable row level security;
alter table public.profiles no force row level security;   -- deliberate, §4.2

create policy profiles_select_self on public.profiles
  for select to authenticated
  using ( id = (select auth.uid()) );

create policy profiles_select_colleagues on public.profiles
  for select to authenticated
  using ( public.is_colleague(id) );

create policy profiles_select_superadmin on public.profiles
  for select to authenticated
  using ( public.is_super_admin() );

-- The row is normally created by the on_auth_user_created trigger; this covers self-repair.
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check ( id = (select auth.uid()) );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using      ( id = (select auth.uid()) )
  with check ( id = (select auth.uid()) );

create policy profiles_update_manager on public.profiles
  for update to authenticated
  using      ( public.is_super_admin() or public.can_manage_staff_of_user(id) )
  with check ( public.is_super_admin() or public.can_manage_staff_of_user(id) );

-- No DELETE policy: profiles are deleted only by cascade from auth.users (service role).
```

`public.trg_profiles_guard()` (§3.18) blocks changes to `is_super_admin` and to `id`.

### 3.5 `public.staff`

RLS **enabled**, **not forced** — see §4.2.

```sql
alter table public.staff enable row level security;
alter table public.staff no force row level security;      -- deliberate, §4.2

-- Everyone can always see their own memberships (this is what the app bootstraps from).
create policy staff_select_self on public.staff
  for select to authenticated
  using ( user_id = (select auth.uid()) );

-- Owners and managers see the roster of the restaurants they manage.
create policy staff_select_manager on public.staff
  for select to authenticated
  using ( public.can_manage_staff(restaurant_id) );

create policy staff_insert_manager on public.staff
  for insert to authenticated
  with check ( public.can_manage_staff(restaurant_id) );

create policy staff_update_manager on public.staff
  for update to authenticated
  using      ( public.can_manage_staff(restaurant_id) )
  with check ( public.can_manage_staff(restaurant_id) );

create policy staff_delete_manager on public.staff
  for delete to authenticated
  using ( public.can_manage_staff(restaurant_id) );
```

`public.trg_staff_guard()` (§3.18) enforces the parts RLS cannot express: no privilege escalation,
no self-editing of your own role, no orphaning the last owner.

### 3.6 `public.tables`

```sql
alter table public.tables enable row level security;
alter table public.tables force  row level security;

create policy tables_select_staff on public.tables
  for select to authenticated
  using ( public.has_branch_access(branch_id) );

create policy tables_insert_manager on public.tables
  for insert to authenticated
  with check ( public.can_manage_tables(branch_id) );

create policy tables_update_manager on public.tables
  for update to authenticated
  using      ( public.can_manage_tables(branch_id) )
  with check ( public.can_manage_tables(branch_id) );

create policy tables_delete_manager on public.tables
  for delete to authenticated
  using ( public.can_manage_tables(branch_id) );
```

`public.trg_tables_guard()` (§3.18) rejects any direct write to `qr_token`, `last_order_at` or
`last_waiter_call_at` — those are owned by `admin_rotate_table_token()` and the public RPCs.

### 3.7 `public.qr_tokens`

```sql
alter table public.qr_tokens enable row level security;
alter table public.qr_tokens force  row level security;

-- Only people who can manage tables may see the raw tokens (they need them to print QR codes).
-- Waiters and kitchen staff have no business reading them.
create policy qr_tokens_select_manager on public.qr_tokens
  for select to authenticated
  using ( public.can_manage_tables(branch_id) );

-- No INSERT / UPDATE / DELETE policy anywhere.
-- Rotation and revocation happen only inside public.admin_rotate_table_token() (§4.7).
```

### 3.8 `public.menu_categories`

```sql
alter table public.menu_categories enable row level security;
alter table public.menu_categories force  row level security;

create policy menu_categories_select_staff on public.menu_categories
  for select to authenticated
  using ( public.has_restaurant_access(restaurant_id)
          and (branch_id is null or public.has_branch_access(branch_id)) );

create policy menu_categories_insert_manager on public.menu_categories
  for insert to authenticated
  with check ( public.can_manage_menu(restaurant_id)
               and (branch_id is null or public.has_branch_access(branch_id)) );

create policy menu_categories_update_manager on public.menu_categories
  for update to authenticated
  using      ( public.can_manage_menu(restaurant_id)
               and (branch_id is null or public.has_branch_access(branch_id)) )
  with check ( public.can_manage_menu(restaurant_id)
               and (branch_id is null or public.has_branch_access(branch_id)) );

create policy menu_categories_delete_manager on public.menu_categories
  for delete to authenticated
  using ( public.can_manage_menu(restaurant_id)
          and (branch_id is null or public.has_branch_access(branch_id)) );
```

### 3.9 `public.menu_items`

```sql
alter table public.menu_items enable row level security;
alter table public.menu_items force  row level security;

create policy menu_items_select_staff on public.menu_items
  for select to authenticated
  using ( public.has_branch_access(branch_id) );

create policy menu_items_insert_manager on public.menu_items
  for insert to authenticated
  with check ( public.can_manage_menu(restaurant_id) and public.has_branch_access(branch_id) );

-- Managers/owners edit everything. Kitchen staff of the same branch may also pass this policy,
-- but trg_menu_items_guard() restricts them to the is_available column ("86 this dish").
create policy menu_items_update_menu_or_kitchen on public.menu_items
  for update to authenticated
  using      ( (public.can_manage_menu(restaurant_id) and public.has_branch_access(branch_id))
               or public.auth_role_in_branch(branch_id) = 'kitchen' )
  with check ( (public.can_manage_menu(restaurant_id) and public.has_branch_access(branch_id))
               or public.auth_role_in_branch(branch_id) = 'kitchen' );

create policy menu_items_delete_manager on public.menu_items
  for delete to authenticated
  using ( public.can_manage_menu(restaurant_id) and public.has_branch_access(branch_id) );
```

### 3.10 `public.menu_item_options`

```sql
alter table public.menu_item_options enable row level security;
alter table public.menu_item_options force  row level security;

create policy menu_item_options_select_staff on public.menu_item_options
  for select to authenticated
  using ( public.has_branch_access(branch_id) );

create policy menu_item_options_insert_manager on public.menu_item_options
  for insert to authenticated
  with check ( public.can_manage_menu(restaurant_id) and public.has_branch_access(branch_id) );

create policy menu_item_options_update_manager on public.menu_item_options
  for update to authenticated
  using      ( public.can_manage_menu(restaurant_id) and public.has_branch_access(branch_id) )
  with check ( public.can_manage_menu(restaurant_id) and public.has_branch_access(branch_id) );

create policy menu_item_options_delete_manager on public.menu_item_options
  for delete to authenticated
  using ( public.can_manage_menu(restaurant_id) and public.has_branch_access(branch_id) );
```

### 3.11 `public.promotions`

```sql
alter table public.promotions enable row level security;
alter table public.promotions force  row level security;

create policy promotions_select_staff on public.promotions
  for select to authenticated
  using ( public.has_restaurant_access(restaurant_id)
          and (branch_id is null or public.has_branch_access(branch_id)) );

create policy promotions_insert_manager on public.promotions
  for insert to authenticated
  with check ( public.can_manage_menu(restaurant_id)
               and (branch_id is null or public.has_branch_access(branch_id)) );

create policy promotions_update_manager on public.promotions
  for update to authenticated
  using      ( public.can_manage_menu(restaurant_id)
               and (branch_id is null or public.has_branch_access(branch_id)) )
  with check ( public.can_manage_menu(restaurant_id)
               and (branch_id is null or public.has_branch_access(branch_id)) );

create policy promotions_delete_manager on public.promotions
  for delete to authenticated
  using ( public.can_manage_menu(restaurant_id)
          and (branch_id is null or public.has_branch_access(branch_id)) );
```

### 3.12 `public.orders`

Brief §34.7: *kitchen sees only relevant orders*. That is expressed as a policy, not a UI filter.

```sql
alter table public.orders enable row level security;
alter table public.orders force  row level security;

-- Owners, managers and waiters of the branch see the full order book.
create policy orders_select_front_of_house on public.orders
  for select to authenticated
  using ( public.can_manage_orders(branch_id) );

-- Kitchen staff see only cookable orders from the last 24h of their own branch.
create policy orders_select_kitchen on public.orders
  for select to authenticated
  using ( public.auth_role_in_branch(branch_id) = 'kitchen'
          and status in ('pending','confirmed','preparing','ready')
          and created_at > now() - interval '24 hours' );

-- NO INSERT POLICY. Orders are created only by public.public_place_order() and
-- public.staff_place_order() (both SECURITY DEFINER). This is what makes price
-- tampering structurally impossible (§1.3).

-- UPDATE is the status machine only; every column guard lives in trg_orders_guard().
create policy orders_update_staff on public.orders
  for update to authenticated
  using      ( public.can_manage_orders(branch_id)
               or public.auth_role_in_branch(branch_id) = 'kitchen' )
  with check ( public.can_manage_orders(branch_id)
               or public.auth_role_in_branch(branch_id) = 'kitchen' );

-- NO DELETE POLICY. Orders are never deleted; they are cancelled.
```

### 3.13 `public.order_items` and `public.order_item_options`

```sql
alter table public.order_items enable row level security;
alter table public.order_items force  row level security;

create policy order_items_select_staff on public.order_items
  for select to authenticated
  using ( public.can_manage_orders(branch_id)
          or public.auth_role_in_branch(branch_id) = 'kitchen' );

-- NO INSERT / UPDATE / DELETE POLICY. Written only by SECURITY DEFINER functions.
-- Snapshots (name_snapshot, price_snapshot) are therefore immutable by construction,
-- satisfying brief §34.4.

alter table public.order_item_options enable row level security;
alter table public.order_item_options force  row level security;

create policy order_item_options_select_staff on public.order_item_options
  for select to authenticated
  using ( public.can_manage_orders(branch_id)
          or public.auth_role_in_branch(branch_id) = 'kitchen' );

-- NO INSERT / UPDATE / DELETE POLICY.
```

### 3.14 `public.order_status_history`

```sql
alter table public.order_status_history enable row level security;
alter table public.order_status_history force  row level security;

create policy order_status_history_select_staff on public.order_status_history
  for select to authenticated
  using ( public.can_manage_orders(branch_id)
          or public.auth_role_in_branch(branch_id) = 'kitchen' );

-- NO INSERT / UPDATE / DELETE POLICY.
-- Rows are written exclusively by trg_orders_write_history() (SECURITY DEFINER) and by
-- public_place_order(). The audit trail cannot be edited or erased by any application role.
```

### 3.15 `public.waiter_calls`

```sql
alter table public.waiter_calls enable row level security;
alter table public.waiter_calls force  row level security;

create policy waiter_calls_select_staff on public.waiter_calls
  for select to authenticated
  using ( public.has_branch_access(branch_id) );

-- NO INSERT POLICY. Calls are created only by public.public_call_waiter().

-- Acknowledge / resolve. trg_waiter_calls_guard() constrains which columns and which
-- transitions are legal, and stamps acknowledged_by from auth.uid() rather than the payload.
create policy waiter_calls_update_service on public.waiter_calls
  for update to authenticated
  using      ( public.can_manage_orders(branch_id) )
  with check ( public.can_manage_orders(branch_id) );

-- NO DELETE POLICY.

create unique index if not exists waiter_calls_one_open_per_table_uk
  on public.waiter_calls (table_id) where status = 'open';

create index if not exists waiter_calls_branch_status_idx
  on public.waiter_calls (branch_id, status, created_at desc);
```

### 3.16 `public.notifications`

```sql
alter table public.notifications enable row level security;
alter table public.notifications force  row level security;

create policy notifications_select_addressee on public.notifications
  for select to authenticated
  using (
    public.has_branch_access(branch_id)
    and (target_user_id is null or target_user_id = (select auth.uid()))
    and (target_role    is null or target_role    = public.auth_role_in_branch(branch_id)
         or public.can_manage_orders(branch_id))
  );

-- Marking as read only. trg_notifications_guard() rejects any change other than read_at.
create policy notifications_update_addressee on public.notifications
  for update to authenticated
  using      ( public.has_branch_access(branch_id)
               and (target_user_id is null or target_user_id = (select auth.uid())) )
  with check ( public.has_branch_access(branch_id)
               and (target_user_id is null or target_user_id = (select auth.uid())) );

-- NO INSERT / DELETE POLICY. Written by triggers and definer functions; pruned by pg_cron.
```

### 3.17 Order state machine (DB-enforced, brief §26 and §34.8)

```sql
create or replace function public.order_transition_allowed(
  p_from  public.order_status,
  p_to    public.order_status,
  p_actor public.app_role
) returns boolean
language sql
immutable
security invoker
set search_path = ''
as $fn$
  select case
    -- terminal states are terminal for everybody
    when p_from in ('completed','cancelled') then false
    when p_from = p_to                       then false

    -- cancellation
    when p_to = 'cancelled' then
      case p_actor
        when 'super_admin' then p_from in ('pending','confirmed','preparing','ready','delivered')
        when 'owner'       then p_from in ('pending','confirmed','preparing','ready','delivered')
        when 'manager'     then p_from in ('pending','confirmed','preparing','ready')
        when 'waiter'      then p_from in ('pending','confirmed')
        else false                          -- kitchen may never cancel
      end

    -- forward path
    when p_from = 'pending'   and p_to = 'confirmed' then p_actor in ('super_admin','owner','manager','waiter','kitchen')
    when p_from = 'confirmed' and p_to = 'preparing' then p_actor in ('super_admin','owner','manager','kitchen')
    when p_from = 'preparing' and p_to = 'ready'     then p_actor in ('super_admin','owner','manager','kitchen')
    when p_from = 'ready'     and p_to = 'delivered' then p_actor in ('super_admin','owner','manager','waiter')
    when p_from = 'delivered' and p_to = 'completed' then p_actor in ('super_admin','owner','manager','waiter')
    else false
  end;
$fn$;

revoke all     on function public.order_transition_allowed(public.order_status, public.order_status, public.app_role) from public;
grant  execute on function public.order_transition_allowed(public.order_status, public.order_status, public.app_role) to authenticated;
```

The full legal graph, for reference:

```
pending ──▶ confirmed ──▶ preparing ──▶ ready ──▶ delivered ──▶ completed
   │            │             │            │           │
   └────────────┴─────────────┴────────────┴───────────┘──▶ cancelled
completed ──▶ (nothing)        cancelled ──▶ (nothing)
```

`completed -> preparing` and `cancelled -> ready` are rejected by `order_transition_allowed`,
exactly as brief §26 requires — and rejected in the database, so no client, no admin panel and no
future service can perform them.

### 3.18 The guard triggers (what RLS structurally cannot express)

RLS decides row visibility; it cannot say "you may change *this column* but not that one", and it
cannot compare old and new values. Those invariants live in `BEFORE` triggers.

```sql
-- ---------------------------------------------------------------- orders: columns + transitions
create or replace function public.trg_orders_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor public.app_role;
begin
  -- 1. Immutable columns (money, identity, capability, audit anchor).
  if new.id                  is distinct from old.id
     or new.restaurant_id    is distinct from old.restaurant_id
     or new.branch_id        is distinct from old.branch_id
     or new.table_id         is distinct from old.table_id
     or new.order_number     is distinct from old.order_number
     or new.public_token     is distinct from old.public_token
     or new.client_request_id is distinct from old.client_request_id
     or new.payload_fingerprint is distinct from old.payload_fingerprint
     or new.subtotal         is distinct from old.subtotal
     or new.service_fee      is distinct from old.service_fee
     or new.total            is distinct from old.total
     or new.created_at       is distinct from old.created_at
  then
    perform app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table','orders'));
  end if;

  -- 2. Status transitions.
  if new.status is distinct from old.status then
    v_actor := coalesce(public.auth_role_in_branch(old.branch_id), public.auth_role());
    if v_actor is null then
      perform app_private.raise_app_error('QR050_FORBIDDEN', 403,
        jsonb_build_object('reason','not_staff_of_branch'));
    end if;
    if not public.order_transition_allowed(old.status, new.status, v_actor) then
      perform app_private.raise_app_error('QR040_INVALID_STATUS_TRANSITION', 409,
        jsonb_build_object('from', old.status, 'to', new.status, 'actor', v_actor));
    end if;
    if new.status = 'cancelled'
       and nullif(btrim(coalesce(new.cancelled_reason,'')), '') is null then
      perform app_private.raise_app_error('QR042_CANCEL_REASON_REQUIRED', 422, '{}'::jsonb);
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

create trigger orders_guard
  before update on public.orders
  for each row execute function public.trg_orders_guard();

-- ---------------------------------------------------------------- orders: audit trail
create or replace function public.trg_orders_write_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (
      id, order_id, restaurant_id, branch_id, previous_status, new_status,
      changed_by, changed_by_kind, created_at)
    values (extensions.gen_random_uuid(), new.id, new.restaurant_id, new.branch_id,
            old.status, new.status, (select auth.uid()),
            case when (select auth.uid()) is null then 'system' else 'staff' end, now());

    perform realtime.send(
      jsonb_build_object('event','order.status_changed','status',new.status,
                         'order_number',new.order_number),
      'order.status_changed', 'order:' || new.public_token, true);

    perform realtime.send(
      jsonb_build_object('event','order.status_changed','status',new.status,
                         'order_number',new.order_number,'order_id',new.id),
      'order.status_changed', 'branch:' || new.branch_id::text, true);
  end if;
  return null;
end;
$fn$;

create trigger orders_write_history
  after update on public.orders
  for each row execute function public.trg_orders_write_history();

-- ---------------------------------------------------------------- menu_items: kitchen may only 86
create or replace function public.trg_menu_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.restaurant_id is distinct from old.restaurant_id
     or new.branch_id  is distinct from old.branch_id
     or new.id         is distinct from old.id then
    perform app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table','menu_items'));
  end if;

  if public.auth_role_in_branch(old.branch_id) = 'kitchen'
     and not public.can_manage_menu(old.restaurant_id) then
    -- Kitchen staff may toggle availability and nothing else.
    if to_jsonb(new) - 'is_available' - 'updated_at'
       is distinct from to_jsonb(old) - 'is_available' - 'updated_at' then
      perform app_private.raise_app_error('QR054_COLUMN_NOT_ALLOWED', 403,
        jsonb_build_object('allowed', jsonb_build_array('is_available')));
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

create trigger menu_items_guard
  before update on public.menu_items
  for each row execute function public.trg_menu_items_guard();

-- ---------------------------------------------------------------- staff: escalation + last owner
create or replace function public.trg_staff_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor_role  public.app_role;
  v_rank        constant public.app_role[] := array['owner','manager','waiter','kitchen']::public.app_role[];
  v_target_role public.app_role;
  v_restaurant  uuid;
begin
  -- NEW is unassigned on DELETE and OLD is unassigned on INSERT: never dereference blindly.
  if tg_op = 'DELETE' then
    v_target_role := old.role;
    v_restaurant  := old.restaurant_id;
  else
    v_target_role := new.role;
    v_restaurant  := new.restaurant_id;
  end if;

  if public.is_super_admin() then
    if tg_op = 'DELETE' then return old; end if;
    if tg_op = 'UPDATE' then new.updated_at := now(); end if;
    return new;
  end if;

  v_actor_role := public.auth_role_in_restaurant(v_restaurant);

  if v_actor_role is null or v_actor_role not in ('owner','manager') then
    perform app_private.raise_app_error('QR050_FORBIDDEN', 403,
      jsonb_build_object('reason','not_staff_manager'));
  end if;

  -- 1. Never grant a role at or above your own rank (a manager cannot mint owners or managers).
  if array_position(v_rank, v_target_role) < array_position(v_rank, v_actor_role)
     or (v_actor_role = 'manager' and v_target_role in ('owner','manager')) then
    perform app_private.raise_app_error('QR055_PRIVILEGE_ESCALATION', 403,
      jsonb_build_object('actor', v_actor_role, 'target', v_target_role));
  end if;

  -- 2. Nobody edits their own membership row.
  if tg_op in ('UPDATE','DELETE') and old.user_id = (select auth.uid()) then
    perform app_private.raise_app_error('QR056_SELF_MODIFICATION', 403, '{}'::jsonb);
  end if;

  -- 3. Tenancy of a membership row is immutable.
  if tg_op = 'UPDATE'
     and (new.user_id is distinct from old.user_id
          or new.restaurant_id is distinct from old.restaurant_id) then
    perform app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table','staff'));
  end if;

  -- 4. A restaurant must always retain at least one active owner.
  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner'
         and (new.role <> 'owner' or new.is_active = false)) then
    if (select count(*) from public.staff s
        where s.restaurant_id = old.restaurant_id
          and s.role = 'owner' and s.is_active and s.id <> old.id) = 0 then
      perform app_private.raise_app_error('QR051_LAST_OWNER', 409, '{}'::jsonb);
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$fn$;

create trigger staff_guard
  before insert or update or delete on public.staff
  for each row execute function public.trg_staff_guard();

-- ---------------------------------------------------------------- profiles: no self-promotion
create or replace function public.trg_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.id is distinct from old.id then
    perform app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table','profiles'));
  end if;

  if new.is_super_admin is distinct from old.is_super_admin then
    if not public.is_super_admin() or old.id = (select auth.uid()) then
      perform app_private.raise_app_error('QR052_FORBIDDEN_FIELD', 403,
        jsonb_build_object('field','is_super_admin'));
    end if;
  end if;

  if new.is_active is distinct from old.is_active
     and old.id = (select auth.uid()) and not public.is_super_admin() then
    perform app_private.raise_app_error('QR052_FORBIDDEN_FIELD', 403,
      jsonb_build_object('field','is_active'));
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.trg_profiles_guard();

-- ---------------------------------------------------------------- tables: token is not user data
create or replace function public.trg_tables_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.qr_token is distinct from old.qr_token
     or new.last_order_at is distinct from old.last_order_at
     or new.last_waiter_call_at is distinct from old.last_waiter_call_at
     or new.branch_id is distinct from old.branch_id
     or new.restaurant_id is distinct from old.restaurant_id then
    perform app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table','tables',
        'hint_fields', jsonb_build_array('qr_token','last_order_at','last_waiter_call_at',
                                         'branch_id','restaurant_id')));
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

create trigger tables_guard
  before update on public.tables
  for each row execute function public.trg_tables_guard();
-- NOTE: admin_rotate_table_token() and the public RPCs run as SECURITY DEFINER with
-- session_replication_role untouched, so they must set app_private.bypass_table_guard.
-- Implementation: those functions perform
--     set local app.guard_bypass = 'tables';
-- and this trigger short-circuits with
--     if current_setting('app.guard_bypass', true) = 'tables' then return new; end if;
-- as its first statement. `SET LOCAL` is transaction-scoped and unreachable by anon,
-- which cannot execute any function that sets it.

-- ---------------------------------------------------------------- waiter_calls: transitions
create or replace function public.trg_waiter_calls_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.id is distinct from old.id
     or new.restaurant_id is distinct from old.restaurant_id
     or new.branch_id     is distinct from old.branch_id
     or new.table_id      is distinct from old.table_id
     or new.reason        is distinct from old.reason
     or new.created_at    is distinct from old.created_at then
    perform app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table','waiter_calls'));
  end if;

  if new.status is distinct from old.status then
    if not (   (old.status = 'open'         and new.status in ('acknowledged','resolved','expired'))
            or (old.status = 'acknowledged' and new.status in ('resolved','expired'))) then
      perform app_private.raise_app_error('QR041_INVALID_CALL_TRANSITION', 409,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;

    if new.status = 'acknowledged' then
      new.acknowledged_by := (select auth.uid());   -- stamped, never taken from the payload
      new.acknowledged_at := now();
    elsif new.status = 'resolved' then
      new.resolved_at := now();
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

create trigger waiter_calls_guard
  before update on public.waiter_calls
  for each row execute function public.trg_waiter_calls_guard();

-- ---------------------------------------------------------------- notifications: read_at only
create or replace function public.trg_notifications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if to_jsonb(new) - 'read_at' is distinct from to_jsonb(old) - 'read_at' then
    perform app_private.raise_app_error('QR054_COLUMN_NOT_ALLOWED', 403,
      jsonb_build_object('allowed', jsonb_build_array('read_at')));
  end if;
  return new;
end;
$fn$;

create trigger notifications_guard
  before update on public.notifications
  for each row execute function public.trg_notifications_guard();
```

### 3.19 Policy coverage matrix

`S` = SELECT, `I` = INSERT, `U` = UPDATE, `D` = DELETE. `—` = no policy exists for that verb.

| Table | super_admin | owner | manager | waiter | kitchen | anon |
|---|---|---|---|---|---|---|
| `restaurants` | S I U D | S U | S | S | S | — |
| `branches` | S I U D | S I U D | S U (own branch) | S (own branch) | S (own branch) | — |
| `profiles` | S U | S (colleagues) U | S (colleagues) U | S (self) U (self) | S (self) U (self) | — |
| `staff` | S I U D | S I U D | S I U D (waiter/kitchen only) | S (self) | S (self) | — |
| `tables` | S I U D | S I U D | S I U D | S | S | — |
| `qr_tokens` | S | S | S | — | — | — |
| `menu_categories` | S I U D | S I U D | S I U D | S | S | — |
| `menu_items` | S I U D | S I U D | S I U D | S | S, U (`is_available` only) | — |
| `menu_item_options` | S I U D | S I U D | S I U D | S | S | — |
| `promotions` | S I U D | S I U D | S I U D | S | S | — |
| `orders` | S U | S U | S U | S U | S (cookable, 24h) U (kitchen transitions) | — |
| `order_items` | S | S | S | S | S | — |
| `order_item_options` | S | S | S | S | S | — |
| `order_status_history` | S | S | S | S | S | — |
| `waiter_calls` | S U | S U | S U | S U | S | — |
| `notifications` | S U | S U | S U | S U (addressed) | S U (addressed) | — |

Every `—` in the `anon` column is enforced twice: by the absence of a policy **and** by the
absence of a grant (§2.3).

---

## 4. The helper functions RLS depends on

### 4.1 Non-negotiable properties of every helper

| Property | Value | Why |
|---|---|---|
| Security | `SECURITY DEFINER`, owner `postgres` | must read `staff`/`profiles` regardless of the caller's own visibility |
| `search_path` | `set search_path = ''` | a `SECURITY DEFINER` function with a mutable `search_path` is a privilege-escalation primitive: the caller creates `public.staff` in a schema earlier on the path and the function reads *their* table. Empty path + fully-qualified identifiers eliminates it. `revoke create on schema public from public` (§2.3) closes the door a second time. |
| Volatility | `STABLE` | evaluated once per query as an InitPlan instead of once per row; `VOLATILE` here would turn every RLS check into a per-row function call and destroy plan quality on the KDS queries |
| Grants | `revoke all from public`, then `grant execute to authenticated` — **never `anon`** | `anon` has no rows to be scoped to; exposing these would leak roster shape |
| Parallel safety | `parallel safe` | permits parallel plans on analytics queries |

### 4.2 THE RECURSION TRAP — read this before writing a single policy

**The trap.** The natural policy on `public.staff` is *"you can see the staff of restaurants you
belong to"*, i.e. `restaurant_id = any(public.current_restaurant_ids())`. But
`current_restaurant_ids()` reads `public.staff`. PostgreSQL detects this and aborts the query with

```
ERROR:  infinite recursion detected in policy for relation "staff"   -- SQLSTATE 42P17
```

and the failure is not local: **every** policy anywhere that calls a staff-reading helper starts
failing, so the whole application returns 500s. This is the single most common way a Supabase
multi-tenant RLS design dies, and it usually surfaces only after the second table is added.

**Why `SECURITY DEFINER` alone does not fix it.** People assume a definer function bypasses RLS.
It does not. It changes `current_user` to the function owner, and the owner is exempt from RLS
**only when the table does not have `FORCE ROW LEVEL SECURITY`**. Turn `FORCE` on — which is
exactly what a hardened design wants — and the owner is subject to the policies again, the helper
re-enters `staff`'s policy, and the recursion returns. `SET row_security = off` inside the
function does not help either: a non-superuser is refused when a forced policy would apply.

**The resolution adopted here (normative).**

1. `public.staff` and `public.profiles` are `ENABLE ROW LEVEL SECURITY` but explicitly
   `NO FORCE ROW LEVEL SECURITY`. Every other staff-facing table is `FORCE`.
2. All helper functions are `SECURITY DEFINER` and owned by `postgres`, which owns those two
   tables. Inside a helper, `current_user = postgres` = table owner + not forced ⇒ RLS is skipped
   ⇒ the helper reads the complete `staff`/`profiles` rows ⇒ **no recursion, in one hop.**
3. The exemption is safe because `authenticated` is never the owner. Ordinary API traffic —
   PostgREST connecting as `authenticator` and `SET ROLE authenticated` — is fully policy
   controlled. The only sessions that gain owner exemption are `postgres` sessions, and §6.13
   forbids the application from ever connecting as `postgres`.
4. Compensating controls for the two exempted tables: `revoke delete on public.profiles from
   authenticated` (§3.1), `trg_profiles_guard()` and `trg_staff_guard()` (§3.18) — which run for
   *all* roles including the owner — and a CI assertion (§9.2) that exactly these two tables and
   no others report `relforcerowsecurity = false`.
5. **Policies on `staff` may only call helpers that read `staff` — never anything else, and no
   policy on `staff` may reference `staff` directly in a subquery.** Adding
   `EXISTS (SELECT 1 FROM public.staff …)` to a `staff` policy re-arms the trap even with the
   exemption in place, because that subquery is inside the policy on `staff` itself.

**Rejected alternative (documented so nobody "fixes" this later).** Keep `FORCE` on `staff` and
`profiles`, and have the helpers read a denormalised access index in `app_private` kept in sync by
triggers. It works and is marginally stricter, but it introduces a second copy of the
authorization state whose drift is silent and whose failure mode is *granting access that was
revoked*. A stale authorization cache is a worse security property than an owner-role exemption
that no application role can reach. If a future release ever needs `FORCE` on those two tables,
that is the design to adopt, together with a reconciliation job that alerts on divergence.

### 4.3 Identity and membership helpers

```sql
-- ------------------------------------------------------------------ is the caller a platform admin
create or replace function public.is_super_admin()
returns boolean
language sql
stable
parallel safe
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_super_admin
      and p.is_active);
$fn$;

-- ------------------------------------------------------------------ every restaurant the caller belongs to
create or replace function public.current_restaurant_ids()
returns uuid[]
language sql
stable
parallel safe
security definer
set search_path = ''
as $fn$
  select coalesce(array_agg(distinct s.restaurant_id), '{}'::uuid[])
  from public.staff s
  join public.profiles p on p.id = s.user_id
  where s.user_id = (select auth.uid())
    and s.is_active
    and p.is_active;
$fn$;

-- ------------------------------------------------------------------ every branch the caller may touch
-- A staff row with branch_id IS NULL (owner, restaurant-wide manager) expands to all branches
-- of that restaurant. Inactive branches are included: admins must still be able to manage them.
create or replace function public.current_branch_ids()
returns uuid[]
language sql
stable
parallel safe
security definer
set search_path = ''
as $fn$
  select coalesce(array_agg(distinct b.id), '{}'::uuid[])
  from public.staff s
  join public.profiles p on p.id = s.user_id
  join public.branches b
    on b.restaurant_id = s.restaurant_id
   and (s.branch_id is null or b.id = s.branch_id)
  where s.user_id = (select auth.uid())
    and s.is_active
    and p.is_active;
$fn$;

-- ------------------------------------------------------------------ caller's highest role overall
-- Rank order: super_admin > owner > manager > waiter > kitchen.
-- Used for coarse UI-independent branching and as the fallback actor in trg_orders_guard().
create or replace function public.auth_role()
returns public.app_role
language sql
stable
parallel safe
security definer
set search_path = ''
as $fn$
  select case
    when public.is_super_admin() then 'super_admin'::public.app_role
    else (
      select s.role
      from public.staff s
      join public.profiles p on p.id = s.user_id
      where s.user_id = (select auth.uid())
        and s.is_active
        and p.is_active
      order by array_position(
        array['owner','manager','waiter','kitchen']::public.app_role[], s.role)
      limit 1)
  end;
$fn$;

-- ------------------------------------------------------------------ caller's role inside one restaurant
create or replace function public.auth_role_in_restaurant(p_restaurant_id uuid)
returns public.app_role
language sql
stable
parallel safe
security definer
set search_path = ''
as $fn$
  select case
    when public.is_super_admin() then 'super_admin'::public.app_role
    else (
      select s.role
      from public.staff s
      join public.profiles p on p.id = s.user_id
      where s.user_id       = (select auth.uid())
        and s.restaurant_id = p_restaurant_id
        and s.is_active
        and p.is_active
      order by array_position(
        array['owner','manager','waiter','kitchen']::public.app_role[], s.role)
      limit 1)
  end;
$fn$;

-- ------------------------------------------------------------------ caller's role inside one branch
-- A restaurant-wide membership (branch_id IS NULL) counts for every branch of that restaurant.
create or replace function public.auth_role_in_branch(p_branch_id uuid)
returns public.app_role
language sql
stable
parallel safe
security definer
set search_path = ''
as $fn$
  select case
    when public.is_super_admin() then 'super_admin'::public.app_role
    else (
      select s.role
      from public.staff s
      join public.profiles p on p.id = s.user_id
      join public.branches b on b.restaurant_id = s.restaurant_id
      where s.user_id = (select auth.uid())
        and b.id      = p_branch_id
        and (s.branch_id is null or s.branch_id = b.id)
        and s.is_active
        and p.is_active
      order by array_position(
        array['owner','manager','waiter','kitchen']::public.app_role[], s.role)
      limit 1)
  end;
$fn$;

-- ------------------------------------------------------------------ do we share a restaurant?
create or replace function public.is_colleague(p_user_id uuid)
returns boolean
language sql
stable
parallel safe
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.staff s
    where s.user_id = p_user_id
      and s.restaurant_id = any (public.current_restaurant_ids()));
$fn$;
```

### 4.4 Access predicates

```sql
create or replace function public.has_restaurant_access(p_restaurant_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select public.is_super_admin()
      or (p_restaurant_id is not null
          and p_restaurant_id = any (public.current_restaurant_ids()));
$fn$;

create or replace function public.has_branch_access(p_branch_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select public.is_super_admin()
      or (p_branch_id is not null
          and p_branch_id = any (public.current_branch_ids()));
$fn$;
```

### 4.5 Capability predicates (the RBAC matrix, expressed once)

```sql
-- Menu, categories, options, promotions: owner + manager.
create or replace function public.can_manage_menu(p_restaurant_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select public.auth_role_in_restaurant(p_restaurant_id)
         in ('super_admin','owner','manager');
$fn$;

-- Tables and QR tokens: owner + manager, scoped to the branch.
create or replace function public.can_manage_tables(p_branch_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select public.auth_role_in_branch(p_branch_id) in ('super_admin','owner','manager');
$fn$;

-- Creating/deleting branches, and restaurant-wide branch edits: owner only.
create or replace function public.can_manage_branches(p_restaurant_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select public.auth_role_in_restaurant(p_restaurant_id) in ('super_admin','owner');
$fn$;

-- Editing one branch's own settings: owner, or the manager assigned to that branch.
create or replace function public.can_manage_branch(p_branch_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select public.auth_role_in_branch(p_branch_id) in ('super_admin','owner','manager');
$fn$;

-- Restaurant settings, currency, service fee, billing: owner only.
create or replace function public.can_manage_settings(p_restaurant_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select public.auth_role_in_restaurant(p_restaurant_id) in ('super_admin','owner');
$fn$;

-- Staff roster: owner + manager (the escalation limits live in trg_staff_guard()).
create or replace function public.can_manage_staff(p_restaurant_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select public.auth_role_in_restaurant(p_restaurant_id)
         in ('super_admin','owner','manager');
$fn$;

-- "May I edit this person's profile?" — true if we manage staff in ANY restaurant they belong to.
create or replace function public.can_manage_staff_of_user(p_user_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select exists (
    select 1
    from public.staff s
    where s.user_id = p_user_id
      and public.can_manage_staff(s.restaurant_id));
$fn$;

-- Front-of-house order book: owner + manager + waiter of the branch.
create or replace function public.can_manage_orders(p_branch_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select public.auth_role_in_branch(p_branch_id)
         in ('super_admin','owner','manager','waiter');
$fn$;

-- Anyone rostered on the branch, kitchen included.
create or replace function public.can_work_branch(p_branch_id uuid)
returns boolean
language sql stable parallel safe security definer set search_path = ''
as $fn$
  select public.auth_role_in_branch(p_branch_id)
         in ('super_admin','owner','manager','waiter','kitchen');
$fn$;
```

### 4.6 Grants for the helper set

```sql
do $grants$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'is_super_admin','current_restaurant_ids','current_branch_ids','auth_role',
        'auth_role_in_restaurant','auth_role_in_branch','is_colleague',
        'has_restaurant_access','has_branch_access','can_manage_menu','can_manage_tables',
        'can_manage_branches','can_manage_branch','can_manage_settings','can_manage_staff',
        'can_manage_staff_of_user','can_manage_orders','can_work_branch',
        'order_transition_allowed')
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated', fn.sig);
  end loop;
end
$grants$;
```

**None of these are granted to `anon`.** A public customer has no membership, so every one of them
would return `false`/`NULL` anyway; withholding `EXECUTE` keeps the roster shape out of the
unauthenticated OpenAPI document as well.

### 4.7 Staff-side `SECURITY DEFINER` operations

Three staff actions cannot be expressed as a policy-governed direct write, so they are RPCs.

```sql
-- ------------------------------------------------------------------ rotate a table's QR token
create or replace function public.admin_rotate_table_token(p_table_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_branch uuid;
  v_rest   uuid;
  v_token  text;
begin
  select t.branch_id, t.restaurant_id into v_branch, v_rest
  from public.tables t where t.id = p_table_id;

  if not found then
    perform app_private.raise_app_error('QR030_NOT_FOUND', 404,
      jsonb_build_object('entity','table'));
  end if;
  if not public.can_manage_tables(v_branch) then
    perform app_private.raise_app_error('QR050_FORBIDDEN', 403, '{}'::jsonb);
  end if;

  set local app.guard_bypass = 'tables';

  update public.qr_tokens
     set is_active = false, revoked_at = now()
   where table_id = p_table_id and is_active;

  v_token := app_private.generate_token(16);

  insert into public.qr_tokens (id, table_id, branch_id, restaurant_id, token, is_active, created_at)
  values (extensions.gen_random_uuid(), p_table_id, v_branch, v_rest, v_token, true, now());

  update public.tables set qr_token = v_token, updated_at = now() where id = p_table_id;

  insert into app_private.security_events (id, kind, actor_id, restaurant_id, branch_id, payload, created_at)
  values (extensions.gen_random_uuid(), 'qr_token.rotated', (select auth.uid()), v_rest, v_branch,
          jsonb_build_object('table_id', p_table_id), now());

  return jsonb_build_object('token', v_token, 'path', '/t/' || v_token);
end;
$fn$;

revoke all     on function public.admin_rotate_table_token(uuid) from public, anon;
grant  execute on function public.admin_rotate_table_token(uuid) to authenticated;
-- Raises: QR030_NOT_FOUND (404) · QR050_FORBIDDEN (403)

-- ------------------------------------------------------------------ staff-entered (phone/walk-in) order
-- Same pricing engine as the customer path; the ONLY other writer of orders.
create or replace function public.staff_place_order(
  p_table_id uuid,
  p_items    jsonb,
  p_note     text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_branch uuid;
  v_token  text;
begin
  select t.branch_id, qt.token into v_branch, v_token
  from public.tables t
  join public.qr_tokens qt on qt.table_id = t.id and qt.is_active
  where t.id = p_table_id;

  if not found then
    perform app_private.raise_app_error('QR030_NOT_FOUND', 404,
      jsonb_build_object('entity','table'));
  end if;
  if not public.can_manage_orders(v_branch) then
    perform app_private.raise_app_error('QR050_FORBIDDEN', 403, '{}'::jsonb);
  end if;

  -- Reuse the public engine verbatim: one pricing implementation, one place to audit.
  -- Rate limits still apply and are intentionally not bypassed.
  return public.public_place_order(v_token, p_items, p_note, extensions.gen_random_uuid());
end;
$fn$;

revoke all     on function public.staff_place_order(uuid, jsonb, text) from public, anon;
grant  execute on function public.staff_place_order(uuid, jsonb, text) to authenticated;
-- Raises: everything public_place_order raises, plus QR030_NOT_FOUND (404) · QR050_FORBIDDEN (403)

-- ------------------------------------------------------------------ void a line on an open order
create or replace function public.staff_void_order_item(p_order_item_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_oi     public.order_items%rowtype;
  v_status public.order_status;
  v_sub    bigint;
  v_fee    bigint;
  v_bps    integer;
  v_on     boolean;
begin
  select * into v_oi from public.order_items oi where oi.id = p_order_item_id;
  if not found then
    perform app_private.raise_app_error('QR030_NOT_FOUND', 404,
      jsonb_build_object('entity','order_item'));
  end if;
  if public.auth_role_in_branch(v_oi.branch_id) not in ('super_admin','owner','manager') then
    perform app_private.raise_app_error('QR050_FORBIDDEN', 403, '{}'::jsonb);
  end if;

  select o.status into v_status from public.orders o where o.id = v_oi.order_id for update;
  if v_status in ('completed','cancelled') then
    perform app_private.raise_app_error('QR043_ORDER_CLOSED', 409,
      jsonb_build_object('status', v_status));
  end if;

  delete from public.order_item_options where order_item_id = p_order_item_id;
  delete from public.order_items        where id            = p_order_item_id;

  select coalesce(sum(oi.total), 0) into v_sub
  from public.order_items oi where oi.order_id = v_oi.order_id;

  select b.service_fee_enabled, b.service_fee_bps into v_on, v_bps
  from public.branches b where b.id = v_oi.branch_id;

  v_fee := case when v_on and v_bps > 0 then (v_sub * v_bps + 5000) / 10000 else 0 end;

  set local app.guard_bypass = 'orders';
  update public.orders
     set subtotal = v_sub, service_fee = v_fee, total = v_sub + v_fee, updated_at = now()
   where id = v_oi.order_id;

  insert into app_private.security_events (id, kind, actor_id, restaurant_id, branch_id, payload, created_at)
  values (extensions.gen_random_uuid(), 'order_item.voided', (select auth.uid()),
          v_oi.restaurant_id, v_oi.branch_id,
          jsonb_build_object('order_id', v_oi.order_id, 'name', v_oi.name_snapshot,
                             'total', v_oi.total, 'reason', left(coalesce(p_reason,''), 200)),
          now());

  return jsonb_build_object('subtotal', v_sub, 'service_fee', v_fee, 'total', v_sub + v_fee);
end;
$fn$;

revoke all     on function public.staff_void_order_item(uuid, text) from public, anon;
grant  execute on function public.staff_void_order_item(uuid, text) to authenticated;
-- Raises: QR030_NOT_FOUND (404) · QR050_FORBIDDEN (403) · QR043_ORDER_CLOSED (409)
```

`trg_orders_guard()` and `trg_tables_guard()` both begin with:

```sql
  if current_setting('app.guard_bypass', true) = tg_table_name then
    new.updated_at := now();
    return new;
  end if;
```

`SET LOCAL` is transaction-scoped, and `anon` cannot execute any function that sets it, so the
bypass is reachable only from the three definer functions above.

### 4.8 Audit sink

```sql
create table if not exists app_private.security_events (
  id            uuid primary key,
  kind          text        not null,
  actor_id      uuid,
  restaurant_id uuid,
  branch_id     uuid,
  ip            inet,
  payload       jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists security_events_created_idx on app_private.security_events (created_at desc);
create index if not exists security_events_kind_idx    on app_private.security_events (kind, created_at desc);

alter table app_private.security_events enable row level security;
alter table app_private.security_events force  row level security;
-- No policies and no grants: readable only by service_role / postgres. Deliberate.
```

Recorded kinds: `qr_token.rotated`, `order_item.voided`, `staff.role_changed`,
`profile.super_admin_changed`, `auth.failed_resolve_burst`, `ratelimit.tripped`,
`policy.violation`.

---

## 5. Rate limiting

### 5.0 Design principle

The DB is authoritative; the app-side limiter is a cheap pre-filter. The DB limits are keyed on
**table** and **branch** — resources an attacker cannot rotate — so distributing a flood across IP
addresses, browsers or devices buys nothing. IP limiting exists only to stop the cheap noise before
it reaches Postgres.

Three mechanisms, used together:

| Mechanism | Purpose | Where |
|---|---|---|
| **Cooldown column** (`tables.last_order_at`, `tables.last_waiter_call_at`) | strict minimum interval between two accepted actions at a table, race-free via `SELECT … FOR UPDATE` | `public.tables` |
| **Fixed-window counter** (`app_private.rate_limits`) | hourly ceilings per table and per branch | `app_private` |
| **Uniqueness / idempotency** (`orders.client_request_id`, `waiter_calls_one_open_per_table_uk`, `orders.payload_fingerprint`) | makes retries and double taps free instead of harmful | `public` |

### 5.1 The counter store and the counting function

```sql
create table if not exists app_private.rate_limits (
  bucket       text        primary key,
  window_start timestamptz not null,
  hits         integer     not null,
  expires_at   timestamptz not null
);
create index if not exists rate_limits_expires_idx on app_private.rate_limits (expires_at);

alter table app_private.rate_limits enable row level security;
alter table app_private.rate_limits force  row level security;
-- No policies, no grants. Reachable only from SECURITY DEFINER functions.

create or replace function app_private.rate_limit_hit(
  p_bucket text,
  p_limit  integer,
  p_window interval
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now  timestamptz := clock_timestamp();
  v_hits integer;
begin
  insert into app_private.rate_limits as rl (bucket, window_start, hits, expires_at)
  values (p_bucket, v_now, 1, v_now + p_window)
  on conflict (bucket) do update
    set window_start = case when rl.expires_at <= v_now then v_now            else rl.window_start end,
        hits         = case when rl.expires_at <= v_now then 1                else rl.hits + 1     end,
        expires_at   = case when rl.expires_at <= v_now then v_now + p_window else rl.expires_at   end
  returning rl.hits into v_hits;

  if v_hits = p_limit + 1 then
    insert into app_private.security_events (id, kind, payload, created_at)
    values (extensions.gen_random_uuid(), 'ratelimit.tripped',
            jsonb_build_object('bucket', p_bucket, 'limit', p_limit), v_now);
  end if;

  return v_hits <= p_limit;
end;
$fn$;

revoke all on function app_private.rate_limit_hit(text, integer, interval)
  from public, anon, authenticated;

-- Housekeeping: the table is bounded by the number of live tables and branches, but expired
-- rows are pruned so it never becomes a scan hazard.
create or replace function app_private.rate_limits_gc()
returns integer
language sql
volatile
security definer
set search_path = ''
as $fn$
  with d as (delete from app_private.rate_limits where expires_at < now() - interval '1 hour'
             returning 1)
  select count(*)::int from d;
$fn$;

select cron.schedule('rate-limits-gc', '*/10 * * * *', $cron$ select app_private.rate_limits_gc(); $cron$);
```

`clock_timestamp()` is used rather than `now()` so that a long transaction cannot pin the window.
The window is **fixed**, not sliding: a burst can straddle a boundary and briefly exceed the
nominal rate by up to 2x. That is acceptable because the cooldown column, not the counter, is what
enforces the tight interval; the counter only enforces the hourly ceiling.

### 5.2 Order-spam design

| Control | Value | Error |
|---|---|---|
| Per-table minimum interval | **20 seconds** (`tables.last_order_at`, under `FOR UPDATE`) | `QR010_ORDER_RATE_LIMITED`, `details.scope = "table_cooldown"`, `details.retry_after_seconds` |
| Per-table hourly ceiling | **12 orders / hour** (`order:table:<uuid>`) | `QR010_ORDER_RATE_LIMITED`, `scope = "table_hourly"` |
| Per-branch hourly circuit breaker | **300 orders / hour** (`order:branch:<uuid>`) | `QR010_ORDER_RATE_LIMITED`, `scope = "branch_hourly"` |
| Identical-payload dedupe | same `(table_id, sha256(table_id‖items))` within **60 seconds** | `QR013_DUPLICATE_ORDER` |
| Idempotency | `orders.client_request_id` unique; a repeat returns the original order **200 OK**, not an error | — |
| Payload ceilings | ≤ 40 lines, qty 1..50 per line, ≤ 20 options per line, note ≤ 140, order note ≤ 280 | `QR023` / `QR024` |
| App-side IP limiter | **10 order submissions / IP / minute** | `QR010`, HTTP 429 |

Why 20 seconds and 12/hour: a real table places a first order, then typically 1–3 follow-ups
(drinks, dessert) over a 60–90 minute sitting. 12/hour is roughly 4x the busiest realistic
behaviour, so it never fires for a genuine diner and caps a compromised token at 12 fake tickets
per hour per table — an amount the KDS can absorb and a manager can cancel. 300/hour per branch is
about 5 orders/minute sustained, above any single venue's peak, and it stops a many-table token
dump from taking the kitchen offline.

Ordering of the checks inside `public_place_order` matters and is normative:
**resolve token → idempotency → payload shape → `FOR UPDATE` + cooldown → counters → dedupe →
write.** Cheap rejections happen before any lock is taken; the lock is taken before the counters so
that concurrent submits from one table cannot both pass the cooldown.

The `FOR UPDATE` on `public.tables` is the concurrency control. Without it, two simultaneous taps
both read `last_order_at`, both see it as stale, and both insert. With it, the second transaction
blocks until the first commits and then sees the fresh timestamp.

### 5.3 Waiter-call-spam design

| Control | Value | Error |
|---|---|---|
| Per-table cooldown | **90 seconds** (`tables.last_waiter_call_at`, under `FOR UPDATE`) | `QR011_WAITER_CALL_COOLDOWN`, `details.retry_after_seconds` |
| Per-table hourly ceiling | **5 calls / hour** (`call:table:<uuid>`) | `QR011_WAITER_CALL_COOLDOWN`, `scope = "table_hourly"` |
| One open call per table | partial unique index `waiter_calls_one_open_per_table_uk on (table_id) where status = 'open'` | `QR012_WAITER_CALL_ALREADY_OPEN` |
| Auto-expiry | open calls older than 30 minutes become `expired` | — |
| App-side IP limiter | **5 calls / IP / minute** | `QR011`, HTTP 429 |

90 seconds is the shortest interval at which a second call carries information — under that, the
waiter has not physically had time to reach the table, so the call is noise. The partial unique
index is the real defence: while a call is open, a further tap is a `23505` in the database, not a
check in JavaScript. The customer UI shows the existing call's state and a countdown built from
`cooldown_seconds` rather than pretending the button is available.

```sql
-- Auto-expire stale calls so the one-open-per-table lock can never wedge a table.
create or replace function app_private.expire_waiter_calls()
returns integer
language sql
volatile
security definer
set search_path = ''
as $fn$
  with u as (
    update public.waiter_calls
       set status = 'expired', updated_at = now()
     where status = 'open'
       and created_at < now() - interval '30 minutes'
     returning 1)
  select count(*)::int from u;
$fn$;

revoke all on function app_private.expire_waiter_calls() from public, anon, authenticated;

select cron.schedule('waiter-calls-expire', '*/5 * * * *',
                     $cron$ select app_private.expire_waiter_calls(); $cron$);
```

`expire_waiter_calls()` runs as `postgres`, so `trg_waiter_calls_guard()` sees
`auth.uid() IS NULL`; `open -> expired` is an allowed transition in that trigger.

### 5.4 The app-side limiter

`src/lib/security/rate-limit.ts`:

```ts
export type LimitKind = 'resolve' | 'menu' | 'order' | 'waiter-call' | 'order-read';

export interface LimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Fixed-window in-process limiter. Best effort: per serverless instance, not global. */
export function checkLimit(kind: LimitKind, key: string): LimitResult;

/** IP for the current request: first entry of x-forwarded-for, else x-real-ip, else '0.0.0.0'. */
export function clientIp(headers: Headers): string;
```

| Kind | Budget | Key |
|---|---|---|
| `resolve` | 30 / minute | `ip` |
| `menu` | 60 / minute | `ip` |
| `order` | 10 / minute | `ip + qrToken` |
| `waiter-call` | 5 / minute | `ip + qrToken` |
| `order-read` | 60 / minute | `ip` |

Implementation: a `Map<string, { windowStart: number; hits: number }>` with a 5,000-entry cap and
oldest-first eviction, held in module scope. On a 429 the handler returns
`{ code: 'QR010_ORDER_RATE_LIMITED', retryAfterSeconds }` and sets the `Retry-After` header.

**Its limits are honest about what they are.** Serverless instances do not share memory, so the
effective global budget is `budget x instances`. That is fine: this layer exists to shed obvious
noise cheaply. Every number that actually protects the business is in §5.2 and §5.3, enforced in
Postgres, where there is exactly one copy of the truth. Do not "optimise" by moving a limit out of
the database into this module.

### 5.5 Client-side behaviour (UX, not security)

- The PLACE ORDER button disables on submit and stays disabled until the RPC settles; a v4 UUID is
  generated once per cart and reused for every retry of that cart.
- On `QR010`/`QR011` the UI renders a countdown from `details.retry_after_seconds` instead of an
  error toast.
- On `QR013_DUPLICATE_ORDER` the UI navigates to the existing order's tracking page.
- None of this is a control. Every one of these behaviours is also enforced server-side.

---

## 6. The "never" rules

Each rule states the invariant, and the **database object** that makes violating it impossible.
"The UI prevents it" is never an acceptable answer to any row in this table.

| # | Never | Enforced by |
|---|---|---|
| 6.1 | **Never grant `anon` any table privilege.** | §2.3 `REVOKE ALL … FROM anon` + `ALTER DEFAULT PRIVILEGES … REVOKE`. CI query (a) in §2.3 must return zero rows or the build fails. |
| 6.2 | **Never let a price, subtotal, service fee or total arrive from a client.** | `orders` has **no INSERT policy** for any role; the only writers are `public_place_order` / `staff_place_order`, which read prices from `menu_items`/`menu_item_options`. `trg_orders_guard()` rejects any UPDATE that changes `subtotal`, `service_fee` or `total`. |
| 6.3 | **Never let a client choose `table_id`, `branch_id` or `restaurant_id`.** | Not parameters of any public function. Derived by `app_private.resolve_token()`. `trg_orders_guard()` and `trg_tables_guard()` make them immutable after insert. Composite FKs make an inconsistent pair a `23503`. |
| 6.4 | **Never write a status transition without validating it.** | `trg_orders_guard()` calls `public.order_transition_allowed(old, new, actor)` on every UPDATE, for every role including `service_role`-issued writes that go through SQL (the trigger is not role-conditional). `completed -> preparing` and `cancelled -> ready` return `false`. |
| 6.5 | **Never let a customer change an order's status.** | `anon` holds no privilege on `orders` (6.1) and no public RPC writes `status`. |
| 6.6 | **Never let staff of one branch act on another.** | `has_branch_access` / `auth_role_in_branch` in every branch-scoped policy's `USING` **and** `WITH CHECK`; `staff_branch_required_ck` forces waiter/kitchen rows to name a branch. |
| 6.7 | **Never let a tenant read another tenant's rows.** | `FORCE ROW LEVEL SECURITY` + `has_restaurant_access` on every SELECT policy; PostgREST embeds are filtered by the embedded table's own policy. |
| 6.8 | **Never mutate an `order_items` snapshot.** | `order_items` and `order_item_options` have **no INSERT/UPDATE/DELETE policy** and the verbs are revoked from `authenticated` outright. Corrections go through `staff_void_order_item()`, which deletes a line and re-derives totals rather than editing a snapshot. |
| 6.9 | **Never allow a `SECURITY DEFINER` function without a pinned `search_path`.** | Every function in this document sets `search_path = ''`. CI query (c) in §9.2 fails the build on any `prosecdef` function whose `proconfig` lacks `search_path=`. `REVOKE CREATE ON SCHEMA public FROM public` removes the shadowing primitive entirely. |
| 6.10 | **Never leave `EXECUTE` on a new function granted to `PUBLIC`.** | §2.3 revokes the default and rewrites `ALTER DEFAULT PRIVILEGES`. CI query (b) enumerates everything `anon` may execute and fails on anything outside the five public entry points. |
| 6.11 | **Never expose the service-role key to the browser.** | Env var has no `NEXT_PUBLIC_` prefix; single import site `src/lib/supabase/admin.ts` with `import 'server-only'`; ESLint `no-restricted-imports` blocks it from `src/components/**` and any `'use client'` file; CI runs `grep -rn "NEXT_PUBLIC_.*SERVICE_ROLE\|service_role" src/` and `grep -rn "SUPABASE_SERVICE_ROLE_KEY" src/app --include=*.tsx` and fails on a hit outside `src/lib/supabase/admin.ts`. |
| 6.12 | **Never use the service-role client for ordinary staff operations.** | Code review rule + `src/lib/supabase/admin.ts` exports `createAdminClient(reason: AdminReason)` where `AdminReason` is a closed union of `'qr-render' \| 'storage-signing' \| 'platform-admin' \| 'cron'`; any other call site fails type-check. |
| 6.13 | **Never connect the application as `postgres`.** | The app has exactly three clients (§2.7), none of which holds the direct-connection string. Migrations run as `postgres` only through the Supabase CLI in CI. This is the premise that makes the `NO FORCE` exemption of §4.2 safe. |
| 6.14 | **Never generate a token with `random()`, a sequence, a hash of an id, or a UUID that is exposed as a public path.** | `app_private.generate_token()` is the only approved source and uses `extensions.gen_random_bytes`; it is the DEFAULT-free explicit writer in `admin_rotate_table_token()` and `public_place_order()`. CI greps migrations for `random()` in any token context. |
| 6.15 | **Never let more than one QR token be active for a table.** | `qr_tokens_one_active_per_table_uk` (partial unique index). Rotation deactivates then inserts, in one transaction. |
| 6.16 | **Never delete an order or a status-history row.** | No DELETE policy on `orders` or `order_status_history`; `DELETE` revoked from `authenticated`. Orders are cancelled, never removed. |
| 6.17 | **Never let a user grant themselves a role.** | `trg_staff_guard()`: rank check, self-modification check, `restaurant_id`/`user_id` immutability. `trg_profiles_guard()`: `is_super_admin` may only be changed by a different super admin. |
| 6.18 | **Never leave a restaurant without an active owner.** | `trg_staff_guard()` raises `QR051_LAST_OWNER` on the delete/demote/deactivate of the last active owner. |
| 6.19 | **Never write an `UPDATE` policy without `WITH CHECK`.** | CI query (d) in §9.2 fails on any policy with `cmd = 'UPDATE'` and `with_check IS NULL`. |
| 6.20 | **Never enable a table without also writing its policies in the same migration.** | CI query (e): every table in `public` must have `relrowsecurity = true` **and** at least one row in `pg_policies`. A table with RLS on and zero policies is invisible to staff and is a silent outage, not a security win. |
| 6.21 | **Never disable RLS to debug.** | CI query (f): `relrowsecurity = false` for any table in `public` fails the build. Debug with `SET ROLE authenticated` + `request.jwt.claims`, not by turning policies off. |
| 6.22 | **Never return a raw Postgres error to a browser.** | `mapPgError()` passes through only errors carrying `hint = 'RESTAURANT_QR_OS'`; everything else is logged with its SQLSTATE server-side and returned as `QR999_INTERNAL` / 500. |
| 6.23 | **Never trust `p_items` structurally.** | `jsonb_typeof` checks, explicit key extraction (never iteration over the object's keys), length caps, and per-cast `EXCEPTION` handling, plus zod `.strict()` before the call. |
| 6.24 | **Never bypass the rate limiter for staff-entered orders.** | `staff_place_order()` delegates to `public_place_order()`, limits included. |
| 6.25 | **Never put a customer capability token in a cookie, a query string that gets logged, or a third-party request.** | Token lives in the URL path; `Referrer-Policy: no-referrer`; CSP on `/t/**` forbids third-party origins (§8.3); no analytics script on customer routes. |

---

## 7. Realtime authorization

Brief §28 forbids polling as the primary mechanism, so both audiences get push — with different
authorization stories.

### 7.1 Staff (`authenticated`)

Kitchen, waiter and admin panels subscribe with `postgres_changes` on the cookie-bound
`authenticated` client. Supabase Realtime evaluates the subscriber's RLS on every change before
emitting it, so §3's policies apply unchanged: a kitchen subscriber never receives an order from
another branch, and never receives a `completed` order (it fails `orders_select_kitchen`).

```sql
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.waiter_calls;
alter publication supabase_realtime add table public.notifications;
-- menu_items is added so a KDS reflects an availability toggle without a refetch.
alter publication supabase_realtime add table public.menu_items;
```

Client-side filters (`filter: 'branch_id=eq.<uuid>'`) are a bandwidth optimisation only. They are
**not** the security control; removing one changes nothing about what a subscriber may receive.

### 7.2 Customers (`anon`) — Broadcast from the database

`anon` cannot subscribe to `postgres_changes` because it has no `SELECT` on `orders`, which is
correct. Customer tracking uses **Broadcast from Database**: `public_place_order()` and
`trg_orders_write_history()` call `realtime.send(...)` on the topic
`order:<orders.public_token>`. The topic name *is* the capability — 144 bits of entropy — so
subscribing requires already holding the tracking URL.

Authorization for private topics is RLS on `realtime.messages`:

```sql
-- Definer helper: does this topic name correspond to a real, recent order?
-- anon cannot read public.orders, so the check must be made by a definer function.
create or replace function public.order_topic_is_valid(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.orders o
    where p_topic = 'order:' || o.public_token
      and o.created_at > now() - interval '24 hours');
$fn$;

revoke all     on function public.order_topic_is_valid(text) from public;
grant  execute on function public.order_topic_is_valid(text) to anon, authenticated;

alter table realtime.messages enable row level security;

create policy realtime_customer_order_read on realtime.messages
  for select to anon
  using ( realtime.topic() like 'order:%' and public.order_topic_is_valid(realtime.topic()) );

create policy realtime_staff_branch_read on realtime.messages
  for select to authenticated
  using (
    (realtime.topic() like 'branch:%'
     and public.has_branch_access(nullif(split_part(realtime.topic(), ':', 2), '')::uuid))
    or (realtime.topic() like 'order:%' and public.order_topic_is_valid(realtime.topic())));
```

There is **no INSERT policy on `realtime.messages` for `anon` or `authenticated`.** Clients may
listen; only the database publishes. That closes channel injection — a customer cannot broadcast a
fake `order.status_changed` to another diner's tracker, and a diner cannot inject a fake
`order.created` onto a branch channel.

Customer payloads carry `order_number`, `status`, `table_number` only — never ids, never totals of
other orders, never staff identity.

---

## 8. Adjacent surfaces

### 8.1 Supabase Auth configuration

| Setting | Value | Reason |
|---|---|---|
| Sign-ups | **disabled** (`enable_signup = false`) | staff accounts are never self-served. An owner/manager calls `POST /api/admin/staff/invite` (Node runtime), which uses `createAdminClient('platform-admin').auth.admin.inviteUserByEmail()` to create the `auth.users` row, then performs a **policy-governed** `INSERT` into `public.staff` with the caller's own cookie-bound client — so `staff_insert_manager` and `trg_staff_guard()` both apply and the service-role client never authors the membership row |
| Email confirmations | required | |
| JWT expiry | 3600 s; refresh rotation on, reuse interval 10 s | a revoked staff member loses access at the next refresh at the latest; membership itself is read live from `staff`, so `staff.is_active = false` takes effect on the **next query**, not the next token |
| Password policy | min 10 chars, leaked-password protection on | |
| MFA | TOTP enabled; **required** for `owner` and `super_admin` (enforced in `src/app/(admin)/layout.tsx` via `aal2` check and in `admin_*` RPCs via `auth.jwt() ->> 'aal'`) | |
| `auth.users` | never queried by the app; `public.profiles` is the projection | |

**Why membership is not in the JWT.** A custom access-token hook that stamps roles into claims
would make every RLS check a claim read instead of a query — faster, and tempting. It is rejected:
claims go stale for up to a full token lifetime, so firing a waiter or 86-ing a manager would not
take effect until their token refreshed. Reading `staff` live costs one InitPlan per query (the
helpers are `STABLE`) and revokes instantly. Revisit only with measured evidence of a problem, and
only together with a forced-refresh mechanism.

Profile bootstrap:

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, email, full_name, locale, is_super_admin, is_active,
                               created_at, updated_at)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
          coalesce(new.raw_user_meta_data ->> 'locale', 'uz'),
          false, true, now(), now())
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

`is_super_admin` is hard-coded `false` here: `raw_user_meta_data` is attacker-controlled at
sign-up and must never reach a privilege column.

### 8.2 Storage

Two buckets:

| Bucket | Public | Contents | Key layout |
|---|---|---|---|
| `menu-images` | yes (read) | dish, category and promotion photography | `<restaurant_id>/<branch_id>/<uuid>.webp` |
| `qr-codes` | **no** | rendered QR PNG/SVG | `<restaurant_id>/<branch_id>/<table_id>.png` |

```sql
-- menu-images: world-readable (customers are anonymous), writable only by menu managers.
create policy menu_images_read_all on storage.objects
  for select to anon, authenticated
  using ( bucket_id = 'menu-images' );

create policy menu_images_write_manager on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'menu-images'
               and public.can_manage_menu((storage.foldername(name))[1]::uuid) );

create policy menu_images_update_manager on storage.objects
  for update to authenticated
  using      ( bucket_id = 'menu-images'
               and public.can_manage_menu((storage.foldername(name))[1]::uuid) )
  with check ( bucket_id = 'menu-images'
               and public.can_manage_menu((storage.foldername(name))[1]::uuid) );

create policy menu_images_delete_manager on storage.objects
  for delete to authenticated
  using ( bucket_id = 'menu-images'
          and public.can_manage_menu((storage.foldername(name))[1]::uuid) );

-- qr-codes: never public. A QR image embeds a live capability token.
create policy qr_codes_read_manager on storage.objects
  for select to authenticated
  using ( bucket_id = 'qr-codes'
          and public.can_manage_tables((storage.foldername(name))[2]::uuid) );

create policy qr_codes_write_manager on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'qr-codes'
               and public.can_manage_tables((storage.foldername(name))[2]::uuid) );

create policy qr_codes_delete_manager on storage.objects
  for delete to authenticated
  using ( bucket_id = 'qr-codes'
          and public.can_manage_tables((storage.foldername(name))[2]::uuid) );
```

Download links for QR images are short-lived signed URLs (300 s), minted server-side. A QR PNG is
a bearer credential; it never lives at a guessable public URL.

Uploads are validated server-side before they reach Storage (`src/app/api/admin/media/route.ts`,
Node runtime): MIME must be `image/jpeg|png|webp`, size ≤ 5 MB, re-encoded to WebP, EXIF stripped,
filename replaced with a fresh UUID. The path's `restaurant_id` comes from the caller's membership,
never from the request body.

### 8.3 HTTP headers and CSP

`next.config.ts` sets, for all routes:

```
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Content-Security-Policy:
  default-src 'self';
  img-src 'self' data: blob: https://<project-ref>.supabase.co;
  connect-src 'self' https://<project-ref>.supabase.co wss://<project-ref>.supabase.co;
  script-src 'self' 'nonce-<per-request>';
  style-src 'self' 'nonce-<per-request>';
  font-src 'self';
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'self';
  object-src 'none'
```

No third-party origin is allowed anywhere, and specifically not on `/t/**`, because the URL path
of those routes contains capability tokens (§6.25).

`middleware.ts` refreshes the staff session via `@supabase/ssr` and gates `/admin`, `/kitchen`,
`/waiter` on the presence of a session. That gate is **UX only** — every one of those routes also
authorizes server-side, and the data behind them is protected by RLS regardless. Never add an
authorization decision that exists only in middleware.

---

## 9. Verification

### 9.1 pgTAP suite (`supabase/tests/`)

Minimum required cases; each must be red before the corresponding control is written.

| File | Asserts |
|---|---|
| `01_grants.sql` | `anon` holds zero table privileges; `anon` may execute exactly the five public functions; every `SECURITY DEFINER` function pins `search_path` |
| `02_rls_enabled.sql` | every table in `public` has `relrowsecurity`; only `profiles` and `staff` have `relforcerowsecurity = false`; every table has ≥1 policy; no `UPDATE` policy lacks `with_check` |
| `03_cross_tenant.sql` | as restaurant B's owner: SELECT/UPDATE/DELETE on every one of A's rows returns 0 rows; INSERT with A's `restaurant_id` fails |
| `04_branch_scope.sql` | waiter of branch A sees 0 of branch B's orders and cannot update them; kitchen sees no `completed`/`delivered`/`cancelled` orders |
| `05_recursion.sql` | `select public.current_restaurant_ids()` as `authenticated` does **not** raise `42P17`; `select * from public.staff` as a waiter returns exactly their own rows |
| `06_price_tampering.sql` | `public_place_order` with an injected `price` key produces a total equal to the DB price; `insert into public.orders` as `authenticated` is denied; `update public.orders set total = 1` raises `QR053` |
| `07_state_machine.sql` | all 49 (from, to) pairs x 5 actors against `order_transition_allowed`; `completed -> preparing` and `cancelled -> ready` are false for every actor |
| `08_rate_limits.sql` | second order within 20 s raises `QR010`; 13th within an hour raises `QR010`; second open waiter call raises `QR012`; repeat with the same `client_request_id` returns the same `order_number` |
| `09_tokens.sql` | revoked token raises `QR001` (identical to unknown); rotation leaves exactly one active token; `public_get_order` with a mismatched table token raises `QR030` |
| `10_escalation.sql` | manager creating an `owner` raises `QR055`; editing own `staff` row raises `QR056`; demoting the last owner raises `QR051`; setting own `is_super_admin` raises `QR052` |

### 9.2 CI gate queries (all must return zero rows)

```sql
-- (a) anon must hold no table privilege
select * from information_schema.role_table_grants where grantee = 'anon';

-- (b) anon may execute nothing but the five entry points
select n.nspname, p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where has_function_privilege('anon', p.oid, 'execute')
  and n.nspname in ('public','app_private')
  and p.proname not in ('public_resolve_table','public_get_menu','public_place_order',
                        'public_get_order','public_call_waiter','order_topic_is_valid');

-- (c) every SECURITY DEFINER function pins search_path
select n.nspname, p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname in ('public','app_private')
  and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%';

-- (d) no UPDATE policy without WITH CHECK
select schemaname, tablename, policyname
from pg_policies where schemaname = 'public' and cmd = 'UPDATE' and with_check is null;

-- (e) every public table has RLS on and at least one policy
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and (not c.relrowsecurity
       or not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname));

-- (f) FORCE is on everywhere except the two documented exemptions
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and not c.relforcerowsecurity
  and c.relname not in ('profiles','staff');
```

Plus two repository greps that must find nothing:

```bash
grep -rn "NEXT_PUBLIC_[A-Z_]*SERVICE" src/ && exit 1
grep -rln "SUPABASE_SERVICE_ROLE_KEY" src/ | grep -v '^src/lib/supabase/admin.ts$' && exit 1
```

### 9.3 Migration order (dependencies are real; do not reorder)

```
0001_privilege_baseline.sql       -- §2.3 (revokes; run before any table exists)
0002_extensions_and_schemas.sql   -- pgcrypto in extensions, pg_cron, app_private, enums
0003_core_tables.sql              -- restaurants … notifications, promotions, qr_tokens, composite FKs
0004_helpers.sql                  -- §4.3–4.6 (must precede any policy that calls them)
0005_rls_policies.sql             -- §3.2–3.16
0006_guard_triggers.sql           -- §3.17–3.18
0007_private_machinery.sql        -- §2.5, §4.8, §5.1, §5.3 (rate limits, security_events, cron)
0008_public_rpc.sql               -- §2.6 (the five functions) + §4.7 staff RPCs
0009_realtime_and_storage.sql     -- §7, §8.2
0010_privilege_baseline_reassert.sql -- §2.3 verbatim again + the five GRANTs
```

---

## 10. Appendix A — the complete error catalogue

`ERRCODE` is `PT<http>`; PostgREST returns that HTTP status. `MESSAGE` is the stable machine code
the TypeScript layer switches on. `HINT` is always `RESTAURANT_QR_OS`.

| MESSAGE (machine code) | HTTP | `DETAIL` fields | Raised by |
|---|---|---|---|
| `QR001_INVALID_QR_TOKEN` | 404 | — | `resolve_token` — malformed, unknown, or revoked (deliberately indistinguishable) |
| `QR002_TABLE_INACTIVE` | 423 | — | `resolve_token` |
| `QR003_BRANCH_INACTIVE` | 423 | — | `resolve_token` |
| `QR004_RESTAURANT_INACTIVE` | 423 | — | `resolve_token` |
| `QR010_ORDER_RATE_LIMITED` | 429 | `scope`, `retry_after_seconds` | `public_place_order` |
| `QR011_WAITER_CALL_COOLDOWN` | 429 | `scope`, `retry_after_seconds` | `public_call_waiter` |
| `QR012_WAITER_CALL_ALREADY_OPEN` | 409 | — | `public_call_waiter` |
| `QR013_DUPLICATE_ORDER` | 409 | `window_seconds` | `public_place_order` |
| `QR020_ITEM_UNAVAILABLE` | 409 | `menu_item_id` | `public_place_order` |
| `QR022_INVALID_OPTION` | 409 | `menu_item_id`, `option_id` | `public_place_order` |
| `QR023_INVALID_PAYLOAD` | 422 | `field`, `reason`, `max`/`allowed` | `public_place_order`, `public_call_waiter` |
| `QR024_QUANTITY_OUT_OF_RANGE` | 422 | `menu_item_id`, `min`, `max` | `public_place_order` |
| `QR030_ORDER_NOT_FOUND` | 404 | — | `public_get_order` (also wrong-table match) |
| `QR030_NOT_FOUND` | 404 | `entity` | `admin_rotate_table_token`, `staff_place_order`, `staff_void_order_item` |
| `QR032_ORDER_EXPIRED` | 410 | — | `public_get_order` (> 24 h) |
| `QR040_INVALID_STATUS_TRANSITION` | 409 | `from`, `to`, `actor` | `trg_orders_guard` |
| `QR041_INVALID_CALL_TRANSITION` | 409 | `from`, `to` | `trg_waiter_calls_guard` |
| `QR042_CANCEL_REASON_REQUIRED` | 422 | — | `trg_orders_guard` |
| `QR043_ORDER_CLOSED` | 409 | `status` | `staff_void_order_item` |
| `QR050_FORBIDDEN` | 403 | `reason` | guards and staff RPCs |
| `QR051_LAST_OWNER` | 409 | — | `trg_staff_guard` |
| `QR052_FORBIDDEN_FIELD` | 403 | `field` | `trg_profiles_guard` |
| `QR053_IMMUTABLE_COLUMN` | 403 | `table`, `hint_fields` | `trg_orders_guard`, `trg_tables_guard`, `trg_staff_guard`, `trg_profiles_guard`, `trg_waiter_calls_guard`, `trg_menu_items_guard` |
| `QR054_COLUMN_NOT_ALLOWED` | 403 | `allowed` | `trg_menu_items_guard`, `trg_notifications_guard` |
| `QR055_PRIVILEGE_ESCALATION` | 403 | `actor`, `target` | `trg_staff_guard` |
| `QR056_SELF_MODIFICATION` | 403 | — | `trg_staff_guard` |
| `QR999_INTERNAL` | 500 | — | synthesised by `mapPgError()` for any Postgres error lacking `hint = 'RESTAURANT_QR_OS'` |

`src/lib/security/errors.ts` exports `QrErrorCode` as a union of exactly these strings. Every code
must have a localised message in `messages/uz.json`, `messages/ru.json` and `messages/en.json`
under `errors.<code>`; a missing key fails the i18n completeness test.

## 11. Appendix B — what an implementer must never assume

- **Never assume a policy runs.** It runs only if RLS is enabled on that table. Check
  `pg_class.relrowsecurity`, not the migration file.
- **Never assume `USING` covers writes.** `USING` gates which rows you may *see* and *target*;
  `WITH CHECK` gates what the row may *become*. `UPDATE` needs both.
- **Never assume `SECURITY DEFINER` bypasses RLS.** It changes `current_user`; the bypass is the
  owner exemption, and `FORCE` removes it (§4.2).
- **Never assume `anon` is harmless because customers are anonymous.** `anon` is an
  internet-reachable database role. Its privilege list is the public attack surface.
- **Never assume PostgREST hides a table because it has no policies.** It hides it only if the
  role has no privilege on it. Policies control rows; grants control existence.
- **Never assume a filter in a `.select()` call is a security boundary.** Client filters are
  performance. RLS is security.
