# RESTAURANT QR OS — 06. The Real-Time System

**Status:** FINAL. Binding for `src/lib/realtime/**`, `src/hooks/use-realtime-*.ts`,
`src/hooks/use-order-status.ts`, `src/hooks/use-waiter-calls.ts`,
`src/hooks/use-optimistic-status.ts`, `src/components/providers/realtime-provider.tsx`,
`src/components/shared/connection-badge.tsx`, `src/lib/motion/kds-chime.ts` (transport half),
and migrations `0016_realtime_topics.sql` / `0017_realtime_authorization.sql`.

**Reads before this one:** `docs/BRIEF.md` §28, §9, §10, §34.12 ·
`01-database-schema.md` §6.13, §6.17, §6.18, §7.7, §9.1 ·
`02-security-and-rls.md` §2.4, §2.6, §3.12, §7 ·
`03-domain-and-types.md` §1 (the reconciliation table), §4 ·
`04-design-system.md` §7.3, §9.5, §9.6 ·
`05-app-structure.md` §2.5, §3.3.4, §6.4.

Brief §28 is one sentence with four clauses and one prohibition:

> New order → kitchen instantly. Kitchen status change → customer sees it. Ready → waiter notified.
> Customer calls waiter → waiter panel notified. **Do not use polling as the primary mechanism.**

This document is the complete design that satisfies all five, including the part that is genuinely
hard: the customer is `anon`, `anon` has no `SELECT` on `orders`, and Supabase Realtime's
`postgres_changes` refuses to emit a row a subscriber could not have selected.

---

## Table of contents

0. [Scope, vocabulary and binding amendments](#0)
1. [Channel topology](#1)
2. [The hard problem: live tracking for an unauthenticated diner](#2)
3. [Kitchen](#3)
4. [Waiter](#4)
5. [Reconnection and correctness](#5)
6. [The hooks — exact files and signatures](#6)
7. [Supabase-side enablement (SQL)](#7)
8. [Failure taxonomy, capacity and the test matrix](#8)
9. [Definition of done](#9)

---

<a id="0"></a>
## 0. Scope, vocabulary and binding amendments

### 0.1 Frozen decisions this document builds on

- Next.js 16.3 App Router · React 19.2 · TypeScript strict.
- `@supabase/ssr` 0.12 for cookie auth; `@supabase/supabase-js` v2 for Realtime.
- Public customer routes are unauthenticated (`anon`). The service-role key never reaches the browser
  and is **never** used for a Realtime subscription.
- `type Money = number` — integer minor units. No realtime payload in this document carries money.
- Locales `'uz' | 'ru' | 'en'`; no locale URL prefix. **No realtime payload carries rendered text.**
  Every payload carries codes and numbers; the client localises. A `ready` broadcast that shipped a
  Russian string would be wrong for the Uzbek diner at the next table.

### 0.2 Vocabulary (doc 03 §1 is authoritative; restated here because it is load-bearing)

| Concept | Identifier used everywhere in this document |
|---|---|
| Customer's order capability | `public.orders.public_code` — 12 chars, `^[A-Za-z0-9_-]{10,32}$`. **Not** `orders.id`, **not** doc 02's `public_token`. |
| Table capability | `public.tables.qr_token`. **Not** `tables.id`, and there is no `qr_tokens` table. |
| Waiter-call open states | `'pending'`, `'acknowledged'`. **Not** `'open'`. |
| Waiter-call reasons | `call_waiter, request_bill, request_water, request_cutlery, clean_table, complaint, other`. |
| Notification column | `notifications.type` (enum `notification_type`), values like `waiter_call_created`. **Not** `kind`, **not** `'waiter_call.created'`. |
| Staff roles | `SUPER_ADMIN, RESTAURANT_OWNER, MANAGER, WAITER, KITCHEN` (UPPER_SNAKE). |

Realtime **broadcast event names** are a separate namespace from `notification_type` and use dotted
lowercase (`order.status_changed`). They are defined once in §1.4 and never spelled inline.

### 0.3 Binding amendments this document makes

These override the referenced text. Every agent must implement the right-hand column.

| # | Superseded | Binding replacement | Why |
|---|---|---|---|
| **A-1** | Doc 05's `src/hooks/use-realtime-branch.ts` (one hook for all staff panels) | Split into `src/hooks/use-realtime-orders.ts` (`useRealtimeOrders`) and `src/hooks/use-waiter-calls.ts` (`useWaiterCalls`), both consuming the branch channel through `<RealtimeProvider>`. New primitive: `src/hooks/use-realtime-channel.ts`. | A KDS reducer and a waiter-call reducer share no state and no cadence. One hook returning both would force every KDS re-render on every waiter call. |
| **A-2** | Doc 05's `useRealtimeOrder(publicCode)` in `src/hooks/use-realtime-order.ts` | `useOrderStatus(publicOrderId, options)` in `src/hooks/use-order-status.ts`. | Matches the assignment contract and says what it returns. The file is renamed; doc 05's component wiring is otherwise unchanged. |
| **A-3** | Doc 02 §7.2's `public.order_topic_is_valid()` body referencing `o.public_token` | Rewritten in §7.3 below against `o.public_code`, plus a format pre-filter. | `orders.public_token` does not exist (doc 03 §1.1). |
| **A-4** | Doc 02 §7.2's `realtime_customer_order_read` / `realtime_staff_branch_read` policies | Replaced by the four policies in §7.4 (order, table, branch read; explicit no-write). | The originals miss the `table:` topic and do not deny `INSERT` explicitly. |
| **A-5** | Doc 02 §2.6 — the inline `perform realtime.send(...)` inside `public_call_waiter()` | **Delete it.** All broadcasts are emitted by triggers (§7.5, §7.6). | One publisher per event. A function-level send plus a trigger-level send is a duplicate delivery and a divergence waiting to happen. |
| **A-6** | Doc 01 §9.1 publication list (7 tables) | 5 tables: `orders`, `waiter_calls`, `notifications`, `menu_items`, `tables`. **`order_items` and `order_status_history` are removed.** | Justified in §7.2. No client can legally or usefully bind either one; publication membership costs WAL decoding on every write for nothing. |
| **A-7** | Doc 05 §6.4's `<KdsBoard>` binding `postgres_changes` on `order_items` | The KDS never binds `order_items`. Ticket contents are hydrated by fetch (§3.3). | `order_items` has no `branch_id` column, so no branch-scoped WAL filter exists, and its RLS policy needs a join to `orders` evaluated per row per subscriber. |
| **A-8** | `<ConnectionBadge>` is referenced by doc 05 §3.3.4/§6.4/§8.5 but defined nowhere | Defined in §6.8 of this document, at `src/components/shared/connection-badge.tsx`. | |
| **A-9** | Doc 02 §3.13 `order_items_select_staff` / `order_item_options_select_staff` using `branch_id` | Must be rewritten to reach `branch_id` through the parent `orders` row. | The column does not exist (doc 03 §1.1). Not a realtime concern once A-7 lands, but the policy is still wrong for the fetch path. |
| **A-10** | `src/lib/supabase/browser.ts` created with defaults | Must pass the exact `realtime` options in §6.2. | Default heartbeat and timeout are tuned for a chat app, not for a kitchen tablet that must notice a dead socket in seconds. |

### 0.4 The file inventory this document owns

```
src/lib/realtime/
├── channels.ts                 topic builders + event-name constants + branch-table constants
├── payloads.ts                 zod v4 schemas for every broadcast payload + inferred types
├── manager.ts                  RealtimeManager: ref-counted channel registry (StrictMode safety)
├── subscribe.ts                subscribeToOrder / subscribeToTable / subscribeToBranch
├── resync.ts                   ResyncController: generation counter, buffer, replay, backoff
└── poll.ts                     PollController: the documented fallback, jittered + visibility-aware

src/hooks/
├── use-realtime-channel.ts     useRealtimeChannel  — the primitive
├── use-realtime-orders.ts      useRealtimeOrders   — KDS
├── use-order-status.ts         useOrderStatus      — customer tracker
├── use-waiter-calls.ts         useWaiterCalls      — waiter console
├── use-optimistic-status.ts    useOptimisticStatus — intent map + reconciliation
└── use-connection-state.ts     useConnectionState  — derives badge state from a channel state

src/components/providers/realtime-provider.tsx    <RealtimeProvider> + useBranchRealtime()
src/components/shared/connection-badge.tsx        <ConnectionBadge>
src/components/kitchen/new-order-chime.tsx        <NewOrderChime> + <AudioUnlockBar>
src/lib/motion/kds-chime.ts                       unlock/throttle/play (doc 04 owns the waveform)

supabase/migrations/
├── 0016_realtime_topics.sql         publication, replica identity, broadcast triggers
└── 0017_realtime_authorization.sql  realtime.messages RLS + topic-validity functions
```

---

<a id="1"></a>
## 1. Channel topology

### 1.1 The complete channel set

There are exactly **three** topic families. Every one of them is built by
`src/lib/realtime/channels.ts` and nowhere else; a string literal `'order:'`, `'branch:'` or
`'table:'` anywhere else in the codebase is a review rejection.

| Topic | Audience | Postgres role | `private` | Transport carried | Capability that grants access |
|---|---|---|---|---|---|
| `order:{public_code}` | One diner tracking one order | **`anon`** (unauthenticated) | `true` | Broadcast only | Knowing `public_code` (72 bits) — the topic name *is* the capability |
| `table:{qr_token}` | The diners at one table | **`anon`** (unauthenticated) | `true` | Broadcast only | Knowing `qr_token` — already in the URL bar |
| `branch:{branch_id}` | Every staff panel scoped to one branch (KDS, waiter, admin dashboard) | **`authenticated`** | `true` | `postgres_changes` **and** broadcast | A cookie-bound session whose `staff` row grants access to that branch (`public.has_branch_access(branch_id)`) |

**Anon topics carry no internal identifier.** `order:` is keyed by `public_code` and `table:` by
`qr_token`, never by `orders.id` or `tables.id`, because brief §3 forbids exposing internal DB ids
on a public surface and a Realtime topic is exactly as public as a URL.

**The staff topic is keyed by `branch_id`, a UUID that only an authenticated staff member ever
learns.** Guessing it buys nothing: RLS on `realtime.messages` calls `has_branch_access()`, and
`postgres_changes` re-evaluates the table policies per row per subscriber.

### 1.2 Topics deliberately **not** created

| Rejected topic | Why not |
|---|---|
| `order:{order_id}:status` | Two faults. `order_id` is an internal identifier (brief §3). And a per-aspect suffix multiplies channels — one order would need `:status`, `:items`, `:cancelled`. **One topic per entity; the `event` name discriminates.** A channel is a connection-level object; an event is free. |
| `table:{table_id}` | Same identifier fault. The customer holds `qr_token`, not `tables.id`; handing the browser `table_id` so it can name a channel would leak the internal id purely to satisfy a naming habit. |
| `restaurant:{restaurant_id}` | No screen in this product is restaurant-wide-live. The admin dashboard is branch-scoped (`<BranchSwitcher>` picks one). A restaurant topic would deliver a 40-branch chain's whole order flow to one browser. |
| `staff:{staff_id}` | Personal notifications (`notifications.target_staff_id`) arrive on the branch channel and are filtered client-side; RLS already refuses rows addressed to somebody else. A per-person channel adds a second WebSocket per user for a feature with no second consumer. |
| A global `presence` channel | Presence is not in the brief and costs a channel join per client plus per-client state fan-out. Not built. |

### 1.3 One socket, one channel per branch

`<RealtimeProvider>` (mounted once in `src/app/(staff)/layout.tsx`, doc 05 §2.5) opens **exactly one**
`branch:{branch_id}` channel and multiplexes it to every consumer through an in-process bus. A KDS
with three columns, a late-order counter and a notification bell opens **one** WebSocket and **one**
channel join, not five.

This is not merely an optimisation. `supabase-js` requires every `.on()` binding to be registered
**before** `.subscribe()`; a binding added to an already-joined channel is not sent to the server and
silently never fires. Therefore the branch channel declares its **complete, fixed binding set**
up-front (§1.5) and consumers attach to the bus, never to the channel.

The customer topics have exactly one consumer each and are created directly by their hook.

### 1.4 Broadcast event names — the closed set

```ts
// src/lib/realtime/channels.ts
export const REALTIME_PROTOCOL_VERSION = 1 as const;

export const ORDER_EVENTS = {
  created:       'order.created',
  statusChanged: 'order.status_changed',
} as const;

export const BRANCH_EVENTS = {
  orderCreated:           'order.created',
  orderReady:             'order.ready',
  orderCancelled:         'order.cancelled',
  waiterCallCreated:      'waiter_call.created',
  waiterCallAcknowledged: 'waiter_call.acknowledged',
} as const;

export const TABLE_EVENTS = {
  waiterCallAcknowledged: 'waiter_call.acknowledged',
  waiterCallResolved:     'waiter_call.resolved',
} as const;

export type OrderEvent  = (typeof ORDER_EVENTS)[keyof typeof ORDER_EVENTS];
export type BranchEvent = (typeof BRANCH_EVENTS)[keyof typeof BRANCH_EVENTS];
export type TableEvent  = (typeof TABLE_EVENTS)[keyof typeof TABLE_EVENTS];
```

Every payload carries `v: 1` (`REALTIME_PROTOCOL_VERSION`). A client receiving `v !== 1` **ignores
the message and schedules a resync** rather than guessing — that is the forward-compatibility hinge
for any future payload change, and it costs one comparison.

### 1.5 The branch channel's fixed binding set

| Binding | Kind | Table / event | WAL filter | Consumer |
|---|---|---|---|---|
| B1 | `postgres_changes` | `INSERT` on `public.orders` | `branch_id=eq.{branchId}` | KDS list, waiter Active list, dashboard refresh |
| B2 | `postgres_changes` | `UPDATE` on `public.orders` | `branch_id=eq.{branchId}` | KDS lane moves, waiter Ready list, dashboard refresh |
| B3 | `postgres_changes` | `INSERT` on `public.waiter_calls` | `branch_id=eq.{branchId}` | Waiter Calls list |
| B4 | `postgres_changes` | `UPDATE` on `public.waiter_calls` | `branch_id=eq.{branchId}` | Waiter Calls list (ack/resolve by a colleague) |
| B5 | `postgres_changes` | `UPDATE` on `public.menu_items` | `branch_id=eq.{branchId}` | KDS 86-list chip; admin menu grid |
| B6 | `postgres_changes` | `INSERT` on `public.notifications` | `branch_id=eq.{branchId}` | Notification bell on all three staff panels |
| B7 | `broadcast` | `order.created` | — | Chime + assertive announcement (alert only) |
| B8 | `broadcast` | `order.ready` | — | Waiter alert + chime (alert only) |
| B9 | `broadcast` | `order.cancelled` | — | Toast on KDS and waiter (alert only) |
| B10 | `broadcast` | `waiter_call.created` | — | `<CallAlert>` "TABLE 12 IS CALLING" (alert only) |
| B11 | `broadcast` | `waiter_call.acknowledged` | — | Silence another device's alert (alert only) |

There is no `DELETE` binding anywhere. Orders are never deleted (they are cancelled), waiter calls are
never deleted (they are resolved/expired), and menu items are soft-deleted. A `DELETE` event arriving
on any binding is a data-integrity incident: the handler logs it and forces a full resync.

### 1.6 The two-lane rule — why the branch channel carries both transports

Mixing `postgres_changes` and `broadcast` on one topic is a deliberate split of responsibility, not
redundancy. The rule is absolute and both halves are testable:

> **`postgres_changes` is STATE. Every list on every staff panel is derived from `postgres_changes`
> plus resync, and from nothing else.**
>
> **`broadcast` is ALERT. A broadcast handler may play a sound, fire a toast, write to a live region
> or flash a badge. It must never insert, remove or reorder a row in any list.**

Why both exist:

1. **A broadcast can carry cross-table context a WAL row cannot.** `orders` has no `table_number`;
   it has `table_id`. "TABLE 12 IS CALLING" needs the number *now*, not after a round trip. The
   broadcast trigger joins `tables` once, server-side, and ships the number.
2. **`postgres_changes` is the throughput-constrained path.** Every published row is RLS-evaluated
   per subscriber by the Realtime server. Broadcast is not. Putting the latency-critical human alert
   on the cheap lane and the bookkeeping on the expensive one is the right way round.
3. **They fail independently.** If RLS evaluation degrades under load, the alert still fires and the
   next resync repairs the list. If broadcast is lost, the list is still correct and only the chime
   was missed.

Duplicate delivery is therefore harmless by construction: the two lanes drive disjoint state. Within
the alert lane, every handler is idempotent and de-duplicated on `alertKey` (`{event}:{entityId}`)
inside a 10 s window, so a re-delivery after a rejoin cannot double-chime.

---

<a id="2"></a>
## 2. The hard problem: live tracking for an unauthenticated diner

### 2.1 The constraint, stated exactly

Supabase Realtime's `postgres_changes` is RLS-aware. For each WAL change on a published table, the
Realtime server re-evaluates the subscribing connection's `SELECT` policies **as that connection's
role, using the claims in that connection's JWT**, and drops the change if the subscriber could not
have selected the row.

Doc 02 §2.3 sets the privilege baseline: `anon` holds **zero** table privileges in the `public`
schema. Not a narrow policy — no `SELECT` grant at all. Everything a diner reads comes from five
`SECURITY DEFINER` functions. Consequently:

> **A diner's browser cannot subscribe to `postgres_changes` on `orders`. The subscription would
> join successfully and then deliver nothing, forever, silently.** There is no error to catch. That
> silence is the trap this section exists to avoid.

The requirement it collides with is brief §28 clause 2 — *kitchen status change → customer sees it* —
and brief §33 P4/§8's "real-time updates without manual refresh", with polling explicitly excluded as
the primary mechanism.

### 2.2 The options, evaluated honestly

#### Option A — a narrowly scoped RLS `SELECT` policy on `orders`, keyed by a request-scoped setting

The idea: `create policy orders_select_public on public.orders for select to anon using (public_code = current_setting('app.public_code', true))`,
with the app setting `app.public_code` per request.

**It cannot work, for a structural reason, not a stylistic one.** The RLS evaluation for a Realtime
subscription does **not** happen in the diner's HTTP request. It happens later, inside the Realtime
server's own pooled database connection, when a WAL record arrives — possibly minutes after the
subscribe. The only per-subscriber input available at that moment is the JWT the client used to join
(surfaced as `auth.uid()` / `auth.jwt()`). There is no mechanism to attach an arbitrary
transaction-local GUC to a Realtime subscription, and `set_config(..., true)` in a route handler is
by design scoped to that transaction and gone before the first WAL record is decoded.

Rewriting the predicate to read the code from the JWT instead (`auth.jwt() ->> 'public_code'`) is a
real technique — but it *is* Option D, and it is evaluated there.

Even setting the mechanism aside, the policy is unacceptable on its own terms:

- It requires `grant select on public.orders to anon`, which re-opens `GET /rest/v1/orders` to the
  whole internet. PostgREST would then answer `?select=*` for the anon role; the RLS policy is the
  only thing standing between a script and the order book, and any future policy with an
  `or`-branch (a debug policy, a policy added for a new feature) silently widens it. Doc 02 §1.12 and
  §2.2 rejected exactly this trade, and one screen's convenience is not a reason to unpick the
  product's central security decision.
- The `orders` row contains `restaurant_id`, `branch_id`, `table_id`, `customer_session_id`,
  `customer_phone`, `service_fee_bps` and staff ids. A policy that filters *rows* still exposes every
  *column* of the matched row. Column-level grants could narrow it, at the cost of a second privilege
  surface to keep in sync forever.

**Verdict: rejected. Not implementable as described, and undesirable if it were.**

#### Option B — Broadcast from the database (`realtime.send()` in a trigger) + RLS on `realtime.messages`

The database publishes a purpose-built message onto a topic named after the capability the diner
already holds. `anon` keeps zero table privileges. Authorization is one RLS policy on
`realtime.messages`, checked by a `SECURITY DEFINER` helper that can see `orders` even though the
caller cannot.

- The payload is **designed**, not leaked: it contains what a tracking screen renders and nothing
  else. There is no column-exposure question because there are no columns.
- `realtime.send()` writes inside the same transaction as the status change, so a rolled-back
  transaction broadcasts nothing. There is no "told the diner, then rolled back" state.
- The topic is `order:{public_code}` — 72 bits of entropy the diner already possesses via the URL.
  Subscribing requires holding the tracking link, which is the same trust boundary as
  `public_get_order` (doc 02 §2.4).
- No `auth.users` row, no MAU, no account. Brief §11 holds.
- Cost: one trigger, one helper function, two policies. Latency: one WAL hop, the same order of
  magnitude as `postgres_changes` and with less per-subscriber work.

**Verdict: chosen.**

#### Option C — a short-lived Supabase anonymous session (`auth.signInAnonymously()`)

- Creates a real `auth.users` row **per diner per device**. A 40-table restaurant at three sittings a
  day manufactures ~120 permanent identity rows a day, ~44 000 a year, all of them garbage, all of
  them billable MAU on the Supabase plan.
- It contradicts brief §1 and §11 ("No app download. No customer account.") in substance, not just in
  wording: the diner would hold a refreshable credential.
- It still does not solve the problem by itself. An anonymous user is still not permitted to see the
  order — you would additionally need either Option A's `orders` grant or a custom claim binding that
  user to that order, which needs a service-role call **per order** to `auth.admin.updateUserById`.
  So the MAU cost buys a partial solution that then needs one of the other options anyway.
- It adds a token-refresh lifecycle to a screen a diner keeps open for forty minutes on a phone that
  sleeps, i.e. a new class of "expired session" failure on the most latency-sensitive customer screen.

**Verdict: rejected.** Doc 02 §2.4 rejected it for the tracking read path; the same reasoning applies
to the subscription, with the MAU argument stronger.

#### Option D — a self-signed JWT carrying a `public_code` claim, installed via `realtime.setAuth()`

Mint a short-lived JWT server-side (signed with the project JWT secret) containing
`{ role: 'anon', public_code: '…' }`, hand it to the browser, call
`supabase.realtime.setAuth(token)`, and write the RLS policy as
`public_code = (auth.jwt() ->> 'public_code')`.

This one genuinely works, which is why it is listed. It is still rejected:

- It requires the **project JWT secret** in a Node route handler. That secret signs *every* token in
  the project, including `service_role` ones. Doc 02 §1.11's containment story is "one secret, two
  call sites, both server-only"; this adds a second key of equal blast radius to a route reachable by
  every anonymous diner. A bug that echoes the minted token, or a signing helper that accepts a
  caller-supplied `role`, is a full project compromise.
- Rotating the JWT secret would invalidate every open tracking screen mid-meal.
- `setAuth()` is global to the Supabase client instance. A staff member who opened a tracking link on
  the same browser profile would have their `authenticated` socket re-authed to an `anon` token, and
  every staff channel would drop. Guarding that needs a second isolated client instance.
- It still requires `grant select on public.orders to anon` for the `postgres_changes` path, dragging
  Option A's PostgREST exposure along with it.
- Net: strictly more moving parts and strictly more risk than Option B, for the same user-visible
  result.

**Verdict: rejected.**

#### Option E — polling

Explicitly forbidden by brief §28 as a primary mechanism. It exists in this design **only** as the
degraded fallback specified in §5.6, and whenever it is active the UI says so via
`<ConnectionBadge state="polling">` (doc 05 §6.4). It is never silently substituted.

### 2.3 The decision

> **Customer live order tracking is implemented with Broadcast from Database on the private topic
> `order:{public_code}`, published by an `AFTER INSERT OR UPDATE OF status` trigger on
> `public.orders`, authorized by an RLS `SELECT` policy on `realtime.messages` whose predicate is a
> `SECURITY DEFINER` topic-validity check. `anon` keeps zero privileges on every table in the
> `public` schema. Polling `/api/public/order/[token]/[publicOrderId]` is the documented fallback and
> never the primary path.**

Two properties make this safe rather than merely convenient:

1. **The database is the only publisher.** There is no `INSERT` policy on `realtime.messages` for
   `anon` or `authenticated` (§7.4). A diner cannot broadcast a forged `order.status_changed` onto
   another diner's topic, and cannot inject a fake ticket onto a branch topic. Clients listen; the
   database speaks.
2. **The payload is a projection, not a row.** §2.4 fixes it exactly. Adding a field to it is a
   deliberate act reviewed against "would we print this on the diner's receipt?".

### 2.4 The customer payload — exact shape

```jsonc
{
  "v": 1,
  "event": "order.status_changed",     // or "order.created"
  "public_code": "Xr7Qa2mB9pLz",
  "order_number": "C-014",             // human-facing, already unique per branch/day
  "status": "preparing",               // public.order_status label
  "table_number": "12",                // string; the diner's own table
  "estimated_prep_minutes": 18,
  "due_at": "2026-09-01T12:41:00.000Z",       // null before 'confirmed'
  "cancellation_reason": null,         // non-null ONLY when status = 'cancelled'
  "at": "2026-09-01T12:23:04.517Z"     // clock_timestamp(), for display ordering only
}
```

What it deliberately does **not** contain, and why:

| Absent | Reason |
|---|---|
| `orders.id`, `restaurant_id`, `branch_id`, `table_id` | Brief §3: no internal ids on a public surface. |
| `subtotal`, `service_fee`, `total`, `service_fee_bps` | The authoritative money is server-rendered by `public_get_order` into `<OrderReceipt>` and cannot change after placement. Duplicating it into a push message creates a second source of truth for money — precisely what doc 03 §5 forbids. |
| Line items | Immutable after placement except by a staff void, which produces a full `orders` UPDATE the tracker handles by refetching (§5.4). |
| `customer_phone`, `customer_session_id`, staff ids, internal notes | Never leaves the server. |
| Any localised string | The diner's locale lives in a cookie; the client localises `status` and `cancellation_reason` is free text the staff member typed, shown verbatim. |
| A monotonic sequence number | Unnecessary — §2.6's merge rule is monotonic in `status` itself, which is a total order on the forward path plus one terminal escape. Fewer invariants to maintain. |

`status_index` is **not** in the payload. The client already owns the forward-path index in
`src/lib/orders/state-machine.ts` (doc 03 §6); shipping a second copy from SQL would create two
definitions of the same ordering that can disagree after a migration.

### 2.5 The trigger — complete SQL

Ships in `supabase/migrations/0016_realtime_topics.sql`.

```sql
-- ---------------------------------------------------------------------------
-- Customer + branch broadcast for every order creation and status change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.broadcast_order_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_event       text;
  v_table_no    text;
  v_table_name  text;
  v_item_count  integer;
  v_at          text := to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  -- Fire on creation, and on a real status change. Nothing else.
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  v_event := CASE WHEN TG_OP = 'INSERT' THEN 'order.created'
                  ELSE 'order.status_changed' END;

  SELECT t.number, t.name INTO v_table_no, v_table_name
  FROM public.tables t
  WHERE t.id = NEW.table_id;

  ---------------------------------------------------------------- customer lane
  PERFORM realtime.send(
    jsonb_build_object(
      'v',                      1,
      'event',                  v_event,
      'public_code',            NEW.public_code,
      'order_number',           NEW.order_number,
      'status',                 NEW.status::text,
      'table_number',           v_table_no,
      'estimated_prep_minutes', NEW.estimated_prep_minutes,
      'due_at',                 NEW.due_at,
      'cancellation_reason',    CASE WHEN NEW.status = 'cancelled'
                                     THEN NEW.cancellation_reason END,
      'at',                     v_at),
    v_event,
    'order:' || NEW.public_code,
    true);

  ---------------------------------------------------------------- staff alert lane
  -- Alerts only: order.created (chime the KDS), order.ready (light up the waiter),
  -- order.cancelled (toast both). Every other transition is carried by postgres_changes.
  IF TG_OP = 'INSERT' OR NEW.status IN ('ready', 'cancelled') THEN
    SELECT COALESCE(SUM(oi.quantity), 0) INTO v_item_count
    FROM public.order_items oi
    WHERE oi.order_id = NEW.id;

    PERFORM realtime.send(
      jsonb_build_object(
        'v',            1,
        'event',        CASE WHEN TG_OP = 'INSERT' THEN 'order.created'
                             WHEN NEW.status = 'ready' THEN 'order.ready'
                             ELSE 'order.cancelled' END,
        'order_id',     NEW.id,
        'order_number', NEW.order_number,
        'status',       NEW.status::text,
        'table_number', v_table_no,
        'table_name',   v_table_name,
        'item_count',   v_item_count,
        'is_late',      false,
        'at',           v_at),
      CASE WHEN TG_OP = 'INSERT' THEN 'order.created'
           WHEN NEW.status = 'ready' THEN 'order.ready'
           ELSE 'order.cancelled' END,
      'branch:' || NEW.branch_id::text,
      true);
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A broadcast is a notification, never a business fact. Losing one costs a chime;
  -- aborting the transaction costs the guest their order. The resync in doc 06 §5 is
  -- what makes swallowing this safe.
  RAISE WARNING 'realtime broadcast failed for order % (%): % [%]',
    NEW.id, NEW.public_code, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION app_private.broadcast_order_event() IS
  'Publishes order lifecycle events to order:<public_code> (anon customer, Broadcast from Database) and, for the three alert-worthy transitions, to branch:<branch_id> (staff). This is the ONLY publisher of those events - public_place_order() must NOT call realtime.send() itself (doc 06 amendment A-5). Runs inside the caller''s transaction, so a rollback publishes nothing. The EXCEPTION block is mandatory: realtime.send() writes to the partitioned table realtime.messages, and a missing partition or a Realtime schema migration must never abort an order.';

CREATE TRIGGER trg_orders_broadcast_event
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_order_event();
```

**On trigger ordering.** `trg_orders_broadcast_event` sorts before `trg_orders_log_status_change`
alphabetically, so it fires first. This is irrelevant to correctness: `realtime.send()` inserts into
`realtime.messages` inside the same transaction, so if any later trigger raises, the message insert
rolls back with everything else and nothing is ever delivered for a state that did not commit. The
ordering is documented here only so nobody "fixes" it later.

**On `EXCEPTION WHEN OTHERS`.** This is normally a smell. It is correct here and only here, for the
reason in the `COMMENT`: the alternative is that a Realtime-side schema issue takes down order
placement for a restaurant. The `RAISE WARNING` lands in the Postgres log, and §8.4 makes it an
alertable condition.

### 2.6 The client subscription — complete code

```ts
// src/lib/realtime/payloads.ts
import { z } from 'zod';
import { ORDER_STATUSES } from '@/types/database';

export const orderBroadcastSchema = z.object({
  v:                      z.literal(1),
  event:                  z.enum(['order.created', 'order.status_changed']),
  public_code:            z.string().min(10).max(32),
  order_number:           z.string().min(1).max(16),
  status:                 z.enum(ORDER_STATUSES),
  table_number:           z.string().nullable(),
  estimated_prep_minutes: z.number().int().positive(),
  due_at:                 z.string().datetime({ offset: true }).nullable(),
  cancellation_reason:    z.string().nullable(),
  at:                     z.string().datetime({ offset: true }),
});
export type OrderBroadcast = z.infer<typeof orderBroadcastSchema>;
```

```ts
// src/lib/realtime/subscribe.ts
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createBrowserClient } from '@/lib/supabase/browser';
import { orderTopic } from '@/lib/realtime/channels';
import { orderBroadcastSchema, type OrderBroadcast } from '@/lib/realtime/payloads';

export interface SubscribeHandlers<T> {
  onMessage: (payload: T) => void;
  /** Any transition into a joined state, INCLUDING the first. Always triggers a resync. */
  onLive: () => void;
  /** Left the joined state: CHANNEL_ERROR, TIMED_OUT or CLOSED. */
  onDown: (reason: 'error' | 'timeout' | 'closed') => void;
  /** A message that failed schema validation or carried an unknown protocol version. */
  onProtocolMismatch?: (raw: unknown) => void;
}

export function subscribeToOrder(
  publicCode: string,
  handlers: SubscribeHandlers<OrderBroadcast>,
): RealtimeChannel {
  const supabase = createBrowserClient();

  const channel = supabase
    .channel(orderTopic(publicCode), {
      config: { private: true, broadcast: { self: false, ack: false } },
    })
    // One handler for both event names; the payload's `event` discriminates.
    .on('broadcast', { event: 'order.created' },        (m) => dispatch(m.payload))
    .on('broadcast', { event: 'order.status_changed' }, (m) => dispatch(m.payload))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED')     handlers.onLive();
      else if (status === 'CHANNEL_ERROR') handlers.onDown('error');
      else if (status === 'TIMED_OUT')     handlers.onDown('timeout');
      else if (status === 'CLOSED')        handlers.onDown('closed');
    });

  function dispatch(raw: unknown): void {
    const parsed = orderBroadcastSchema.safeParse(raw);
    if (!parsed.success) { handlers.onProtocolMismatch?.(raw); return; }
    handlers.onMessage(parsed.data);
  }

  return channel;
}
```

**Every inbound payload is zod-parsed before it reaches state.** A broadcast is untrusted input in
exactly the sense doc 02 means: it arrives over the network into a client that cannot verify who
wrote it beyond "someone the RLS policy let publish". Today only the database can publish, and this
parse costs microseconds; it is the difference between a protocol change producing a typed rejection
and producing `undefined` rendered into the DOM.

### 2.7 The merge rule — monotonic, replay-safe, no sequence numbers

```ts
// src/hooks/use-order-status.ts (internal)
import { statusIndex, isTerminalStatus } from '@/lib/orders/state-machine';

/** Returns true when `incoming` is a strictly newer state than `current`. */
export function shouldApplyStatus(current: OrderStatus, incoming: OrderStatus): boolean {
  if (current === incoming) return false;
  if (isTerminalStatus(current)) return false;          // completed / cancelled are absorbing
  if (incoming === 'cancelled') return true;            // the one legal side-exit
  return statusIndex(incoming) > statusIndex(current);  // forward path only, never backwards
}
```

Consequences, all of them wanted:

- **Out-of-order delivery is harmless.** If `preparing` overtakes `confirmed`, the late `confirmed`
  is dropped and the tracker stays on `preparing`.
- **Replay after a reconnect is harmless.** Re-delivered messages are all `<=` current and are
  dropped, so the resync buffer (§5.3) can replay unconditionally.
- **The tracker never goes backwards.** A diner never sees "Ready" become "Preparing" — which, on the
  one screen where this product is telling the guest a story (doc 04 §7.4), would read as a bug in
  the restaurant, not in the software.
- **No sequence column, no clock skew dependency.** `at` is used only for the "updated 2 min ago"
  affordance and for the stale-connection watchdog, never for ordering.

The same reducer runs on a resync snapshot and on a broadcast, so the two paths cannot diverge.

### 2.8 What the tracker screen does with each status

| Status | Tracker | Extra cue |
|---|---|---|
| `pending` | Step 0 active, "Sent to the kitchen" | `<CancelOrderButton>` visible (doc 03 §1.4) |
| `confirmed` | Step 1, shows `due_at` as "Ready by ~12:41" | Cancel button removed |
| `preparing` | Step 2, breathing halo (doc 04 §7.4) | — |
| `ready` | Step 3, halo stops | `navigator.vibrate([40, 60, 40])` + one chime **if audio was unlocked by a prior tap in this document**; both best-effort, never required |
| `delivered` | Step 4 | — |
| `completed` | Step 5, tracker collapses to a receipt summary | Channel unsubscribed: terminal state, nothing more will arrive |
| `cancelled` | `statusIndex === -1` branch: the stepper is replaced by an explanation panel showing `cancellation_reason` verbatim | Channel unsubscribed |

On a terminal status the hook calls `release()` on its channel handle immediately. A finished order's
topic holds a WebSocket open for nothing, and a table of eight finished orders on one phone is eight
idle channels.

---

<a id="3"></a>
## 3. Kitchen

Brief §9: three columns NEW / PREPARING / READY, speed over decoration, real-time incoming orders
with a clear notification, late orders visually flagged.

Column → status mapping (doc 05 §2.5.1's board):

| Column | Statuses | Primary action |
|---|---|---|
| NEW | `pending`, `confirmed` | `acceptOrderAction` (`pending → confirmed`), then `startPreparingAction` |
| PREPARING | `preparing` | `markReadyAction` |
| READY | `ready` | (waiter takes over; the card ages out when it goes `delivered`) |

`KDS_STATUSES = ['pending','confirmed','preparing','ready'] as const` lives in
`src/lib/realtime/channels.ts` and is the exact set `orders_select_kitchen` (doc 02 §3.12) permits —
so the client filter and the RLS policy agree by construction rather than by coincidence.

### 3.1 The subscription

Bindings B1 and B2 from §1.5, declared by `<RealtimeProvider>`:

```ts
// inside src/components/providers/realtime-provider.tsx
channel
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` },
      (payload) => bus.emitPostgres('orders', payload))
  .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` },
      (payload) => bus.emitPostgres('orders', payload))
```

**The `filter` is a bandwidth control, not a security control.** It is applied by the Realtime server
before RLS. Deleting it would change nothing about what a subscriber may legally receive — doc 02
§3.12's `orders_select_kitchen` decides that, and it also strips `completed` and `delivered` orders
and anything older than 24 h. This is stated in doc 02 §7.1 and repeated here because it is the single
most common misreading of Supabase Realtime.

Two consequences the KDS must handle, which follow directly from RLS being the real filter:

- **A `KITCHEN` subscriber never receives the `ready → delivered` UPDATE.** The new row fails
  `orders_select_kitchen` (`delivered` is not in the permitted set), so Realtime drops it. The card
  would sit in READY forever. **Resolution:** the KDS treats "no event for a `ready` ticket for
  `KDS_READY_TTL_MS = 15 * 60_000`" as a signal to run a targeted refetch of that ticket, and every
  scheduled resync (§5.2) reconciles the whole board anyway. A `MANAGER`/`RESTAURANT_OWNER` viewing
  the same KDS *does* receive it (`orders_select_front_of_house`) and the card leaves immediately —
  the two roles legitimately see slightly different boards, and the resync makes both correct.
- **`REPLICA IDENTITY FULL` is required** (§7.1) or the `UPDATE` payload's `old` record carries only
  the primary key, and the KDS cannot tell which lane a ticket left.

### 3.2 The event → state reducer

```ts
type OrdersEvent = RealtimePostgresChangesPayload<OrderRow>;
```

| Event | `new.status` | Action |
|---|---|---|
| `INSERT` | any in `KDS_STATUSES` | Enqueue `new.id` for hydration (§3.3). Mark `isNew` for 4 s. Fire the alert path (§3.5) — *from the broadcast lane, not from here*. |
| `INSERT` | not in `KDS_STATUSES` | Ignore. Cannot happen today (orders are born `pending`) but the branch exists so a future `channel='admin'` pre-confirmed order does not corrupt the board. |
| `UPDATE` | status changed, new status in `KDS_STATUSES` | Move the ticket between lanes in place. No refetch: nothing in `KitchenTicket` other than `status` and its timestamps changed. |
| `UPDATE` | status changed, new status **not** in `KDS_STATUSES` | Remove the ticket from the board. |
| `UPDATE` | status **unchanged** but `updated_at` advanced | **Targeted refetch of that one ticket.** This is how a voided line (`voidOrderLineAction` → `staff_void_order_item` → totals recomputed → `orders` UPDATE) reaches the KDS without an `order_items` subscription. |
| `DELETE` | — | Log an integrity warning, force a full resync. Orders are never deleted. |
| any | ticket id not currently on the board | Treat as an insert: enqueue for hydration. Covers the case where a `pending` order the KDS missed becomes `preparing`. |

The reducer is a pure function over `(state, event) → state` in `use-realtime-orders.ts`, exported for
unit testing, and is **idempotent**: applying the same event twice is a no-op. That is what makes the
resync replay in §5.3 safe.

### 3.3 How a newly inserted order's items are loaded

The `orders` INSERT event carries an `OrderRow` and nothing else. A `KitchenTicket` (doc 03 §4) needs
`lines: KitchenTicketLine[]`, `itemCount`, `tableNumber`, `tableName` — none of which are on that row.

**The KDS never assembles a ticket from `order_items` events.** Three independent reasons, any one of
which is sufficient:

1. **No branch-scoped filter is possible.** `public.order_items` has no `branch_id` column (doc 03
   §1.1). The best available WAL filter is `restaurant_id=eq.…`, so a 12-branch chain would push every
   branch's item rows at every kitchen tablet for the Realtime server to RLS-check and discard.
2. **Its RLS policy needs a join.** `order_items_select_staff` must reach `branch_id` through the
   parent `orders` row (amendment A-9). Realtime would run that join **per row, per subscriber**, on
   the hottest insert path in the product.
3. **There is no atomicity across events.** An eight-line order arrives as one `orders` INSERT plus
   eight `order_items` INSERTs with no ordering or completeness guarantee. The KDS would paint a
   ticket with three lines and then grow it — and a cook who starts on a partial ticket is a real
   operational failure, not a cosmetic one.

**The mechanism instead — coalesced hydration:**

```ts
// REQUIRED ADDITION to doc 05 §5.2 (kitchen actions), file src/lib/actions/kitchen.ts
'use server';
/**
 * Hydrate specific tickets. Cookie client; RLS decides visibility; ids the caller may not
 * see are simply absent from the result (never an error — that is an oracle).
 * `orderIds`: 1..40 uuids.
 */
export async function loadKitchenTicketsAction(
  input: unknown,   // → { branch_id: string; order_ids: string[] }
): Promise<Result<KitchenTicket[]>>;

/** Full-board snapshot for resync. Same statuses as KDS_STATUSES, newest last. */
export async function loadKitchenBoardAction(
  input: unknown,   // → { branch_id: string }
): Promise<Result<{ tickets: KitchenTicket[]; generatedAt: string }>>;
```

Hydration queue algorithm, in `use-realtime-orders.ts`:

1. An INSERT (or an unknown-id UPDATE) pushes `new.id` into `pendingHydrationRef: Set<string>`.
2. A **120 ms** coalescing timer starts if not already running. A burst of five orders at a lunch rush
   becomes **one** round trip, not five.
3. On fire: snapshot and clear the set, call `loadKitchenTicketsAction({ branch_id, order_ids })`.
4. Results are merged by `orderId`. An id that comes back absent is dropped from the board — it means
   RLS says this subscriber may not see it (e.g. it was cancelled between the event and the fetch).
5. **The card is rendered immediately, before hydration returns**, as a skeleton ticket built from the
   `OrderRow` alone: order number, table number resolved from the alert broadcast when present,
   elapsed timer running, `<TicketLinesSkeleton />` in place of the lines. The chime and the flash
   fire at event time, not at hydration time. A cook must know a ticket landed within ~200 ms; the
   lines can arrive 150 ms later.
6. In-flight de-duplication: an id already being fetched is not re-queued. A failed batch retries once
   after 1 s, then marks those ids `hydrationFailed` — the card renders `<TicketLinesError>` with a
   Retry button rather than an empty card that looks like an order with no food in it.

`estimatedPrepMinutes`, `isLate`, `lateBySeconds` and `ageSeconds` are recomputed client-side on the
1 s tick from `use-elapsed.ts` against `placedAt` and the branch threshold — never pushed.

### 3.4 Optimistic status updates and reconciliation

The KDS's primary buttons must feel instant on a tablet over restaurant Wi-Fi. The mechanism is an
**intent map**, not React 19's `useOptimistic`.

*Why not `useOptimistic`.* `useOptimistic` layers a temporary value over a prop that a transition will
replace, and it discards the optimistic value when the transition settles. The KDS board is
long-lived client state fed by a socket, not a server prop re-rendered per action, and the settling
signal arrives asynchronously on a **different channel** than the action's promise. `useOptimistic`
would clear the overlay when the action resolves — which is *before* the realtime echo — producing a
visible flicker back to the old lane. The intent map holds until the echo or a timeout.

```ts
// src/hooks/use-optimistic-status.ts
export interface StatusIntent {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  /** performance.now() at button press. */
  startedAt: number;
}

export interface UseOptimisticStatusResult {
  /** Overlay: orderId → optimistic status. Read by the board when projecting lanes. */
  overlay: ReadonlyMap<string, OrderStatus>;
  /** Cards with an open intent render disabled actions + a spinner. */
  pendingIds: ReadonlySet<string>;
  begin: (intent: StatusIntent) => void;
  /** Called from the realtime reducer with the authoritative server status. */
  reconcile: (orderId: string, serverStatus: OrderStatus) => void;
  /** Called when the server action rejects. Returns the status to restore. */
  fail: (orderId: string, serverStatus: OrderStatus | null) => OrderStatus | null;
}

export function useOptimisticStatus(opts: {
  /** Fired when an intent gets no echo within `timeoutMs`. */
  onStale: (orderId: string) => void;
  /** Default 10_000. */
  timeoutMs?: number;
}): UseOptimisticStatusResult;
```

The complete lifecycle of one tap:

1. **Press.** `begin({ orderId, from, to, startedAt: performance.now() })`. The card moves lanes
   immediately with the doc 04 §7.1 transition; its buttons disable; `orderId` joins `pendingIds`.
2. **Server.** `acceptOrderAction` / `startPreparingAction` / `markReadyAction` (doc 05 §5.2). Inside
   `order-service.ts` the write is a **compare-and-swap**:
   `.update({ status: to }).eq('id', orderId).eq('status', from).select().single()`.
   Zero rows updated means somebody else moved it first. That check is what stops two cooks on two
   tablets fighting over one ticket, and it exists in addition to `trg_orders_status_guard` — RLS and
   the guard trigger reject *illegal* transitions, the CAS rejects *stale* ones.
3. **Success.** The action returns the fresh `OrderView`. `reconcile(orderId, view.status)` runs
   immediately; the overlay entry is dropped only if the server agrees. The realtime echo arrives a
   moment later and is a no-op because the reducer is idempotent.
4. **Conflict** (`CONFLICT` / `QR040_INVALID_STATUS_TRANSITION`). The error's `details` carry the
   current server status. `fail(orderId, serverStatus)` restores it, the card animates back, and a
   `warning` toast fires keyed `order.status_conflict` with the order number and the actual status.
   A targeted refetch of that ticket follows so nothing else on the card is stale.
5. **Network error.** `fail(orderId, null)` restores `from`; toast `errors.network`; the card is
   re-enabled so the cook can retry. **The intent is never retried automatically** — an automatic
   retry of a state transition after an ambiguous failure can double-advance an order.
6. **Echo before the promise.** Common on a fast LAN. `reconcile` is called from the realtime reducer
   too: if `serverStatus === intent.to`, the intent is closed as confirmed; if it differs, **the
   server wins unconditionally**, the overlay is dropped, and the toast fires. There is no branch in
   which the client's optimism outranks a value that came from the database.
7. **Silence.** A `timeoutMs` (10 s) watchdog per intent calls `onStale(orderId)`, which drops the
   overlay and issues a targeted refetch. An optimistic value is never allowed to become permanent
   client truth.

Lane projection is always `overlay.get(id) ?? ticket.status`, computed in a `useMemo` — the board
never stores the optimistic status inside the ticket object, so a resync that replaces the ticket list
wholesale cannot accidentally persist an unconfirmed guess.

### 3.5 The new-order notification: audio and visual

Doc 04 §7.3 owns the waveform, the timings and the reduced-motion behaviour. This section owns the
transport, the trigger condition and the browser-policy handling.

**Trigger.** The alert fires from the **broadcast lane** (`order.created` on `branch:{branchId}`,
binding B7), not from the `postgres_changes` INSERT. Reason: the broadcast carries `table_number`,
`order_number` and `item_count`, so the announcement and the toast can be complete at the instant of
arrival, and the two lanes are independently observable in tests. If the broadcast is lost and only
the `postgres_changes` INSERT arrives, the visual path (card entrance, edge bar, `isNew` ring) still
runs from the reducer — **the visual notification never depends on broadcast**, only the sound and the
spoken announcement do.

**De-duplication.** `alertKey = 'order.created:' + order_id`, held in a `Map<string, number>` with a
10 s TTL. A re-delivery after a rejoin cannot double-chime.

**Throttle.** At most one chime per **800 ms** (doc 04 §7.3). Five tickets landing together produce one
ping and five cards.

**Browser autoplay policy — the actual problem and the actual handling.**

Every current browser blocks audio until the document has received a real user gesture. An
`AudioContext` constructed before that gesture is created in state `'suspended'`, and
`ctx.resume()` outside a gesture handler rejects. There is no permission API for this and no way to
ask.

```ts
// src/lib/motion/kds-chime.ts
export type AudioState = 'locked' | 'unlocked' | 'muted' | 'unsupported';

/** Current state. Synchronous; safe during render (it reads a module-level variable). */
export function getAudioState(): AudioState;
/** Subscribe for <AudioUnlockBar>; returns an unsubscribe. Shaped for useSyncExternalStore. */
export function subscribeAudioState(cb: () => void): () => void;
/** MUST be called synchronously inside a user-gesture handler. Idempotent. */
export function unlockAudio(): Promise<AudioState>;
/** User preference, persisted in localStorage['qros:kds:sound'] = '0' | '1'. */
export function setMuted(muted: boolean): void;
/** No-op unless state === 'unlocked'. Applies the 800 ms throttle internally. */
export function playNewOrderChime(): void;
```

The handling, exactly:

1. The KDS layout mounts `<AudioUnlockBar>` — a full-width bar reading *"Tap to enable sound"* (key
   `kds.sound.enable`) — whenever `getAudioState() === 'locked'` and the user has not muted.
   It is a real, focusable `<button>` (not a passive banner), because the gesture must be a genuine
   activation.
2. In addition, a capture-phase, `{ once: true }` listener on `document` for `pointerdown` **and**
   `keydown` calls `unlockAudio()`. A cook who taps *any* ticket has already enabled sound; the bar
   disappears without them ever reading it. This is the path that fires 95 % of the time.
3. `unlockAudio()` constructs the shared `AudioContext` lazily (never at module load — constructing
   one at import time in a suspended state is what exhausts the per-document context limit), calls
   `resume()`, then plays a **0-gain 1 ms buffer**. Some Safari versions only truly unlock after a
   buffer has been played inside the gesture. On resolve it flips the state to `'unlocked'` and
   notifies subscribers.
4. **The unlock does not survive a page load.** Browsers require a fresh gesture per document. The bar
   therefore reappears after every reload, and the copy says *"Tap to enable sound"* rather than
   *"Enable sound"* so it does not read as a bug or as a setting that failed to save. The **mute
   preference** does persist, in `localStorage`.
5. **Suspension after backgrounding.** Chrome and iOS Safari suspend an `AudioContext` when a tab is
   hidden or the device sleeps. On `visibilitychange → visible`, if the state was `'unlocked'` and
   `ctx.state === 'suspended'`, `resume()` is attempted once without a gesture. Browsers usually allow
   this for a context that has already been activated; if the promise rejects, the state flips back to
   `'locked'` and the bar returns. **No silent failure**: the KDS never believes it is making noise
   when it is not.
6. `'unsupported'` (no `AudioContext`, e.g. a hardened kiosk build) hides the bar entirely and marks
   sound permanently unavailable. Every other cue still runs.
7. **Sound is never the only channel** (doc 04 §9.6). The visual path always runs: card entrance,
   `--animate-pulse-ring` ×2, the 6 px `--lane-new` edge bar, the `isNew` window of 4 s, and an
   `aria-live="assertive"` announcement into the layout-mounted live region — *"New order C-014, table
   12, 6 items"* (key `kds.a11y.new_order`). Under `prefers-reduced-motion: reduce` the pulse is
   replaced by a static edge bar for the full 4 s (doc 04 §7.8); the chime and the announcement are
   unchanged, because reduced motion is not reduced information.
8. **The Web Notifications API is deliberately not used.** It requires a permission prompt on a shared
   kitchen tablet, its notifications land in an OS tray nobody watches, and the KDS tab is by
   definition foreground and full-screen. `use-wake-lock.ts` keeps the screen on instead
   (`navigator.wakeLock.request('screen')`, re-acquired on `visibilitychange → visible` because the
   sentinel is released whenever the document is hidden).

**Late-order flagging** is a clock condition, not an event: `isLate = ageSeconds > branches.late_order_threshold_minutes * 60`,
recomputed on the 1 s tick. Nothing is pushed. A ticket crossing the threshold gets the danger
treatment and increments the header's late counter; it does **not** re-chime, because a chime that
fires for a ticket already on screen trains cooks to ignore chimes.

---

<a id="4"></a>
## 4. Waiter

Brief §10: Active Orders, Ready Orders, Table Calls. "TABLE 12 IS CALLING", waiter acknowledges,
cooldown prevents spam, waiter sees only their assigned branch.

Branch isolation is a policy, not a filter: `orders_select_front_of_house` and
`waiter_calls_select_staff` both gate on `has_branch_access(branch_id)`, and doc 05 §2.5.2 refuses to
render the waiter panel at all when a `WAITER`'s `branchId` is null.

### 4.1 Ready-order notifications

**State lane.** Binding B2 (`UPDATE` on `orders`). The waiter board keeps two derived lists from one
ticket collection:

- **Active** — `status IN ('pending','confirmed','preparing')`
- **Ready** — `status = 'ready'`, sorted by `ready_at` ascending (oldest food first — it is getting
  cold, and that ordering is the entire point of the list)

A ticket entering `ready` moves lists with the doc 04 lane transition. A ticket entering `delivered`
leaves the board; `markDeliveredAction` is the waiter's primary button and goes through the identical
optimistic-intent machinery as §3.4 (the hook is shared).

**Alert lane.** Binding B8, `order.ready` broadcast. Fires the chime and an assertive announcement
*"Order C-014 ready, table 12"* (key `waiter.a11y.order_ready`). Same 800 ms throttle, same
`alertKey` de-duplication, same audio-unlock machinery — `<AudioUnlockBar>` is mounted by the waiter
layout too.

Unlike the KDS, the waiter panel is a tablet a person carries and glances at, so the ready alert also
sets `document.title = '(1) Waiter — QR OS'` with a count of unacknowledged ready orders, cleared on
`visibilitychange → visible`. Title mutation is free, works when the tab is background, and needs no
permission.

### 4.2 Waiter-call notifications

**State lane.** Bindings B3/B4 on `waiter_calls`. Open calls are `status IN ('pending','acknowledged')`
(doc 01 §6.17 — `uq_waiter_calls_open_per_table` makes at most one open call per table a database
invariant, so the console can never show two rings for one table).

**Alert lane.** Binding B10, `waiter_call.created`, published by the trigger in §7.5. Payload:

```jsonc
{ "v": 1, "event": "waiter_call.created", "call_id": "…uuid…",
  "table_number": "12", "table_name": "Terrace 3",
  "reason": "request_bill", "note": null,
  "at": "2026-09-01T12:23:04.517Z" }
```

`<CallAlert>` renders **"TABLE 12 IS CALLING"** (key `waiter.call.alert`, interpolating the table
number) as a persistent, non-dismissible banner across the top of the waiter panel. It stays until the
call leaves `pending` — by this waiter, by a colleague on another tablet, or by the guest cancelling.
It is not a toast: a toast auto-dismisses, and a call that scrolled past unheard is exactly the
failure this feature exists to prevent.

Reason drives icon, colour and sort priority (doc 01 §6.17): `request_bill` and `complaint` outrank
`request_water` and `request_cutlery`. `<CallAlert>` always shows the **highest-priority oldest** open
call; the Calls tab shows all of them with a live count in `<WaiterTabs>`.

Repeat alerting: the chime re-fires every **60 s** while at least one `pending` call is open,
independent of the 800 ms burst throttle. A single ping on a busy floor is missable; a ping every
minute until somebody taps is the behaviour a restaurant actually needs. It stops the instant the last
call moves to `acknowledged`.

### 4.3 The acknowledgement flow

```
guest taps CALL WAITER
  → callWaiterAction → public_call_waiter()  [cooldown + one-open-call checks in the DB]
  → INSERT waiter_calls (status 'pending')
      ├─ trg_waiter_calls_broadcast_event → broadcast waiter_call.created → branch:{branch_id}
      ├─ postgres_changes INSERT           → waiter_calls list on every waiter tablet
      └─ INSERT notifications (type 'waiter_call_created', target_role 'WAITER')
  → waiter taps "I'M COMING"
  → acknowledgeCallAction  [compare-and-swap on status = 'pending']
  → UPDATE waiter_calls SET status='acknowledged', acknowledged_at, acknowledged_by_staff_id
      ├─ trg_waiter_calls_broadcast_event → broadcast waiter_call.acknowledged → branch:{branch_id}
      │                                   → broadcast waiter_call.acknowledged → table:{qr_token}
      └─ postgres_changes UPDATE           → every waiter tablet drops the banner
  → guest's screen shows "A waiter is on the way"
  → waiter taps "DONE" → resolveCallAction → status 'resolved' → table released for a new call
```

**The race between two waiters is resolved in the database, not the UI.** `acknowledgeCallAction`
issues:

```ts
// src/lib/services/waiter-service.ts
const { data, error } = await supabase
  .from('waiter_calls')
  .update({ status: 'acknowledged' })
  .eq('id', callId)
  .eq('status', 'pending')          // ← compare-and-swap
  .select('*')
  .maybeSingle();
```

`data === null` means a colleague won. The losing tablet shows an `info` toast
*"Already acknowledged by Dilnoza"* (key `waiter.call.already_acknowledged`, name resolved from the
refetched row's `acknowledged_by_staff_id`) and drops its banner. No error state, no red, because
nothing went wrong — the guest is being served, which is the desired outcome.

Optimistically, the tapping tablet clears its own banner immediately and adds `callId` to
`pendingIds`; on a `null` result it does not restore the banner (the call *is* acknowledged, just not
by this person). On a network error it restores the banner and toasts `errors.network`.

`acknowledged_by_staff_id` is set server-side from the session, never sent by the client.

**Feedback to the guest** is the `table:{qr_token}` topic (§1.1). `<CallWaiterButton>` on the customer
surface subscribes to it while a call is open and swaps its label to *"A waiter is on the way"*
(key `customer.call.on_the_way`) on `waiter_call.acknowledged`, and back to the idle state on
`waiter_call.resolved`. This is brief §34.12 — *every important action gives clear feedback* — and it
is the one thing that stops a guest pressing the button four more times.

The table payload is deliberately minimal, because a table topic is shared by everyone sitting there:

```jsonc
{ "v": 1, "event": "waiter_call.acknowledged", "reason": "request_bill",
  "at": "2026-09-01T12:23:31.004Z" }
```

No `call_id`, no staff name, no note. A guest does not need the internal id of their own call, and the
waiter's name is staff data.

### 4.4 Cooldown and its feedback

Three independent anti-spam mechanisms, in the order a request meets them:

| # | Where | Rule | What the guest sees |
|---|---|---|---|
| 1 | `src/lib/security/rate-limit.ts` (`checkLimit('waiter-call', ip+token)`) | In-process shedder. Not a security control (doc 02 §5.4); it exists so an abusive client is cheap to refuse. | Same as #2 |
| 2 | `public_call_waiter()` — `tables.last_waiter_call_at` under `FOR UPDATE` | **90 s** between calls per table; plus max 5 per table per hour | `QR011_WAITER_CALL_COOLDOWN` (429) with `details.retry_after_seconds` |
| 3 | `uq_waiter_calls_open_per_table` (partial unique index) | At most one `pending`/`acknowledged` call per table, ever | `QR012_WAITER_CALL_ALREADY_OPEN` (409) |

**The client feedback contract, exactly:**

- On **success**, `callWaiterAction` returns `{ callId, createdAt, cooldownSeconds }` (doc 05 §5.2).
  The button writes `localStorage['qros:call:' + qrToken] = String(Date.now() + cooldownSeconds*1000)`
  and enters the countdown state.
- On **`QR011`**, the same state is entered using `details.retryAfterSeconds` from the error. The
  server is authoritative for the remaining time; the local timestamp is only a hint that survives a
  reload.
- The countdown renders **on the disabled button itself** — *"Call again in 1:12"*, key
  `customer.call.cooldown` — ticking once per second. **Never a toast.** Doc 05 §5.2 fixes this and it
  is right: a toast for a cooldown vanishes after 6 s and leaves a disabled button with no explanation,
  which reads as broken.
- On **`QR012`**, the button shows the *"A waiter is on the way"* state instead of a countdown, because
  the correct information is that a call is already open, not that they must wait.
- After a reload, the button reads the `localStorage` value and resumes the countdown. A cleared or
  unreadable value simply means the button is enabled and the server refuses with `QR011` — the
  storage is a convenience, never the control. Every read/write is wrapped in `try/catch` (doc 05
  §3.4's storage rule).
- The countdown is driven by one `setInterval(1000)` inside `<CallWaiterButton>`, cleared on unmount,
  and recomputed from the target timestamp on every tick rather than decremented — so a sleeping tab
  wakes up with the correct remaining time instead of a frozen number.

---

<a id="5"></a>
## 5. Reconnection and correctness

The governing rule:

> **A panel may be late. A panel may be degraded and say so. A panel may never be silently wrong.**

Every mechanism below exists to convert an invisible failure into either a repaired state or a visible
badge.

### 5.1 The failure taxonomy

| # | Failure | What actually happens | Detection | Repair |
|---|---|---|---|---|
| F1 | Tab hidden / device sleeps | Timers throttled to ≥1/min; the WebSocket usually survives but heartbeats stall; `AudioContext` suspends | `visibilitychange` | Resync on `visible` + audio re-check (§3.5.5) |
| F2 | Tab restored from bfcache | The socket **was** severed while frozen; `supabase-js` does not know | `pageshow` with `event.persisted === true` | Force `channel.unsubscribe()` → re-acquire → resync |
| F3 | Wi-Fi drop / AP roam | Socket closes; `supabase-js` retries with its own backoff | `subscribe()` callback → `CLOSED` / `CHANNEL_ERROR` | Our backoff (§5.5) + resync on rejoin |
| F4 | Server-side channel error (RLS denied, topic invalid, rate limit) | Join fails repeatedly | `CHANNEL_ERROR` ≥3 consecutive | Fall back to polling, badge `polling`, keep retrying |
| F5 | JWT expired during a long shift | Rejoin is refused: the access token in the socket is stale | `CHANNEL_ERROR` right after a long idle | `supabase.auth.onAuthStateChange` → `realtime.setAuth()` → rejoin (§5.5) |
| F6 | Events emitted while we were away | No error at all — the dangerous one | Cannot be detected | **Assume it always happened**: every transition into `live` triggers a full resync |
| F7 | A single message dropped or malformed | Zod parse fails, or a status arrives that the merge rule rejects | `onProtocolMismatch` / reducer no-op | Schedule a resync |
| F8 | Broadcast trigger swallowed an exception (§2.5) | No message at all for a real status change | Watchdog: no event and no heartbeat for `staleAfterMs` | Resync |
| F9 | Clock skew between device and server | `at` timestamps look future/past | — | `at` is never used for ordering (§2.7); elapsed timers use `Date.now()` deltas against server timestamps and are floored at 0 |
| F10 | An order legitimately stops being visible to this role (`ready → delivered` for `KITCHEN`) | Realtime correctly emits nothing | TTL (§3.1) | Targeted refetch, then removal |

### 5.2 The resync contract

Every channel consumer supplies **exactly one** `onResync` function returning a complete authoritative
snapshot of everything that channel feeds. The controller in `src/lib/realtime/resync.ts` calls it:

| Trigger | Condition |
|---|---|
| **T1 — Join** | Every transition into `SUBSCRIBED`, **including the very first**. There is no "we just mounted so we are fresh" exemption: the server-rendered payload was fetched before the channel joined, so events in that window are unobserved. |
| **T2 — Visibility** | `document.visibilityState` becomes `visible` **and** `now - lastResyncAt > 10_000`. The threshold stops a tablet being tapped awake every few seconds from hammering the server. |
| **T3 — Online** | `window.addEventListener('online')`. |
| **T4 — bfcache** | `pageshow` with `persisted === true`. Also forces a channel re-acquire (F2). |
| **T5 — Watchdog** | No inbound message **and** no successful heartbeat for `staleAfterMs` (default **45 000 ms**, i.e. 3 missed 15 s heartbeats). Covers F8. |
| **T6 — Protocol** | A payload fails zod validation or carries `v !== 1`. |
| **T7 — Manual** | The operator taps `<ConnectionBadge>`, which is a button. |
| **T8 — Integrity** | Any `DELETE` event on any binding, or a reducer invariant violation. |

Resyncs are **coalesced**: a request while one is in flight sets a `rerunRef` flag and runs exactly one
more pass afterwards. A resync is **debounced by 400 ms** so T1+T2+T3 firing together (the normal
laptop-lid-open sequence) is one round trip.

### 5.3 The resync algorithm — why it cannot drift

```ts
// src/lib/realtime/resync.ts
export interface ResyncController<TEvent> {
  /** Called by every binding handler. Buffers during an in-flight resync, else applies. */
  ingest: (event: TEvent) => void;
  request: (reason: ResyncReason) => void;
  readonly state: { resyncing: boolean; lastResyncAt: number | null; generation: number };
}

export function createResyncController<TEvent>(opts: {
  fetchSnapshot: (signal: AbortSignal) => Promise<{ generatedAt: string }>;
  applySnapshot: (snapshot: unknown) => void;
  applyEvent: (event: TEvent) => void;
  debounceMs?: number;   // default 400
}): ResyncController<TEvent>;
```

The pass, step by step:

1. `generation += 1`; capture `myGen`. Create an `AbortController`; abort any previous in-flight fetch.
2. `buffering = true`. Every event arriving from now on goes into `bufferRef` instead of the reducer.
3. `await fetchSnapshot(signal)`.
4. If `generation !== myGen`, discard the result entirely and return. A stale response can never
   overwrite newer state — this is the single most important line in the file.
5. `applySnapshot(...)` **replaces** the collection wholesale. It does not merge, does not diff, does
   not preserve unknown ids. The server's list is the list. Anything the client held that the server
   does not return no longer exists for this subscriber.
6. Drain `bufferRef` through `applyEvent` in arrival order. This is safe **because every reducer in
   this document is idempotent and monotonic** (§2.7, §3.2): re-applying an event already reflected in
   the snapshot is a no-op, and an event that is genuinely newer wins.
7. `buffering = false`; `lastResyncAt = Date.now()`; badge returns to `live`.

Optimistic intents (§3.4) survive a resync: they live outside the ticket collection, and step 5's
wholesale replace is followed by re-projecting `overlay.get(id) ?? ticket.status`. An intent whose
order is absent from the snapshot is dropped, because the server has spoken.

**The snapshot sources, exactly:**

| Consumer | `fetchSnapshot` |
|---|---|
| `useRealtimeOrders` (KDS) | `loadKitchenBoardAction({ branch_id })` → `{ tickets, generatedAt }` |
| `useWaiterCalls` + waiter board | `loadWaiterBoardAction({ branch_id })` → `{ activeOrders, readyOrders, calls, generatedAt }` (REQUIRED ADDITION to doc 05 §5.2, `src/lib/actions/waiter.ts`, thin wrapper over `getWaiterBoard`) |
| `useOrderStatus` (customer) | `GET /api/public/order/{token}/{publicOrderId}` (doc 05 §5.3.5) → `{ order: OrderView }` |
| `<CallWaiterButton>` table topic | No snapshot. Its state is derived from the button's own last action plus `localStorage`; on any doubt it falls back to the idle state, which is always safe. |
| Admin dashboard | `router.refresh()` debounced 3 s (doc 05 §6.4). Aggregates are re-derived server-side; a client-side re-implementation would be a second, divergent definition of "today's revenue". |

### 5.4 Targeted refetch — the cheap repair

A full resync is the sledgehammer. Three situations need one ticket, not the board:

1. An `orders` UPDATE with unchanged `status` but advanced `updated_at` (a voided line, §3.2).
2. A stale optimistic intent (§3.4 step 7).
3. A `ready` ticket exceeding `KDS_READY_TTL_MS` on a `KITCHEN` session (§3.1).

All three call `loadKitchenTicketsAction({ branch_id, order_ids: [id] })` through the same 120 ms
coalescing queue as hydration, so three simultaneous repairs are one round trip. An id that comes back
absent is removed from the board — that is the correct answer to "the server will not show me this
any more".

### 5.5 Socket-level handling

```ts
// src/lib/supabase/browser.ts — the realtime options are binding (amendment A-10)
export const createBrowserClient = /* memoised module singleton */ () =>
  createBrowserClientSSR<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      realtime: {
        params: { eventsPerSecond: 10 },   // we never send; this is a safety ceiling
        heartbeatIntervalMs: 15_000,       // default 30 s is too slow to notice a dead AP
        timeout: 10_000,                   // join timeout
        reconnectAfterMs: (tries: number) =>
          [1_000, 2_000, 5_000, 10_000][tries - 1] ?? 10_000,
      },
    },
  );
```

**The client must be a module-level singleton.** `createBrowserClient()` returning a new client per
call opens a new WebSocket per call and is the most expensive mistake available in this file.

**Token refresh (F5).** Mounted once in `<RealtimeProvider>`:

```ts
useEffect(() => {
  const supabase = createBrowserClient();
  const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
      // Re-authorises the socket. Without this, channels rejoin with an expired JWT
      // after a long shift and fail with CHANNEL_ERROR forever.
      void supabase.realtime.setAuth(session?.access_token);
    }
    if (event === 'SIGNED_OUT') supabase.realtime.disconnect();
  });
  return () => sub.subscription.unsubscribe();
}, []);
```

The customer surface never calls `setAuth`: its token is the anon key, which the client installs
itself and which does not expire on the timescale of a meal.

**Join watchdog.** If `SUBSCRIBED` is not reached within `joinTimeoutMs` (**8 000 ms**, matching doc 05
§6.4), the badge goes to `reconnecting` and polling starts. Three consecutive `CHANNEL_ERROR`s escalate
to `degraded`. **Retrying never stops** — the backoff caps at 10 s and the channel keeps trying
forever, because a restaurant's Wi-Fi comes back and nobody is going to reload the KDS.

**Explicit rejoin** (used by T4/bfcache and by the escalation path): `channel.unsubscribe()`, then
`supabase.removeChannel(channel)`, then re-acquire through the manager. `removeChannel` is async;
`acquireChannel` must await its completion before creating a replacement with the same topic, or the
server sees two joins for one topic from one socket and rejects the second.

### 5.6 Polling — the fallback, stated honestly

Polling activates **only** when the badge is `reconnecting` or `degraded`, i.e. after the 8 s join
timeout or three failed rejoins. It is also the permanent transport in demo mode (doc 05 §8.6), where
no Supabase project exists at all.

```ts
// src/lib/realtime/poll.ts
export function createPollController(opts: {
  fetch: (signal: AbortSignal) => Promise<void>;
  intervalMs: number;          // customer 15_000 · staff 10_000 (doc 05 §6.4)
  jitterRatio?: number;        // default 0.2 — ±20 %, so 30 tablets do not sync up
  maxIntervalMs?: number;      // default 30_000
  backoffAfter?: number;       // default 10 consecutive polls → double the interval, capped
}): { start(): void; stop(): void; pokeNow(): void };
```

Rules:

- **Paused while `document.visibilityState === 'hidden'`**, and `pokeNow()` on becoming visible. A
  background tab polling every 10 s for an hour is a battery and quota bug.
- Jitter is mandatory. Ten kitchen tablets reconnecting after the same AP reboot must not become a
  synchronised thundering herd against the same route handler.
- Polling **stops immediately** on the next `SUBSCRIBED`, and the badge returns to `live`.
- `<ConnectionBadge state="polling">` is visible the entire time. Brief §28's prohibition is about the
  product's design, and this state is visibly labelled as the degraded one.

### 5.7 The badge — the user-visible contract

```ts
// src/hooks/use-connection-state.ts
export type ConnectionState = 'live' | 'connecting' | 'reconnecting' | 'polling' | 'stale' | 'offline';
export function useConnectionState(channel: RealtimeChannelState): {
  state: ConnectionState;
  /** Seconds since the last confirmed-fresh moment (event or resync). */
  secondsSinceFresh: number;
  retryNow: () => void;
};
```

| State | Meaning | Badge (doc 04 tokens) |
|---|---|---|
| `live` | Joined, heartbeats current, last resync succeeded | Small `--success` dot, no text (the healthy case must be quiet) |
| `connecting` | First join in flight, <8 s | Neutral dot, `common.connecting` |
| `reconnecting` | Was live, lost it, retrying | `--warning` dot + `common.reconnecting`, pulsing |
| `polling` | Fallback active | `--warning` chip + `common.polling` |
| `stale` | Joined but the watchdog fired and the resync failed | `--danger` chip + `common.stale` + *"Tap to refresh"* |
| `offline` | `navigator.onLine === false` | `--danger` chip + `common.offline` |

The badge is a `<button>` in every state; tapping it triggers T7. On the KDS and waiter panels it sits
in the header, always visible. On the customer tracker it appears **only** when the state is not
`live`, because a healthy connection is not information a diner needs.

---

<a id="6"></a>
## 6. The hooks — exact files and signatures

### 6.1 `src/lib/realtime/channels.ts`

```ts
export const REALTIME_PROTOCOL_VERSION = 1 as const;

export type OrderTopic  = `order:${string}`;
export type TableTopic  = `table:${string}`;
export type BranchTopic = `branch:${string}`;
export type RealtimeTopic = OrderTopic | TableTopic | BranchTopic;

/** publicCode must match publicCodeSchema; throws in dev, returns a safe topic in prod. */
export function orderTopic(publicCode: string): OrderTopic;
/** qrToken must match qrTokenSchema. */
export function tableTopic(qrToken: string): TableTopic;
/** branchId must be a uuid. */
export function branchTopic(branchId: string): BranchTopic;

export const KDS_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'] as const;
export const WAITER_ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing'] as const;
export const OPEN_CALL_STATUSES = ['pending', 'acknowledged'] as const;

export const BRANCH_TABLES = ['orders', 'waiter_calls', 'menu_items', 'notifications'] as const;
export type BranchTable = (typeof BRANCH_TABLES)[number];

export const JOIN_TIMEOUT_MS   = 8_000;
export const STALE_AFTER_MS    = 45_000;
export const RESYNC_DEBOUNCE_MS = 400;
export const HYDRATION_COALESCE_MS = 120;
export const KDS_READY_TTL_MS  = 15 * 60_000;
export const ALERT_DEDUPE_MS   = 10_000;

// ORDER_EVENTS / BRANCH_EVENTS / TABLE_EVENTS as in §1.4
```

This is the **only** module that concatenates a topic string. `channels.test.ts` asserts that
`orderTopic` rejects a `public_code` failing `publicCodeSchema` — a topic built from unvalidated input
is how a client ends up subscribed to `order:undefined`.

### 6.2 `src/lib/realtime/manager.ts` — StrictMode safety

React 19 StrictMode in development mounts every component, runs effects, **unmounts, and mounts
again**. A naive `useEffect(() => { const ch = supabase.channel(t).subscribe(); return () => supabase.removeChannel(ch) }, [t])`
produces, in order: join → leave → join. `removeChannel` is asynchronous, so the second join is very
often sent while the first leave is still in flight, and the server answers the second join with an
error. Symptom: the KDS works in production and shows `CHANNEL_ERROR` in development, which trains
developers to ignore the error state — exactly the wrong instinct for this subsystem.

The fix is a **ref-counted registry with deferred teardown**:

```ts
export interface ChannelHandle {
  readonly topic: RealtimeTopic;
  readonly channel: RealtimeChannel;
  release(): void;
}

/**
 * Acquire (or join) the channel for `topic`.
 * `build` runs ONCE per topic, before subscribe(), and registers every `.on()` binding.
 * A second acquire for a live topic increments the refcount and reuses the channel; `build`
 * is NOT re-run, which is why the branch channel's binding set must be fixed and complete (§1.3).
 */
export function acquireChannel(
  topic: RealtimeTopic,
  build: (channel: RealtimeChannel) => void,
  onStatus: (status: ChannelSubscribeStatus, err?: Error) => void,
): ChannelHandle;

/** Test-only. Drains pending teardowns synchronously. */
export function __resetRealtimeManager(): void;
```

Implementation rules:

1. `Map<topic, { channel, refs, teardownTimer, statusListeners: Set }>`.
2. `release()` decrements `refs`. At zero it schedules teardown after **`TEARDOWN_GRACE_MS = 300`**,
   not immediately. StrictMode's remount happens in the same tick, finds `refs === 0` but the entry
   still present, **cancels the timer** and re-increments. Net effect: one join, one channel, no error.
3. Teardown: `await channel.unsubscribe()` then `await supabase.removeChannel(channel)` then delete the
   map entry. A subsequent `acquireChannel` for the same topic awaits that promise before rebuilding.
4. Status is fanned out to every listener, so multiple hooks on the branch topic all see the same
   connection state without multiple `.subscribe()` calls.
5. The registry is module-scoped and therefore per-tab. It is never touched on the server; `manager.ts`
   is imported only from `'use client'` modules.

### 6.3 `useRealtimeChannel` — the primitive

```ts
// src/hooks/use-realtime-channel.ts
'use client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { ZodType } from 'zod';
import type { RealtimeTopic } from '@/lib/realtime/channels';

export type ChannelStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'degraded' | 'closed';

export interface PostgresBinding<TRow extends Record<string, unknown>> {
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  table: string;
  /** Bandwidth filter only. RLS is the security control. */
  filter?: string;
  onChange: (payload: RealtimePostgresChangesPayload<TRow>) => void;
}

export interface BroadcastBinding<TPayload> {
  event: string;
  /** Every payload is parsed before it reaches a handler. Non-optional by design. */
  schema: ZodType<TPayload>;
  onMessage: (payload: TPayload) => void;
}

export interface UseRealtimeChannelOptions {
  topic: RealtimeTopic;
  /** false unmounts the channel without unmounting the component (demo mode, terminal order). */
  enabled?: boolean;
  /** Realtime Authorization. true for every topic in this product. Default true. */
  isPrivate?: boolean;
  /** MUST be stable across renders (useMemo / module constant). See §6.7. */
  postgres?: readonly PostgresBinding<never>[];
  broadcast?: readonly BroadcastBinding<never>[];
  /** REQUIRED. Called on every transition into `live`, and on triggers T2-T8 (§5.2). */
  onResync: (signal: AbortSignal) => Promise<void>;
  /** A payload that failed schema validation or carried v !== 1. Default: request a resync. */
  onProtocolMismatch?: (topic: RealtimeTopic, raw: unknown) => void;
  joinTimeoutMs?: number;   // default JOIN_TIMEOUT_MS
  staleAfterMs?: number;    // default STALE_AFTER_MS
  resyncOnVisible?: boolean; // default true
}

export interface RealtimeChannelState {
  status: ChannelStatus;
  isLive: boolean;
  /** Date.now() of the last inbound message on this channel. */
  lastEventAt: number | null;
  lastResyncAt: number | null;
  resyncing: boolean;
  /** Consecutive failed joins. Feeds the badge and the polling escalation. */
  attempt: number;
  resyncNow: () => void;
  /** Escape hatch for tests and for <ConnectionBadge>'s retry. */
  reconnect: () => void;
}

export function useRealtimeChannel(options: UseRealtimeChannelOptions): RealtimeChannelState;
```

**Internals that are binding, not incidental:**

- **Latest-ref for every callback.** `onChange`, `onMessage`, `onResync` are stored in a ref updated in
  a `useLayoutEffect` on every render, and the effect that builds the channel reads
  `handlersRef.current`. The channel is therefore **never** torn down because a parent re-rendered with
  a new closure. This is the single highest-value line in the hook; without it, a KDS that re-renders
  on a 1 s timer would rejoin its channel once per second.
- **The subscribe effect depends on `[topic, enabled, isPrivate, bindingKey]` and nothing else.**
  `bindingKey` is a string derived from the binding *shapes* — `postgres.map(b => `${b.event}:${b.table}:${b.filter ?? ''}`).join('|') + '#' + broadcast.map(b => b.event).join('|')` — computed
  in a `useMemo`. Handler identity is not part of it. Adding a binding legitimately rebuilds the
  channel (it must: bindings are registered before `subscribe()`); changing a handler does not.
- **Cleanup is `handle.release()`**, never `supabase.removeChannel` directly. The manager owns the
  lifecycle.
- **The effect body is synchronous.** It calls `acquireChannel` and returns the cleanup. It never
  `async`s, because an async effect cannot return a cleanup function and the subscription would leak.
- Every `setState` from an async path is guarded by a `mountedRef`.

### 6.4 `<RealtimeProvider>` and `useBranchRealtime()`

```tsx
// src/components/providers/realtime-provider.tsx
'use client';

export interface BranchRealtimeApi {
  branchId: string;
  connection: RealtimeChannelState;
  /** Register a postgres_changes consumer. Returns an unsubscribe. */
  onPostgres<T extends Record<string, unknown>>(
    table: BranchTable,
    handler: (payload: RealtimePostgresChangesPayload<T>) => void,
  ): () => void;
  /** Register a broadcast consumer. Payload is already zod-parsed. */
  onBroadcast<E extends BranchEvent>(
    event: E,
    handler: (payload: BranchBroadcastPayload<E>) => void,
  ): () => void;
  /** Register a resync participant. The provider fans every resync trigger out to all of them. */
  onResync(handler: (signal: AbortSignal) => Promise<void>): () => void;
  resyncNow(): void;
}

export function RealtimeProvider(props: {
  branchId: string;
  children: React.ReactNode;
}): React.ReactElement;

/** Throws outside the provider — a staff panel without live data is a bug, not a degraded mode. */
export function useBranchRealtime(): BranchRealtimeApi;
```

The provider owns the single branch channel with the complete binding set of §1.5, and an internal bus
(`Map<key, Set<handler>>`). `onResync` participants are awaited with `Promise.allSettled` so one
failing snapshot does not block the others; a rejection sets that consumer's badge to `stale` without
poisoning the channel.

In demo mode (`isDemoMode()`), the provider builds **no channel at all**, reports
`connection.status = 'degraded'` with `state = 'polling'` in the badge, and drives every registered
`onResync` from a `PollController`. The consumer hooks are unchanged, which is exactly why demo mode
exercises the same code path the fallback uses in production.

### 6.5 `useRealtimeOrders(branchId, options)` — the KDS

```ts
// src/hooks/use-realtime-orders.ts
'use client';

export interface UseRealtimeOrdersOptions {
  /** Server-rendered board from getKitchenTickets(). Used until the first resync lands. */
  initial: readonly KitchenTicket[];
  /** Default KDS_STATUSES. The waiter panel passes its own set. */
  statuses?: readonly OrderStatus[];
  /** Alert lane. Fired once per order, de-duplicated on alertKey. Do NOT mutate lists here. */
  onNewOrder?: (alert: OrderCreatedAlert) => void;
  onOrderReady?: (alert: OrderReadyAlert) => void;
  onOrderCancelled?: (alert: OrderCancelledAlert) => void;
}

export interface UseRealtimeOrdersResult {
  /** Hydration-complete and skeleton tickets, sorted by placedAt ascending. */
  tickets: readonly KitchenTicket[];
  /** Lane projection with the optimistic overlay already applied. */
  byStatus: Readonly<Record<OrderStatus, readonly KitchenTicket[]>>;
  /** Ids within their 4 s isNew window (doc 04 §7.3). */
  newTicketIds: ReadonlySet<string>;
  /** Ids whose lines are still loading (§3.3 step 5). */
  hydratingIds: ReadonlySet<string>;
  /** Ids with an open optimistic intent — the card disables its actions. */
  pendingIds: ReadonlySet<string>;
  connection: RealtimeChannelState;
  /** Optimistic + CAS + reconcile (§3.4). Wraps the doc 05 §5.2 status actions. */
  setStatus: (orderId: string, next: OrderStatus, reason?: string) => Promise<Result<OrderView>>;
  /** Force a targeted refetch of specific tickets. */
  refreshTickets: (orderIds: readonly string[]) => void;
  /** Force a full board resync (same as connection.resyncNow). */
  refresh: () => void;
}

export function useRealtimeOrders(
  branchId: string,
  options: UseRealtimeOrdersOptions,
): UseRealtimeOrdersResult;
```

Internally: `useBranchRealtime()` → `onPostgres('orders', reducer)`, `onBroadcast('order.created' | 'order.ready' | 'order.cancelled', alertDispatch)`,
`onResync(loadKitchenBoard)`, plus `useOptimisticStatus`, the hydration queue and the 1 s elapsed tick
(`use-elapsed.ts`) which is the **only** thing that re-renders the board between events.

The board's own state lives in a `useReducer` whose state object is replaced only when something
actually changed (the reducer returns the identical reference for a no-op event), so an idempotent
re-delivery costs zero renders.

### 6.6 `useOrderStatus(publicOrderId, options)` — the customer tracker

```ts
// src/hooks/use-order-status.ts
'use client';

export interface UseOrderStatusOptions {
  /** The table capability. Needed for the polling fallback URL, not for the topic. */
  qrToken: string;
  /** Server-rendered OrderView from public_get_order. Correct with JS disabled. */
  initial: OrderView;
  /** Fires once per forward transition, after the merge rule accepts it. Haptics/chime. */
  onStatusChange?: (next: OrderStatus, previous: OrderStatus) => void;
}

export interface UseOrderStatusResult {
  order: OrderView;
  status: OrderStatus;
  /** 0..5 on the forward path; -1 for cancelled. Drives <OrderStatusStepper>. */
  statusIndex: number;
  isTerminal: boolean;
  /** Date.now() of the last accepted status change; null if none since mount. */
  lastChangeAt: number | null;
  connection: RealtimeChannelState;
}

export function useOrderStatus(
  publicOrderId: string,
  options: UseOrderStatusOptions,
): UseOrderStatusResult;
```

- `publicOrderId` **is** `orders.public_code`. The topic is `orderTopic(publicOrderId)`.
- `enabled: !isTerminalStatus(status)` — the channel is released the moment the order completes or is
  cancelled (§2.8).
- Broadcast updates patch `status`, `dueAt`, `estimatedPrepMinutes`, `cancellationReason` and the
  matching lifecycle timestamp onto the existing `OrderView`. Lines and money are **never** patched
  from a broadcast; a resync is what replaces them (and only a staff void can change them).
- `onResync` calls `GET /api/public/order/{qrToken}/{publicOrderId}`. A `404` means the order expired
  past 24 h or the token was rotated and the grace window closed: the hook stops, and `<OrderTracker>`
  renders the expired state instead of an infinitely retrying spinner.

### 6.7 `useWaiterCalls(branchId, options)`

```ts
// src/hooks/use-waiter-calls.ts
'use client';

export interface UseWaiterCallsOptions {
  initial: readonly WaiterCallView[];
  /** Alert lane: <CallAlert> + chime. Does not mutate the list. */
  onNewCall?: (alert: WaiterCallCreatedAlert) => void;
  /** Fires every 60 s while at least one pending call is open (§4.2). */
  onRepeatAlert?: (call: WaiterCallView) => void;
}

export interface UseWaiterCallsResult {
  /** Open calls only: status in ('pending','acknowledged'), newest last. */
  calls: readonly WaiterCallView[];
  pendingCount: number;
  /** Highest-priority oldest pending call, or null. Drives <CallAlert>. */
  loudest: WaiterCallView | null;
  pendingIds: ReadonlySet<string>;
  connection: RealtimeChannelState;
  /** CAS on status='pending'; null result = a colleague won, which is not an error. */
  acknowledge: (callId: string) => Promise<Result<WaiterCallView | null>>;
  resolve: (callId: string) => Promise<Result<WaiterCallView | null>>;
  refresh: () => void;
}

export function useWaiterCalls(
  branchId: string,
  options: UseWaiterCallsOptions,
): UseWaiterCallsResult;
```

A call transitioning to `resolved`, `cancelled` or `expired` leaves `calls` — the hook holds only open
calls, because that is the entire content of the Calls tab and history belongs to the admin panel.

### 6.8 `<ConnectionBadge>`

```tsx
// src/components/shared/connection-badge.tsx
'use client';
export interface ConnectionBadgeProps {
  connection: RealtimeChannelState;
  /** 'staff' shows every state; 'customer' renders null while live. */
  surface: 'staff' | 'customer';
  className?: string;
}
export function ConnectionBadge(props: ConnectionBadgeProps): React.ReactElement | null;
```

A `<button type="button">` with `aria-live="polite"` on its label, so a state change is announced once
without stealing focus. Tapping it calls `connection.reconnect()` followed by `resyncNow()`.

### 6.9 The dependency-array traps, enumerated

Every one of these has produced a production incident in a Supabase Realtime codebase. They are listed
as rules, each with the failure it prevents.

| # | Trap | Rule |
|---|---|---|
| D1 | **Handler in the deps.** `useEffect(..., [onMessage])` with an inline arrow rebuilds the channel on every parent render. On the KDS, whose 1 s tick re-renders the tree, that is one join/leave per second until the server rate-limits the socket. | Handlers live in a ref updated in `useLayoutEffect`. They are **never** in a dependency array. |
| D2 | **Object or array literal in the deps.** `[{ branchId }]` or `[statuses]` where `statuses` is an inline array — new identity every render, same outcome as D1. | Options objects are destructured to primitives at the top of the hook. Arrays are reduced to a `bindingKey` string. |
| D3 | **`supabase` in the deps.** A non-memoised `createBrowserClient()` returns a new client each call, so a client in the deps rebuilds forever *and* leaks a WebSocket per render. | `createBrowserClient` is a module-level memoised singleton and is called **inside** the effect, never captured as a dep. |
| D4 | **`async` effect body.** `useEffect(async () => …)` returns a Promise, React ignores it as a cleanup, and the channel leaks. | Effect bodies are synchronous. Async work goes into an inner function invoked with `void`. |
| D5 | **`filter` built inline.** `` filter: `branch_id=eq.${branchId}` `` inside a `useMemo` with the wrong deps silently keeps the *previous* branch's filter after a branch switch. The panel then shows another branch's orders — RLS still permits them for a multi-branch manager, so nothing errors. | The filter string is derived inside `bindingKey`, and `branchId` is a direct dependency of the subscribe effect. `<BranchSwitcher>` changing branch **must** produce a new topic, which forces a full rebuild and resync. |
| D6 | **Missing `enabled` in the deps.** A terminal order's channel stays open forever. | `enabled` is a first-class dependency of the subscribe effect. |
| D7 | **`setState` after unmount** from a resolved resync or hydration fetch. | `mountedRef` guard plus `AbortController` on every fetch; an `AbortError` is swallowed, never toasted. |
| D8 | **State setter identity.** `useState` setters are stable; `useReducer` dispatch is stable. Including them is harmless noise, but including a *derived* callback is D1 again. | Only stable dispatchers may appear; anything wrapped in `useCallback` must have its own deps audited. |
| D9 | **StrictMode double-invocation of the effect body.** Any side effect outside the cleanup's reach (starting a timer, appending to a module array) runs twice. | Every side effect in a realtime effect is registered with a matching cleanup; the manager's refcount absorbs the double mount. |
| D10 | **`useEffect` vs `useLayoutEffect` for the handler ref.** With `useEffect`, an event delivered between render and effect flush calls the *previous* handler with stale closure state. | The handler ref is written in `useLayoutEffect`. |

---

<a id="7"></a>
## 7. Supabase-side enablement (SQL)

Two migrations. `0016_realtime_topics.sql` must run **after** the tables and the state-machine
triggers; `0017_realtime_authorization.sql` must run **after** doc 02's helper functions
(`has_branch_access`) exist.

### 7.1 Replica identity

```sql
-- 0016_realtime_topics.sql
-- FULL is required for RLS-aware Realtime: without it an UPDATE/DELETE WAL record carries only the
-- primary key, so the Realtime server cannot evaluate a branch-scoped policy against the OLD row and
-- the client cannot tell which lane a ticket left.
ALTER TABLE public.orders        REPLICA IDENTITY FULL;
ALTER TABLE public.waiter_calls  REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.menu_items    REPLICA IDENTITY FULL;
ALTER TABLE public.tables        REPLICA IDENTITY FULL;
```

Cost, stated plainly: `REPLICA IDENTITY FULL` writes the entire old row into the WAL on every UPDATE
and DELETE, roughly doubling WAL volume for these five tables. That is accepted; the alternative is a
KDS that cannot reconcile.

### 7.2 Publication membership

```sql
-- Idempotent: DROP then ADD, so re-running the migration converges.
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.order_items;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.order_status_history;

ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.waiter_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tables;
```

> `ALTER PUBLICATION ... ADD TABLE` errors if the table is already a member. On a project where the
> Supabase dashboard has already toggled Realtime for a table, wrap each `ADD` in a
> `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` block, or run the `DROP TABLE IF EXISTS`
> form first for all five. The migration file uses the drop-then-add form for all five.

| Table | Consumer | Why it is published |
|---|---|---|
| `orders` | KDS lanes, waiter Active/Ready, admin dashboard refresh | The core live entity |
| `waiter_calls` | Waiter Calls tab | Brief §10 |
| `notifications` | Notification bell on all three staff panels | Doc 01 §6.18 |
| `menu_items` | KDS 86-list chip, admin menu grid | A dish going unavailable mid-service must show without a refresh |
| `tables` | Admin table grid (QR rotation / activation from another operator's session) | Doc 01 §9.1 |

**Removed, with reasons (amendment A-6):**

- **`order_items`** — no client binds it (§3.3, amendment A-7). It has no `branch_id` for a WAL filter
  and its policy needs a join. Every order line written would be decoded, filtered and discarded for
  nothing.
- **`order_status_history`** — doc 01 §9.1 published it so "the customer's visual tracker timeline
  appends without refetching". That justification does not survive §2.1: the customer is `anon` and
  cannot subscribe to `postgres_changes` at all. No staff screen renders a live history either. It is
  read on demand inside `app_private.order_payload()`.

### 7.3 Topic-validity helpers

```sql
-- 0017_realtime_authorization.sql
-- anon holds no SELECT on public.orders or public.tables, so both checks must be SECURITY DEFINER.
-- Both are STABLE and take the FULL topic string, so the policy body stays a single call.

CREATE OR REPLACE FUNCTION public.order_topic_is_valid(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT p_topic ~ '^order:[A-Za-z0-9_-]{10,32}$'
     AND EXISTS (
           SELECT 1
           FROM public.orders o
           WHERE o.public_code = substring(p_topic FROM 7)
             AND o.created_at  > now() - interval '24 hours');
$fn$;

REVOKE ALL     ON FUNCTION public.order_topic_is_valid(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.order_topic_is_valid(text) TO anon, authenticated;

COMMENT ON FUNCTION public.order_topic_is_valid(text) IS
  'Realtime Authorization predicate for order:<public_code>. Keyed on orders.public_code (doc 03 §1.1 rename; doc 02 §7.2 wrote public_token, which does not exist). The 24h window matches public_get_order''s QR032_ORDER_EXPIRED so a leaked tracking link expires identically on both the read path and the subscribe path. The regex pre-filter means a malformed topic costs no table lookup.';


CREATE OR REPLACE FUNCTION public.table_topic_is_valid(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT p_topic ~ '^table:[A-Za-z0-9_-]{16,64}$'
     AND EXISTS (
           SELECT 1
           FROM public.tables t
           JOIN public.branches    b ON b.id = t.branch_id
           JOIN public.restaurants r ON r.id = b.restaurant_id
           WHERE t.qr_token = substring(p_topic FROM 7)
             AND t.is_active
             AND b.is_active
             AND r.is_active);
$fn$;

REVOKE ALL     ON FUNCTION public.table_topic_is_valid(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.table_topic_is_valid(text) TO anon, authenticated;

COMMENT ON FUNCTION public.table_topic_is_valid(text) IS
  'Realtime Authorization predicate for table:<qr_token>, the topic that tells a guest their waiter call was acknowledged. Requires the live token (tables.qr_token) - a token in qr_token_history is revoked and its topic dies with it, which is what makes brief §34.10 hold for subscriptions as well as for reads.';
```

Both are `STABLE`, so the Realtime server's per-message evaluation is cheap; `orders.public_code` and
`tables.qr_token` are both `UNIQUE`, so each check is a single index probe.

### 7.4 RLS on `realtime.messages` — the authorization surface

```sql
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

GRANT USAGE  ON SCHEMA realtime            TO anon, authenticated;
GRANT SELECT ON TABLE  realtime.messages   TO anon, authenticated;
-- NO INSERT GRANT. Publishing is the database's job (see the note below).

DROP POLICY IF EXISTS realtime_customer_order_read on realtime.messages;
DROP POLICY IF EXISTS realtime_staff_branch_read   on realtime.messages;

-- 1. A diner may read one order's topic, for 24 hours, if they hold the public_code.
CREATE POLICY realtime_order_topic_read ON realtime.messages
  FOR SELECT TO anon, authenticated
  USING ( realtime.topic() LIKE 'order:%'
          AND public.order_topic_is_valid(realtime.topic()) );

-- 2. A diner may read their table's topic while the table, branch and restaurant are active.
CREATE POLICY realtime_table_topic_read ON realtime.messages
  FOR SELECT TO anon, authenticated
  USING ( realtime.topic() LIKE 'table:%'
          AND public.table_topic_is_valid(realtime.topic()) );

-- 3. Staff may read their own branch's topic. has_branch_access() is doc 02 §4.4.
CREATE POLICY realtime_branch_topic_read ON realtime.messages
  FOR SELECT TO authenticated
  USING ( realtime.topic() LIKE 'branch:%'
          AND public.has_branch_access(
                nullif(split_part(realtime.topic(), ':', 2), '')::uuid) );

-- 4. NOBODY writes. Stated as a comment rather than a policy because RLS is deny-by-default:
--    with no INSERT policy and no INSERT grant, anon and authenticated cannot publish at all.
--    The trigger functions are SECURITY DEFINER owned by postgres and bypass this entirely.
COMMENT ON TABLE realtime.messages IS
  'Realtime Broadcast transport. THREE SELECT policies, ZERO INSERT policies: clients listen, only the database speaks. This is what makes channel injection impossible - a diner cannot broadcast a forged order.status_changed onto another diner''s topic, and cannot inject a fake ticket onto a branch topic.';
```

A malformed `branch:` topic would make `split_part(...)::uuid` raise. `nullif(..., '')` turns the empty
case into `NULL` (and `has_branch_access(NULL)` returns false); a non-empty non-UUID still raises
`invalid_text_representation`, which Realtime surfaces as a join failure — the correct outcome for a
client sending garbage, and one the app never produces because `branchTopic()` validates.

`realtime.messages` is partitioned by day with a short retention (~3 days on Supabase). That is
irrelevant to this design: it is a transport, never a store. No code in this product reads historical
rows from it; every screen's truth comes from `public.*` via the resync path.

### 7.5 The waiter-call broadcast trigger

```sql
-- 0016_realtime_topics.sql
CREATE OR REPLACE FUNCTION app_private.broadcast_waiter_call_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_table_no   text;
  v_table_name text;
  v_qr_token   text;
  v_event      text;
  v_at         text := to_char(clock_timestamp() AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  v_event := CASE
               WHEN TG_OP = 'INSERT'            THEN 'waiter_call.created'
               WHEN NEW.status = 'acknowledged' THEN 'waiter_call.acknowledged'
               WHEN NEW.status = 'resolved'     THEN 'waiter_call.resolved'
               ELSE NULL
             END;
  IF v_event IS NULL THEN
    RETURN NULL;   -- 'cancelled' and 'expired' need no alert; postgres_changes carries them.
  END IF;

  SELECT t.number, t.name, t.qr_token
    INTO v_table_no, v_table_name, v_qr_token
  FROM public.tables t
  WHERE t.id = NEW.table_id;

  ---------------------------------------------------------------- staff alert lane
  IF v_event <> 'waiter_call.resolved' THEN
    PERFORM realtime.send(
      jsonb_build_object(
        'v',            1,
        'event',        v_event,
        'call_id',      NEW.id,
        'table_number', v_table_no,
        'table_name',   v_table_name,
        'reason',       NEW.reason::text,
        'note',         NEW.note,
        'at',           v_at),
      v_event,
      'branch:' || NEW.branch_id::text,
      true);
  END IF;

  ---------------------------------------------------------------- guest feedback lane
  -- Minimal by design: a table topic is shared by everyone sitting there.
  IF TG_OP = 'UPDATE' AND v_qr_token IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object(
        'v',     1,
        'event', v_event,
        'reason', NEW.reason::text,
        'at',    v_at),
      v_event,
      'table:' || v_qr_token,
      true);
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'realtime broadcast failed for waiter_call %: % [%]', NEW.id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION app_private.broadcast_waiter_call_event() IS
  'Single publisher for waiter-call alerts. Replaces the inline realtime.send() that doc 02 §2.6 put inside public_call_waiter(), which must be deleted (doc 06 amendment A-5) so one status change never produces two messages. Emits waiter_call.created / .acknowledged to branch:<branch_id> for the waiter console, and .acknowledged / .resolved to table:<qr_token> so the guest sees "a waiter is on the way" (brief §10, §34.12).';

CREATE TRIGGER trg_waiter_calls_broadcast_event
  AFTER INSERT OR UPDATE OF status ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_waiter_call_event();
```

### 7.6 Migration checklist

```sql
-- 0016_realtime_topics.sql, in order:
--   1. REPLICA IDENTITY FULL on the five published tables            (§7.1)
--   2. Publication membership: drop 2, add 5                          (§7.2)
--   3. app_private.broadcast_order_event() + trg_orders_broadcast_event        (§2.5)
--   4. app_private.broadcast_waiter_call_event() + trg_waiter_calls_broadcast_event (§7.5)
--
-- 0017_realtime_authorization.sql, in order:
--   1. public.order_topic_is_valid(text)                              (§7.3)
--   2. public.table_topic_is_valid(text)                              (§7.3)
--   3. ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY        (§7.4)
--   4. grants + the three SELECT policies                             (§7.4)
--
-- Also required (doc 02, amended by A-5 and A-9):
--   - Remove the `perform realtime.send(...)` block from public.public_call_waiter().
--   - Rewrite order_items_select_staff / order_item_options_select_staff to reach branch_id
--     through the parent orders row.
```

### 7.7 Verification queries — every one must return the stated result

```sql
-- V1. Exactly five published tables, and the right five.
SELECT string_agg(tablename, ',' ORDER BY tablename)
FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
-- expected: menu_items,notifications,orders,tables,waiter_calls

-- V2. Every published table has FULL replica identity. Zero rows.
SELECT c.relname
FROM pg_publication_tables p
JOIN pg_class c ON c.relname = p.tablename
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
WHERE p.pubname = 'supabase_realtime' AND c.relreplident <> 'f';

-- V3. RLS is on for realtime.messages.
SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'realtime' AND c.relname = 'messages';
-- expected: true

-- V4. Exactly three policies on realtime.messages, all SELECT. Zero non-SELECT rows.
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'realtime' AND tablename = 'messages' AND cmd <> 'SELECT';

-- V5. No INSERT/UPDATE/DELETE privilege on realtime.messages for anon or authenticated. Zero rows.
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'realtime' AND table_name = 'messages'
  AND grantee IN ('anon','authenticated') AND privilege_type <> 'SELECT';

-- V6. anon still has zero privileges on the public schema (doc 02 §2.3 must survive this migration).
SELECT table_name, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'anon';
-- expected: zero rows

-- V7. Both topic helpers are SECURITY DEFINER with an empty search_path.
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('order_topic_is_valid','table_topic_is_valid');
-- expected: prosecdef = true and proconfig = {search_path=} for both

-- V8. public_call_waiter no longer publishes directly (amendment A-5). Zero rows.
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'public_call_waiter'
  AND pg_get_functiondef(p.oid) LIKE '%realtime.send%';

-- V9. Both broadcast triggers exist and are AFTER-row triggers.
SELECT tgname FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN ('trg_orders_broadcast_event','trg_waiter_calls_broadcast_event');
-- expected: 2 rows
```

### 7.8 pgTAP coverage (adds to doc 02 §9.1's suite)

`supabase/tests/06_realtime.sql`:

1. `set role anon;` → `select public.order_topic_is_valid('order:' || <code>)` is `true` for a
   30-minute-old order and `false` for a 25-hour-old one.
2. `set role anon;` → `order_topic_is_valid('order:../../etc')` is `false` (regex pre-filter).
3. `set role anon;` → a direct `select * from public.orders` still raises `insufficient_privilege`.
4. `table_topic_is_valid` is `false` for a token found only in `qr_token_history`, and `false` when
   the branch is deactivated.
5. `set role authenticated;` with a `WAITER` of branch A → `has_branch_access(branchB)` is `false`, so
   the branch-topic policy denies branch B.
6. Placing an order writes exactly **two** rows into `realtime.messages` (one `order:` + one `branch:`);
   a `confirmed` transition writes exactly **one** (`order:` only); a `ready` transition writes exactly
   **two**.
7. A `preparing → ready` update inside a transaction that then raises leaves **zero** rows in
   `realtime.messages` (transactionality).
8. Forcing `realtime.send` to fail (temporarily renaming it inside a savepoint) does **not** abort the
   order update — the `EXCEPTION` block holds.
9. `insert into realtime.messages` as `anon` and as `authenticated` both raise
   `insufficient_privilege`.

---

<a id="8"></a>
## 8. Failure taxonomy, capacity and the test matrix

### 8.1 Capacity

| Quantity | Per what | Notes |
|---|---|---|
| 1 WebSocket | per browser tab | The Supabase client is a module singleton |
| 1 channel | per staff tablet | `branch:{branch_id}`, multiplexed by `<RealtimeProvider>` |
| 1 channel | per open customer tracker | `order:{public_code}`, released on a terminal status |
| 1 channel | per customer table page with an open waiter call | `table:{qr_token}`, released when the call closes |
| ≤ 11 bindings | per branch channel | The fixed set in §1.5 |

A 60-table branch at full occupancy with every guest tracking: ~60 order channels + ~6 staff channels.
A 40-branch chain at peak: ~2 400 concurrent channels. That sits inside a Supabase Pro plan's
concurrent-client budget, and the per-branch channel design is what keeps it linear in *diners* rather
than in *diners × screens*.

### 8.2 What we never do

| Never | Because |
|---|---|
| Subscribe with the service-role key | It would bypass RLS in a browser. The key never leaves the server (doc 02 §1.11). |
| Put money in a broadcast payload | Two sources of truth for a number the guest pays. |
| Put rendered text in a broadcast payload | Three locales; the pusher does not know the reader's. |
| Let a broadcast handler mutate a list | §1.6's two-lane rule. |
| Trust an optimistic value past its echo or its 10 s timeout | §3.4 step 7. |
| Retry a status transition automatically after an ambiguous failure | Double-advance risk. |
| Poll as the primary transport | Brief §28. |
| Silently fall back | `<ConnectionBadge>` always says which transport is live. |

### 8.3 Test matrix

| Test | Type | Assertion |
|---|---|---|
| Reducer idempotence | unit | Applying any event twice equals applying it once, for orders and waiter calls |
| `shouldApplyStatus` | unit | Full 7×7 matrix; never regresses; `cancelled` accepted from every non-terminal state; nothing accepted from a terminal state |
| Resync generation | unit | A slow snapshot from generation N never overwrites state from generation N+1 |
| Buffer replay | unit | Events buffered during a resync, replayed after, produce the same state as if they had arrived after |
| StrictMode double mount | RTL | `acquireChannel` is called twice, `supabase.channel` **once**, `removeChannel` **zero** times |
| Handler churn | RTL | 100 parent re-renders with new inline handlers → `supabase.channel` called once |
| Branch switch | RTL | Changing `branchId` releases the old topic and acquires exactly one new one, and fires a resync |
| Terminal release | RTL | An order reaching `completed` releases its channel within one tick |
| Join timeout | RTL (fake timers) | No `SUBSCRIBED` within 8 s → badge `reconnecting` and the poller starts |
| Optimistic conflict | RTL | CAS returns null → status restored from the error, toast `order.status_conflict` fired |
| Optimistic stale | RTL (fake timers) | No echo in 10 s → overlay dropped and a targeted refetch issued |
| Chime throttle | unit | Five `order.created` alerts in 200 ms → `playNewOrderChime` invoked once |
| Alert dedupe | unit | The same `alertKey` twice within 10 s → one alert |
| Audio locked | RTL | With `AudioContext.state === 'suspended'`, `<AudioUnlockBar>` renders and no chime is attempted |
| Anon cannot read orders | pgTAP | §7.8.3 |
| Anon cannot publish | pgTAP | §7.8.9 |
| Broadcast transactionality | pgTAP | §7.8.7 |
| Broadcast failure isolation | pgTAP | §7.8.8 |
| End-to-end | Playwright | Two contexts: diner places an order → KDS card appears <2 s → KDS marks ready → diner's stepper reaches Ready <2 s without a reload |
| End-to-end | Playwright | Diner calls waiter → waiter panel shows "TABLE 12 IS CALLING" → waiter acknowledges → diner sees "A waiter is on the way" |
| Offline recovery | Playwright | `context.setOffline(true)` for 30 s while three orders are placed → back online → the KDS board matches the server exactly (resync, not drift) |

### 8.4 Operational alerting

- `RAISE WARNING 'realtime broadcast failed%'` in the Postgres log is an **alertable** condition. It
  means a status change committed with no push; the resync path repaired it, but the trigger is
  failing and must be investigated.
- A client-side counter of `CHANNEL_ERROR` per session is reported through the existing error channel
  once per session (not per error), tagged with the topic family. A spike on `order:` topics means the
  topic-validity function or the `realtime.messages` policy regressed.
- `secondsSinceFresh` exceeding 120 s on any staff panel is surfaced as the `stale` badge; that is the
  operator-visible half of the same signal.

---

<a id="9"></a>
## 9. Definition of done

1. `docs/architecture/06-realtime.md` amendments A-1 … A-10 are reflected in docs 01, 02, 03 and 05.
2. Migrations `0016_realtime_topics.sql` and `0017_realtime_authorization.sql` apply cleanly on a fresh
   `supabase db reset`, and all nine verification queries in §7.7 return the stated results.
3. `supabase/tests/06_realtime.sql` passes under pgTAP.
4. The `src/lib/realtime/**` and `src/hooks/use-*` files in §0.4 exist with exactly the signatures in
   §6, `tsc --noEmit` clean under `strict`.
5. `grep -rn "'order:\|'branch:\|'table:" src --include=*.ts --include=*.tsx` matches **only**
   `src/lib/realtime/channels.ts`.
6. `grep -rn "realtime.send" supabase/migrations` matches only `0016_realtime_topics.sql`.
7. No module outside `src/lib/realtime/**`, `src/hooks/use-realtime-*`, `use-order-status.ts`,
   `use-waiter-calls.ts` and `realtime-provider.tsx` imports `RealtimeChannel` or calls
   `supabase.channel(...)`.
8. Every test in §8.3 is green.
9. Manually verified on a real device pair: a phone on cellular tracking an order while a tablet on
   Wi-Fi runs the KDS; the tablet is put to sleep for two minutes mid-service and, on wake, its board
   matches the database with no reload and no missing ticket.
