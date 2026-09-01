# RESTAURANT QR OS — Product Brief (source of truth)

A production-ready, premium, multi-tenant Restaurant QR Menu & Ordering System.
NOT a template, NOT a generic restaurant website, NOT a toy QR menu.
A real Restaurant Operating System: many restaurants, many branches, tables, staff, customers.

## 1. Core idea
Customer sits at a table -> scans the QR on the table -> system identifies restaurant + branch + table
-> opens the digital menu -> browse -> cart -> place order -> order goes to kitchen in real time
-> waiter notified when relevant -> customer tracks status live.
**No app download. No customer account.**

## 2. Four interfaces
- A. CUSTOMER APP — public, mobile-first QR menu.
- B. KITCHEN PANEL — real-time kitchen display system (KDS).
- C. WAITER PANEL — real-time waiter console.
- D. ADMIN PANEL — full restaurant management dashboard (SaaS-grade).

## 3. Customer flow
QR contains a secure random token: `/t/a8F3kP9x`. Public URL must NOT expose internal DB ids.
Resolution: QR TOKEN -> TABLE -> BRANCH -> RESTAURANT.
Flow: SCAN -> WELCOME -> MENU -> SELECT FOOD -> PRODUCT DETAILS -> ADD TO CART -> REVIEW CART -> PLACE ORDER -> ORDER TRACKING.

## 4. Customer interface
Mobile-first, extremely fast, beautiful, premium, simple, touch-friendly, accessible, one-handed use.
Home contains: restaurant logo, restaurant name, welcome message, table number, search field,
featured food, popular dishes, categories, active promotions, cart button with item count.
Example categories: Popular, Uzbek Cuisine, Fast Food, Salads, Drinks, Desserts.
No boring generic grid — a modern restaurant discovery experience.

## 5. Menu experience
Supports categories, search, popular items, featured items, availability status, prices, images,
dietary info, spicy level, preparation time.
Food card: image, name, short description, price, availability, add button.
Unavailable products visually distinct but must not break the UI.

## 6. Product details
Large image, name, description, price, ingredients, dietary info, spicy level, prep time,
quantity selector, optional extras, notes field ("No onion"). Increase/decrease qty, add to cart.
Feels like a premium modern mobile application.

## 7. Cart
Image, name, selected extras, quantity controls, per-line price, total.
Subtotal / service fee (if enabled) / total. CTA: PLACE ORDER.
Before creating order validate: table active, restaurant active, branch active, products available, prices valid.
**Never trust prices from the frontend. Backend calculates the final price.**

## 8. Order tracking
Premium visual tracker. Statuses: pending, confirmed, preparing, ready, delivered, completed, cancelled.
Real-time updates without manual refresh. Invalid status transitions rejected.

## 9. Kitchen Display System
Optimized for speed. Large readable cards. Three columns: NEW / PREPARING / READY.
Card shows: order number, table number, items, quantity, customer notes, created time, elapsed prep time.
Actions: accept order, start preparing, mark ready. Real-time incoming orders with a clear notification.
Late orders visually flagged. Speed and readability over decoration.

## 10. Waiter panel
Active Orders, Ready Orders, Table Calls. Customer presses CALL WAITER -> waiter panel instantly shows
"TABLE 12 IS CALLING". Waiter acknowledges. Cooldown prevents spam. Waiter sees only their assigned branch.

## 11. Admin dashboard
Premium SaaS-style. Nav: Dashboard, Orders, Menu, Categories, Tables, Branches, Staff, Analytics, Settings.
Dashboard: today's revenue, today's orders, average order value, active tables, pending orders,
most popular dishes, order status overview. No fake analytics — real data only; demo data clearly separated.

## 12. Menu management
Categories: create, edit, reorder, activate/deactivate.
Items: name, description, category, price, image, ingredients, prep time, spicy level, availability, optional extras.
Temporary unavailability supported (AVAILABLE -> UNAVAILABLE blocks ordering).

## 13. Table management
Create/edit/disable table, assign number, generate QR token, regenerate QR token, download QR code.
Unique cryptographically secure random token. Never predictable/sequential.
GOOD: /t/K9f3PqA7xL   BAD: /table/12

## 14. QR system
`https://<domain>/t/<SECURE_RANDOM_TOKEN>` resolves restaurant/branch/table. Supports regeneration;
old token can be disabled.

## 15. Multi-restaurant SaaS architecture
PLATFORM -> RESTAURANTS -> BRANCHES. Strict data isolation: a restaurant must never access another's
orders, menu, tables, employees, analytics. Database + authorization model must enforce it.

## 16. Roles (RBAC)
SUPER_ADMIN (full platform), RESTAURANT_OWNER (their restaurant), MANAGER (menu/tables/orders/staff per permission),
WAITER (assigned branch orders + waiter calls), KITCHEN (kitchen-relevant orders).
Never rely only on frontend checks. Enforce on backend/database layer.

## 17-25. Database (PostgreSQL)
Tables required: restaurants, branches, profiles, staff, tables, menu_categories, menu_items,
menu_item_options, orders, order_items, order_status_history, waiter_calls, notifications.
Every business entity: id, created_at, updated_at. Proper foreign keys and indexes.

- restaurants: id, name, slug, logo_url, phone, is_active, created_at, updated_at
- branches: id, restaurant_id, name, address, phone, timezone, is_active, created_at, updated_at
- tables: id, branch_id, name, number, qr_token (UNIQUE), is_active, created_at, updated_at
- menu_categories: id, restaurant_id, branch_id, name, image_url, sort_order, is_active, created_at, updated_at
- menu_items: id, restaurant_id, branch_id, category_id, name, description, price, image_url, ingredients,
  spicy_level, preparation_time, is_available, created_at, updated_at
- orders: id, restaurant_id, branch_id, table_id, order_number, status, subtotal, service_fee, total, created_at, updated_at
- order_items: id, order_id, menu_item_id, name_snapshot, price_snapshot, quantity, total, created_at
- order_status_history: id, order_id, previous_status, new_status, changed_by, created_at

Money: never floating point. Snapshots on order_items are MANDATORY (historical accuracy when items are
renamed, repriced, deleted or made unavailable). Order number human-friendly, internal id separate.
Every important status transition recorded.

## 26. Order state machine
pending -> confirmed -> preparing -> ready -> delivered -> completed.
Cancellation rules explicit. Invalid transitions rejected (completed -> preparing NOT ALLOWED;
cancelled -> ready NOT ALLOWED). Logic centralised on the backend.

## 27. Security
Secure auth, RBAC, Row-Level Security, restaurant data isolation, branch-level restrictions,
secure random QR tokens, input validation, server-side price calculation, order state validation,
rate limiting, order-spam protection, waiter-call-spam protection.
Never expose sensitive DB data to public users. Public QR users see only their table's context.

## 28. Real-time
New order -> kitchen instantly. Kitchen status change -> customer sees it. Ready -> waiter notified.
Customer calls waiter -> waiter panel notified. Do not use polling as the primary mechanism.

## 29. Stack
Next.js + TypeScript, Tailwind CSS, modular reusable component architecture,
Supabase + PostgreSQL, Supabase Auth, Supabase Realtime, Supabase Storage, secure server-generated QR.
Architecture modular enough to migrate backend later.

## 30. UI direction
Premium startup product. AVOID: generic dashboards, default templates, rounded cards everywhere,
gradient overuse, shadow overuse, generic stock SaaS look, cartoonish visuals, cluttered screens.
USE: strong visual hierarchy, clean typography, premium spacing, intentional animation,
high-quality food imagery, smooth micro-interactions, clear empty/loading/error states, responsive layouts.
Customer menu = warm and attractive. Kitchen = speed. Admin = professional SaaS.

## 31. Responsive
Mobile = primary customer experience. Tablet = kitchen + waiter. Desktop = admin.

## 32. States
Every important screen: loading, empty, error. Cases: no menu items, no orders, restaurant closed,
table inactive, invalid QR, product unavailable, network error. No blank or broken pages.

## 33. MVP priority order
P1 auth + restaurant structure + branches + tables + secure QR tokens
P2 categories + menu management + items + images
P3 public QR menu + product details + cart
P4 order creation + server-side validation + state machine
P5 kitchen panel + real-time orders
P6 waiter panel + waiter calls
P7 admin dashboard + basic analytics
No AI recommendations in MVP. No complex payment integrations until ordering is stable.

## 34. Critical business rules
1 public user cannot change table identity manually. 2 prices always server-calculated.
3 cannot order unavailable products. 4 historical orders preserve snapshots.
5 no cross-restaurant access. 6 waiters only their branch. 7 kitchen only relevant orders.
8 invalid transitions rejected. 9 QR tokens unpredictable. 10 old tokens invalidatable.
11 customer orders need no account. 12 every important action gives clear feedback.

## 35. Engineering requirements
Real functional system, not a fake prototype. Clean, maintainable, production-oriented code.
Modular architecture, no giant files. Reusable components and services. Meaningful error handling.
Scales from one restaurant to many without rewriting the core.

## Localisation
Trilingual: Uzbek (uz), Russian (ru), English (en). All customer, staff and admin UI strings localised.

## Visual reference (from the user's pinned inspiration)
Dark, warm, cinematic fine-dining aesthetic: near-black backgrounds, warm gold accents, deep wine
secondary, cream text, elegant serif display type paired with a clean sans, candle-lit food photography,
generous spacing, thin gold rules/dividers, restrained ornament. Premium, editorial, not templated.
