# Restaurant QR OS (Antigravity edition)

A QR-menu restaurant system: diners scan a table's QR code, browse the menu,
order, and track the order live; the kitchen, waiters and admins each get
their own real-time screen.

**Surfaces**

| Route | Who |
|---|---|
| `/t/<token>` | Diner — menu, cart, order tracking (`/t/<token>/order/<id>`) |
| `/kitchen` | Kitchen display — live tickets, status changes |
| `/waiter` | Waiter console — ready orders, table calls |
| `/admin` | Admin — orders, menu, categories, tables & QR codes, staff, analytics, settings |

Demo tables are linked from the home page (`/`).

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5000
```

`npm run build && npm run start` runs the production build. `next start`
honours the `PORT` environment variable, which is how Railway runs it.

## Deploy on Railway

The repo carries a `railway.toml`. Point a Railway service at this branch;
Railpack detects Next.js, runs `npm run build`, then `npm run start`. No
environment variables are required.

## How data works — read this before relying on it

The data layer is an **in-process, in-memory store** (`src/lib/db/store.ts`)
seeded from `src/lib/db/seed-data.ts`. Realtime is server-sent events over
`/api/realtime`, fed by an in-process event bus.

Consequences:

- Every restart or redeploy resets all data to the seed. Orders placed in
  production are not durable.
- It is single-instance by design: two replicas would each hold a different
  store. Keep the Railway service at one replica.

This is fine for a demo and for evaluating the design; a real deployment
needs a database behind the same API routes.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 3 ·
framer-motion · lucide-react
