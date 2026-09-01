# 07 — Localisation Architecture & Content / Seed Data

**Status:** frozen specification. Implement exactly.
**Owns:** `src/types/i18n.ts` (message half), `src/lib/i18n/**`, `src/messages/**`,
`src/hooks/use-locale.ts`, `src/hooks/use-translate.ts`,
`src/components/common/{locale-provider,locale-switcher,translate,i18n-text}.tsx`,
`src/lib/utils/datetime.ts`, `supabase/seed.sql`, `src/lib/demo/fixtures/**`.
**Depends on:** doc 01 (schema, `public.i18n_text`), doc 02 (RPC/wire error codes),
doc 03 (`Locale`, `I18nText`, `BCP47`, `Money`, `formatMoney`, `AppErrorCode`, `QrErrorCode`),
doc 04 (design tokens), doc 05 (route tree, `resolveLocale` placement, cookie rules).

---

## 0. Reconciliation with docs 03 and 05 — read this first

Three points in the earlier docs are *narrowed or superseded here*. Nothing else changes.
Where this table says **supersedes**, this document wins and the earlier line is a stale draft.

| Earlier text | This document | Why |
|---|---|---|
| doc 03 §2.1: `export type MessageKey = string;` | **Supersedes**: `MessageKey = DictionaryPath` — a generated union of the ~600 real dot-paths. It is a subtype of `string`, so every existing signature (`messageKeyFor(): string`, `APP_ERROR_MESSAGE_KEYS: Record<AppErrorCode, string>`) still compiles unchanged. | A `string` key type makes a typo a runtime blank. §1.3. |
| doc 03 §2.1: `export type Messages = Readonly<Record<MessageKey, string>>;` | **Supersedes**: `export type Messages = Dictionary;` — the nested, fully-typed shape in §1.2. `getMessages(locale)` keeps its name, signature and call site in `src/app/layout.tsx`. | A flat `Record` cannot express "every locale has every key"; the nested interface makes a missing key a compile error. |
| doc 05 §8.7: demo restaurant "Oshxona", slug `oshxona`, 3 tables, 26 items | **Supersedes**: "Samarqand Osh Xonasi", slug `samarqand-osh-xonasi`, **12 tables**, **37 items**. Branch names (`Chorsu`, `Yunusobod`), branch codes (`A`, `B`), timezone (`Asia/Tashkent`), `currency: 'UZS'`, `currency_decimals: 0`, `default_locale: 'uz'`, `service_fee_enabled: true`, `service_fee_bps: 1000`, and `DEMO_TOKEN = 'DEMOxK9f3PqA7xLmZ2vRt6'` are **unchanged**. | Doc 05 named a placeholder; content is this document's assignment. The demo token is a routing constant, not content, so it survives. §5. |

Three files listed in doc 05 §1 that this document adds detail to but does not move:
`src/messages/{uz,ru,en}.json`, `src/lib/i18n/{locale,t,messages}.ts`, `src/lib/utils/datetime.ts`.
Four files this document **adds** to the tree: `src/lib/i18n/dictionary.ts`, `src/lib/i18n/plural.ts`,
`src/lib/i18n/format.ts`, `scripts/check-seed-parity.ts`.

---

## 1. The i18n architecture

### 1.1 Shape of the decision

Five properties are non-negotiable, and they force the design:

1. **A missing key is a compile error, not a blank span.** Three parallel catalogues drift the
   moment one person adds a key. Types must catch it before CI does.
2. **No locale URL prefix** (frozen). The locale is a cookie plus an optional `?lang=`.
   `/t/K9f3PqA7xL` must stay short enough to print under a QR code.
3. **Server-rendered by default.** The customer menu is RSC; the language must be known *before*
   the first byte, not hydrated in afterwards. No flash of Uzbek on a Russian phone.
4. **One catalogue per request, not per component.** The whole dictionary for one locale is ~45 KB
   of JSON. It is loaded once in the root layout, passed through a single client context, and never
   fetched again on navigation.
5. **UI language and content language are different things.** The UI string "Add to cart" comes from
   the catalogue. The dish name "Osh" comes from a database `i18n_text` column with its own fallback
   chain (§4). Conflating them produces a menu that says "Plov" in an Uzbek UI.

The consequence: **the catalogue is JSON on disk (translator-editable, doc 05 froze the paths) but
is imported through typed modules that `satisfies Dictionary`.** JSON gives us a file a non-developer
can edit; `satisfies` gives us the compile error. Nothing is generated at build time.

### 1.2 `src/lib/i18n/dictionary.ts` — the `Dictionary` type

This interface is the single definition of "what strings exist". `en.json` is the canonical
authoring locale; `uz.json` and `ru.json` must match it key-for-key.

```ts
// src/lib/i18n/dictionary.ts
// The shape of one locale's complete message catalogue.
// Adding a key here without adding it to all three JSON files is a compile error.
// Adding it to a JSON file without adding it here is caught by messages.test.ts (§1.9).

/** A plural message. All four CLDR categories are present in every locale, always. */
export interface PluralForms {
  /** n = 1 */
  one: string;
  /** ru: n%10 in 2..4 and n%100 not in 12..14. uz/en: duplicate of `other`. */
  few: string;
  /** ru: everything else. uz/en: duplicate of `other`. */
  many: string;
  /** The catch-all. Uzbek uses this form for every n != 1; the noun does not inflect. */
  other: string;
}

/** loading / empty / error shells share this triple. `cta` is optional per screen. */
export interface StateCopy {
  title: string;
  body: string;
}

export interface Dictionary {
  common: {
    appName: string; tagline: string; yes: string; no: string; ok: string;
    cancel: string; save: string; saving: string; saved: string; edit: string;
    delete: string; deleting: string; remove: string; add: string; create: string;
    close: string; back: string; next: string; previous: string; continue: string;
    confirm: string; retry: string; refresh: string; search: string; filter: string;
    clear: string; clearAll: string; apply: string; reset: string; select: string;
    none: string; all: string; showMore: string; showLess: string; copy: string;
    copied: string; download: string; print: string; export: string; required: string;
    optional: string; active: string; inactive: string; available: string;
    unavailable: string; language: string; actions: string; status: string;
    total: string; quantity: string; price: string; name: string; description: string;
    image: string; category: string; notes: string; phone: string; email: string;
    address: string; time: string; date: string; from: string; to: string;
    free: string; new: string; justNow: string; unnamed: string; notSet: string;
  };

  nav: {
    home: string; menu: string; cart: string; orders: string; tracking: string;
    kitchen: string; waiter: string; admin: string; dashboard: string;
    categories: string; menuManagement: string; tables: string; branches: string;
    staff: string; analytics: string; settings: string; platform: string;
    profile: string; signOut: string; openMenu: string; closeMenu: string;
    backToMenu: string;
  };

  customer: {
    welcome: {
      eyebrow: string; greeting: string; tableLabel: string; intro: string;
      viewMenu: string; chooseLanguage: string; openNow: string; closedNow: string;
      closedTitle: string; closedBody: string; notAcceptingTitle: string;
      notAcceptingBody: string; poweredBy: string; scanAgain: string;
    };
    menu: {
      title: string; searchPlaceholder: string; searchLabel: string; resultsFor: string;
      noResultsTitle: string; noResultsBody: string; clearSearch: string;
      allCategories: string; popularTitle: string; popularSubtitle: string;
      featuredTitle: string; featuredSubtitle: string; promotionsTitle: string;
      categoriesTitle: string; viewCategory: string; addToCart: string; added: string;
      unavailable: string; unavailableUntil: string; prepMinutes: string;
      spicyLabel: string; dietaryLabel: string; cartButton: string; jumpToCategory: string;
    };
    item: {
      backToMenu: string; ingredientsTitle: string; dietaryTitle: string;
      prepTitle: string; spicyTitle: string; caloriesTitle: string; caloriesValue: string;
      quantityTitle: string; optionsTitle: string; chooseOne: string; chooseUpTo: string;
      chooseAtLeast: string; optionRequired: string; optionUnavailable: string;
      noteTitle: string; notePlaceholder: string; noteHint: string; addToCart: string;
      addToCartTotal: string; updateItem: string; unavailableTitle: string;
      unavailableBody: string; notFoundTitle: string; notFoundBody: string;
    };
    cart: {
      title: string; subtitle: string; emptyTitle: string; emptyBody: string;
      emptyCta: string; lineExtras: string; lineNote: string; editLine: string;
      removeLine: string; removeConfirmTitle: string; removeConfirmBody: string;
      clear: string; clearConfirmTitle: string; clearConfirmBody: string;
      subtotal: string; serviceFee: string; serviceFeeHint: string; discount: string;
      total: string; guestName: string; guestNamePlaceholder: string; guestCount: string;
      orderNote: string; orderNotePlaceholder: string; placeOrder: string;
      placing: string; addMore: string; priceChangedTitle: string;
      priceChangedBody: string; itemsRemovedTitle: string; itemsRemovedBody: string;
      estimatedTime: string;
    };
    checkout: {
      confirmTitle: string; confirmBody: string; confirmCta: string; successTitle: string;
      successBody: string; orderNumberLabel: string; trackOrder: string;
      backToMenu: string; keepThisPage: string; sending: string;
    };
    tracking: {
      title: string; orderNumber: string; placedAt: string; tableLabel: string;
      estimatedReady: string; readyNow: string; itemsTitle: string; totalsTitle: string;
      timelineTitle: string; cancelOrder: string; cancelConfirmTitle: string;
      cancelConfirmBody: string; cancelWindowOverTitle: string; cancelWindowOverBody: string;
      cancelledTitle: string; cancelledBody: string; completedTitle: string;
      completedBody: string; callWaiter: string; backToMenu: string; notFoundTitle: string;
      notFoundBody: string; recentOrders: string; viewOrder: string; live: string;
      reconnecting: string; polling: string; lastUpdated: string;
    };
    waiterCall: {
      cta: string; sheetTitle: string; sheetBody: string; reasonLabel: string;
      notePlaceholder: string; send: string; sending: string; sentTitle: string;
      sentBody: string; pendingTitle: string; pendingBody: string;
      acknowledgedTitle: string; acknowledgedBody: string; cooldownTitle: string;
      cooldownBody: string; alreadyOpenTitle: string;
    };
  };

  kitchen: {
    title: string; subtitle: string; branchLabel: string; columnNew: string;
    columnPreparing: string; columnReady: string; ticketTable: string;
    ticketTakeaway: string; placedAgo: string; elapsed: string; dueIn: string;
    overdueBy: string; lateBadge: string; guestNote: string; itemNote: string;
    accept: string; startPreparing: string; markReady: string; markDelivered: string;
    undo: string; newOrderTitle: string; newOrderBody: string; soundOn: string;
    soundOff: string; keepAwakeOn: string; keepAwakeOff: string; fullscreen: string;
    exitFullscreen: string; emptyNew: StateCopy; emptyPreparing: StateCopy;
    emptyReady: StateCopy; connectionLive: string; connectionReconnecting: string;
    connectionOffline: string;
  };

  waiter: {
    title: string; subtitle: string; branchLabel: string; tabActive: string;
    tabReady: string; tabCalls: string; callBannerTitle: string; callBannerBody: string;
    tableCalling: string; acknowledge: string; acknowledging: string;
    acknowledged: string; resolve: string; resolved: string; callAge: string;
    callNote: string; acknowledgedBy: string; serve: string; markDelivered: string;
    complete: string; orderTable: string; emptyActive: StateCopy; emptyReady: StateCopy;
    emptyCalls: StateCopy; newCallTitle: string; newCallBody: string;
    orderReadyTitle: string; noBranch: StateCopy;
  };

  admin: {
    dashboard: {
      title: string; subtitle: string; todayRevenue: string; todayOrders: string;
      avgOrderValue: string; activeTables: string; pendingOrders: string;
      openCalls: string; popularDishes: string; statusOverview: string;
      revenueTrend: string; vsYesterday: string; periodToday: string;
      periodWeek: string; periodMonth: string; viewAllOrders: string; liveFeed: string;
      branchFilter: string; allBranches: string; noData: StateCopy;
    };
    orders: {
      title: string; subtitle: string; filterStatus: string; filterBranch: string;
      filterDate: string; searchPlaceholder: string; colNumber: string; colTable: string;
      colStatus: string; colItems: string; colTotal: string; colPlaced: string;
      colBranch: string; detailTitle: string; detailItems: string; detailTotals: string;
      detailTimeline: string; detailCustomer: string; changeStatus: string;
      confirmOrder: string; cancelOrder: string; cancelReasonLabel: string;
      cancelReasonPlaceholder: string; cancelReasonRequired: string; printTicket: string;
      exportCsv: string; empty: StateCopy;
    };
    menu: {
      title: string; subtitle: string; newItem: string; editItem: string;
      duplicateItem: string; deleteItem: string; deleteConfirmTitle: string;
      deleteConfirmBody: string; fieldName: string; fieldDescription: string;
      fieldIngredients: string; fieldCategory: string; fieldPrice: string;
      fieldCompareAtPrice: string; fieldImage: string; fieldPrepTime: string;
      fieldSpicy: string; fieldCalories: string; fieldDietary: string;
      fieldFeatured: string; fieldPopular: string; availability: string;
      markAvailable: string; markUnavailable: string; unavailableUntilLabel: string;
      optionsTitle: string; optionsHint: string; addOptionGroup: string;
      groupLabel: string; groupSelection: string; groupMin: string; groupMax: string;
      addOption: string; optionName: string; optionPriceDelta: string;
      optionDefault: string; translationsTitle: string; missingTranslation: string;
      missingTranslationHint: string; uploadImage: string; uploadHint: string;
      reorderHint: string; filterCategory: string; filterAvailability: string;
      empty: StateCopy; emptyCta: string;
    };
    categories: {
      title: string; subtitle: string; newCategory: string; editCategory: string;
      deleteCategory: string; deleteConfirmTitle: string; deleteConfirmBody: string;
      deleteBlockedTitle: string; deleteBlockedBody: string; fieldName: string;
      fieldDescription: string; fieldIcon: string; fieldBranch: string;
      allBranches: string; reorderHint: string; itemsInCategory: string;
      empty: StateCopy; emptyCta: string;
    };
    tables: {
      title: string; subtitle: string; newTable: string; editTable: string;
      fieldNumber: string; fieldName: string; fieldZone: string; fieldSeats: string;
      fieldBranch: string; qrTitle: string; qrHint: string; viewQr: string;
      downloadPng: string; downloadSvg: string; printSheet: string; tableUrl: string;
      copyUrl: string; rotateToken: string; rotateConfirmTitle: string;
      rotateConfirmBody: string; rotateReasonLabel: string; rotationCount: string;
      issuedAt: string; deactivate: string; activate: string;
      deactivateConfirmTitle: string; deactivateConfirmBody: string;
      empty: StateCopy; emptyCta: string;
    };
    branches: {
      title: string; subtitle: string; newBranch: string; editBranch: string;
      fieldName: string; fieldCode: string; fieldCodeHint: string; fieldAddress: string;
      fieldTimezone: string; fieldOpeningHours: string; fieldServiceFee: string;
      fieldServiceFeeInherit: string; fieldWaiterCooldown: string;
      fieldOrderInterval: string; fieldPrepDefault: string; fieldLateThreshold: string;
      acceptingOrders: string; pauseOrders: string; resumeOrders: string;
      pausedNotice: string; tableCount: string; staffCount: string;
      empty: StateCopy; emptyCta: string;
    };
    staff: {
      title: string; subtitle: string; invite: string; inviteTitle: string;
      inviteBody: string; fieldEmail: string; fieldFullName: string; fieldRole: string;
      fieldBranch: string; fieldEmployeeCode: string; allBranches: string;
      inviteSent: string; resendInvite: string; revokeInvite: string;
      pendingInvite: string; joinedAt: string; lastSeen: string; neverSignedIn: string;
      deactivate: string; reactivate: string; deactivateConfirmTitle: string;
      deactivateConfirmBody: string; lastOwner: StateCopy; empty: StateCopy;
      emptyCta: string;
    };
    analytics: {
      title: string; subtitle: string; rangeToday: string; rangeWeek: string;
      rangeMonth: string; rangeCustom: string; revenue: string; orders: string;
      avgTicket: string; itemsSold: string; topItems: string; topCategories: string;
      byHour: string; byBranch: string; byStatus: string; peakHour: string;
      exportCsv: string; noData: StateCopy;
    };
    settings: {
      title: string; subtitle: string; tabGeneral: string; tabBranding: string;
      tabOrdering: string; tabDanger: string; restaurantName: string; slug: string;
      slugHint: string; logo: string; coverImage: string; welcomeMessage: string;
      welcomeMessageHint: string; description: string; defaultLocale: string;
      defaultLocaleHint: string; currency: string; currencyDecimals: string;
      currencyHint: string; serviceFeeEnabled: string; serviceFeeRate: string;
      serviceFeeHint: string; dangerTitle: string; deactivateRestaurant: string;
      deactivateConfirmTitle: string; deactivateConfirmBody: string;
    };
    platform: {
      title: string; subtitle: string; restaurantsCount: string; branchesCount: string;
      ordersToday: string; colRestaurant: string; colSlug: string; colBranches: string;
      colOrders: string; colCreated: string; demoBadge: string; empty: StateCopy;
    };
  };

  auth: {
    signInTitle: string; signInSubtitle: string; email: string; emailPlaceholder: string;
    password: string; passwordPlaceholder: string; showPassword: string;
    hidePassword: string; signIn: string; signingIn: string; forgotPassword: string;
    resetTitle: string; resetSubtitle: string; sendResetLink: string; sending: string;
    resetSent: StateCopy; newPasswordTitle: string; newPassword: string;
    confirmPassword: string; updatePassword: string; passwordUpdated: StateCopy;
    inviteTitle: string; inviteSubtitle: string; fullName: string;
    preferredLanguage: string; acceptInvite: string; accepting: string;
    signOut: string; signOutConfirmTitle: string; signOutConfirmBody: string;
    backToSignIn: string; staffOnly: StateCopy;
  };

  errors: {
    /** Keyed by AppErrorCode (doc 03 §8.4). Twelve, exhaustive. */
    app: {
      TABLE_INACTIVE: string; INVALID_QR: string; RESTAURANT_CLOSED: string;
      ITEM_UNAVAILABLE: string; PRICE_MISMATCH: string; INVALID_TRANSITION: string;
      RATE_LIMITED: string; FORBIDDEN: string; NOT_FOUND: string;
      VALIDATION_FAILED: string; NETWORK: string; UNKNOWN: string;
    };
    validation: {
      required: string; invalid: string; email: string; phone: string; slug: string;
      url: string; tooShort: string; tooLong: string; tooSmall: string; tooBig: string;
      integer: string; positive: string; nonNegative: string; passwordWeak: string;
      passwordMismatch: string; i18nAtLeastOne: string; i18nTooLong: string;
      invalidLocale: string; invalidTime: string; fileTooLarge: string;
      fileType: string; duplicateValue: string;
    };
    generic: {
      title: string; body: string; retry: string; traceLabel: string;
      notFoundTitle: string; notFoundBody: string; forbiddenTitle: string;
      forbiddenBody: string; offlineTitle: string; offlineBody: string;
      serverTitle: string; serverBody: string; goHome: string;
    };
    /* The 27 wire codes (doc 03 §8.4 QrErrorCode). messageKeyFor() returns
       `errors.${wire}`, so these are siblings of `app`/`validation`/`generic`. */
    QR001_INVALID_QR_TOKEN: string;
    QR002_TABLE_INACTIVE: string;
    QR003_BRANCH_INACTIVE: string;
    QR004_RESTAURANT_INACTIVE: string;
    QR010_ORDER_RATE_LIMITED: string;
    QR011_WAITER_CALL_COOLDOWN: string;
    QR012_WAITER_CALL_ALREADY_OPEN: string;
    QR013_DUPLICATE_ORDER: string;
    QR020_ITEM_UNAVAILABLE: string;
    QR022_INVALID_OPTION: string;
    QR023_INVALID_PAYLOAD: string;
    QR024_QUANTITY_OUT_OF_RANGE: string;
    QR030_ORDER_NOT_FOUND: string;
    QR030_NOT_FOUND: string;
    QR032_ORDER_EXPIRED: string;
    QR040_INVALID_STATUS_TRANSITION: string;
    QR041_INVALID_CALL_TRANSITION: string;
    QR042_CANCEL_REASON_REQUIRED: string;
    QR043_ORDER_CLOSED: string;
    QR050_FORBIDDEN: string;
    QR051_LAST_OWNER: string;
    QR052_FORBIDDEN_FIELD: string;
    QR053_IMMUTABLE_COLUMN: string;
    QR054_COLUMN_NOT_ALLOWED: string;
    QR055_PRIVILEGE_ESCALATION: string;
    QR056_SELF_MODIFICATION: string;
    QR999_INTERNAL: string;
  };

  states: {
    loading: {
      generic: string; menu: string; item: string; cart: string; order: string;
      tracking: string; kitchen: string; waiter: string; dashboard: string;
      orders: string; menuAdmin: string; tables: string; branches: string;
      staff: string; analytics: string; settings: string;
    };
    error: {
      generic: StateCopy; menu: StateCopy; item: StateCopy; cart: StateCopy;
      order: StateCopy; tracking: StateCopy; kitchen: StateCopy; waiter: StateCopy;
      dashboard: StateCopy; orders: StateCopy; menuAdmin: StateCopy; tables: StateCopy;
      branches: StateCopy; staff: StateCopy; analytics: StateCopy; settings: StateCopy;
    };
    empty: StateCopy;
    offline: StateCopy;
    notFound: StateCopy;
    demo: { banner: string; badge: string; body: string };
  };

  status: {
    /** Staff-facing label for orders.status. Seven, exhaustive. */
    order: {
      pending: string; confirmed: string; preparing: string; ready: string;
      delivered: string; completed: string; cancelled: string;
    };
    /** Guest-facing sentence on the tracking page. Same seven. */
    orderCustomer: {
      pending: string; confirmed: string; preparing: string; ready: string;
      delivered: string; completed: string; cancelled: string;
    };
    /** waiter_calls.status. Five, exhaustive. */
    call: {
      pending: string; acknowledged: string; resolved: string; cancelled: string;
      expired: string;
    };
  };

  labels: {
    role: {
      SUPER_ADMIN: string; RESTAURANT_OWNER: string; MANAGER: string; WAITER: string;
      KITCHEN: string;
    };
    dietary: {
      vegetarian: string; vegan: string; halal: string; gluten_free: string;
      lactose_free: string; nut_free: string; contains_nuts: string;
      contains_seafood: string; contains_pork: string; contains_alcohol: string;
    };
    spicy: { '0': string; '1': string; '2': string; '3': string };
    orderType: { dine_in: string; takeaway: string };
    channel: { qr: string; waiter: string; admin: string };
    callReason: {
      call_waiter: string; request_bill: string; request_water: string;
      request_cutlery: string; clean_table: string; complaint: string; other: string;
    };
    promoType: {
      announcement: string; percentage: string; fixed_amount: string;
      special_price: string;
    };
    locale: { uz: string; ru: string; en: string };
    selectionType: { single: string; multiple: string };
  };

  toasts: {
    saved: string; deleted: string; copied: string; itemAdded: string;
    itemRemoved: string; cartCleared: string; orderPlaced: string;
    orderCancelled: string; waiterCalled: string; waiterAcknowledged: string;
    statusUpdated: string; qrRotated: string; inviteSent: string;
    languageChanged: string; backOnline: string; wentOffline: string;
    newOrder: string; orderReady: string; orderLate: string; newWaiterCall: string;
    saveFailed: string; actionFailed: string;
  };

  a11y: {
    skipToContent: string; closeDialog: string; openCart: string;
    increaseQuantity: string; decreaseQuantity: string; removeNamedItem: string;
    loading: string; languageSwitcher: string; mainNavigation: string;
    currentPage: string; expand: string; collapse: string; requiredField: string;
    spicyLevelLabel: string; orderStatusLabel: string;
  };

  plurals: {
    items: PluralForms; dishes: PluralForms; orders: PluralForms; tables: PluralForms;
    branches: PluralForms; staff: PluralForms; categories: PluralForms;
    guests: PluralForms; results: PluralForms; minutes: PluralForms;
    seconds: PluralForms; hours: PluralForms; days: PluralForms; extras: PluralForms;
    calls: PluralForms;
  };
}
```

**Key count: 884 leaf strings per locale** (`plurals` contributes 15 keys / 60 leaves; each
`StateCopy` contributes its two leaves). **2 652 strings across the three files**, verified by
`messages.test.ts` gate 1.

### 1.3 `MessageKey` — the dot-path union

```ts
// src/lib/i18n/dictionary.ts (continued)

/**
 * Every legal dot-path into Dictionary, computed from the interface.
 * 'customer.cart.placeOrder' ✓   'customer.cart.placeorder' ✗ (compile error)
 * Plural keys resolve to the PluralForms node, e.g. 'plurals.items' — not to its leaves.
 */
export type DictionaryPath<T = Dictionary> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends PluralForms
      ? K
      : `${K}.${DictionaryPath<T[K]>}`;
}[keyof T & string];

/** Paths whose value is a plain string (everything translate() may return). */
export type StringPath<T = Dictionary> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends PluralForms
      ? never
      : `${K}.${StringPath<T[K]>}`;
}[keyof T & string];

/** Paths whose value is a PluralForms node (everything translatePlural() accepts). */
export type PluralPath = Extract<DictionaryPath, `plurals.${string}`>;
```

`src/types/i18n.ts` re-exports these so doc 03's import sites keep working:

```ts
// src/types/i18n.ts — final content (supersedes doc 03 §2.1's last two lines)
import type { Dictionary, StringPath } from '@/lib/i18n/dictionary';

export const LOCALES = ['uz', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'uz';

/** Content fallback order when an i18n_text lacks the active locale. §4.3. */
export const LOCALE_FALLBACK_ORDER: readonly Locale[] = ['uz', 'ru', 'en'] as const;

/** public.i18n_text. Keys optional individually; at least one non-empty (DB-enforced). */
export type I18nText = Partial<Record<Locale, string>>;

/** BCP-47 tags used for Intl formatting. */
export const BCP47: Readonly<Record<Locale, string>> = {
  uz: 'uz-UZ',
  ru: 'ru-RU',
  en: 'en-US',
};

/** Text direction. All three locales are LTR; the field exists so a future `ar`/`fa` is a data change. */
export const DIRECTION: Readonly<Record<Locale, 'ltr' | 'rtl'>> = { uz: 'ltr', ru: 'ltr', en: 'ltr' };

/** A dot-path whose value is a plain string. Assignable to string — doc 03's signatures still compile. */
export type MessageKey = StringPath;
/** One locale's complete catalogue. */
export type Messages = Dictionary;

export type { Dictionary, DictionaryPath, PluralPath, PluralForms, StateCopy } from '@/lib/i18n/dictionary';
```

### 1.4 The three catalogue modules

```ts
// src/lib/i18n/catalogues.ts
import 'server-only'; // the catalogue is chosen on the server; the client receives one, not three
import type { Dictionary } from '@/lib/i18n/dictionary';
import uzJson from '@/messages/uz.json';
import ruJson from '@/messages/ru.json';
import enJson from '@/messages/en.json';

/**
 * `satisfies` is doing the work: TypeScript infers the exact shape of each JSON literal
 * and checks it against Dictionary. A missing key, a misspelt key, or a string where a
 * PluralForms belongs fails `npm run typecheck` — the JSON never has to be hand-audited.
 * (`resolveJsonModule: true` is already set in tsconfig.json.)
 */
export const uz = uzJson satisfies Dictionary;
export const ru = ruJson satisfies Dictionary;
export const en = enJson satisfies Dictionary;

/**
 * `satisfies` does NOT reject *extra* keys in an imported JSON module (excess-property
 * checking applies only to fresh object literals), so this second assertion closes the hole:
 * any key present in the JSON but absent from Dictionary resolves to `never` and fails.
 */
type NoExtraKeys<T, Shape> = T extends string
  ? unknown
  : { [K in keyof T]: K extends keyof Shape ? NoExtraKeys<T[K], Shape[K]> : never };

const _uzExact: NoExtraKeys<typeof uzJson, Dictionary> = uzJson;
const _ruExact: NoExtraKeys<typeof ruJson, Dictionary> = ruJson;
const _enExact: NoExtraKeys<typeof enJson, Dictionary> = enJson;
void _uzExact; void _ruExact; void _enExact;

export const CATALOGUES: Readonly<Record<'uz' | 'ru' | 'en', Dictionary>> = { uz, ru, en };
```

### 1.5 `src/lib/i18n/messages.ts` — `getDictionary` / `getMessages` / `translate`

```ts
// src/lib/i18n/messages.ts
import 'server-only';
import { CATALOGUES } from '@/lib/i18n/catalogues';
import { plural, type PluralCategory } from '@/lib/i18n/plural';
import type { Dictionary, PluralForms, PluralPath, StringPath } from '@/lib/i18n/dictionary';
import { DEFAULT_LOCALE, type Locale } from '@/types/i18n';

/** Values allowed in an interpolation. Objects are rejected at the type level. */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * The whole catalogue for one locale. Synchronous and allocation-free: all three JSON
 * modules are in the server bundle already, so there is nothing to await. The signature
 * is `Promise`-free; doc 05's `const messages = await getMessages(locale)` still works
 * because `await` on a non-promise is a no-op.
 */
export function getDictionary(locale: Locale): Dictionary {
  return CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
}

/** doc 03 / doc 05 call this name. Identical function, kept as the compatibility alias. */
export const getMessages = getDictionary;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Replaces `{name}` with params.name. `{{` is a literal `{`. Unknown params stay verbatim. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
  return template
    .replace(PLACEHOLDER, (match, key: string) => {
      const value = params[key];
      if (value === undefined) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[i18n] missing param "${key}" for "${template}"`);
        }
        return match;
      }
      return String(value);
    })
    .replace(/\{\{/g, '{')
    .replace(/\}\}/g, '}');
}

function walk(dict: Dictionary, key: string): unknown {
  let node: unknown = dict;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Resolve one message. Typed keys mean the `undefined` branch is unreachable in
 * application code; it exists for the dynamic keys doc 03 produces (`errors.${wire}`).
 * Never throws in production — a broken key renders as the key itself, which is
 * debuggable in a screenshot and never a blank button.
 */
export function translate(
  messages: Dictionary,
  key: StringPath | (string & {}),
  params?: MessageParams,
): string {
  const value = walk(messages, key);
  if (typeof value === 'string') return interpolate(value, params);
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`[i18n] missing or non-string message key: "${key}"`);
  }
  return key;
}

/**
 * Resolve a plural message. `count` is always exposed to the template as {count},
 * pre-formatted with the locale's grouping (1 200 / 1 200 / 1,200).
 */
export function translatePlural(
  messages: Dictionary,
  key: PluralPath | (string & {}),
  count: number,
  locale: Locale,
  params?: MessageParams,
): string {
  const node = walk(messages, key) as PluralForms | undefined;
  if (!node || typeof node.other !== 'string') {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`[i18n] missing or malformed plural key: "${key}"`);
    }
    return key;
  }
  const category: PluralCategory = plural(locale, count);
  const template = node[category] ?? node.other;
  return interpolate(template, { count: formatCount(count, locale), ...params });
}

function formatCount(count: number, locale: Locale): string {
  // Imported lazily to keep this module free of a cycle with format.ts.
  const { formatNumber } = require('@/lib/i18n/format') as typeof import('@/lib/i18n/format');
  return formatNumber(count, locale);
}
```

> **Note on `formatCount`.** `require` inside a function is the one place in the codebase where it
> is permitted, and only because `format.ts` imports `BCP47` from `@/types/i18n`, which imports
> `dictionary.ts`, which nothing here imports back — the cycle is theoretical, not real. If a
> reviewer prefers a static import, use one; the behaviour is identical.

### 1.6 `src/lib/i18n/plural.ts` — pluralisation

Uzbek and Russian do **not** share a rule, and neither matches English. Getting this wrong is the
most visible localisation bug a menu can have, so the rule is written out rather than delegated.

| Locale | CLDR categories | Rule | Grammatical note |
|---|---|---|---|
| `uz` | `one`, `other` | `n == 1 → one`, else `other` | **The Uzbek noun does not inflect after a numeral.** "1 ta taom", "5 ta taom" — never "5 ta taomlar". So in practice `one` and `other` carry the same noun form and differ only in whether the sentence reads naturally; the catalogue still fills all four slots. |
| `ru` | `one`, `few`, `many` | `n%10==1 && n%100!=11 → one`; `n%10 ∈ 2..4 && n%100 ∉ 12..14 → few`; else `many` | The classic three-form rule: 1 блюдо, 2 блюда, 5 блюд, 21 блюдо, 22 блюда, 25 блюд, 11 блюд. |
| `en` | `one`, `other` | `n == 1 → one`, else `other` | — |

```ts
// src/lib/i18n/plural.ts
import type { Locale } from '@/types/i18n';

export type PluralCategory = 'one' | 'few' | 'many' | 'other';

/**
 * The plural category for `count` in `locale`.
 *
 * Written by hand, not delegated to Intl.PluralRules, for two reasons:
 *  1. `Intl.PluralRules('uz')` silently falls back to the CLDR root locale on a
 *     small-ICU Node build, and root has only `other` — an Uzbek "1 ta taomlar".
 *  2. The Russian rule is stable, three lines long, and worth being able to unit-test
 *     without an ICU dependency. plural.test.ts pins all 3 locales × 0..1000.
 *
 * Fractions are not a case we have: every count in this product is a whole number of
 * items, minutes or orders, so `count` is truncated rather than routed to `other`.
 */
export function plural(locale: Locale, count: number): PluralCategory {
  const n = Math.abs(Math.trunc(count));
  switch (locale) {
    case 'ru': {
      const mod10 = n % 10;
      const mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return 'one';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
      return 'many';
    }
    case 'uz':
    case 'en':
      return n === 1 ? 'one' : 'other';
  }
}
```

`src/lib/i18n/plural.test.ts` asserts, at minimum:
`ru` → 1 `one`, 2 `few`, 5 `many`, 11 `many`, 12 `many`, 14 `many`, 21 `one`, 22 `few`, 25 `many`,
101 `one`, 111 `many`, 0 `many`; `uz`/`en` → 1 `one`, 0/2/5/11/21 `other`; and that `plural(l, -3)`
equals `plural(l, 3)` for all three.

### 1.7 `src/lib/i18n/locale.ts` — server-side locale resolution

```ts
// src/lib/i18n/locale.ts
import { BCP47, DEFAULT_LOCALE, DIRECTION, LOCALES, type Locale } from '@/types/i18n';

export const LOCALE_COOKIE = 'qros_locale';
export const LOCALE_QUERY_PARAM = 'lang';
/** One year. A diner who picked Russian last month still gets Russian. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function bcp47(locale: Locale): string { return BCP47[locale]; }
export function direction(locale: Locale): 'ltr' | 'rtl' { return DIRECTION[locale]; }

/**
 * Parse an Accept-Language header and return the first supported locale.
 *
 * Handles quality values and region subtags: 'ru-RU,ru;q=0.9,en;q=0.8' → 'ru'.
 * Uzbek phones commonly send 'uz-Latn-UZ' or 'uz-Cyrl-UZ'; both map to 'uz' because
 * the *UI* has one Uzbek and it is Latin. A Cyrillic-Uzbek reader who dislikes that
 * switches once and the cookie remembers.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tagRaw, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: (tagRaw ?? '').trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const primary = tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

export interface ResolveLocaleInput {
  /** Value of the qros_locale cookie, if any. */
  cookie?: string | null;
  /** Value of ?lang=, if any. Middleware has usually already promoted it to the cookie. */
  searchParam?: string | null;
  /** Raw Accept-Language header. */
  acceptLanguage?: string | null;
}

/**
 * Precedence (doc 05 §4.6, restated so it lives beside the implementation):
 *   ?lang=  →  cookie  →  Accept-Language  →  NEXT_PUBLIC_DEFAULT_LOCALE  →  'uz'
 *
 * ?lang= outranks the cookie so that a printed QR poster with ?lang=ru wins on the
 * first scan even for a returning diner, and so a shared link keeps its language.
 * Middleware then writes that choice to the cookie, so the second page load is
 * already cookie-driven and the parameter can be dropped without changing anything.
 */
export function resolveLocale(input: ResolveLocaleInput): Locale {
  if (isLocale(input.searchParam)) return input.searchParam;
  if (isLocale(input.cookie)) return input.cookie;
  const fromHeader = parseAcceptLanguage(input.acceptLanguage);
  if (fromHeader) return fromHeader;
  const fromEnv = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
  if (isLocale(fromEnv)) return fromEnv;
  return DEFAULT_LOCALE;
}

/** The cookie attributes, in one place, used by middleware and by setLocaleAction. */
export function localeCookieOptions(): {
  path: string; maxAge: number; sameSite: 'lax'; secure: boolean; httpOnly: false;
} {
  return {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    // Not HttpOnly: the locale switcher reads it for its initial state, and it carries
    // no authority — the worst a tampered value can do is render the wrong language.
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  };
}

/** Used by src/app/_actions/locale-actions.ts. `store` is the awaited cookies() object. */
export function setLocaleCookie(
  store: { set: (name: string, value: string, options: ReturnType<typeof localeCookieOptions>) => void },
  locale: Locale,
): void {
  store.set(LOCALE_COOKIE, locale, localeCookieOptions());
}
```

**Where each caller sits:**

| Caller | File | What it does |
|---|---|---|
| Middleware | `src/middleware.ts` (doc 05 §4.2) | Reads `?lang=`; if valid and different from the cookie, writes the cookie on the same `NextResponse`. Does **not** strip the parameter. |
| Root layout | `src/app/layout.tsx` (doc 05 §3.1) | `resolveLocale({ cookie, acceptLanguage })` → `getDictionary(locale)` → `<html lang={bcp47(locale)} dir={direction(locale)}>` → `<LocaleProvider>`. |
| Server action | `src/app/_actions/locale-actions.ts` | `setLocaleAction({ locale })` → `setLocaleCookie(await cookies(), locale)` → `revalidatePath('/', 'layout')`. |
| Staff panels | `src/lib/services/session.ts` | A signed-in staff member's `profiles.locale` is written to the cookie on sign-in, so the panel opens in their language without a second click. The cookie remains the single source of truth afterwards. |

### 1.8 Client side — provider, hooks, components

```tsx
// src/components/common/locale-provider.tsx
'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/types/i18n';

export interface LocaleContextValue {
  locale: Locale;
  messages: Dictionary;
  /** BCP-47 tag, for ad-hoc Intl construction in a leaf component. */
  tag: string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Mounted once, in the root layout, above everything. The dictionary crosses the
 * RSC boundary as a plain serialisable object (~45 KB gzipped ~9 KB) exactly once
 * per document; client navigations reuse it.
 */
export function LocaleProvider({
  locale, messages, children,
}: { locale: Locale; messages: Dictionary; children: ReactNode }) {
  const value = useMemo<LocaleContextValue>(
    () => ({ locale, messages, tag: BCP47_TAGS[locale] }),
    [locale, messages],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

const BCP47_TAGS: Readonly<Record<Locale, string>> = { uz: 'uz-UZ', ru: 'ru-RU', en: 'en-US' };

export function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocaleContext must be used inside <LocaleProvider>');
  return ctx;
}
```

```ts
// src/hooks/use-locale.ts
'use client';
import { useLocaleContext } from '@/components/common/locale-provider';
import type { Locale } from '@/types/i18n';

/** The active UI locale and its BCP-47 tag. Use when you need the locale itself, not a string. */
export function useLocale(): { locale: Locale; tag: string } {
  const { locale, tag } = useLocaleContext();
  return { locale, tag };
}
```

```ts
// src/hooks/use-translate.ts
'use client';
import { useCallback, useMemo } from 'react';
import { useLocaleContext } from '@/components/common/locale-provider';
import { interpolate } from '@/lib/i18n/messages';
import { plural } from '@/lib/i18n/plural';
import { formatNumber } from '@/lib/i18n/format';
import type { PluralForms, PluralPath, StringPath } from '@/lib/i18n/dictionary';
import type { MessageParams } from '@/lib/i18n/messages';
import type { I18nText, Locale } from '@/types/i18n';
import { t as resolveI18nText } from '@/lib/i18n/t';

export interface Translator {
  /** t('customer.cart.placeOrder') · t('kitchen.placedAgo', { minutes: 4 }) */
  (key: StringPath, params?: MessageParams): string;
  /** tn('plurals.items', 3) → "3 taom" / "3 блюда" / "3 items" */
  n: (key: PluralPath, count: number, params?: MessageParams) => string;
  /** Resolves a database i18n_text with the content fallback chain. §4.3. */
  c: (value: I18nText | null | undefined, fallback?: Locale) => string;
  locale: Locale;
  tag: string;
}

/**
 * The single translation entry point for client components.
 * Deliberately NOT named `t` at the call site of the hook, so `const t = useT()` reads
 * naturally and `t.n(...)` / `t.c(...)` sit on the same object rather than needing three imports.
 */
export function useT(): Translator {
  const { locale, messages, tag } = useLocaleContext();

  const translate = useCallback(
    (key: string, params?: MessageParams): string => {
      const value = key.split('.').reduce<unknown>(
        (node, seg) => (typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[seg]
          : undefined),
        messages,
      );
      if (typeof value === 'string') return interpolate(value, params);
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(`[i18n] missing message key: "${key}"`);
      }
      return key;
    },
    [messages],
  );

  return useMemo<Translator>(() => {
    const fn = ((key: StringPath, params?: MessageParams) =>
      translate(key, params)) as Translator;

    fn.n = (key: PluralPath, count: number, params?: MessageParams) => {
      const node = key.split('.').reduce<unknown>(
        (n, seg) => (typeof n === 'object' && n !== null
          ? (n as Record<string, unknown>)[seg]
          : undefined),
        messages,
      ) as PluralForms | undefined;
      if (!node) {
        if (process.env.NODE_ENV !== 'production') {
          throw new Error(`[i18n] missing plural key: "${key}"`);
        }
        return key;
      }
      const template = node[plural(locale, count)] ?? node.other;
      return interpolate(template, { count: formatNumber(count, locale), ...params });
    };

    fn.c = (value, fallback) => resolveI18nText(value ?? null, locale, fallback);
    fn.locale = locale;
    fn.tag = tag;
    return fn;
  }, [translate, messages, locale, tag]);
}
```

```tsx
// src/components/common/translate.tsx
'use client';
import { useT } from '@/hooks/use-translate';
import type { StringPath } from '@/lib/i18n/dictionary';
import type { MessageParams } from '@/lib/i18n/messages';

/** <T k="customer.cart.title" /> — for the common case of a bare translated string in JSX. */
export function T({ k, params }: { k: StringPath; params?: MessageParams }) {
  return <>{useT()(k, params)}</>;
}
```

```tsx
// src/components/common/i18n-text.tsx  (Server Component — no 'use client')
import { t } from '@/lib/i18n/t';
import type { I18nText, Locale } from '@/types/i18n';

/**
 * Renders a database i18n_text in a server component, where there is no context to read.
 * The locale is passed down from the layout that resolved it; `fallback` is the
 * restaurant's default_locale.
 */
export function I18nTextView({
  value, locale, fallback, as: Tag = 'span', className,
}: {
  value: I18nText | null | undefined;
  locale: Locale;
  fallback?: Locale;
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'div';
  className?: string;
}) {
  return <Tag className={className}>{t(value ?? null, locale, fallback)}</Tag>;
}
```

**Server components that are not the layout** get the dictionary by calling
`getDictionary(locale)` directly; `locale` is threaded down as a prop from the route's
layout (which already resolved it). There is no `getRequestLocale()` global — an implicit
per-request singleton would break the moment a route renders two tenants' content, and it
would make every server component dynamic.

### 1.9 The locale switcher

```tsx
// src/components/common/locale-switcher.tsx
'use client';

import { useTransition } from 'react';
import { setLocaleAction } from '@/app/_actions/locale-actions';
import { useLocaleContext } from '@/components/common/locale-provider';
import { useT } from '@/hooks/use-translate';
import { LOCALES, type Locale } from '@/types/i18n';

/** Native language names — never translated. A Russian speaker looks for "Русский". */
export const LOCALE_NATIVE_NAMES: Readonly<Record<Locale, string>> = {
  uz: "O'zbekcha",
  ru: 'Русский',
  en: 'English',
};

/** Two-letter chips for the compact (customer header) variant. */
export const LOCALE_SHORT: Readonly<Record<Locale, string>> = { uz: 'UZ', ru: 'RU', en: 'EN' };

export function LocaleSwitcher({ variant = 'menu' }: { variant?: 'menu' | 'segmented' }) {
  const { locale } = useLocaleContext();
  const t = useT();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    startTransition(async () => { await setLocaleAction({ locale: next }); });
  }

  return (
    <div
      role="group"
      aria-label={t('a11y.languageSwitcher')}
      data-variant={variant}
      data-pending={pending || undefined}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-current={l === locale ? 'true' : undefined}
          disabled={pending}
          onClick={() => choose(l)}
        >
          {variant === 'segmented' ? LOCALE_SHORT[l] : LOCALE_NATIVE_NAMES[l]}
        </button>
      ))}
    </div>
  );
}
```

**Behaviour, exactly:**

1. Clicking a language calls `setLocaleAction`, which writes `qros_locale` **server-side** and calls
   `revalidatePath('/', 'layout')`. The whole tree re-renders in the new language — **no full page
   reload, no client-side catalogue swap, no flash**. Scroll position and the open sheet survive
   because it is a transition, not a navigation.
2. The cart is **not** cleared. Cart lines store `menuItemId` and the *full* `I18nText` name
   snapshot, so switching language re-renders existing lines in the new language (doc 05 §3.5's
   `setLocale` cart action exists for exactly this).
3. Three placements: customer header (`variant="segmented"`, always visible, thumb-reachable);
   marketing/auth header (`variant="menu"`); admin settings + the account menu (`variant="menu"`).
   Staff who change it here are changing the cookie only — `profiles.locale` is changed from
   Settings, and the toast says so (`toasts.languageChanged`).
4. `?lang=` is honoured on the *first* request of a session and then promoted to the cookie by
   middleware, so it never fights a later manual choice.
5. While pending, the group is `disabled` and gets `data-pending`; doc 04's token set styles it as a
   0.6-opacity, `cursor: wait` group. No spinner — the transition is a few dozen milliseconds.

### 1.10 `src/lib/i18n/messages.test.ts` — the completeness gate

Vitest. Runs in `npm run check`. Fails the build on any of:

1. **Key-set equality.** `flatten(en)`, `flatten(uz)`, `flatten(ru)` have identical key sets.
   The failure message names the missing/orphan keys, per file.
2. **No empty strings.** No leaf is `''` or whitespace-only in any locale.
3. **Placeholder parity.** For every key, the set of `{param}` tokens is identical across the three
   locales. Catches the classic `"{count} ta taom"` vs `"блюд"` bug.
4. **Plural completeness.** Every node typed `PluralForms` has all four string forms in all three
   locales, and each contains `{count}`.
5. **Error-code coverage** (doc 03 §8.4's requirement, asserted here):
   every `AppErrorCode` has `errors.app.<code>`; every `QrErrorCode` has `errors.<code>`.
   Iterated from `APP_ERROR_MESSAGE_KEYS` and `QR_TO_APP_ERROR` so a new code cannot be added
   without copy.
6. **Enum coverage.** Every member of `order_status`, `waiter_call_status`, `app_role`,
   `dietary_tag`, `waiter_call_reason`, `order_type`, `order_channel`, `promotion_type`,
   `option_selection_type` and `app_locale` has a `labels.*` / `status.*` entry. Imported from
   `@/types/database`, so adding a Postgres enum value breaks this test until copy exists.
7. **No untranslated leakage.** `uz.json` and `ru.json` may not be byte-identical to `en.json` for
   any key outside `IDENTICAL_ALLOWLIST` — strings that are legitimately the same in all three
   locales: the brand (`common.appName`), format-only values (`labels.spicy.*` keys aside,
   `kitchen.branchLabel`, `waiter.branchLabel`, `waiter.callBannerBody`, `waiter.newCallBody` are
   pure `{placeholder}` templates), `common.ok`, and loanwords (`Espresso`, `Coca-Cola`, `Fast
   Food`, `Demo`, `CSV`, `PNG`, `SVG`, `QR`, `UZS`). The allowlist lives in the test file, not in
   the catalogue.
8. **Latin-script Uzbek.** Zero values in `uz.json` may contain a Cyrillic character
   (`/[\u0400-\u04ff]/`) — absolute, no exceptions; `labels.locale.ru` is `"Ruscha"`, which is
   Latin. Conversely every `ru.json` value containing a Latin letter must also contain a Cyrillic
   one, except the six entries in `IDENTICAL_ALLOWLIST` that are brand, placeholder-only, or an
   email example (`auth.emailPlaceholder`).

`src/lib/i18n/format.test.ts` additionally asserts the ICU build is complete, which is a real
deployment risk on slim container images:

```ts
it('has full ICU data for uz-UZ', () => {
  const m = new Intl.DateTimeFormat('uz-UZ', { month: 'long' }).format(new Date(Date.UTC(2026, 0, 15)));
  expect(m.toLowerCase()).toContain('yanvar'); // not "January"
  expect(new Intl.NumberFormat('ru-RU').format(45000)).toBe('45 000');
});
```

---

## 2. The message catalogue

Three files, identical structure, **884 leaf strings each**. `en.json` is the authoring canon: a new
key is added to `Dictionary` and to all three files in the same commit, or `npm run typecheck` fails.

Copy conventions applied throughout:

- **Uzbek** is Latin script (`Oʻzbekcha`), modern Tashkent register, `ʻ` rendered as the ASCII
  apostrophe `'` because that is what Uzbek keyboards and QR-printed URLs actually produce. Verb
  forms are the polite imperative (`-ing`: *tanlang*, *bosing*), never the familiar.
- **Russian** is neutral-formal (вы, never ты), no exclamation marks outside toasts.
- **English** is British-neutral, sentence case, no title case in buttons.
- Buttons are verbs. Titles are noun phrases. Body copy is one sentence where possible.
- No exclamation marks in error copy — a diner whose order failed is not to be shouted at.

### 2.1 `src/messages/en.json`

```json
{
  "common": {
    "appName": "Restaurant QR OS",
    "tagline": "Scan. Choose. Enjoy.",
    "yes": "Yes",
    "no": "No",
    "ok": "OK",
    "cancel": "Cancel",
    "save": "Save",
    "saving": "Saving…",
    "saved": "Saved",
    "edit": "Edit",
    "delete": "Delete",
    "deleting": "Deleting…",
    "remove": "Remove",
    "add": "Add",
    "create": "Create",
    "close": "Close",
    "back": "Back",
    "next": "Next",
    "previous": "Previous",
    "continue": "Continue",
    "confirm": "Confirm",
    "retry": "Try again",
    "refresh": "Refresh",
    "search": "Search",
    "filter": "Filter",
    "clear": "Clear",
    "clearAll": "Clear all",
    "apply": "Apply",
    "reset": "Reset",
    "select": "Select",
    "none": "None",
    "all": "All",
    "showMore": "Show more",
    "showLess": "Show less",
    "copy": "Copy",
    "copied": "Copied",
    "download": "Download",
    "print": "Print",
    "export": "Export",
    "required": "Required",
    "optional": "Optional",
    "active": "Active",
    "inactive": "Inactive",
    "available": "Available",
    "unavailable": "Unavailable",
    "language": "Language",
    "actions": "Actions",
    "status": "Status",
    "total": "Total",
    "quantity": "Quantity",
    "price": "Price",
    "name": "Name",
    "description": "Description",
    "image": "Image",
    "category": "Category",
    "notes": "Notes",
    "phone": "Phone",
    "email": "Email",
    "address": "Address",
    "time": "Time",
    "date": "Date",
    "from": "From",
    "to": "To",
    "free": "Free",
    "new": "New",
    "justNow": "Just now",
    "unnamed": "Untitled",
    "notSet": "Not set"
  },
  "nav": {
    "home": "Home",
    "menu": "Menu",
    "cart": "Cart",
    "orders": "Orders",
    "tracking": "Order status",
    "kitchen": "Kitchen",
    "waiter": "Waiter",
    "admin": "Admin",
    "dashboard": "Dashboard",
    "categories": "Categories",
    "menuManagement": "Menu",
    "tables": "Tables",
    "branches": "Branches",
    "staff": "Staff",
    "analytics": "Analytics",
    "settings": "Settings",
    "platform": "Platform",
    "profile": "Profile",
    "signOut": "Sign out",
    "openMenu": "Open menu",
    "closeMenu": "Close menu",
    "backToMenu": "Back to menu"
  },
  "customer": {
    "welcome": {
      "eyebrow": "You are seated at",
      "greeting": "Welcome to {restaurant}",
      "tableLabel": "Table {number}",
      "intro": "Browse the menu, order from your phone, and track it live. No app, no account.",
      "viewMenu": "View the menu",
      "chooseLanguage": "Choose your language",
      "openNow": "Open now",
      "closedNow": "Closed now",
      "closedTitle": "We are closed right now",
      "closedBody": "{restaurant} is not serving at the moment. Please ask a member of staff if you need help.",
      "notAcceptingTitle": "Ordering is paused",
      "notAcceptingBody": "The kitchen has paused new orders for a few minutes. Your waiter can still take an order at the table.",
      "poweredBy": "Powered by Restaurant QR OS",
      "scanAgain": "Scan the code on your table again"
    },
    "menu": {
      "title": "Menu",
      "searchPlaceholder": "Search dishes, drinks…",
      "searchLabel": "Search the menu",
      "resultsFor": "Results for “{query}”",
      "noResultsTitle": "Nothing matched “{query}”",
      "noResultsBody": "Try a shorter word, or browse the categories below.",
      "clearSearch": "Clear search",
      "allCategories": "All",
      "popularTitle": "Most ordered",
      "popularSubtitle": "What this table usually goes for",
      "featuredTitle": "Chef's picks",
      "featuredSubtitle": "Made the way we like it best",
      "promotionsTitle": "Today's offers",
      "categoriesTitle": "Browse the menu",
      "viewCategory": "See all",
      "addToCart": "Add",
      "added": "Added",
      "unavailable": "Sold out",
      "unavailableUntil": "Back at {time}",
      "prepMinutes": "{minutes} min",
      "spicyLabel": "Spice",
      "dietaryLabel": "Dietary",
      "cartButton": "View cart · {total}",
      "jumpToCategory": "Jump to {category}"
    },
    "item": {
      "backToMenu": "Back to menu",
      "ingredientsTitle": "What's in it",
      "dietaryTitle": "Good to know",
      "prepTitle": "Preparation",
      "spicyTitle": "Spice level",
      "caloriesTitle": "Energy",
      "caloriesValue": "{calories} kcal",
      "quantityTitle": "How many?",
      "optionsTitle": "Make it yours",
      "chooseOne": "Choose one",
      "chooseUpTo": "Choose up to {max}",
      "chooseAtLeast": "Choose at least {min}",
      "optionRequired": "Please choose an option to continue.",
      "optionUnavailable": "Out of stock",
      "noteTitle": "Anything to tell the kitchen?",
      "notePlaceholder": "No onion, extra napkins…",
      "noteHint": "The kitchen reads this exactly as you write it.",
      "addToCart": "Add to cart",
      "addToCartTotal": "Add to cart · {total}",
      "updateItem": "Update",
      "unavailableTitle": "This dish just ran out",
      "unavailableBody": "The kitchen has taken it off the menu for now. Everything else is still available.",
      "notFoundTitle": "We can't find that dish",
      "notFoundBody": "It may have been renamed or removed. Head back to the menu to see what's on today."
    },
    "cart": {
      "title": "Your order",
      "subtitle": "Table {number} · {restaurant}",
      "emptyTitle": "Your cart is empty",
      "emptyBody": "Add something from the menu and it will show up here.",
      "emptyCta": "Browse the menu",
      "lineExtras": "Extras",
      "lineNote": "Note",
      "editLine": "Edit",
      "removeLine": "Remove",
      "removeConfirmTitle": "Remove {item}?",
      "removeConfirmBody": "It will be taken out of this order. You can add it again at any time.",
      "clear": "Empty the cart",
      "clearConfirmTitle": "Empty the cart?",
      "clearConfirmBody": "Everything you have chosen will be removed. This cannot be undone.",
      "subtotal": "Subtotal",
      "serviceFee": "Service charge",
      "serviceFeeHint": "{percent}% service charge, added by the restaurant",
      "discount": "Discount",
      "total": "Total",
      "guestName": "Your name",
      "guestNamePlaceholder": "So the waiter knows who to look for",
      "guestCount": "Guests at the table",
      "orderNote": "Note for the whole order",
      "orderNotePlaceholder": "We're in a hurry, bring the bill with the food…",
      "placeOrder": "Place order",
      "placing": "Sending your order…",
      "addMore": "Add more dishes",
      "priceChangedTitle": "Prices were updated",
      "priceChangedBody": "The restaurant changed a price while you were browsing. The totals below are the ones that will be charged.",
      "itemsRemovedTitle": "Some dishes are no longer available",
      "itemsRemovedBody": "We removed them from your order. Everything else is unchanged.",
      "estimatedTime": "Ready in about {minutes} min"
    },
    "checkout": {
      "confirmTitle": "Send this order to the kitchen?",
      "confirmBody": "The kitchen will start as soon as you confirm. You can still cancel in the first few minutes.",
      "confirmCta": "Yes, send it",
      "successTitle": "Order received",
      "successBody": "The kitchen has your order. Watch it move along on this page.",
      "orderNumberLabel": "Order {number}",
      "trackOrder": "Track my order",
      "backToMenu": "Back to menu",
      "keepThisPage": "Keep this page open to follow your order.",
      "sending": "Sending…"
    },
    "tracking": {
      "title": "Your order",
      "orderNumber": "Order {number}",
      "placedAt": "Placed at {time}",
      "tableLabel": "Table {number}",
      "estimatedReady": "Ready around {time}",
      "readyNow": "Ready now",
      "itemsTitle": "What you ordered",
      "totalsTitle": "Total to pay",
      "timelineTitle": "Progress",
      "cancelOrder": "Cancel order",
      "cancelConfirmTitle": "Cancel this order?",
      "cancelConfirmBody": "The kitchen will stop working on it. You can order again straight away.",
      "cancelWindowOverTitle": "Too late to cancel",
      "cancelWindowOverBody": "The kitchen has already started. Please speak to your waiter.",
      "cancelledTitle": "Order cancelled",
      "cancelledBody": "Nothing will be prepared. You can start a new order whenever you like.",
      "completedTitle": "Thank you",
      "completedBody": "We hope it was good. Come back soon.",
      "callWaiter": "Call the waiter",
      "backToMenu": "Order something else",
      "notFoundTitle": "We can't find this order",
      "notFoundBody": "The link may be old, or the order may have been closed. Please ask your waiter.",
      "recentOrders": "Your recent orders",
      "viewOrder": "View",
      "live": "Live",
      "reconnecting": "Reconnecting…",
      "polling": "Checking every few seconds",
      "lastUpdated": "Updated {time}"
    },
    "waiterCall": {
      "cta": "Call the waiter",
      "sheetTitle": "Call the waiter",
      "sheetBody": "We'll let the floor team know that table {number} needs them.",
      "reasonLabel": "What do you need?",
      "notePlaceholder": "Anything else we should know?",
      "send": "Call",
      "sending": "Calling…",
      "sentTitle": "The waiter is on the way",
      "sentBody": "Someone from the floor team has been notified.",
      "pendingTitle": "Waiting for the waiter",
      "pendingBody": "Your call is in the queue. Someone will be with you shortly.",
      "acknowledgedTitle": "The waiter is coming",
      "acknowledgedBody": "{staff} has picked up your call.",
      "cooldownTitle": "You just called",
      "cooldownBody": "Please wait {seconds} s before calling again.",
      "alreadyOpenTitle": "A call is already open for this table"
    }
  },
  "kitchen": {
    "title": "Kitchen",
    "subtitle": "Live orders",
    "branchLabel": "{branch}",
    "columnNew": "NEW",
    "columnPreparing": "PREPARING",
    "columnReady": "READY",
    "ticketTable": "Table {number}",
    "ticketTakeaway": "Takeaway",
    "placedAgo": "{minutes} min ago",
    "elapsed": "{elapsed} on the pass",
    "dueIn": "Due in {minutes} min",
    "overdueBy": "Late by {minutes} min",
    "lateBadge": "LATE",
    "guestNote": "Guest note",
    "itemNote": "Note",
    "accept": "Accept",
    "startPreparing": "Start cooking",
    "markReady": "Mark ready",
    "markDelivered": "Handed over",
    "undo": "Undo",
    "newOrderTitle": "New order {number}",
    "newOrderBody": "Table {table} · {items}",
    "soundOn": "Sound on",
    "soundOff": "Sound off",
    "keepAwakeOn": "Keep screen awake",
    "keepAwakeOff": "Allow screen to sleep",
    "fullscreen": "Full screen",
    "exitFullscreen": "Exit full screen",
    "emptyNew": {
      "title": "No new orders",
      "body": "New tickets land here the second a table sends one."
    },
    "emptyPreparing": {
      "title": "Nothing on the stove",
      "body": "Accepted orders move here while you cook them."
    },
    "emptyReady": {
      "title": "Nothing waiting",
      "body": "Finished orders sit here until a waiter takes them out."
    },
    "connectionLive": "Live",
    "connectionReconnecting": "Reconnecting…",
    "connectionOffline": "Offline — showing the last known board"
  },
  "waiter": {
    "title": "Floor",
    "subtitle": "Orders and table calls",
    "branchLabel": "{branch}",
    "tabActive": "Active",
    "tabReady": "Ready to serve",
    "tabCalls": "Table calls",
    "callBannerTitle": "TABLE {number} IS CALLING",
    "callBannerBody": "{reason} · {age}",
    "tableCalling": "Table {number} is calling",
    "acknowledge": "I've got it",
    "acknowledging": "Taking it…",
    "acknowledged": "Picked up by {staff}",
    "resolve": "Done",
    "resolved": "Resolved",
    "callAge": "{age} ago",
    "callNote": "Guest note",
    "acknowledgedBy": "Picked up by {staff} at {time}",
    "serve": "Take to table",
    "markDelivered": "Delivered",
    "complete": "Close order",
    "orderTable": "Table {number}",
    "emptyActive": {
      "title": "No active orders",
      "body": "Orders being cooked will appear here."
    },
    "emptyReady": {
      "title": "Nothing to serve",
      "body": "The kitchen will push finished orders here."
    },
    "emptyCalls": {
      "title": "No one is calling",
      "body": "When a table presses the call button, it shows up here immediately."
    },
    "newCallTitle": "Table {number} is calling",
    "newCallBody": "{reason}",
    "orderReadyTitle": "Order {number} is ready",
    "noBranch": {
      "title": "No branch assigned",
      "body": "Your account is not linked to a branch yet. Ask your manager to assign one."
    }
  },
  "admin": {
    "dashboard": {
      "title": "Dashboard",
      "subtitle": "How today is going",
      "todayRevenue": "Revenue today",
      "todayOrders": "Orders today",
      "avgOrderValue": "Average order",
      "activeTables": "Tables in use",
      "pendingOrders": "Awaiting confirmation",
      "openCalls": "Open table calls",
      "popularDishes": "Most ordered dishes",
      "statusOverview": "Orders by status",
      "revenueTrend": "Revenue",
      "vsYesterday": "{value} vs yesterday",
      "periodToday": "Today",
      "periodWeek": "This week",
      "periodMonth": "This month",
      "viewAllOrders": "See all orders",
      "liveFeed": "Live orders",
      "branchFilter": "Branch",
      "allBranches": "All branches",
      "noData": {
        "title": "Nothing to show yet",
        "body": "Numbers appear here as soon as the first order of the day comes in."
      }
    },
    "orders": {
      "title": "Orders",
      "subtitle": "Every order, live and historical",
      "filterStatus": "Status",
      "filterBranch": "Branch",
      "filterDate": "Date",
      "searchPlaceholder": "Order number or table",
      "colNumber": "Order",
      "colTable": "Table",
      "colStatus": "Status",
      "colItems": "Items",
      "colTotal": "Total",
      "colPlaced": "Placed",
      "colBranch": "Branch",
      "detailTitle": "Order {number}",
      "detailItems": "Items",
      "detailTotals": "Totals",
      "detailTimeline": "History",
      "detailCustomer": "Guest",
      "changeStatus": "Change status",
      "confirmOrder": "Confirm order",
      "cancelOrder": "Cancel order",
      "cancelReasonLabel": "Why is it being cancelled?",
      "cancelReasonPlaceholder": "Out of stock, guest changed their mind…",
      "cancelReasonRequired": "A reason is required to cancel an order.",
      "printTicket": "Print ticket",
      "exportCsv": "Export CSV",
      "empty": {
        "title": "No orders match",
        "body": "Try widening the date range or clearing a filter."
      }
    },
    "menu": {
      "title": "Menu",
      "subtitle": "Dishes, prices and availability",
      "newItem": "New dish",
      "editItem": "Edit dish",
      "duplicateItem": "Duplicate",
      "deleteItem": "Delete dish",
      "deleteConfirmTitle": "Delete {item}?",
      "deleteConfirmBody": "It disappears from the menu straight away. Past orders keep their own copy of the name and price, so your history stays correct.",
      "fieldName": "Name",
      "fieldDescription": "Description",
      "fieldIngredients": "Ingredients",
      "fieldCategory": "Category",
      "fieldPrice": "Price",
      "fieldCompareAtPrice": "Was",
      "fieldImage": "Photo",
      "fieldPrepTime": "Preparation time (min)",
      "fieldSpicy": "Spice level",
      "fieldCalories": "Calories",
      "fieldDietary": "Dietary tags",
      "fieldFeatured": "Show in Chef's picks",
      "fieldPopular": "Show in Most ordered",
      "availability": "Availability",
      "markAvailable": "Mark available",
      "markUnavailable": "Mark sold out",
      "unavailableUntilLabel": "Back available at",
      "optionsTitle": "Options and extras",
      "optionsHint": "Group options so guests can pick a size, add extras or set the spice.",
      "addOptionGroup": "Add a group",
      "groupLabel": "Group name",
      "groupSelection": "Selection",
      "groupMin": "Minimum choices",
      "groupMax": "Maximum choices",
      "addOption": "Add an option",
      "optionName": "Option",
      "optionPriceDelta": "Extra cost",
      "optionDefault": "Selected by default",
      "translationsTitle": "Languages",
      "missingTranslation": "Missing translation",
      "missingTranslationHint": "Guests using this language will see the {locale} text instead.",
      "uploadImage": "Upload a photo",
      "uploadHint": "JPEG or PNG, at least 1200 px wide, under 5 MB.",
      "reorderHint": "Drag to change the order guests see.",
      "filterCategory": "Category",
      "filterAvailability": "Availability",
      "empty": {
        "title": "No dishes yet",
        "body": "Add your first dish and it appears on the QR menu immediately."
      },
      "emptyCta": "Add a dish"
    },
    "categories": {
      "title": "Categories",
      "subtitle": "How the menu is grouped",
      "newCategory": "New category",
      "editCategory": "Edit category",
      "deleteCategory": "Delete category",
      "deleteConfirmTitle": "Delete {category}?",
      "deleteConfirmBody": "The category disappears from the menu. It must be empty first.",
      "deleteBlockedTitle": "This category still has dishes",
      "deleteBlockedBody": "Move or delete its {count} dishes first, then try again.",
      "fieldName": "Name",
      "fieldDescription": "Description",
      "fieldIcon": "Icon",
      "fieldBranch": "Branch",
      "allBranches": "All branches",
      "reorderHint": "Drag to change the order on the menu.",
      "itemsInCategory": "{count} dishes",
      "empty": {
        "title": "No categories yet",
        "body": "Categories are how guests find their way around a long menu."
      },
      "emptyCta": "Add a category"
    },
    "tables": {
      "title": "Tables",
      "subtitle": "QR codes and table numbers",
      "newTable": "New table",
      "editTable": "Edit table",
      "fieldNumber": "Table number",
      "fieldName": "Label",
      "fieldZone": "Zone",
      "fieldSeats": "Seats",
      "fieldBranch": "Branch",
      "qrTitle": "QR code",
      "qrHint": "Print this and put it on the table. Every table has its own code.",
      "viewQr": "View QR",
      "downloadPng": "Download PNG",
      "downloadSvg": "Download SVG",
      "printSheet": "Print all codes",
      "tableUrl": "Table link",
      "copyUrl": "Copy link",
      "rotateToken": "Generate a new code",
      "rotateConfirmTitle": "Generate a new QR code for table {number}?",
      "rotateConfirmBody": "The printed code on this table stops working immediately. Print and place the new one before you confirm.",
      "rotateReasonLabel": "Why? (kept in the audit log)",
      "rotationCount": "Regenerated {count} times",
      "issuedAt": "Issued {date}",
      "deactivate": "Take out of service",
      "activate": "Put back in service",
      "deactivateConfirmTitle": "Take table {number} out of service?",
      "deactivateConfirmBody": "Guests scanning its code will see a polite notice instead of the menu.",
      "empty": {
        "title": "No tables yet",
        "body": "Add a table and we'll generate a secure QR code for it."
      },
      "emptyCta": "Add a table"
    },
    "branches": {
      "title": "Branches",
      "subtitle": "Locations, hours and service rules",
      "newBranch": "New branch",
      "editBranch": "Edit branch",
      "fieldName": "Branch name",
      "fieldCode": "Code",
      "fieldCodeHint": "One to four capitals. It prefixes every order number, e.g. A-014.",
      "fieldAddress": "Address",
      "fieldTimezone": "Time zone",
      "fieldOpeningHours": "Opening hours",
      "fieldServiceFee": "Service charge",
      "fieldServiceFeeInherit": "Use the restaurant's rate",
      "fieldWaiterCooldown": "Wait between table calls (seconds)",
      "fieldOrderInterval": "Wait between orders from one table (seconds)",
      "fieldPrepDefault": "Default preparation time (min)",
      "fieldLateThreshold": "Flag an order as late after (min)",
      "acceptingOrders": "Accepting orders",
      "pauseOrders": "Pause new orders",
      "resumeOrders": "Resume orders",
      "pausedNotice": "This branch is not taking new orders. Guests see a notice instead of the order button.",
      "tableCount": "{count} tables",
      "staffCount": "{count} staff",
      "empty": {
        "title": "No branches yet",
        "body": "Every table belongs to a branch, so start by adding one."
      },
      "emptyCta": "Add a branch"
    },
    "staff": {
      "title": "Staff",
      "subtitle": "Who can do what, and where",
      "invite": "Invite someone",
      "inviteTitle": "Invite a team member",
      "inviteBody": "They get an email with a link to set their own password. You never see it.",
      "fieldEmail": "Work email",
      "fieldFullName": "Full name",
      "fieldRole": "Role",
      "fieldBranch": "Branch",
      "fieldEmployeeCode": "Staff number",
      "allBranches": "All branches",
      "inviteSent": "Invitation sent to {email}",
      "resendInvite": "Send again",
      "revokeInvite": "Cancel invitation",
      "pendingInvite": "Invitation pending",
      "joinedAt": "Joined {date}",
      "lastSeen": "Last seen {time}",
      "neverSignedIn": "Has not signed in yet",
      "deactivate": "Deactivate",
      "reactivate": "Reactivate",
      "deactivateConfirmTitle": "Deactivate {name}?",
      "deactivateConfirmBody": "They are signed out everywhere and cannot sign back in. Their history stays intact.",
      "lastOwner": {
        "title": "You cannot remove the last owner",
        "body": "Every restaurant needs at least one owner. Promote someone else first."
      },
      "empty": {
        "title": "No staff yet",
        "body": "Invite your managers, waiters and kitchen team so they can sign in."
      },
      "emptyCta": "Invite someone"
    },
    "analytics": {
      "title": "Analytics",
      "subtitle": "Real numbers from real orders",
      "rangeToday": "Today",
      "rangeWeek": "Last 7 days",
      "rangeMonth": "Last 30 days",
      "rangeCustom": "Custom range",
      "revenue": "Revenue",
      "orders": "Orders",
      "avgTicket": "Average order",
      "itemsSold": "Dishes sold",
      "topItems": "Top dishes",
      "topCategories": "Top categories",
      "byHour": "Orders by hour",
      "byBranch": "By branch",
      "byStatus": "By status",
      "peakHour": "Busiest hour: {hour}",
      "exportCsv": "Export CSV",
      "noData": {
        "title": "Not enough data yet",
        "body": "Charts fill in once orders start coming through. Nothing here is simulated."
      }
    },
    "settings": {
      "title": "Settings",
      "subtitle": "How your restaurant works",
      "tabGeneral": "General",
      "tabBranding": "Branding",
      "tabOrdering": "Ordering",
      "tabDanger": "Danger zone",
      "restaurantName": "Restaurant name",
      "slug": "Web address",
      "slugHint": "Lowercase letters, numbers and hyphens. Changing it breaks old links.",
      "logo": "Logo",
      "coverImage": "Cover photo",
      "welcomeMessage": "Welcome message",
      "welcomeMessageHint": "The first line a guest reads after scanning. Keep it short and warm.",
      "description": "About the restaurant",
      "defaultLocale": "Default language",
      "defaultLocaleHint": "Used when a dish has no text in the guest's language.",
      "currency": "Currency",
      "currencyDecimals": "Decimal places",
      "currencyHint": "UZS has none — prices are whole soms.",
      "serviceFeeEnabled": "Add a service charge",
      "serviceFeeRate": "Service charge rate",
      "serviceFeeHint": "Shown to guests as a separate line before they confirm.",
      "dangerTitle": "Danger zone",
      "deactivateRestaurant": "Deactivate restaurant",
      "deactivateConfirmTitle": "Deactivate {restaurant}?",
      "deactivateConfirmBody": "Every QR code stops working and staff can no longer sign in. Your data is kept and you can reactivate at any time."
    },
    "platform": {
      "title": "Platform",
      "subtitle": "Every restaurant on this installation",
      "restaurantsCount": "Restaurants",
      "branchesCount": "Branches",
      "ordersToday": "Orders today",
      "colRestaurant": "Restaurant",
      "colSlug": "Address",
      "colBranches": "Branches",
      "colOrders": "Orders",
      "colCreated": "Created",
      "demoBadge": "Demo",
      "empty": {
        "title": "No restaurants yet",
        "body": "The first restaurant appears here as soon as an owner signs up."
      }
    }
  },
  "auth": {
    "signInTitle": "Staff sign in",
    "signInSubtitle": "For owners, managers, waiters and kitchen staff.",
    "email": "Email",
    "emailPlaceholder": "you@restaurant.uz",
    "password": "Password",
    "passwordPlaceholder": "Your password",
    "showPassword": "Show password",
    "hidePassword": "Hide password",
    "signIn": "Sign in",
    "signingIn": "Signing in…",
    "forgotPassword": "Forgotten your password?",
    "resetTitle": "Reset your password",
    "resetSubtitle": "We'll email you a link. It works once and expires in an hour.",
    "sendResetLink": "Send the link",
    "sending": "Sending…",
    "resetSent": {
      "title": "Check your email",
      "body": "If that address belongs to a staff account, a reset link is on its way."
    },
    "newPasswordTitle": "Choose a new password",
    "newPassword": "New password",
    "confirmPassword": "Repeat the password",
    "updatePassword": "Save the password",
    "passwordUpdated": {
      "title": "Password updated",
      "body": "You can sign in with it now."
    },
    "inviteTitle": "Join {restaurant}",
    "inviteSubtitle": "Set a password and you're in.",
    "fullName": "Full name",
    "preferredLanguage": "Preferred language",
    "acceptInvite": "Join the team",
    "accepting": "Setting things up…",
    "signOut": "Sign out",
    "signOutConfirmTitle": "Sign out?",
    "signOutConfirmBody": "You'll need your password to get back in.",
    "backToSignIn": "Back to sign in",
    "staffOnly": {
      "title": "This area is for staff",
      "body": "Guests do not need an account — just scan the code on your table."
    }
  },
  "errors": {
    "app": {
      "TABLE_INACTIVE": "This table is out of service. Please ask a member of staff.",
      "INVALID_QR": "This QR code is not valid. Please scan the code printed on your table.",
      "RESTAURANT_CLOSED": "The restaurant is not taking orders right now.",
      "ITEM_UNAVAILABLE": "One of the dishes in your order has just sold out.",
      "PRICE_MISMATCH": "Prices changed while you were browsing. Please check the total before confirming.",
      "INVALID_TRANSITION": "That order has already moved on. Refreshing now.",
      "RATE_LIMITED": "That was quick. Please wait {seconds} s and try again.",
      "FORBIDDEN": "You do not have permission to do that.",
      "NOT_FOUND": "We can't find that any more.",
      "VALIDATION_FAILED": "Please check the highlighted fields.",
      "NETWORK": "No connection. Your order is saved on this device.",
      "UNKNOWN": "Something went wrong on our side. Please try again."
    },
    "validation": {
      "required": "This field is required.",
      "invalid": "That value is not valid.",
      "email": "Enter a valid email address.",
      "phone": "Enter a valid phone number, e.g. +998 90 123 45 67.",
      "slug": "Use lowercase letters, numbers and hyphens only.",
      "url": "Enter a valid web address.",
      "tooShort": "Use at least {min} characters.",
      "tooLong": "Use at most {max} characters.",
      "tooSmall": "Must be {min} or more.",
      "tooBig": "Must be {max} or less.",
      "integer": "Enter a whole number.",
      "positive": "Enter a number greater than zero.",
      "nonNegative": "This cannot be negative.",
      "passwordWeak": "Use at least 8 characters with a letter and a number.",
      "passwordMismatch": "The two passwords do not match.",
      "i18nAtLeastOne": "Fill in at least one language.",
      "i18nTooLong": "Each language may use at most {max} characters.",
      "invalidLocale": "Choose Uzbek, Russian or English.",
      "invalidTime": "Use the 24-hour format, e.g. 09:30.",
      "fileTooLarge": "The file must be under {max}.",
      "fileType": "Only {types} files are accepted.",
      "duplicateValue": "{value} is already in use."
    },
    "generic": {
      "title": "Something went wrong",
      "body": "We could not finish that. Try again, and if it keeps happening tell us the code below.",
      "retry": "Try again",
      "traceLabel": "Reference {traceId}",
      "notFoundTitle": "Not found",
      "notFoundBody": "The page you were looking for does not exist.",
      "forbiddenTitle": "No access",
      "forbiddenBody": "Your role does not include this page. If that seems wrong, ask your manager.",
      "offlineTitle": "You are offline",
      "offlineBody": "We'll reconnect on our own. Nothing you have entered is lost.",
      "serverTitle": "Our side is having a problem",
      "serverBody": "The team has been notified. Please try again in a moment.",
      "goHome": "Go to the start"
    },
    "QR001_INVALID_QR_TOKEN": "This QR code is not valid. Please scan the code printed on your table.",
    "QR002_TABLE_INACTIVE": "This table is out of service. Please ask a member of staff.",
    "QR003_BRANCH_INACTIVE": "This branch is closed at the moment.",
    "QR004_RESTAURANT_INACTIVE": "This restaurant is not accepting orders right now.",
    "QR010_ORDER_RATE_LIMITED": "You have just ordered. Please wait {seconds} s before sending another.",
    "QR011_WAITER_CALL_COOLDOWN": "You have just called. Please wait {seconds} s before calling again.",
    "QR012_WAITER_CALL_ALREADY_OPEN": "A waiter has already been called for this table.",
    "QR013_DUPLICATE_ORDER": "That order has already been sent. Opening it now.",
    "QR020_ITEM_UNAVAILABLE": "{item} has just sold out and was removed from your order.",
    "QR022_INVALID_OPTION": "One of the extras you chose is no longer offered.",
    "QR023_INVALID_PAYLOAD": "We could not read that order. Please try again from the cart.",
    "QR024_QUANTITY_OUT_OF_RANGE": "Choose between 1 and 999 of each dish.",
    "QR030_ORDER_NOT_FOUND": "We can't find this order any more.",
    "QR030_NOT_FOUND": "We can't find that any more.",
    "QR032_ORDER_EXPIRED": "This order is closed and no longer trackable.",
    "QR040_INVALID_STATUS_TRANSITION": "That order has already moved on. Refreshing the board.",
    "QR041_INVALID_CALL_TRANSITION": "That call has already been handled by someone else.",
    "QR042_CANCEL_REASON_REQUIRED": "A reason is required to cancel an order.",
    "QR043_ORDER_CLOSED": "This order is closed and can no longer be changed.",
    "QR050_FORBIDDEN": "You do not have permission to do that.",
    "QR051_LAST_OWNER": "Every restaurant needs at least one owner.",
    "QR052_FORBIDDEN_FIELD": "You are not allowed to change {field}.",
    "QR053_IMMUTABLE_COLUMN": "{field} cannot be changed once it has been set.",
    "QR054_COLUMN_NOT_ALLOWED": "Your role cannot change {field}.",
    "QR055_PRIVILEGE_ESCALATION": "You cannot grant a role higher than your own.",
    "QR056_SELF_MODIFICATION": "You cannot change your own role or access.",
    "QR999_INTERNAL": "Something went wrong on our side. Please try again."
  },
  "states": {
    "loading": {
      "generic": "Loading…",
      "menu": "Bringing the menu…",
      "item": "Loading the dish…",
      "cart": "Checking your cart…",
      "order": "Loading your order…",
      "tracking": "Getting the latest…",
      "kitchen": "Loading the board…",
      "waiter": "Loading the floor…",
      "dashboard": "Crunching today's numbers…",
      "orders": "Loading orders…",
      "menuAdmin": "Loading the menu…",
      "tables": "Loading tables…",
      "branches": "Loading branches…",
      "staff": "Loading the team…",
      "analytics": "Building the report…",
      "settings": "Loading settings…"
    },
    "error": {
      "generic": { "title": "Something went wrong", "body": "Try again in a moment." },
      "menu": { "title": "We couldn't load the menu", "body": "Check your connection and try again — your table is still valid." },
      "item": { "title": "We couldn't load this dish", "body": "Go back to the menu and open it again." },
      "cart": { "title": "We couldn't check your cart", "body": "Your dishes are saved on this device. Try again." },
      "order": { "title": "We couldn't send your order", "body": "Nothing was charged and your cart is intact. Try again." },
      "tracking": { "title": "We lost track of your order", "body": "It is still with the kitchen. Refresh to reconnect." },
      "kitchen": { "title": "The board could not load", "body": "Orders are safe. Refresh to reconnect to the kitchen feed." },
      "waiter": { "title": "The floor view could not load", "body": "Refresh to reconnect. Calls are not lost while you are away." },
      "dashboard": { "title": "The dashboard could not load", "body": "Your data is fine — this is a display problem. Try again." },
      "orders": { "title": "Orders could not load", "body": "Try again, or narrow the date range." },
      "menuAdmin": { "title": "The menu could not load", "body": "Try again. Nothing has been changed." },
      "tables": { "title": "Tables could not load", "body": "Try again. QR codes keep working regardless." },
      "branches": { "title": "Branches could not load", "body": "Try again in a moment." },
      "staff": { "title": "The team list could not load", "body": "Try again. Nobody's access has changed." },
      "analytics": { "title": "The report could not be built", "body": "Try a shorter date range, then try again." },
      "settings": { "title": "Settings could not load", "body": "Try again. Your current settings are unchanged." }
    },
    "empty": {
      "title": "Nothing here yet",
      "body": "When there is something to show, it will appear here."
    },
    "offline": {
      "title": "You are offline",
      "body": "We'll pick up where you left off as soon as the connection is back."
    },
    "notFound": {
      "title": "Page not found",
      "body": "That link does not lead anywhere. Check it, or start from the beginning."
    },
    "demo": {
      "banner": "DEMO DATA — nothing here is a real order",
      "badge": "Demo",
      "body": "You are looking at a sample restaurant so you can try every screen. Real installations never mix demo and live data."
    }
  },
  "status": {
    "order": {
      "pending": "Pending",
      "confirmed": "Confirmed",
      "preparing": "Preparing",
      "ready": "Ready",
      "delivered": "Delivered",
      "completed": "Completed",
      "cancelled": "Cancelled"
    },
    "orderCustomer": {
      "pending": "Sent to the kitchen",
      "confirmed": "The kitchen has accepted your order",
      "preparing": "Your food is being cooked",
      "ready": "Ready — the waiter is on the way",
      "delivered": "Served. Enjoy your meal",
      "completed": "Finished. Thank you",
      "cancelled": "Cancelled"
    },
    "call": {
      "pending": "Waiting",
      "acknowledged": "On the way",
      "resolved": "Handled",
      "cancelled": "Cancelled",
      "expired": "Expired"
    }
  },
  "labels": {
    "role": {
      "SUPER_ADMIN": "Platform admin",
      "RESTAURANT_OWNER": "Owner",
      "MANAGER": "Manager",
      "WAITER": "Waiter",
      "KITCHEN": "Kitchen"
    },
    "dietary": {
      "vegetarian": "Vegetarian",
      "vegan": "Vegan",
      "halal": "Halal",
      "gluten_free": "Gluten free",
      "lactose_free": "Lactose free",
      "nut_free": "Nut free",
      "contains_nuts": "Contains nuts",
      "contains_seafood": "Contains seafood",
      "contains_pork": "Contains pork",
      "contains_alcohol": "Contains alcohol"
    },
    "spicy": { "0": "Not spicy", "1": "Mild", "2": "Spicy", "3": "Very spicy" },
    "orderType": { "dine_in": "At the table", "takeaway": "Takeaway" },
    "channel": { "qr": "QR menu", "waiter": "Waiter", "admin": "Admin" },
    "callReason": {
      "call_waiter": "Call the waiter",
      "request_bill": "Bring the bill",
      "request_water": "Bring water",
      "request_cutlery": "Bring cutlery",
      "clean_table": "Clear the table",
      "complaint": "There is a problem",
      "other": "Something else"
    },
    "promoType": {
      "announcement": "Announcement",
      "percentage": "Percentage off",
      "fixed_amount": "Fixed amount off",
      "special_price": "Special price"
    },
    "locale": { "uz": "Uzbek", "ru": "Russian", "en": "English" },
    "selectionType": { "single": "Choose one", "multiple": "Choose several" }
  },
  "toasts": {
    "saved": "Saved",
    "deleted": "Deleted",
    "copied": "Copied to the clipboard",
    "itemAdded": "{item} added to your order",
    "itemRemoved": "{item} removed",
    "cartCleared": "Cart emptied",
    "orderPlaced": "Order {number} sent to the kitchen",
    "orderCancelled": "Order {number} cancelled",
    "waiterCalled": "The waiter has been called",
    "waiterAcknowledged": "Table {number} — call picked up",
    "statusUpdated": "Order {number} is now {status}",
    "qrRotated": "New QR code generated for table {number}",
    "inviteSent": "Invitation sent",
    "languageChanged": "Language changed to {language}",
    "backOnline": "Back online",
    "wentOffline": "Connection lost — retrying",
    "newOrder": "New order {number} · table {table}",
    "orderReady": "Order {number} is ready",
    "orderLate": "Order {number} is running late",
    "newWaiterCall": "Table {number} is calling",
    "saveFailed": "Could not save. Nothing was changed.",
    "actionFailed": "That did not work. Please try again."
  },
  "a11y": {
    "skipToContent": "Skip to the main content",
    "closeDialog": "Close this dialog",
    "openCart": "Open your cart",
    "increaseQuantity": "Add one more",
    "decreaseQuantity": "Remove one",
    "removeNamedItem": "Remove {item} from your order",
    "loading": "Loading",
    "languageSwitcher": "Choose a language",
    "mainNavigation": "Main navigation",
    "currentPage": "Current page",
    "expand": "Expand",
    "collapse": "Collapse",
    "requiredField": "Required field",
    "spicyLevelLabel": "Spice level: {level}",
    "orderStatusLabel": "Order status: {status}"
  },
  "plurals": {
    "items":      { "one": "{count} item",     "few": "{count} items",     "many": "{count} items",     "other": "{count} items" },
    "dishes":     { "one": "{count} dish",     "few": "{count} dishes",    "many": "{count} dishes",    "other": "{count} dishes" },
    "orders":     { "one": "{count} order",    "few": "{count} orders",    "many": "{count} orders",    "other": "{count} orders" },
    "tables":     { "one": "{count} table",    "few": "{count} tables",    "many": "{count} tables",    "other": "{count} tables" },
    "branches":   { "one": "{count} branch",   "few": "{count} branches",  "many": "{count} branches",  "other": "{count} branches" },
    "staff":      { "one": "{count} person",   "few": "{count} people",    "many": "{count} people",    "other": "{count} people" },
    "categories": { "one": "{count} category", "few": "{count} categories","many": "{count} categories","other": "{count} categories" },
    "guests":     { "one": "{count} guest",    "few": "{count} guests",    "many": "{count} guests",    "other": "{count} guests" },
    "results":    { "one": "{count} result",   "few": "{count} results",   "many": "{count} results",   "other": "{count} results" },
    "minutes":    { "one": "{count} minute",   "few": "{count} minutes",   "many": "{count} minutes",   "other": "{count} minutes" },
    "seconds":    { "one": "{count} second",   "few": "{count} seconds",   "many": "{count} seconds",   "other": "{count} seconds" },
    "hours":      { "one": "{count} hour",     "few": "{count} hours",     "many": "{count} hours",     "other": "{count} hours" },
    "days":       { "one": "{count} day",      "few": "{count} days",      "many": "{count} days",      "other": "{count} days" },
    "extras":     { "one": "{count} extra",    "few": "{count} extras",    "many": "{count} extras",    "other": "{count} extras" },
    "calls":      { "one": "{count} call",     "few": "{count} calls",     "many": "{count} calls",     "other": "{count} calls" }
  }
}
```

### 2.2 `src/messages/uz.json`

```json
{
  "common": {
    "appName": "Restaurant QR OS",
    "tagline": "Skanerlang. Tanlang. Mazza qiling.",
    "yes": "Ha",
    "no": "Yo'q",
    "ok": "OK",
    "cancel": "Bekor qilish",
    "save": "Saqlash",
    "saving": "Saqlanmoqda…",
    "saved": "Saqlandi",
    "edit": "Tahrirlash",
    "delete": "O'chirish",
    "deleting": "O'chirilmoqda…",
    "remove": "Olib tashlash",
    "add": "Qo'shish",
    "create": "Yaratish",
    "close": "Yopish",
    "back": "Orqaga",
    "next": "Keyingi",
    "previous": "Oldingi",
    "continue": "Davom etish",
    "confirm": "Tasdiqlash",
    "retry": "Qayta urinish",
    "refresh": "Yangilash",
    "search": "Qidirish",
    "filter": "Saralash",
    "clear": "Tozalash",
    "clearAll": "Hammasini tozalash",
    "apply": "Qo'llash",
    "reset": "Tiklash",
    "select": "Tanlash",
    "none": "Yo'q",
    "all": "Hammasi",
    "showMore": "Ko'proq ko'rsatish",
    "showLess": "Kamroq ko'rsatish",
    "copy": "Nusxalash",
    "copied": "Nusxalandi",
    "download": "Yuklab olish",
    "print": "Chop etish",
    "export": "Eksport",
    "required": "Majburiy",
    "optional": "Ixtiyoriy",
    "active": "Faol",
    "inactive": "Faol emas",
    "available": "Mavjud",
    "unavailable": "Mavjud emas",
    "language": "Til",
    "actions": "Amallar",
    "status": "Holati",
    "total": "Jami",
    "quantity": "Miqdori",
    "price": "Narxi",
    "name": "Nomi",
    "description": "Tavsifi",
    "image": "Rasm",
    "category": "Bo'lim",
    "notes": "Izohlar",
    "phone": "Telefon",
    "email": "Email",
    "address": "Manzil",
    "time": "Vaqt",
    "date": "Sana",
    "from": "Dan",
    "to": "Gacha",
    "free": "Bepul",
    "new": "Yangi",
    "justNow": "Hozirgina",
    "unnamed": "Nomsiz",
    "notSet": "Belgilanmagan"
  },
  "nav": {
    "home": "Bosh sahifa",
    "menu": "Menyu",
    "cart": "Savat",
    "orders": "Buyurtmalar",
    "tracking": "Buyurtma holati",
    "kitchen": "Oshxona",
    "waiter": "Ofitsiant",
    "admin": "Boshqaruv",
    "dashboard": "Boshqaruv paneli",
    "categories": "Bo'limlar",
    "menuManagement": "Menyu",
    "tables": "Stollar",
    "branches": "Filiallar",
    "staff": "Xodimlar",
    "analytics": "Tahlil",
    "settings": "Sozlamalar",
    "platform": "Platforma",
    "profile": "Profil",
    "signOut": "Chiqish",
    "openMenu": "Menyuni ochish",
    "closeMenu": "Menyuni yopish",
    "backToMenu": "Menyuga qaytish"
  },
  "customer": {
    "welcome": {
      "eyebrow": "Siz o'tirgan joy",
      "greeting": "{restaurant}ga xush kelibsiz",
      "tableLabel": "{number}-stol",
      "intro": "Menyuni ko'ring, telefoningizdan buyurtma bering va uni jonli kuzating. Ilova ham, ro'yxatdan o'tish ham kerak emas.",
      "viewMenu": "Menyuni ko'rish",
      "chooseLanguage": "Tilni tanlang",
      "openNow": "Hozir ochiq",
      "closedNow": "Hozir yopiq",
      "closedTitle": "Hozir yopiqmiz",
      "closedBody": "{restaurant} ayni paytda xizmat ko'rsatmayapti. Yordam kerak bo'lsa, xodimlarimizga murojaat qiling.",
      "notAcceptingTitle": "Buyurtmalar vaqtincha to'xtatilgan",
      "notAcceptingBody": "Oshxona bir necha daqiqaga yangi buyurtmalarni to'xtatdi. Ofitsiant stolda buyurtmani qabul qila oladi.",
      "poweredBy": "Restaurant QR OS asosida",
      "scanAgain": "Stolingizdagi kodni qaytadan skanerlang"
    },
    "menu": {
      "title": "Menyu",
      "searchPlaceholder": "Taom, ichimlik qidiring…",
      "searchLabel": "Menyudan qidirish",
      "resultsFor": "“{query}” bo'yicha natijalar",
      "noResultsTitle": "“{query}” bo'yicha hech nima topilmadi",
      "noResultsBody": "Qisqaroq so'z bilan urinib ko'ring yoki quyidagi bo'limlarni ko'ring.",
      "clearSearch": "Qidiruvni tozalash",
      "allCategories": "Hammasi",
      "popularTitle": "Eng ko'p buyurtma qilinadi",
      "popularSubtitle": "Mehmonlar odatda shuni tanlaydi",
      "featuredTitle": "Oshpaz tavsiyasi",
      "featuredSubtitle": "Biz eng yaxshi ko'rgan tarzda tayyorlanadi",
      "promotionsTitle": "Bugungi takliflar",
      "categoriesTitle": "Menyu bo'limlari",
      "viewCategory": "Barchasi",
      "addToCart": "Qo'shish",
      "added": "Qo'shildi",
      "unavailable": "Tugadi",
      "unavailableUntil": "{time} da qaytadi",
      "prepMinutes": "{minutes} daq",
      "spicyLabel": "Achchiqligi",
      "dietaryLabel": "Tarkib belgilari",
      "cartButton": "Savat · {total}",
      "jumpToCategory": "{category} bo'limiga o'tish"
    },
    "item": {
      "backToMenu": "Menyuga qaytish",
      "ingredientsTitle": "Tarkibi",
      "dietaryTitle": "Bilib qo'ying",
      "prepTitle": "Tayyorlanishi",
      "spicyTitle": "Achchiqlik darajasi",
      "caloriesTitle": "Kaloriya",
      "caloriesValue": "{calories} kkal",
      "quantityTitle": "Nechta?",
      "optionsTitle": "O'zingizga moslang",
      "chooseOne": "Bittasini tanlang",
      "chooseUpTo": "Ko'pi bilan {max} ta tanlang",
      "chooseAtLeast": "Kamida {min} ta tanlang",
      "optionRequired": "Davom etish uchun variantni tanlang.",
      "optionUnavailable": "Tugadi",
      "noteTitle": "Oshxonaga aytadigan gapingiz bormi?",
      "notePlaceholder": "Piyozsiz, qo'shimcha salfetka…",
      "noteHint": "Oshxona buni siz yozgandek o'qiydi.",
      "addToCart": "Savatga qo'shish",
      "addToCartTotal": "Savatga qo'shish · {total}",
      "updateItem": "Yangilash",
      "unavailableTitle": "Bu taom hozirgina tugadi",
      "unavailableBody": "Oshxona uni vaqtincha menyudan olib qo'ydi. Qolgan hamma narsa mavjud.",
      "notFoundTitle": "Bu taomni topa olmadik",
      "notFoundBody": "U qayta nomlangan yoki olib tashlangan bo'lishi mumkin. Bugungi menyuni ko'rish uchun orqaga qayting."
    },
    "cart": {
      "title": "Buyurtmangiz",
      "subtitle": "{number}-stol · {restaurant}",
      "emptyTitle": "Savat bo'sh",
      "emptyBody": "Menyudan biror narsa qo'shing, u shu yerda ko'rinadi.",
      "emptyCta": "Menyuni ko'rish",
      "lineExtras": "Qo'shimchalar",
      "lineNote": "Izoh",
      "editLine": "Tahrirlash",
      "removeLine": "Olib tashlash",
      "removeConfirmTitle": "{item} olib tashlansinmi?",
      "removeConfirmBody": "U buyurtmadan chiqariladi. Istagan vaqtda qayta qo'shishingiz mumkin.",
      "clear": "Savatni bo'shatish",
      "clearConfirmTitle": "Savat bo'shatilsinmi?",
      "clearConfirmBody": "Tanlagan hamma narsangiz o'chiriladi. Buni qaytarib bo'lmaydi.",
      "subtotal": "Taomlar summasi",
      "serviceFee": "Xizmat haqi",
      "serviceFeeHint": "Restoran qo'shadigan {percent}% xizmat haqi",
      "discount": "Chegirma",
      "total": "Jami",
      "guestName": "Ismingiz",
      "guestNamePlaceholder": "Ofitsiant kimni izlashini bilishi uchun",
      "guestCount": "Stoldagi mehmonlar",
      "orderNote": "Butun buyurtmaga izoh",
      "orderNotePlaceholder": "Shoshib turibmiz, hisobni taom bilan olib keling…",
      "placeOrder": "Buyurtma berish",
      "placing": "Buyurtma yuborilmoqda…",
      "addMore": "Yana taom qo'shish",
      "priceChangedTitle": "Narxlar yangilandi",
      "priceChangedBody": "Siz menyuni ko'rayotganingizda restoran narxni o'zgartirdi. Quyidagi summa siz to'laydigan summadir.",
      "itemsRemovedTitle": "Ba'zi taomlar endi mavjud emas",
      "itemsRemovedBody": "Ularni buyurtmangizdan olib tashladik. Qolgani o'zgarishsiz.",
      "estimatedTime": "Taxminan {minutes} daqiqada tayyor bo'ladi"
    },
    "checkout": {
      "confirmTitle": "Buyurtma oshxonaga yuborilsinmi?",
      "confirmBody": "Tasdiqlaganingiz bilan oshxona ishga kirishadi. Dastlabki bir necha daqiqada bekor qilishingiz mumkin.",
      "confirmCta": "Ha, yuboring",
      "successTitle": "Buyurtma qabul qilindi",
      "successBody": "Oshxona buyurtmangizni oldi. Uning holatini shu sahifada kuzating.",
      "orderNumberLabel": "{number} raqamli buyurtma",
      "trackOrder": "Buyurtmani kuzatish",
      "backToMenu": "Menyuga qaytish",
      "keepThisPage": "Buyurtmani kuzatish uchun bu sahifani ochiq qoldiring.",
      "sending": "Yuborilmoqda…"
    },
    "tracking": {
      "title": "Buyurtmangiz",
      "orderNumber": "{number} raqamli buyurtma",
      "placedAt": "{time} da berilgan",
      "tableLabel": "{number}-stol",
      "estimatedReady": "Taxminan {time} da tayyor",
      "readyNow": "Tayyor",
      "itemsTitle": "Buyurtma tarkibi",
      "totalsTitle": "To'lanadigan summa",
      "timelineTitle": "Jarayon",
      "cancelOrder": "Buyurtmani bekor qilish",
      "cancelConfirmTitle": "Buyurtma bekor qilinsinmi?",
      "cancelConfirmBody": "Oshxona ustida ishlashni to'xtatadi. Darhol yangi buyurtma berishingiz mumkin.",
      "cancelWindowOverTitle": "Bekor qilish uchun kech bo'ldi",
      "cancelWindowOverBody": "Oshxona allaqachon boshlab yubordi. Iltimos, ofitsiantga murojaat qiling.",
      "cancelledTitle": "Buyurtma bekor qilindi",
      "cancelledBody": "Hech narsa tayyorlanmaydi. Istagan vaqtda yangi buyurtma bera olasiz.",
      "completedTitle": "Rahmat",
      "completedBody": "Umid qilamizki, yoqdi. Yana kutamiz.",
      "callWaiter": "Ofitsiantni chaqirish",
      "backToMenu": "Yana buyurtma berish",
      "notFoundTitle": "Bu buyurtmani topa olmadik",
      "notFoundBody": "Havola eskirgan yoki buyurtma yopilgan bo'lishi mumkin. Ofitsiantga murojaat qiling.",
      "recentOrders": "So'nggi buyurtmalaringiz",
      "viewOrder": "Ko'rish",
      "live": "Jonli",
      "reconnecting": "Qayta ulanmoqda…",
      "polling": "Bir necha soniyada tekshirilmoqda",
      "lastUpdated": "{time} da yangilandi"
    },
    "waiterCall": {
      "cta": "Ofitsiantni chaqirish",
      "sheetTitle": "Ofitsiantni chaqirish",
      "sheetBody": "{number}-stolga kerak ekanini zalga xabar qilamiz.",
      "reasonLabel": "Nima kerak?",
      "notePlaceholder": "Yana nimani bilishimiz kerak?",
      "send": "Chaqirish",
      "sending": "Chaqirilmoqda…",
      "sentTitle": "Ofitsiant yo'lda",
      "sentBody": "Zal xodimlariga xabar berildi.",
      "pendingTitle": "Ofitsiant kutilmoqda",
      "pendingBody": "Chaqiruvingiz navbatda. Tez orada keladi.",
      "acknowledgedTitle": "Ofitsiant kelyapti",
      "acknowledgedBody": "Chaqiruvingizni {staff} qabul qildi.",
      "cooldownTitle": "Siz hozirgina chaqirdingiz",
      "cooldownBody": "Qayta chaqirishdan oldin {seconds} soniya kuting.",
      "alreadyOpenTitle": "Bu stol uchun chaqiruv allaqachon ochiq"
    }
  },
  "kitchen": {
    "title": "Oshxona",
    "subtitle": "Jonli buyurtmalar",
    "branchLabel": "{branch}",
    "columnNew": "YANGI",
    "columnPreparing": "TAYYORLANMOQDA",
    "columnReady": "TAYYOR",
    "ticketTable": "{number}-stol",
    "ticketTakeaway": "Olib ketish",
    "placedAgo": "{minutes} daqiqa oldin",
    "elapsed": "{elapsed} o'tdi",
    "dueIn": "{minutes} daqiqada tugashi kerak",
    "overdueBy": "{minutes} daqiqa kechikdi",
    "lateBadge": "KECHIKDI",
    "guestNote": "Mehmon izohi",
    "itemNote": "Izoh",
    "accept": "Qabul qilish",
    "startPreparing": "Tayyorlashni boshlash",
    "markReady": "Tayyor deb belgilash",
    "markDelivered": "Topshirildi",
    "undo": "Qaytarish",
    "newOrderTitle": "Yangi buyurtma {number}",
    "newOrderBody": "{table}-stol · {items}",
    "soundOn": "Ovoz yoqilgan",
    "soundOff": "Ovoz o'chirilgan",
    "keepAwakeOn": "Ekran o'chmasin",
    "keepAwakeOff": "Ekran o'chishi mumkin",
    "fullscreen": "To'liq ekran",
    "exitFullscreen": "To'liq ekrandan chiqish",
    "emptyNew": {
      "title": "Yangi buyurtma yo'q",
      "body": "Stol buyurtma yuborishi bilan chipta shu yerda paydo bo'ladi."
    },
    "emptyPreparing": {
      "title": "O'choqda hech nima yo'q",
      "body": "Qabul qilingan buyurtmalar tayyorlanayotganda shu yerga o'tadi."
    },
    "emptyReady": {
      "title": "Kutayotgani yo'q",
      "body": "Tayyor buyurtmalar ofitsiant olib ketguncha shu yerda turadi."
    },
    "connectionLive": "Jonli",
    "connectionReconnecting": "Qayta ulanmoqda…",
    "connectionOffline": "Aloqa yo'q — oxirgi holat ko'rsatilmoqda"
  },
  "waiter": {
    "title": "Zal",
    "subtitle": "Buyurtmalar va stol chaqiruvlari",
    "branchLabel": "{branch}",
    "tabActive": "Faol",
    "tabReady": "Berishga tayyor",
    "tabCalls": "Stol chaqiruvlari",
    "callBannerTitle": "{number}-STOL CHAQIRMOQDA",
    "callBannerBody": "{reason} · {age}",
    "tableCalling": "{number}-stol chaqirmoqda",
    "acknowledge": "Qabul qildim",
    "acknowledging": "Qabul qilinmoqda…",
    "acknowledged": "{staff} qabul qildi",
    "resolve": "Bajarildi",
    "resolved": "Hal qilindi",
    "callAge": "{age} oldin",
    "callNote": "Mehmon izohi",
    "acknowledgedBy": "{time} da {staff} qabul qildi",
    "serve": "Stolga olib borish",
    "markDelivered": "Yetkazildi",
    "complete": "Buyurtmani yopish",
    "orderTable": "{number}-stol",
    "emptyActive": {
      "title": "Faol buyurtma yo'q",
      "body": "Tayyorlanayotgan buyurtmalar shu yerda ko'rinadi."
    },
    "emptyReady": {
      "title": "Berishga narsa yo'q",
      "body": "Oshxona tayyor buyurtmalarni shu yerga yuboradi."
    },
    "emptyCalls": {
      "title": "Hech kim chaqirmayapti",
      "body": "Stol chaqiruv tugmasini bosganda, u shu yerda darhol paydo bo'ladi."
    },
    "newCallTitle": "{number}-stol chaqirmoqda",
    "newCallBody": "{reason}",
    "orderReadyTitle": "{number} raqamli buyurtma tayyor",
    "noBranch": {
      "title": "Filial biriktirilmagan",
      "body": "Hisobingiz hali filialga bog'lanmagan. Menejeringizdan biriktirishni so'rang."
    }
  },
  "admin": {
    "dashboard": {
      "title": "Boshqaruv paneli",
      "subtitle": "Bugungi kun qanday ketmoqda",
      "todayRevenue": "Bugungi tushum",
      "todayOrders": "Bugungi buyurtmalar",
      "avgOrderValue": "O'rtacha buyurtma",
      "activeTables": "Band stollar",
      "pendingOrders": "Tasdiq kutayotganlar",
      "openCalls": "Ochiq chaqiruvlar",
      "popularDishes": "Eng ko'p buyurtma qilingan taomlar",
      "statusOverview": "Holat bo'yicha buyurtmalar",
      "revenueTrend": "Tushum",
      "vsYesterday": "Kechagiga nisbatan {value}",
      "periodToday": "Bugun",
      "periodWeek": "Shu hafta",
      "periodMonth": "Shu oy",
      "viewAllOrders": "Barcha buyurtmalar",
      "liveFeed": "Jonli buyurtmalar",
      "branchFilter": "Filial",
      "allBranches": "Barcha filiallar",
      "noData": {
        "title": "Hozircha ko'rsatadigan narsa yo'q",
        "body": "Kunning birinchi buyurtmasi kelishi bilan raqamlar shu yerda paydo bo'ladi."
      }
    },
    "orders": {
      "title": "Buyurtmalar",
      "subtitle": "Barcha buyurtmalar — jonli va tarixiy",
      "filterStatus": "Holati",
      "filterBranch": "Filial",
      "filterDate": "Sana",
      "searchPlaceholder": "Buyurtma raqami yoki stol",
      "colNumber": "Buyurtma",
      "colTable": "Stol",
      "colStatus": "Holati",
      "colItems": "Taomlar",
      "colTotal": "Jami",
      "colPlaced": "Berilgan",
      "colBranch": "Filial",
      "detailTitle": "{number} raqamli buyurtma",
      "detailItems": "Taomlar",
      "detailTotals": "Hisob",
      "detailTimeline": "Tarix",
      "detailCustomer": "Mehmon",
      "changeStatus": "Holatni o'zgartirish",
      "confirmOrder": "Buyurtmani tasdiqlash",
      "cancelOrder": "Buyurtmani bekor qilish",
      "cancelReasonLabel": "Nima uchun bekor qilinmoqda?",
      "cancelReasonPlaceholder": "Mahsulot tugadi, mehmon fikridan qaytdi…",
      "cancelReasonRequired": "Buyurtmani bekor qilish uchun sabab kerak.",
      "printTicket": "Chiptani chop etish",
      "exportCsv": "CSV eksport",
      "empty": {
        "title": "Mos buyurtma topilmadi",
        "body": "Sana oralig'ini kengaytiring yoki saralashni tozalang."
      }
    },
    "menu": {
      "title": "Menyu",
      "subtitle": "Taomlar, narxlar va mavjudlik",
      "newItem": "Yangi taom",
      "editItem": "Taomni tahrirlash",
      "duplicateItem": "Nusxa olish",
      "deleteItem": "Taomni o'chirish",
      "deleteConfirmTitle": "{item} o'chirilsinmi?",
      "deleteConfirmBody": "U menyudan darhol yo'qoladi. O'tgan buyurtmalar nom va narxning o'z nusxasini saqlaydi, shuning uchun tarix to'g'ri qoladi.",
      "fieldName": "Nomi",
      "fieldDescription": "Tavsifi",
      "fieldIngredients": "Tarkibi",
      "fieldCategory": "Bo'limi",
      "fieldPrice": "Narxi",
      "fieldCompareAtPrice": "Eski narxi",
      "fieldImage": "Rasmi",
      "fieldPrepTime": "Tayyorlanish vaqti (daq)",
      "fieldSpicy": "Achchiqlik darajasi",
      "fieldCalories": "Kaloriya",
      "fieldDietary": "Tarkib belgilari",
      "fieldFeatured": "Oshpaz tavsiyasida ko'rsatilsin",
      "fieldPopular": "Eng ko'p buyurtmalarda ko'rsatilsin",
      "availability": "Mavjudligi",
      "markAvailable": "Mavjud deb belgilash",
      "markUnavailable": "Tugadi deb belgilash",
      "unavailableUntilLabel": "Qachon qayta mavjud bo'ladi",
      "optionsTitle": "Variantlar va qo'shimchalar",
      "optionsHint": "Mehmon hajm tanlashi, qo'shimcha olishi yoki achchiqlikni belgilashi uchun guruhlang.",
      "addOptionGroup": "Guruh qo'shish",
      "groupLabel": "Guruh nomi",
      "groupSelection": "Tanlash turi",
      "groupMin": "Eng kami",
      "groupMax": "Eng ko'pi",
      "addOption": "Variant qo'shish",
      "optionName": "Variant",
      "optionPriceDelta": "Qo'shimcha narx",
      "optionDefault": "Sukut bo'yicha tanlangan",
      "translationsTitle": "Tillar",
      "missingTranslation": "Tarjima yo'q",
      "missingTranslationHint": "Bu tildagi mehmonlar {locale} matnini ko'radi.",
      "uploadImage": "Rasm yuklash",
      "uploadHint": "JPEG yoki PNG, kamida 1200 px kenglikda, 5 MB dan kichik.",
      "reorderHint": "Mehmon ko'radigan tartibni o'zgartirish uchun suring.",
      "filterCategory": "Bo'lim",
      "filterAvailability": "Mavjudligi",
      "empty": {
        "title": "Hali taom yo'q",
        "body": "Birinchi taomni qo'shing — u QR menyuda darhol paydo bo'ladi."
      },
      "emptyCta": "Taom qo'shish"
    },
    "categories": {
      "title": "Bo'limlar",
      "subtitle": "Menyu qanday guruhlangan",
      "newCategory": "Yangi bo'lim",
      "editCategory": "Bo'limni tahrirlash",
      "deleteCategory": "Bo'limni o'chirish",
      "deleteConfirmTitle": "{category} o'chirilsinmi?",
      "deleteConfirmBody": "Bo'lim menyudan yo'qoladi. Avval u bo'sh bo'lishi kerak.",
      "deleteBlockedTitle": "Bu bo'limda hali taomlar bor",
      "deleteBlockedBody": "Avval uning {count} ta taomini ko'chiring yoki o'chiring, so'ng qayta urinib ko'ring.",
      "fieldName": "Nomi",
      "fieldDescription": "Tavsifi",
      "fieldIcon": "Belgisi",
      "fieldBranch": "Filial",
      "allBranches": "Barcha filiallar",
      "reorderHint": "Menyudagi tartibni o'zgartirish uchun suring.",
      "itemsInCategory": "{count} ta taom",
      "empty": {
        "title": "Hali bo'lim yo'q",
        "body": "Bo'limlar mehmonga uzun menyuda yo'l topishga yordam beradi."
      },
      "emptyCta": "Bo'lim qo'shish"
    },
    "tables": {
      "title": "Stollar",
      "subtitle": "QR kodlar va stol raqamlari",
      "newTable": "Yangi stol",
      "editTable": "Stolni tahrirlash",
      "fieldNumber": "Stol raqami",
      "fieldName": "Belgisi",
      "fieldZone": "Zona",
      "fieldSeats": "O'rindiqlar",
      "fieldBranch": "Filial",
      "qrTitle": "QR kod",
      "qrHint": "Buni chop etib stolga qo'ying. Har bir stolning o'z kodi bor.",
      "viewQr": "QR ni ko'rish",
      "downloadPng": "PNG yuklab olish",
      "downloadSvg": "SVG yuklab olish",
      "printSheet": "Barcha kodlarni chop etish",
      "tableUrl": "Stol havolasi",
      "copyUrl": "Havolani nusxalash",
      "rotateToken": "Yangi kod yaratish",
      "rotateConfirmTitle": "{number}-stol uchun yangi QR kod yaratilsinmi?",
      "rotateConfirmBody": "Stoldagi chop etilgan kod darhol ishlamay qoladi. Tasdiqlashdan oldin yangisini chop etib qo'ying.",
      "rotateReasonLabel": "Nima uchun? (jurnalga yoziladi)",
      "rotationCount": "{count} marta yangilangan",
      "issuedAt": "{date} da berilgan",
      "deactivate": "Xizmatdan chiqarish",
      "activate": "Xizmatga qaytarish",
      "deactivateConfirmTitle": "{number}-stol xizmatdan chiqarilsinmi?",
      "deactivateConfirmBody": "Uning kodini skanerlagan mehmonlar menyu o'rniga xushmuomala xabarni ko'radi.",
      "empty": {
        "title": "Hali stol yo'q",
        "body": "Stol qo'shing — biz unga xavfsiz QR kod yaratamiz."
      },
      "emptyCta": "Stol qo'shish"
    },
    "branches": {
      "title": "Filiallar",
      "subtitle": "Manzillar, ish vaqti va xizmat qoidalari",
      "newBranch": "Yangi filial",
      "editBranch": "Filialni tahrirlash",
      "fieldName": "Filial nomi",
      "fieldCode": "Kodi",
      "fieldCodeHint": "Bir-to'rtta bosh harf. U har bir buyurtma raqami oldiga qo'shiladi, masalan A-014.",
      "fieldAddress": "Manzili",
      "fieldTimezone": "Vaqt mintaqasi",
      "fieldOpeningHours": "Ish vaqti",
      "fieldServiceFee": "Xizmat haqi",
      "fieldServiceFeeInherit": "Restoran stavkasidan foydalanish",
      "fieldWaiterCooldown": "Chaqiruvlar orasidagi kutish (soniya)",
      "fieldOrderInterval": "Bitta stoldan buyurtmalar orasidagi kutish (soniya)",
      "fieldPrepDefault": "Standart tayyorlanish vaqti (daq)",
      "fieldLateThreshold": "Necha daqiqadan keyin kechikkan deb belgilansin (daq)",
      "acceptingOrders": "Buyurtma qabul qilmoqda",
      "pauseOrders": "Yangi buyurtmalarni to'xtatish",
      "resumeOrders": "Buyurtmalarni davom ettirish",
      "pausedNotice": "Bu filial yangi buyurtma qabul qilmayapti. Mehmonlar buyurtma tugmasi o'rniga xabarni ko'radi.",
      "tableCount": "{count} ta stol",
      "staffCount": "{count} ta xodim",
      "empty": {
        "title": "Hali filial yo'q",
        "body": "Har bir stol filialga tegishli, shuning uchun avval filial qo'shing."
      },
      "emptyCta": "Filial qo'shish"
    },
    "staff": {
      "title": "Xodimlar",
      "subtitle": "Kim nima qila oladi va qayerda",
      "invite": "Taklif qilish",
      "inviteTitle": "Jamoaga taklif qilish",
      "inviteBody": "Ular parol o'rnatish havolasi bilan xat oladi. Siz parolni hech qachon ko'rmaysiz.",
      "fieldEmail": "Ish emaili",
      "fieldFullName": "To'liq ismi",
      "fieldRole": "Lavozimi",
      "fieldBranch": "Filiali",
      "fieldEmployeeCode": "Xodim raqami",
      "allBranches": "Barcha filiallar",
      "inviteSent": "{email} manziliga taklif yuborildi",
      "resendInvite": "Qayta yuborish",
      "revokeInvite": "Taklifni bekor qilish",
      "pendingInvite": "Taklif kutilmoqda",
      "joinedAt": "{date} da qo'shildi",
      "lastSeen": "Oxirgi faollik {time}",
      "neverSignedIn": "Hali kirmagan",
      "deactivate": "Faolsizlantirish",
      "reactivate": "Qayta faollashtirish",
      "deactivateConfirmTitle": "{name} faolsizlantirilsinmi?",
      "deactivateConfirmBody": "U hamma joydan chiqariladi va qayta kira olmaydi. Tarixi saqlanib qoladi.",
      "lastOwner": {
        "title": "Oxirgi egani olib tashlab bo'lmaydi",
        "body": "Har bir restoranda kamida bitta ega bo'lishi shart. Avval boshqa birovni ega qiling."
      },
      "empty": {
        "title": "Hali xodim yo'q",
        "body": "Menejer, ofitsiant va oshxona xodimlarini taklif qiling — ular tizimga kira oladi."
      },
      "emptyCta": "Taklif qilish"
    },
    "analytics": {
      "title": "Tahlil",
      "subtitle": "Haqiqiy buyurtmalardan olingan haqiqiy raqamlar",
      "rangeToday": "Bugun",
      "rangeWeek": "Oxirgi 7 kun",
      "rangeMonth": "Oxirgi 30 kun",
      "rangeCustom": "Boshqa oraliq",
      "revenue": "Tushum",
      "orders": "Buyurtmalar",
      "avgTicket": "O'rtacha buyurtma",
      "itemsSold": "Sotilgan taomlar",
      "topItems": "Eng ko'p sotilgan taomlar",
      "topCategories": "Eng ko'p sotilgan bo'limlar",
      "byHour": "Soatlar bo'yicha buyurtmalar",
      "byBranch": "Filiallar bo'yicha",
      "byStatus": "Holat bo'yicha",
      "peakHour": "Eng gavjum soat: {hour}",
      "exportCsv": "CSV eksport",
      "noData": {
        "title": "Ma'lumot hali yetarli emas",
        "body": "Buyurtmalar kela boshlaganda grafiklar to'ladi. Bu yerda hech narsa o'ylab topilmagan."
      }
    },
    "settings": {
      "title": "Sozlamalar",
      "subtitle": "Restoraningiz qanday ishlaydi",
      "tabGeneral": "Umumiy",
      "tabBranding": "Brend",
      "tabOrdering": "Buyurtma",
      "tabDanger": "Xavfli zona",
      "restaurantName": "Restoran nomi",
      "slug": "Veb manzili",
      "slugHint": "Kichik harflar, raqamlar va chiziqcha. O'zgartirsangiz eski havolalar ishlamaydi.",
      "logo": "Logotip",
      "coverImage": "Muqova rasmi",
      "welcomeMessage": "Xush kelibsiz xabari",
      "welcomeMessageHint": "Mehmon skanerlagandan keyin o'qiydigan birinchi qator. Qisqa va samimiy bo'lsin.",
      "description": "Restoran haqida",
      "defaultLocale": "Asosiy til",
      "defaultLocaleHint": "Taomda mehmon tilidagi matn bo'lmasa, shu til ishlatiladi.",
      "currency": "Valyuta",
      "currencyDecimals": "Kasr xonalari",
      "currencyHint": "UZS da kasr yo'q — narxlar butun so'mda.",
      "serviceFeeEnabled": "Xizmat haqi qo'shilsin",
      "serviceFeeRate": "Xizmat haqi stavkasi",
      "serviceFeeHint": "Mehmonga tasdiqlashdan oldin alohida qator sifatida ko'rsatiladi.",
      "dangerTitle": "Xavfli zona",
      "deactivateRestaurant": "Restoranni faolsizlantirish",
      "deactivateConfirmTitle": "{restaurant} faolsizlantirilsinmi?",
      "deactivateConfirmBody": "Barcha QR kodlar ishlamay qoladi va xodimlar tizimga kira olmaydi. Ma'lumotlaringiz saqlanadi, istagan vaqtda qayta faollashtirasiz."
    },
    "platform": {
      "title": "Platforma",
      "subtitle": "Ushbu tizimdagi barcha restoranlar",
      "restaurantsCount": "Restoranlar",
      "branchesCount": "Filiallar",
      "ordersToday": "Bugungi buyurtmalar",
      "colRestaurant": "Restoran",
      "colSlug": "Manzil",
      "colBranches": "Filiallar",
      "colOrders": "Buyurtmalar",
      "colCreated": "Yaratilgan",
      "demoBadge": "Demo",
      "empty": {
        "title": "Hali restoran yo'q",
        "body": "Birinchi ega ro'yxatdan o'tishi bilan uning restorani shu yerda paydo bo'ladi."
      }
    }
  },
  "auth": {
    "signInTitle": "Xodimlar uchun kirish",
    "signInSubtitle": "Egalar, menejerlar, ofitsiantlar va oshxona xodimlari uchun.",
    "email": "Email",
    "emailPlaceholder": "siz@restoran.uz",
    "password": "Parol",
    "passwordPlaceholder": "Parolingiz",
    "showPassword": "Parolni ko'rsatish",
    "hidePassword": "Parolni yashirish",
    "signIn": "Kirish",
    "signingIn": "Kirilmoqda…",
    "forgotPassword": "Parolni unutdingizmi?",
    "resetTitle": "Parolni tiklash",
    "resetSubtitle": "Emailingizga havola yuboramiz. U bir marta ishlaydi va bir soatda eskiradi.",
    "sendResetLink": "Havolani yuborish",
    "sending": "Yuborilmoqda…",
    "resetSent": {
      "title": "Emailingizni tekshiring",
      "body": "Agar bu manzil xodim hisobiga tegishli bo'lsa, tiklash havolasi yo'lda."
    },
    "newPasswordTitle": "Yangi parol tanlang",
    "newPassword": "Yangi parol",
    "confirmPassword": "Parolni takrorlang",
    "updatePassword": "Parolni saqlash",
    "passwordUpdated": {
      "title": "Parol yangilandi",
      "body": "Endi u bilan tizimga kira olasiz."
    },
    "inviteTitle": "{restaurant} jamoasiga qo'shiling",
    "inviteSubtitle": "Parol o'rnating — tayyor.",
    "fullName": "To'liq ism",
    "preferredLanguage": "Qaysi tilni afzal ko'rasiz",
    "acceptInvite": "Jamoaga qo'shilish",
    "accepting": "Tayyorlanmoqda…",
    "signOut": "Chiqish",
    "signOutConfirmTitle": "Chiqilsinmi?",
    "signOutConfirmBody": "Qaytib kirish uchun parolingiz kerak bo'ladi.",
    "backToSignIn": "Kirish sahifasiga qaytish",
    "staffOnly": {
      "title": "Bu bo'lim xodimlar uchun",
      "body": "Mehmonlarga hisob kerak emas — shunchaki stolingizdagi kodni skanerlang."
    }
  },
  "errors": {
    "app": {
      "TABLE_INACTIVE": "Bu stol xizmatdan chiqarilgan. Iltimos, xodimlarimizga murojaat qiling.",
      "INVALID_QR": "Bu QR kod yaroqsiz. Iltimos, stolingizdagi kodni skanerlang.",
      "RESTAURANT_CLOSED": "Restoran hozir buyurtma qabul qilmayapti.",
      "ITEM_UNAVAILABLE": "Buyurtmangizdagi taomlardan biri hozirgina tugadi.",
      "PRICE_MISMATCH": "Siz menyuni ko'rayotganingizda narxlar o'zgardi. Tasdiqlashdan oldin jamini tekshiring.",
      "INVALID_TRANSITION": "Bu buyurtma allaqachon keyingi bosqichga o'tgan. Yangilanmoqda.",
      "RATE_LIMITED": "Juda tez bo'ldi. {seconds} soniya kutib, qayta urinib ko'ring.",
      "FORBIDDEN": "Buni bajarishga ruxsatingiz yo'q.",
      "NOT_FOUND": "Buni endi topa olmadik.",
      "VALIDATION_FAILED": "Belgilangan maydonlarni tekshiring.",
      "NETWORK": "Aloqa yo'q. Buyurtmangiz shu qurilmada saqlanadi.",
      "UNKNOWN": "Bizning tomonda xatolik yuz berdi. Qayta urinib ko'ring."
    },
    "validation": {
      "required": "Bu maydon majburiy.",
      "invalid": "Bu qiymat yaroqsiz.",
      "email": "To'g'ri email manzilini kiriting.",
      "phone": "To'g'ri telefon raqamini kiriting, masalan +998 90 123 45 67.",
      "slug": "Faqat kichik harflar, raqamlar va chiziqchadan foydalaning.",
      "url": "To'g'ri veb manzilini kiriting.",
      "tooShort": "Kamida {min} ta belgi kiriting.",
      "tooLong": "Ko'pi bilan {max} ta belgi kiriting.",
      "tooSmall": "{min} yoki undan katta bo'lishi kerak.",
      "tooBig": "{max} yoki undan kichik bo'lishi kerak.",
      "integer": "Butun son kiriting.",
      "positive": "Noldan katta son kiriting.",
      "nonNegative": "Bu manfiy bo'la olmaydi.",
      "passwordWeak": "Kamida 8 ta belgi, harf va raqam bilan.",
      "passwordMismatch": "Ikkala parol bir xil emas.",
      "i18nAtLeastOne": "Kamida bitta tilni to'ldiring.",
      "i18nTooLong": "Har bir tilda ko'pi bilan {max} ta belgi bo'lishi mumkin.",
      "invalidLocale": "O'zbek, rus yoki ingliz tilini tanlang.",
      "invalidTime": "24 soatlik formatdan foydalaning, masalan 09:30.",
      "fileTooLarge": "Fayl {max} dan kichik bo'lishi kerak.",
      "fileType": "Faqat {types} fayllari qabul qilinadi.",
      "duplicateValue": "{value} allaqachon band."
    },
    "generic": {
      "title": "Xatolik yuz berdi",
      "body": "Buni yakunlay olmadik. Qayta urinib ko'ring, takrorlansa quyidagi kodni bizga ayting.",
      "retry": "Qayta urinish",
      "traceLabel": "Ma'lumotnoma {traceId}",
      "notFoundTitle": "Topilmadi",
      "notFoundBody": "Siz izlagan sahifa mavjud emas.",
      "forbiddenTitle": "Ruxsat yo'q",
      "forbiddenBody": "Lavozimingizda bu sahifa yo'q. Xato bo'lsa, menejeringizga murojaat qiling.",
      "offlineTitle": "Internet yo'q",
      "offlineBody": "O'zimiz qayta ulanamiz. Kiritganlaringiz yo'qolmaydi.",
      "serverTitle": "Bizning tomonda muammo",
      "serverBody": "Jamoaga xabar berildi. Bir ozdan keyin qayta urinib ko'ring.",
      "goHome": "Boshiga qaytish"
    },
    "QR001_INVALID_QR_TOKEN": "Bu QR kod yaroqsiz. Iltimos, stolingizdagi kodni skanerlang.",
    "QR002_TABLE_INACTIVE": "Bu stol xizmatdan chiqarilgan. Iltimos, xodimlarimizga murojaat qiling.",
    "QR003_BRANCH_INACTIVE": "Bu filial hozir yopiq.",
    "QR004_RESTAURANT_INACTIVE": "Bu restoran hozir buyurtma qabul qilmayapti.",
    "QR010_ORDER_RATE_LIMITED": "Siz hozirgina buyurtma berdingiz. Yangisini yuborishdan oldin {seconds} soniya kuting.",
    "QR011_WAITER_CALL_COOLDOWN": "Siz hozirgina chaqirdingiz. Qayta chaqirishdan oldin {seconds} soniya kuting.",
    "QR012_WAITER_CALL_ALREADY_OPEN": "Bu stol uchun ofitsiant allaqachon chaqirilgan.",
    "QR013_DUPLICATE_ORDER": "Bu buyurtma allaqachon yuborilgan. Uni ochyapmiz.",
    "QR020_ITEM_UNAVAILABLE": "{item} hozirgina tugadi va buyurtmangizdan olib tashlandi.",
    "QR022_INVALID_OPTION": "Siz tanlagan qo'shimchalardan biri endi taklif qilinmaydi.",
    "QR023_INVALID_PAYLOAD": "Bu buyurtmani o'qiy olmadik. Savatdan qayta urinib ko'ring.",
    "QR024_QUANTITY_OUT_OF_RANGE": "Har bir taomdan 1 dan 999 tagacha tanlang.",
    "QR030_ORDER_NOT_FOUND": "Bu buyurtmani endi topa olmadik.",
    "QR030_NOT_FOUND": "Buni endi topa olmadik.",
    "QR032_ORDER_EXPIRED": "Bu buyurtma yopilgan va endi kuzatilmaydi.",
    "QR040_INVALID_STATUS_TRANSITION": "Bu buyurtma allaqachon keyingi bosqichga o'tgan. Doska yangilanmoqda.",
    "QR041_INVALID_CALL_TRANSITION": "Bu chaqiruvni allaqachon boshqa xodim bajardi.",
    "QR042_CANCEL_REASON_REQUIRED": "Buyurtmani bekor qilish uchun sabab kerak.",
    "QR043_ORDER_CLOSED": "Bu buyurtma yopilgan va uni o'zgartirib bo'lmaydi.",
    "QR050_FORBIDDEN": "Buni bajarishga ruxsatingiz yo'q.",
    "QR051_LAST_OWNER": "Har bir restoranda kamida bitta ega bo'lishi shart.",
    "QR052_FORBIDDEN_FIELD": "Sizga {field} maydonini o'zgartirishga ruxsat yo'q.",
    "QR053_IMMUTABLE_COLUMN": "{field} bir marta belgilangach o'zgartirilmaydi.",
    "QR054_COLUMN_NOT_ALLOWED": "Lavozimingiz {field} maydonini o'zgartira olmaydi.",
    "QR055_PRIVILEGE_ESCALATION": "O'zingiznikidan yuqori lavozim bera olmaysiz.",
    "QR056_SELF_MODIFICATION": "O'z lavozimingiz yoki ruxsatingizni o'zgartira olmaysiz.",
    "QR999_INTERNAL": "Bizning tomonda xatolik yuz berdi. Qayta urinib ko'ring."
  },
  "states": {
    "loading": {
      "generic": "Yuklanmoqda…",
      "menu": "Menyu keltirilmoqda…",
      "item": "Taom yuklanmoqda…",
      "cart": "Savat tekshirilmoqda…",
      "order": "Buyurtma yuklanmoqda…",
      "tracking": "So'nggi holat olinmoqda…",
      "kitchen": "Doska yuklanmoqda…",
      "waiter": "Zal yuklanmoqda…",
      "dashboard": "Bugungi raqamlar hisoblanmoqda…",
      "orders": "Buyurtmalar yuklanmoqda…",
      "menuAdmin": "Menyu yuklanmoqda…",
      "tables": "Stollar yuklanmoqda…",
      "branches": "Filiallar yuklanmoqda…",
      "staff": "Jamoa yuklanmoqda…",
      "analytics": "Hisobot tayyorlanmoqda…",
      "settings": "Sozlamalar yuklanmoqda…"
    },
    "error": {
      "generic": { "title": "Xatolik yuz berdi", "body": "Bir ozdan keyin qayta urinib ko'ring." },
      "menu": { "title": "Menyuni yuklay olmadik", "body": "Aloqani tekshiring va qayta urinib ko'ring — stolingiz hamon amal qiladi." },
      "item": { "title": "Bu taomni yuklay olmadik", "body": "Menyuga qayting va uni qaytadan oching." },
      "cart": { "title": "Savatni tekshira olmadik", "body": "Taomlaringiz shu qurilmada saqlangan. Qayta urinib ko'ring." },
      "order": { "title": "Buyurtmani yubora olmadik", "body": "Hech qanday to'lov bo'lmadi va savatingiz joyida. Qayta urinib ko'ring." },
      "tracking": { "title": "Buyurtma kuzatuvi uzildi", "body": "U hamon oshxonada. Qayta ulanish uchun sahifani yangilang." },
      "kitchen": { "title": "Doskani yuklay olmadik", "body": "Buyurtmalar xavfsiz. Oshxona oqimiga qayta ulanish uchun yangilang." },
      "waiter": { "title": "Zal ko'rinishi yuklanmadi", "body": "Qayta ulanish uchun yangilang. Siz yo'qligingizda chaqiruvlar yo'qolmaydi." },
      "dashboard": { "title": "Boshqaruv paneli yuklanmadi", "body": "Ma'lumotlaringiz joyida — bu faqat ko'rsatish muammosi. Qayta urinib ko'ring." },
      "orders": { "title": "Buyurtmalar yuklanmadi", "body": "Qayta urinib ko'ring yoki sana oralig'ini toraytiring." },
      "menuAdmin": { "title": "Menyu yuklanmadi", "body": "Qayta urinib ko'ring. Hech narsa o'zgartirilmadi." },
      "tables": { "title": "Stollar yuklanmadi", "body": "Qayta urinib ko'ring. QR kodlar baribir ishlayveradi." },
      "branches": { "title": "Filiallar yuklanmadi", "body": "Bir ozdan keyin qayta urinib ko'ring." },
      "staff": { "title": "Jamoa ro'yxati yuklanmadi", "body": "Qayta urinib ko'ring. Hech kimning ruxsati o'zgarmadi." },
      "analytics": { "title": "Hisobot tayyorlanmadi", "body": "Qisqaroq sana oralig'ini tanlab, qayta urinib ko'ring." },
      "settings": { "title": "Sozlamalar yuklanmadi", "body": "Qayta urinib ko'ring. Joriy sozlamalaringiz o'zgarmadi." }
    },
    "empty": {
      "title": "Hozircha bo'sh",
      "body": "Ko'rsatadigan narsa paydo bo'lsa, u shu yerda chiqadi."
    },
    "offline": {
      "title": "Internet yo'q",
      "body": "Aloqa tiklanishi bilan qoldirgan joyingizdan davom etamiz."
    },
    "notFound": {
      "title": "Sahifa topilmadi",
      "body": "Bu havola hech qayerga olib bormaydi. Uni tekshiring yoki boshidan boshlang."
    },
    "demo": {
      "banner": "DEMO MA'LUMOT — bu yerdagi hech bir buyurtma haqiqiy emas",
      "badge": "Demo",
      "body": "Har bir ekranni sinab ko'rishingiz uchun namunaviy restoran ko'rsatilmoqda. Haqiqiy tizimlarda demo va jonli ma'lumot hech qachon aralashmaydi."
    }
  },
  "status": {
    "order": {
      "pending": "Kutilmoqda",
      "confirmed": "Tasdiqlandi",
      "preparing": "Tayyorlanmoqda",
      "ready": "Tayyor",
      "delivered": "Yetkazildi",
      "completed": "Yakunlandi",
      "cancelled": "Bekor qilindi"
    },
    "orderCustomer": {
      "pending": "Oshxonaga yuborildi",
      "confirmed": "Oshxona buyurtmangizni qabul qildi",
      "preparing": "Taomingiz tayyorlanmoqda",
      "ready": "Tayyor — ofitsiant yo'lda",
      "delivered": "Berildi. Yoqimli ishtaha",
      "completed": "Yakunlandi. Rahmat",
      "cancelled": "Bekor qilindi"
    },
    "call": {
      "pending": "Kutilmoqda",
      "acknowledged": "Yo'lda",
      "resolved": "Bajarildi",
      "cancelled": "Bekor qilindi",
      "expired": "Muddati o'tdi"
    }
  },
  "labels": {
    "role": {
      "SUPER_ADMIN": "Platforma administratori",
      "RESTAURANT_OWNER": "Ega",
      "MANAGER": "Menejer",
      "WAITER": "Ofitsiant",
      "KITCHEN": "Oshxona"
    },
    "dietary": {
      "vegetarian": "Vegetarian",
      "vegan": "Vegan",
      "halal": "Halol",
      "gluten_free": "Glutensiz",
      "lactose_free": "Laktozasiz",
      "nut_free": "Yong'oqsiz",
      "contains_nuts": "Tarkibida yong'oq bor",
      "contains_seafood": "Tarkibida dengiz mahsuloti bor",
      "contains_pork": "Tarkibida cho'chqa go'shti bor",
      "contains_alcohol": "Tarkibida spirt bor"
    },
    "spicy": { "0": "Achchiq emas", "1": "Yengil achchiq", "2": "Achchiq", "3": "Juda achchiq" },
    "orderType": { "dine_in": "Stolda", "takeaway": "Olib ketish" },
    "channel": { "qr": "QR menyu", "waiter": "Ofitsiant", "admin": "Boshqaruv" },
    "callReason": {
      "call_waiter": "Ofitsiantni chaqirish",
      "request_bill": "Hisobni keltiring",
      "request_water": "Suv keltiring",
      "request_cutlery": "Qoshiq-vilka keltiring",
      "clean_table": "Stolni yig'ishtiring",
      "complaint": "Muammo bor",
      "other": "Boshqa narsa"
    },
    "promoType": {
      "announcement": "E'lon",
      "percentage": "Foizli chegirma",
      "fixed_amount": "Belgilangan chegirma",
      "special_price": "Maxsus narx"
    },
    "locale": { "uz": "O'zbekcha", "ru": "Ruscha", "en": "Inglizcha" },
    "selectionType": { "single": "Bittasini tanlang", "multiple": "Bir nechtasini tanlang" }
  },
  "toasts": {
    "saved": "Saqlandi",
    "deleted": "O'chirildi",
    "copied": "Vaqtinchalik xotiraga nusxalandi",
    "itemAdded": "{item} buyurtmangizga qo'shildi",
    "itemRemoved": "{item} olib tashlandi",
    "cartCleared": "Savat bo'shatildi",
    "orderPlaced": "{number} raqamli buyurtma oshxonaga yuborildi",
    "orderCancelled": "{number} raqamli buyurtma bekor qilindi",
    "waiterCalled": "Ofitsiant chaqirildi",
    "waiterAcknowledged": "{number}-stol — chaqiruv qabul qilindi",
    "statusUpdated": "{number} raqamli buyurtma endi {status}",
    "qrRotated": "{number}-stol uchun yangi QR kod yaratildi",
    "inviteSent": "Taklif yuborildi",
    "languageChanged": "Til {language} tiliga o'zgartirildi",
    "backOnline": "Aloqa tiklandi",
    "wentOffline": "Aloqa uzildi — qayta urinilmoqda",
    "newOrder": "Yangi buyurtma {number} · {table}-stol",
    "orderReady": "{number} raqamli buyurtma tayyor",
    "orderLate": "{number} raqamli buyurtma kechikmoqda",
    "newWaiterCall": "{number}-stol chaqirmoqda",
    "saveFailed": "Saqlab bo'lmadi. Hech narsa o'zgartirilmadi.",
    "actionFailed": "Bu amal bajarilmadi. Qayta urinib ko'ring."
  },
  "a11y": {
    "skipToContent": "Asosiy mazmunga o'tish",
    "closeDialog": "Bu oynani yopish",
    "openCart": "Savatni ochish",
    "increaseQuantity": "Yana bitta qo'shish",
    "decreaseQuantity": "Bittasini olib tashlash",
    "removeNamedItem": "{item} ni buyurtmadan olib tashlash",
    "loading": "Yuklanmoqda",
    "languageSwitcher": "Tilni tanlang",
    "mainNavigation": "Asosiy menyu",
    "currentPage": "Joriy sahifa",
    "expand": "Ochish",
    "collapse": "Yig'ish",
    "requiredField": "Majburiy maydon",
    "spicyLevelLabel": "Achchiqlik darajasi: {level}",
    "orderStatusLabel": "Buyurtma holati: {status}"
  },
  "plurals": {
    "items":      { "one": "{count} ta pozitsiya", "few": "{count} ta pozitsiya", "many": "{count} ta pozitsiya", "other": "{count} ta pozitsiya" },
    "dishes":     { "one": "{count} ta taom",      "few": "{count} ta taom",      "many": "{count} ta taom",      "other": "{count} ta taom" },
    "orders":     { "one": "{count} ta buyurtma",  "few": "{count} ta buyurtma",  "many": "{count} ta buyurtma",  "other": "{count} ta buyurtma" },
    "tables":     { "one": "{count} ta stol",      "few": "{count} ta stol",      "many": "{count} ta stol",      "other": "{count} ta stol" },
    "branches":   { "one": "{count} ta filial",    "few": "{count} ta filial",    "many": "{count} ta filial",    "other": "{count} ta filial" },
    "staff":      { "one": "{count} ta xodim",     "few": "{count} ta xodim",     "many": "{count} ta xodim",     "other": "{count} ta xodim" },
    "categories": { "one": "{count} ta bo'lim",    "few": "{count} ta bo'lim",    "many": "{count} ta bo'lim",    "other": "{count} ta bo'lim" },
    "guests":     { "one": "{count} ta mehmon",    "few": "{count} ta mehmon",    "many": "{count} ta mehmon",    "other": "{count} ta mehmon" },
    "results":    { "one": "{count} ta natija",    "few": "{count} ta natija",    "many": "{count} ta natija",    "other": "{count} ta natija" },
    "minutes":    { "one": "{count} daqiqa",       "few": "{count} daqiqa",       "many": "{count} daqiqa",       "other": "{count} daqiqa" },
    "seconds":    { "one": "{count} soniya",       "few": "{count} soniya",       "many": "{count} soniya",       "other": "{count} soniya" },
    "hours":      { "one": "{count} soat",         "few": "{count} soat",         "many": "{count} soat",         "other": "{count} soat" },
    "days":       { "one": "{count} kun",          "few": "{count} kun",          "many": "{count} kun",          "other": "{count} kun" },
    "extras":     { "one": "{count} ta qo'shimcha","few": "{count} ta qo'shimcha","many": "{count} ta qo'shimcha","other": "{count} ta qo'shimcha" },
    "calls":      { "one": "{count} ta chaqiruv",  "few": "{count} ta chaqiruv",  "many": "{count} ta chaqiruv",  "other": "{count} ta chaqiruv" }
  }
}
```

> **Uzbek plural note, restated where a translator will see it.** All four forms above are
> identical by design. Uzbek does not pluralise a noun that follows a numeral — *bir kishi*,
> *besh kishi*, never *besh kishilar* — so the count alone carries the number. The four slots exist
> so the file shape is uniform across locales and `PluralForms` needs no per-locale branching;
> `plural('uz', n)` still returns `one`/`other` correctly should a future string need to differ.

### 2.3 `src/messages/ru.json`

```json
{
  "common": {
    "appName": "Restaurant QR OS",
    "tagline": "Отсканируйте. Выберите. Наслаждайтесь.",
    "yes": "Да",
    "no": "Нет",
    "ok": "ОК",
    "cancel": "Отмена",
    "save": "Сохранить",
    "saving": "Сохраняем…",
    "saved": "Сохранено",
    "edit": "Изменить",
    "delete": "Удалить",
    "deleting": "Удаляем…",
    "remove": "Убрать",
    "add": "Добавить",
    "create": "Создать",
    "close": "Закрыть",
    "back": "Назад",
    "next": "Далее",
    "previous": "Назад",
    "continue": "Продолжить",
    "confirm": "Подтвердить",
    "retry": "Повторить",
    "refresh": "Обновить",
    "search": "Поиск",
    "filter": "Фильтр",
    "clear": "Очистить",
    "clearAll": "Очистить всё",
    "apply": "Применить",
    "reset": "Сбросить",
    "select": "Выбрать",
    "none": "Нет",
    "all": "Все",
    "showMore": "Показать больше",
    "showLess": "Показать меньше",
    "copy": "Копировать",
    "copied": "Скопировано",
    "download": "Скачать",
    "print": "Печать",
    "export": "Экспорт",
    "required": "Обязательно",
    "optional": "Необязательно",
    "active": "Активен",
    "inactive": "Неактивен",
    "available": "В наличии",
    "unavailable": "Нет в наличии",
    "language": "Язык",
    "actions": "Действия",
    "status": "Статус",
    "total": "Итого",
    "quantity": "Количество",
    "price": "Цена",
    "name": "Название",
    "description": "Описание",
    "image": "Фото",
    "category": "Категория",
    "notes": "Примечания",
    "phone": "Телефон",
    "email": "Эл. почта",
    "address": "Адрес",
    "time": "Время",
    "date": "Дата",
    "from": "С",
    "to": "По",
    "free": "Бесплатно",
    "new": "Новое",
    "justNow": "Только что",
    "unnamed": "Без названия",
    "notSet": "Не задано"
  },
  "nav": {
    "home": "Главная",
    "menu": "Меню",
    "cart": "Корзина",
    "orders": "Заказы",
    "tracking": "Статус заказа",
    "kitchen": "Кухня",
    "waiter": "Официант",
    "admin": "Админ-панель",
    "dashboard": "Сводка",
    "categories": "Категории",
    "menuManagement": "Меню",
    "tables": "Столы",
    "branches": "Филиалы",
    "staff": "Сотрудники",
    "analytics": "Аналитика",
    "settings": "Настройки",
    "platform": "Платформа",
    "profile": "Профиль",
    "signOut": "Выйти",
    "openMenu": "Открыть меню",
    "closeMenu": "Закрыть меню",
    "backToMenu": "Назад в меню"
  },
  "customer": {
    "welcome": {
      "eyebrow": "Ваше место",
      "greeting": "Добро пожаловать в «{restaurant}»",
      "tableLabel": "Стол {number}",
      "intro": "Посмотрите меню, закажите с телефона и следите за заказом онлайн. Без приложения и регистрации.",
      "viewMenu": "Открыть меню",
      "chooseLanguage": "Выберите язык",
      "openNow": "Открыто",
      "closedNow": "Закрыто",
      "closedTitle": "Сейчас мы закрыты",
      "closedBody": "«{restaurant}» сейчас не обслуживает. Если нужна помощь, обратитесь к сотруднику зала.",
      "notAcceptingTitle": "Приём заказов приостановлен",
      "notAcceptingBody": "Кухня на несколько минут остановила новые заказы. Официант по-прежнему может принять заказ за столом.",
      "poweredBy": "Работает на Restaurant QR OS",
      "scanAgain": "Отсканируйте код на вашем столе ещё раз"
    },
    "menu": {
      "title": "Меню",
      "searchPlaceholder": "Найти блюдо, напиток…",
      "searchLabel": "Поиск по меню",
      "resultsFor": "Результаты по запросу «{query}»",
      "noResultsTitle": "По запросу «{query}» ничего не найдено",
      "noResultsBody": "Попробуйте более короткое слово или откройте категории ниже.",
      "clearSearch": "Очистить поиск",
      "allCategories": "Все",
      "popularTitle": "Чаще всего заказывают",
      "popularSubtitle": "То, что обычно выбирают гости",
      "featuredTitle": "Выбор шефа",
      "featuredSubtitle": "Приготовлено так, как мы любим",
      "promotionsTitle": "Предложения дня",
      "categoriesTitle": "Разделы меню",
      "viewCategory": "Смотреть все",
      "addToCart": "Добавить",
      "added": "Добавлено",
      "unavailable": "Закончилось",
      "unavailableUntil": "Вернётся в {time}",
      "prepMinutes": "{minutes} мин",
      "spicyLabel": "Острота",
      "dietaryLabel": "Особенности",
      "cartButton": "Корзина · {total}",
      "jumpToCategory": "Перейти к разделу «{category}»"
    },
    "item": {
      "backToMenu": "Назад в меню",
      "ingredientsTitle": "Состав",
      "dietaryTitle": "Важно знать",
      "prepTitle": "Приготовление",
      "spicyTitle": "Уровень остроты",
      "caloriesTitle": "Калорийность",
      "caloriesValue": "{calories} ккал",
      "quantityTitle": "Сколько порций?",
      "optionsTitle": "Соберите по-своему",
      "chooseOne": "Выберите один вариант",
      "chooseUpTo": "Выберите не более {max}",
      "chooseAtLeast": "Выберите не менее {min}",
      "optionRequired": "Чтобы продолжить, выберите вариант.",
      "optionUnavailable": "Закончилось",
      "noteTitle": "Что передать на кухню?",
      "notePlaceholder": "Без лука, побольше салфеток…",
      "noteHint": "Кухня прочитает это ровно так, как вы написали.",
      "addToCart": "В корзину",
      "addToCartTotal": "В корзину · {total}",
      "updateItem": "Обновить",
      "unavailableTitle": "Это блюдо только что закончилось",
      "unavailableBody": "Кухня временно убрала его из меню. Всё остальное доступно.",
      "notFoundTitle": "Не находим это блюдо",
      "notFoundBody": "Возможно, его переименовали или убрали. Вернитесь в меню, чтобы увидеть, что есть сегодня."
    },
    "cart": {
      "title": "Ваш заказ",
      "subtitle": "Стол {number} · {restaurant}",
      "emptyTitle": "Корзина пуста",
      "emptyBody": "Добавьте что-нибудь из меню — оно появится здесь.",
      "emptyCta": "Открыть меню",
      "lineExtras": "Добавки",
      "lineNote": "Примечание",
      "editLine": "Изменить",
      "removeLine": "Убрать",
      "removeConfirmTitle": "Убрать «{item}»?",
      "removeConfirmBody": "Позиция исчезнет из заказа. Вы сможете добавить её снова в любой момент.",
      "clear": "Очистить корзину",
      "clearConfirmTitle": "Очистить корзину?",
      "clearConfirmBody": "Всё выбранное будет удалено. Отменить это действие нельзя.",
      "subtotal": "Сумма блюд",
      "serviceFee": "Сервисный сбор",
      "serviceFeeHint": "Сервисный сбор {percent}%, добавляет ресторан",
      "discount": "Скидка",
      "total": "Итого",
      "guestName": "Ваше имя",
      "guestNamePlaceholder": "Чтобы официант знал, кого искать",
      "guestCount": "Гостей за столом",
      "orderNote": "Примечание ко всему заказу",
      "orderNotePlaceholder": "Мы торопимся, принесите счёт вместе с блюдами…",
      "placeOrder": "Оформить заказ",
      "placing": "Отправляем заказ…",
      "addMore": "Добавить ещё блюда",
      "priceChangedTitle": "Цены обновились",
      "priceChangedBody": "Пока вы выбирали, ресторан изменил цену. Ниже указана сумма, которая будет к оплате.",
      "itemsRemovedTitle": "Некоторых блюд больше нет",
      "itemsRemovedBody": "Мы убрали их из заказа. Остальное осталось без изменений.",
      "estimatedTime": "Будет готово примерно через {minutes} мин"
    },
    "checkout": {
      "confirmTitle": "Отправить заказ на кухню?",
      "confirmBody": "Кухня начнёт готовить сразу после подтверждения. Отменить можно в первые несколько минут.",
      "confirmCta": "Да, отправить",
      "successTitle": "Заказ принят",
      "successBody": "Кухня получила ваш заказ. Следите за ним на этой странице.",
      "orderNumberLabel": "Заказ {number}",
      "trackOrder": "Следить за заказом",
      "backToMenu": "Назад в меню",
      "keepThisPage": "Оставьте эту страницу открытой, чтобы следить за заказом.",
      "sending": "Отправляем…"
    },
    "tracking": {
      "title": "Ваш заказ",
      "orderNumber": "Заказ {number}",
      "placedAt": "Оформлен в {time}",
      "tableLabel": "Стол {number}",
      "estimatedReady": "Готовность около {time}",
      "readyNow": "Готово",
      "itemsTitle": "Состав заказа",
      "totalsTitle": "К оплате",
      "timelineTitle": "Ход выполнения",
      "cancelOrder": "Отменить заказ",
      "cancelConfirmTitle": "Отменить заказ?",
      "cancelConfirmBody": "Кухня прекратит работу над ним. Новый заказ можно оформить сразу же.",
      "cancelWindowOverTitle": "Отменять уже поздно",
      "cancelWindowOverBody": "Кухня уже начала готовить. Пожалуйста, обратитесь к официанту.",
      "cancelledTitle": "Заказ отменён",
      "cancelledBody": "Ничего готовиться не будет. Вы можете оформить новый заказ в любой момент.",
      "completedTitle": "Спасибо",
      "completedBody": "Надеемся, было вкусно. Ждём вас снова.",
      "callWaiter": "Позвать официанта",
      "backToMenu": "Заказать ещё",
      "notFoundTitle": "Не находим этот заказ",
      "notFoundBody": "Возможно, ссылка устарела или заказ уже закрыт. Обратитесь к официанту.",
      "recentOrders": "Ваши недавние заказы",
      "viewOrder": "Открыть",
      "live": "Онлайн",
      "reconnecting": "Переподключаемся…",
      "polling": "Проверяем каждые несколько секунд",
      "lastUpdated": "Обновлено в {time}"
    },
    "waiterCall": {
      "cta": "Позвать официанта",
      "sheetTitle": "Позвать официанта",
      "sheetBody": "Мы сообщим залу, что вы ждёте за столом {number}.",
      "reasonLabel": "Что нужно?",
      "notePlaceholder": "Что-то ещё, что нам стоит знать?",
      "send": "Позвать",
      "sending": "Зовём…",
      "sentTitle": "Официант уже идёт",
      "sentBody": "Сотрудники зала получили уведомление.",
      "pendingTitle": "Ждём официанта",
      "pendingBody": "Ваш вызов в очереди. К вам скоро подойдут.",
      "acknowledgedTitle": "Официант идёт",
      "acknowledgedBody": "Ваш вызов принял(а) {staff}.",
      "cooldownTitle": "Вы только что звали",
      "cooldownBody": "Подождите {seconds} с, прежде чем позвать снова.",
      "alreadyOpenTitle": "По этому столу уже открыт вызов"
    }
  },
  "kitchen": {
    "title": "Кухня",
    "subtitle": "Заказы в реальном времени",
    "branchLabel": "{branch}",
    "columnNew": "НОВЫЕ",
    "columnPreparing": "ГОТОВЯТСЯ",
    "columnReady": "ГОТОВО",
    "ticketTable": "Стол {number}",
    "ticketTakeaway": "С собой",
    "placedAgo": "{minutes} мин назад",
    "elapsed": "прошло {elapsed}",
    "dueIn": "Срок через {minutes} мин",
    "overdueBy": "Опоздание {minutes} мин",
    "lateBadge": "ОПОЗДАНИЕ",
    "guestNote": "Примечание гостя",
    "itemNote": "Примечание",
    "accept": "Принять",
    "startPreparing": "Начать готовить",
    "markReady": "Отметить готовым",
    "markDelivered": "Передано",
    "undo": "Отменить действие",
    "newOrderTitle": "Новый заказ {number}",
    "newOrderBody": "Стол {table} · {items}",
    "soundOn": "Звук включён",
    "soundOff": "Звук выключен",
    "keepAwakeOn": "Не гасить экран",
    "keepAwakeOff": "Разрешить гасить экран",
    "fullscreen": "Во весь экран",
    "exitFullscreen": "Выйти из полноэкранного режима",
    "emptyNew": {
      "title": "Новых заказов нет",
      "body": "Новый чек появится здесь в ту же секунду, как его отправит стол."
    },
    "emptyPreparing": {
      "title": "На плите пусто",
      "body": "Принятые заказы переходят сюда, пока вы их готовите."
    },
    "emptyReady": {
      "title": "Ничего не ждёт выдачи",
      "body": "Готовые заказы стоят здесь, пока их не заберёт официант."
    },
    "connectionLive": "Онлайн",
    "connectionReconnecting": "Переподключаемся…",
    "connectionOffline": "Нет связи — показываем последнее состояние"
  },
  "waiter": {
    "title": "Зал",
    "subtitle": "Заказы и вызовы со столов",
    "branchLabel": "{branch}",
    "tabActive": "Активные",
    "tabReady": "К выдаче",
    "tabCalls": "Вызовы",
    "callBannerTitle": "СТОЛ {number} ВЫЗЫВАЕТ",
    "callBannerBody": "{reason} · {age}",
    "tableCalling": "Стол {number} вызывает",
    "acknowledge": "Принимаю",
    "acknowledging": "Принимаем…",
    "acknowledged": "Принял(а) {staff}",
    "resolve": "Выполнено",
    "resolved": "Закрыт",
    "callAge": "{age} назад",
    "callNote": "Примечание гостя",
    "acknowledgedBy": "Принял(а) {staff} в {time}",
    "serve": "Отнести к столу",
    "markDelivered": "Подано",
    "complete": "Закрыть заказ",
    "orderTable": "Стол {number}",
    "emptyActive": {
      "title": "Активных заказов нет",
      "body": "Заказы, которые готовятся, появятся здесь."
    },
    "emptyReady": {
      "title": "Выдавать нечего",
      "body": "Кухня отправит сюда готовые заказы."
    },
    "emptyCalls": {
      "title": "Никто не вызывает",
      "body": "Как только гость нажмёт кнопку вызова, вызов появится здесь мгновенно."
    },
    "newCallTitle": "Стол {number} вызывает",
    "newCallBody": "{reason}",
    "orderReadyTitle": "Заказ {number} готов",
    "noBranch": {
      "title": "Филиал не назначен",
      "body": "Ваша учётная запись пока не привязана к филиалу. Попросите менеджера назначить его."
    }
  },
  "admin": {
    "dashboard": {
      "title": "Сводка",
      "subtitle": "Как проходит сегодняшний день",
      "todayRevenue": "Выручка за сегодня",
      "todayOrders": "Заказов сегодня",
      "avgOrderValue": "Средний чек",
      "activeTables": "Занятые столы",
      "pendingOrders": "Ждут подтверждения",
      "openCalls": "Открытые вызовы",
      "popularDishes": "Самые заказываемые блюда",
      "statusOverview": "Заказы по статусам",
      "revenueTrend": "Выручка",
      "vsYesterday": "{value} к вчерашнему дню",
      "periodToday": "Сегодня",
      "periodWeek": "Эта неделя",
      "periodMonth": "Этот месяц",
      "viewAllOrders": "Все заказы",
      "liveFeed": "Заказы в реальном времени",
      "branchFilter": "Филиал",
      "allBranches": "Все филиалы",
      "noData": {
        "title": "Пока нечего показать",
        "body": "Цифры появятся здесь, как только придёт первый заказ дня."
      }
    },
    "orders": {
      "title": "Заказы",
      "subtitle": "Все заказы — текущие и прошлые",
      "filterStatus": "Статус",
      "filterBranch": "Филиал",
      "filterDate": "Дата",
      "searchPlaceholder": "Номер заказа или стол",
      "colNumber": "Заказ",
      "colTable": "Стол",
      "colStatus": "Статус",
      "colItems": "Позиции",
      "colTotal": "Итого",
      "colPlaced": "Оформлен",
      "colBranch": "Филиал",
      "detailTitle": "Заказ {number}",
      "detailItems": "Позиции",
      "detailTotals": "Расчёт",
      "detailTimeline": "История",
      "detailCustomer": "Гость",
      "changeStatus": "Изменить статус",
      "confirmOrder": "Подтвердить заказ",
      "cancelOrder": "Отменить заказ",
      "cancelReasonLabel": "Почему заказ отменяется?",
      "cancelReasonPlaceholder": "Закончился продукт, гость передумал…",
      "cancelReasonRequired": "Чтобы отменить заказ, нужна причина.",
      "printTicket": "Печать чека",
      "exportCsv": "Экспорт в CSV",
      "empty": {
        "title": "Подходящих заказов нет",
        "body": "Расширьте период или снимите один из фильтров."
      }
    },
    "menu": {
      "title": "Меню",
      "subtitle": "Блюда, цены и наличие",
      "newItem": "Новое блюдо",
      "editItem": "Изменить блюдо",
      "duplicateItem": "Дублировать",
      "deleteItem": "Удалить блюдо",
      "deleteConfirmTitle": "Удалить «{item}»?",
      "deleteConfirmBody": "Блюдо сразу исчезнет из меню. В прошлых заказах сохраняется своя копия названия и цены, поэтому история останется корректной.",
      "fieldName": "Название",
      "fieldDescription": "Описание",
      "fieldIngredients": "Состав",
      "fieldCategory": "Категория",
      "fieldPrice": "Цена",
      "fieldCompareAtPrice": "Старая цена",
      "fieldImage": "Фото",
      "fieldPrepTime": "Время приготовления (мин)",
      "fieldSpicy": "Уровень остроты",
      "fieldCalories": "Калорийность",
      "fieldDietary": "Особенности состава",
      "fieldFeatured": "Показывать в «Выборе шефа»",
      "fieldPopular": "Показывать в «Чаще всего заказывают»",
      "availability": "Наличие",
      "markAvailable": "Отметить как в наличии",
      "markUnavailable": "Отметить как закончившееся",
      "unavailableUntilLabel": "Снова в наличии с",
      "optionsTitle": "Варианты и добавки",
      "optionsHint": "Сгруппируйте варианты, чтобы гость выбрал размер, добавку или остроту.",
      "addOptionGroup": "Добавить группу",
      "groupLabel": "Название группы",
      "groupSelection": "Тип выбора",
      "groupMin": "Минимум",
      "groupMax": "Максимум",
      "addOption": "Добавить вариант",
      "optionName": "Вариант",
      "optionPriceDelta": "Доплата",
      "optionDefault": "Выбран по умолчанию",
      "translationsTitle": "Языки",
      "missingTranslation": "Нет перевода",
      "missingTranslationHint": "Гости на этом языке увидят текст на «{locale}».",
      "uploadImage": "Загрузить фото",
      "uploadHint": "JPEG или PNG, не менее 1200 px по ширине, до 5 МБ.",
      "reorderHint": "Перетащите, чтобы изменить порядок для гостей.",
      "filterCategory": "Категория",
      "filterAvailability": "Наличие",
      "empty": {
        "title": "Блюд пока нет",
        "body": "Добавьте первое блюдо — оно сразу появится в QR-меню."
      },
      "emptyCta": "Добавить блюдо"
    },
    "categories": {
      "title": "Категории",
      "subtitle": "Как сгруппировано меню",
      "newCategory": "Новая категория",
      "editCategory": "Изменить категорию",
      "deleteCategory": "Удалить категорию",
      "deleteConfirmTitle": "Удалить «{category}»?",
      "deleteConfirmBody": "Категория исчезнет из меню. Сначала она должна быть пустой.",
      "deleteBlockedTitle": "В категории ещё есть блюда",
      "deleteBlockedBody": "Сначала перенесите или удалите её блюда ({count}), затем повторите.",
      "fieldName": "Название",
      "fieldDescription": "Описание",
      "fieldIcon": "Значок",
      "fieldBranch": "Филиал",
      "allBranches": "Все филиалы",
      "reorderHint": "Перетащите, чтобы изменить порядок в меню.",
      "itemsInCategory": "Блюд: {count}",
      "empty": {
        "title": "Категорий пока нет",
        "body": "Категории помогают гостю не потеряться в длинном меню."
      },
      "emptyCta": "Добавить категорию"
    },
    "tables": {
      "title": "Столы",
      "subtitle": "QR-коды и номера столов",
      "newTable": "Новый стол",
      "editTable": "Изменить стол",
      "fieldNumber": "Номер стола",
      "fieldName": "Подпись",
      "fieldZone": "Зона",
      "fieldSeats": "Мест",
      "fieldBranch": "Филиал",
      "qrTitle": "QR-код",
      "qrHint": "Распечатайте и поставьте на стол. У каждого стола свой код.",
      "viewQr": "Показать QR",
      "downloadPng": "Скачать PNG",
      "downloadSvg": "Скачать SVG",
      "printSheet": "Распечатать все коды",
      "tableUrl": "Ссылка стола",
      "copyUrl": "Копировать ссылку",
      "rotateToken": "Сгенерировать новый код",
      "rotateConfirmTitle": "Сгенерировать новый QR-код для стола {number}?",
      "rotateConfirmBody": "Распечатанный код на этом столе перестанет работать сразу же. Распечатайте и поставьте новый до подтверждения.",
      "rotateReasonLabel": "Причина (сохранится в журнале)",
      "rotationCount": "Обновлялся раз: {count}",
      "issuedAt": "Выдан {date}",
      "deactivate": "Вывести из обслуживания",
      "activate": "Вернуть в обслуживание",
      "deactivateConfirmTitle": "Вывести стол {number} из обслуживания?",
      "deactivateConfirmBody": "Гости, отсканировавшие его код, увидят вежливое сообщение вместо меню.",
      "empty": {
        "title": "Столов пока нет",
        "body": "Добавьте стол — мы сгенерируем для него защищённый QR-код."
      },
      "emptyCta": "Добавить стол"
    },
    "branches": {
      "title": "Филиалы",
      "subtitle": "Адреса, часы работы и правила обслуживания",
      "newBranch": "Новый филиал",
      "editBranch": "Изменить филиал",
      "fieldName": "Название филиала",
      "fieldCode": "Код",
      "fieldCodeHint": "От одной до четырёх заглавных букв. Код становится префиксом номера заказа, например A-014.",
      "fieldAddress": "Адрес",
      "fieldTimezone": "Часовой пояс",
      "fieldOpeningHours": "Часы работы",
      "fieldServiceFee": "Сервисный сбор",
      "fieldServiceFeeInherit": "Использовать ставку ресторана",
      "fieldWaiterCooldown": "Пауза между вызовами (секунд)",
      "fieldOrderInterval": "Пауза между заказами с одного стола (секунд)",
      "fieldPrepDefault": "Время приготовления по умолчанию (мин)",
      "fieldLateThreshold": "Считать заказ опоздавшим через (мин)",
      "acceptingOrders": "Принимает заказы",
      "pauseOrders": "Приостановить новые заказы",
      "resumeOrders": "Возобновить заказы",
      "pausedNotice": "Филиал не принимает новые заказы. Гости видят сообщение вместо кнопки заказа.",
      "tableCount": "Столов: {count}",
      "staffCount": "Сотрудников: {count}",
      "empty": {
        "title": "Филиалов пока нет",
        "body": "Каждый стол принадлежит филиалу, поэтому начните с него."
      },
      "emptyCta": "Добавить филиал"
    },
    "staff": {
      "title": "Сотрудники",
      "subtitle": "Кто и что может делать, и где",
      "invite": "Пригласить",
      "inviteTitle": "Пригласить в команду",
      "inviteBody": "Человек получит письмо со ссылкой, чтобы задать собственный пароль. Вы его никогда не увидите.",
      "fieldEmail": "Рабочая почта",
      "fieldFullName": "Полное имя",
      "fieldRole": "Роль",
      "fieldBranch": "Филиал",
      "fieldEmployeeCode": "Табельный номер",
      "allBranches": "Все филиалы",
      "inviteSent": "Приглашение отправлено на {email}",
      "resendInvite": "Отправить ещё раз",
      "revokeInvite": "Отозвать приглашение",
      "pendingInvite": "Приглашение отправлено",
      "joinedAt": "В команде с {date}",
      "lastSeen": "Последняя активность: {time}",
      "neverSignedIn": "Ещё ни разу не входил",
      "deactivate": "Деактивировать",
      "reactivate": "Активировать снова",
      "deactivateConfirmTitle": "Деактивировать {name}?",
      "deactivateConfirmBody": "Сотрудник будет выведен из всех сессий и не сможет войти. История сохранится.",
      "lastOwner": {
        "title": "Нельзя удалить последнего владельца",
        "body": "В ресторане должен остаться хотя бы один владелец. Сначала назначьте другого."
      },
      "empty": {
        "title": "Сотрудников пока нет",
        "body": "Пригласите менеджеров, официантов и кухню — они смогут войти в систему."
      },
      "emptyCta": "Пригласить"
    },
    "analytics": {
      "title": "Аналитика",
      "subtitle": "Настоящие цифры по настоящим заказам",
      "rangeToday": "Сегодня",
      "rangeWeek": "Последние 7 дней",
      "rangeMonth": "Последние 30 дней",
      "rangeCustom": "Свой период",
      "revenue": "Выручка",
      "orders": "Заказы",
      "avgTicket": "Средний чек",
      "itemsSold": "Продано блюд",
      "topItems": "Топ блюд",
      "topCategories": "Топ категорий",
      "byHour": "Заказы по часам",
      "byBranch": "По филиалам",
      "byStatus": "По статусам",
      "peakHour": "Самый загруженный час: {hour}",
      "exportCsv": "Экспорт в CSV",
      "noData": {
        "title": "Пока мало данных",
        "body": "Графики заполнятся, когда пойдут заказы. Здесь ничего не смоделировано."
      }
    },
    "settings": {
      "title": "Настройки",
      "subtitle": "Как работает ваш ресторан",
      "tabGeneral": "Общее",
      "tabBranding": "Оформление",
      "tabOrdering": "Заказы",
      "tabDanger": "Опасная зона",
      "restaurantName": "Название ресторана",
      "slug": "Веб-адрес",
      "slugHint": "Строчные буквы, цифры и дефисы. После изменения старые ссылки перестанут работать.",
      "logo": "Логотип",
      "coverImage": "Обложка",
      "welcomeMessage": "Приветствие",
      "welcomeMessageHint": "Первая строка, которую гость читает после сканирования. Пусть будет короткой и тёплой.",
      "description": "О ресторане",
      "defaultLocale": "Основной язык",
      "defaultLocaleHint": "Используется, когда у блюда нет текста на языке гостя.",
      "currency": "Валюта",
      "currencyDecimals": "Знаков после запятой",
      "currencyHint": "У UZS их нет — цены в целых сумах.",
      "serviceFeeEnabled": "Добавлять сервисный сбор",
      "serviceFeeRate": "Ставка сервисного сбора",
      "serviceFeeHint": "Показывается гостю отдельной строкой до подтверждения.",
      "dangerTitle": "Опасная зона",
      "deactivateRestaurant": "Деактивировать ресторан",
      "deactivateConfirmTitle": "Деактивировать «{restaurant}»?",
      "deactivateConfirmBody": "Все QR-коды перестанут работать, сотрудники не смогут войти. Данные сохраняются, вы можете активировать ресторан в любой момент."
    },
    "platform": {
      "title": "Платформа",
      "subtitle": "Все рестораны в этой установке",
      "restaurantsCount": "Ресторанов",
      "branchesCount": "Филиалов",
      "ordersToday": "Заказов сегодня",
      "colRestaurant": "Ресторан",
      "colSlug": "Адрес",
      "colBranches": "Филиалы",
      "colOrders": "Заказы",
      "colCreated": "Создан",
      "demoBadge": "Демо",
      "empty": {
        "title": "Ресторанов пока нет",
        "body": "Первый ресторан появится здесь, как только зарегистрируется владелец."
      }
    }
  },
  "auth": {
    "signInTitle": "Вход для сотрудников",
    "signInSubtitle": "Для владельцев, менеджеров, официантов и кухни.",
    "email": "Эл. почта",
    "emailPlaceholder": "vy@restoran.uz",
    "password": "Пароль",
    "passwordPlaceholder": "Ваш пароль",
    "showPassword": "Показать пароль",
    "hidePassword": "Скрыть пароль",
    "signIn": "Войти",
    "signingIn": "Входим…",
    "forgotPassword": "Забыли пароль?",
    "resetTitle": "Сброс пароля",
    "resetSubtitle": "Мы отправим ссылку на почту. Она одноразовая и действует час.",
    "sendResetLink": "Отправить ссылку",
    "sending": "Отправляем…",
    "resetSent": {
      "title": "Проверьте почту",
      "body": "Если этот адрес принадлежит учётной записи сотрудника, ссылка для сброса уже в пути."
    },
    "newPasswordTitle": "Задайте новый пароль",
    "newPassword": "Новый пароль",
    "confirmPassword": "Повторите пароль",
    "updatePassword": "Сохранить пароль",
    "passwordUpdated": {
      "title": "Пароль обновлён",
      "body": "Теперь вы можете войти с ним."
    },
    "inviteTitle": "Присоединяйтесь к «{restaurant}»",
    "inviteSubtitle": "Задайте пароль — и всё готово.",
    "fullName": "Полное имя",
    "preferredLanguage": "Предпочитаемый язык",
    "acceptInvite": "Вступить в команду",
    "accepting": "Настраиваем…",
    "signOut": "Выйти",
    "signOutConfirmTitle": "Выйти из системы?",
    "signOutConfirmBody": "Чтобы вернуться, понадобится пароль.",
    "backToSignIn": "Назад ко входу",
    "staffOnly": {
      "title": "Этот раздел — для сотрудников",
      "body": "Гостям учётная запись не нужна — просто отсканируйте код на своём столе."
    }
  },
  "errors": {
    "app": {
      "TABLE_INACTIVE": "Этот стол выведен из обслуживания. Пожалуйста, обратитесь к сотруднику зала.",
      "INVALID_QR": "Этот QR-код недействителен. Отсканируйте код, напечатанный на вашем столе.",
      "RESTAURANT_CLOSED": "Ресторан сейчас не принимает заказы.",
      "ITEM_UNAVAILABLE": "Одно из блюд в вашем заказе только что закончилось.",
      "PRICE_MISMATCH": "Пока вы выбирали, цены изменились. Проверьте итог перед подтверждением.",
      "INVALID_TRANSITION": "Этот заказ уже перешёл дальше. Обновляем.",
      "RATE_LIMITED": "Слишком быстро. Подождите {seconds} с и повторите.",
      "FORBIDDEN": "У вас нет прав на это действие.",
      "NOT_FOUND": "Мы больше не находим это.",
      "VALIDATION_FAILED": "Проверьте выделенные поля.",
      "NETWORK": "Нет связи. Ваш заказ сохранён на этом устройстве.",
      "UNKNOWN": "На нашей стороне что-то пошло не так. Повторите попытку."
    },
    "validation": {
      "required": "Это поле обязательно.",
      "invalid": "Некорректное значение.",
      "email": "Введите корректный адрес эл. почты.",
      "phone": "Введите корректный номер телефона, например +998 90 123 45 67.",
      "slug": "Используйте только строчные буквы, цифры и дефисы.",
      "url": "Введите корректный веб-адрес.",
      "tooShort": "Не менее {min} символов.",
      "tooLong": "Не более {max} символов.",
      "tooSmall": "Должно быть не меньше {min}.",
      "tooBig": "Должно быть не больше {max}.",
      "integer": "Введите целое число.",
      "positive": "Введите число больше нуля.",
      "nonNegative": "Значение не может быть отрицательным.",
      "passwordWeak": "Не менее 8 символов, с буквой и цифрой.",
      "passwordMismatch": "Пароли не совпадают.",
      "i18nAtLeastOne": "Заполните хотя бы один язык.",
      "i18nTooLong": "На каждом языке не более {max} символов.",
      "invalidLocale": "Выберите узбекский, русский или английский.",
      "invalidTime": "Используйте 24-часовой формат, например 09:30.",
      "fileTooLarge": "Файл должен быть меньше {max}.",
      "fileType": "Принимаются только файлы {types}.",
      "duplicateValue": "«{value}» уже используется."
    },
    "generic": {
      "title": "Что-то пошло не так",
      "body": "Мы не смогли это завершить. Повторите попытку, а если повторится — сообщите нам код ниже.",
      "retry": "Повторить",
      "traceLabel": "Код обращения {traceId}",
      "notFoundTitle": "Не найдено",
      "notFoundBody": "Страницы, которую вы искали, не существует.",
      "forbiddenTitle": "Нет доступа",
      "forbiddenBody": "Ваша роль не включает эту страницу. Если это ошибка, обратитесь к менеджеру.",
      "offlineTitle": "Вы офлайн",
      "offlineBody": "Мы переподключимся сами. Ничего из введённого не потеряется.",
      "serverTitle": "Проблема на нашей стороне",
      "serverBody": "Команда уже уведомлена. Повторите попытку через минуту.",
      "goHome": "В начало"
    },
    "QR001_INVALID_QR_TOKEN": "Этот QR-код недействителен. Отсканируйте код, напечатанный на вашем столе.",
    "QR002_TABLE_INACTIVE": "Этот стол выведен из обслуживания. Пожалуйста, обратитесь к сотруднику зала.",
    "QR003_BRANCH_INACTIVE": "Этот филиал сейчас закрыт.",
    "QR004_RESTAURANT_INACTIVE": "Этот ресторан сейчас не принимает заказы.",
    "QR010_ORDER_RATE_LIMITED": "Вы только что оформили заказ. Подождите {seconds} с перед следующим.",
    "QR011_WAITER_CALL_COOLDOWN": "Вы только что звали. Подождите {seconds} с, прежде чем позвать снова.",
    "QR012_WAITER_CALL_ALREADY_OPEN": "Официант для этого стола уже вызван.",
    "QR013_DUPLICATE_ORDER": "Этот заказ уже отправлен. Открываем его.",
    "QR020_ITEM_UNAVAILABLE": "«{item}» только что закончилось и было убрано из заказа.",
    "QR022_INVALID_OPTION": "Одна из выбранных добавок больше не предлагается.",
    "QR023_INVALID_PAYLOAD": "Мы не смогли прочитать этот заказ. Повторите из корзины.",
    "QR024_QUANTITY_OUT_OF_RANGE": "Выберите от 1 до 999 порций каждого блюда.",
    "QR030_ORDER_NOT_FOUND": "Мы больше не находим этот заказ.",
    "QR030_NOT_FOUND": "Мы больше не находим это.",
    "QR032_ORDER_EXPIRED": "Этот заказ закрыт, отслеживание больше недоступно.",
    "QR040_INVALID_STATUS_TRANSITION": "Этот заказ уже перешёл дальше. Обновляем доску.",
    "QR041_INVALID_CALL_TRANSITION": "Этот вызов уже обработал другой сотрудник.",
    "QR042_CANCEL_REASON_REQUIRED": "Чтобы отменить заказ, нужна причина.",
    "QR043_ORDER_CLOSED": "Этот заказ закрыт и не может быть изменён.",
    "QR050_FORBIDDEN": "У вас нет прав на это действие.",
    "QR051_LAST_OWNER": "В ресторане должен остаться хотя бы один владелец.",
    "QR052_FORBIDDEN_FIELD": "Вам не разрешено изменять поле «{field}».",
    "QR053_IMMUTABLE_COLUMN": "Поле «{field}» нельзя изменить после установки.",
    "QR054_COLUMN_NOT_ALLOWED": "Ваша роль не может изменять поле «{field}».",
    "QR055_PRIVILEGE_ESCALATION": "Нельзя выдать роль выше собственной.",
    "QR056_SELF_MODIFICATION": "Нельзя изменить собственную роль или доступ.",
    "QR999_INTERNAL": "На нашей стороне что-то пошло не так. Повторите попытку."
  },
  "states": {
    "loading": {
      "generic": "Загружаем…",
      "menu": "Несём меню…",
      "item": "Загружаем блюдо…",
      "cart": "Проверяем корзину…",
      "order": "Загружаем заказ…",
      "tracking": "Получаем последние данные…",
      "kitchen": "Загружаем доску…",
      "waiter": "Загружаем зал…",
      "dashboard": "Считаем сегодняшние цифры…",
      "orders": "Загружаем заказы…",
      "menuAdmin": "Загружаем меню…",
      "tables": "Загружаем столы…",
      "branches": "Загружаем филиалы…",
      "staff": "Загружаем команду…",
      "analytics": "Собираем отчёт…",
      "settings": "Загружаем настройки…"
    },
    "error": {
      "generic": { "title": "Что-то пошло не так", "body": "Повторите попытку через минуту." },
      "menu": { "title": "Не удалось загрузить меню", "body": "Проверьте связь и повторите — ваш стол по-прежнему действителен." },
      "item": { "title": "Не удалось загрузить блюдо", "body": "Вернитесь в меню и откройте его снова." },
      "cart": { "title": "Не удалось проверить корзину", "body": "Ваши блюда сохранены на устройстве. Повторите попытку." },
      "order": { "title": "Не удалось отправить заказ", "body": "Списаний не было, корзина цела. Повторите попытку." },
      "tracking": { "title": "Мы потеряли связь с заказом", "body": "Он по-прежнему на кухне. Обновите страницу, чтобы переподключиться." },
      "kitchen": { "title": "Доска не загрузилась", "body": "Заказы в безопасности. Обновите, чтобы переподключиться к ленте кухни." },
      "waiter": { "title": "Вид зала не загрузился", "body": "Обновите, чтобы переподключиться. Вызовы не теряются, пока вас нет." },
      "dashboard": { "title": "Сводка не загрузилась", "body": "С данными всё в порядке — это проблема отображения. Повторите попытку." },
      "orders": { "title": "Заказы не загрузились", "body": "Повторите попытку или сузьте период." },
      "menuAdmin": { "title": "Меню не загрузилось", "body": "Повторите попытку. Ничего не было изменено." },
      "tables": { "title": "Столы не загрузились", "body": "Повторите попытку. QR-коды работают в любом случае." },
      "branches": { "title": "Филиалы не загрузились", "body": "Повторите попытку через минуту." },
      "staff": { "title": "Список команды не загрузился", "body": "Повторите попытку. Ничьи права не изменились." },
      "analytics": { "title": "Отчёт не собрался", "body": "Выберите более короткий период и повторите." },
      "settings": { "title": "Настройки не загрузились", "body": "Повторите попытку. Текущие настройки не изменились." }
    },
    "empty": {
      "title": "Пока пусто",
      "body": "Как только появится что показать, оно будет здесь."
    },
    "offline": {
      "title": "Вы офлайн",
      "body": "Продолжим с того же места, как только связь вернётся."
    },
    "notFound": {
      "title": "Страница не найдена",
      "body": "Эта ссылка никуда не ведёт. Проверьте её или начните сначала."
    },
    "demo": {
      "banner": "ДЕМО-ДАННЫЕ — здесь нет ни одного настоящего заказа",
      "badge": "Демо",
      "body": "Показан демонстрационный ресторан, чтобы вы могли попробовать каждый экран. В рабочих установках демо- и реальные данные никогда не смешиваются."
    }
  },
  "status": {
    "order": {
      "pending": "Ожидает",
      "confirmed": "Подтверждён",
      "preparing": "Готовится",
      "ready": "Готов",
      "delivered": "Подан",
      "completed": "Завершён",
      "cancelled": "Отменён"
    },
    "orderCustomer": {
      "pending": "Отправлен на кухню",
      "confirmed": "Кухня приняла ваш заказ",
      "preparing": "Ваше блюдо готовится",
      "ready": "Готово — официант уже идёт",
      "delivered": "Подано. Приятного аппетита",
      "completed": "Завершено. Спасибо",
      "cancelled": "Отменён"
    },
    "call": {
      "pending": "Ожидает",
      "acknowledged": "Идёт к вам",
      "resolved": "Выполнен",
      "cancelled": "Отменён",
      "expired": "Истёк"
    }
  },
  "labels": {
    "role": {
      "SUPER_ADMIN": "Администратор платформы",
      "RESTAURANT_OWNER": "Владелец",
      "MANAGER": "Менеджер",
      "WAITER": "Официант",
      "KITCHEN": "Кухня"
    },
    "dietary": {
      "vegetarian": "Вегетарианское",
      "vegan": "Веганское",
      "halal": "Халяль",
      "gluten_free": "Без глютена",
      "lactose_free": "Без лактозы",
      "nut_free": "Без орехов",
      "contains_nuts": "Содержит орехи",
      "contains_seafood": "Содержит морепродукты",
      "contains_pork": "Содержит свинину",
      "contains_alcohol": "Содержит алкоголь"
    },
    "spicy": { "0": "Не острое", "1": "Слабоострое", "2": "Острое", "3": "Очень острое" },
    "orderType": { "dine_in": "За столом", "takeaway": "С собой" },
    "channel": { "qr": "QR-меню", "waiter": "Официант", "admin": "Админ-панель" },
    "callReason": {
      "call_waiter": "Позвать официанта",
      "request_bill": "Принести счёт",
      "request_water": "Принести воду",
      "request_cutlery": "Принести приборы",
      "clean_table": "Убрать со стола",
      "complaint": "Есть проблема",
      "other": "Другое"
    },
    "promoType": {
      "announcement": "Объявление",
      "percentage": "Скидка в процентах",
      "fixed_amount": "Фиксированная скидка",
      "special_price": "Специальная цена"
    },
    "locale": { "uz": "Узбекский", "ru": "Русский", "en": "Английский" },
    "selectionType": { "single": "Выберите один", "multiple": "Выберите несколько" }
  },
  "toasts": {
    "saved": "Сохранено",
    "deleted": "Удалено",
    "copied": "Скопировано в буфер обмена",
    "itemAdded": "«{item}» добавлено в заказ",
    "itemRemoved": "«{item}» убрано",
    "cartCleared": "Корзина очищена",
    "orderPlaced": "Заказ {number} отправлен на кухню",
    "orderCancelled": "Заказ {number} отменён",
    "waiterCalled": "Официант вызван",
    "waiterAcknowledged": "Стол {number} — вызов принят",
    "statusUpdated": "Заказ {number} теперь: {status}",
    "qrRotated": "Для стола {number} создан новый QR-код",
    "inviteSent": "Приглашение отправлено",
    "languageChanged": "Язык изменён на {language}",
    "backOnline": "Связь восстановлена",
    "wentOffline": "Связь потеряна — пробуем снова",
    "newOrder": "Новый заказ {number} · стол {table}",
    "orderReady": "Заказ {number} готов",
    "orderLate": "Заказ {number} опаздывает",
    "newWaiterCall": "Стол {number} вызывает",
    "saveFailed": "Не удалось сохранить. Ничего не изменено.",
    "actionFailed": "Действие не выполнено. Повторите попытку."
  },
  "a11y": {
    "skipToContent": "Перейти к основному содержимому",
    "closeDialog": "Закрыть это окно",
    "openCart": "Открыть корзину",
    "increaseQuantity": "Добавить одну",
    "decreaseQuantity": "Убрать одну",
    "removeNamedItem": "Убрать «{item}» из заказа",
    "loading": "Загрузка",
    "languageSwitcher": "Выбор языка",
    "mainNavigation": "Основная навигация",
    "currentPage": "Текущая страница",
    "expand": "Развернуть",
    "collapse": "Свернуть",
    "requiredField": "Обязательное поле",
    "spicyLevelLabel": "Уровень остроты: {level}",
    "orderStatusLabel": "Статус заказа: {status}"
  },
  "plurals": {
    "items":      { "one": "{count} позиция",  "few": "{count} позиции",  "many": "{count} позиций",  "other": "{count} позиций" },
    "dishes":     { "one": "{count} блюдо",    "few": "{count} блюда",    "many": "{count} блюд",     "other": "{count} блюд" },
    "orders":     { "one": "{count} заказ",    "few": "{count} заказа",   "many": "{count} заказов",  "other": "{count} заказов" },
    "tables":     { "one": "{count} стол",     "few": "{count} стола",    "many": "{count} столов",   "other": "{count} столов" },
    "branches":   { "one": "{count} филиал",   "few": "{count} филиала",  "many": "{count} филиалов", "other": "{count} филиалов" },
    "staff":      { "one": "{count} сотрудник","few": "{count} сотрудника","many": "{count} сотрудников","other": "{count} сотрудников" },
    "categories": { "one": "{count} категория","few": "{count} категории","many": "{count} категорий","other": "{count} категорий" },
    "guests":     { "one": "{count} гость",    "few": "{count} гостя",    "many": "{count} гостей",   "other": "{count} гостей" },
    "results":    { "one": "{count} результат","few": "{count} результата","many": "{count} результатов","other": "{count} результатов" },
    "minutes":    { "one": "{count} минута",   "few": "{count} минуты",   "many": "{count} минут",    "other": "{count} минут" },
    "seconds":    { "one": "{count} секунда",  "few": "{count} секунды",  "many": "{count} секунд",   "other": "{count} секунд" },
    "hours":      { "one": "{count} час",      "few": "{count} часа",     "many": "{count} часов",    "other": "{count} часов" },
    "days":       { "one": "{count} день",     "few": "{count} дня",      "many": "{count} дней",     "other": "{count} дней" },
    "extras":     { "one": "{count} добавка",  "few": "{count} добавки",  "many": "{count} добавок",  "other": "{count} добавок" },
    "calls":      { "one": "{count} вызов",    "few": "{count} вызова",   "many": "{count} вызовов",  "other": "{count} вызовов" }
  }
}
```

> **Russian plural note.** The `few`/`many` split is what makes `2 блюда` / `5 блюд` correct, and it
> is the reason `PluralForms` carries four slots rather than two. `other` duplicates `many` because
> Russian only reaches CLDR's `other` for fractional counts, which this product never produces.

---

## 3. Localised database content

### 3.1 The decision: `i18n_text` JSONB columns, not a translations table

Doc 01 §3.1 already froze this; the reasoning is restated here because it is a localisation
decision and implementers will look for it in this document.

```sql
-- Already in migration 20260901000100_types_and_domains.sql (doc 01 §3.1). Not re-created here.
CREATE DOMAIN public.i18n_text AS JSONB
  CONSTRAINT ck_i18n_text_shape CHECK (public.is_i18n_text(VALUE));
-- is_i18n_text(v): v is a JSONB object; every key ∈ {uz,ru,en}; every value is a string of
-- ≤ 2000 chars; at least one value is non-empty.
```

Value shape: `{"uz": "Osh", "ru": "Плов", "en": "Plov"}`.

**Why a JSONB column and not a `menu_item_translations (item_id, locale, name, description)` table:**

| | `i18n_text` JSONB | Translations table |
|---|---|---|
| Reads | One row, one round trip. The public `get_menu` RPC returns the whole menu in a single call. | A join per translatable entity, or a `FILTER`-pivot per locale. The menu RPC grows three joins. |
| RLS | Policies already written for `menu_items` cover the text. | Every translation table needs its own duplicate tenant policy — five more surfaces to get wrong. |
| Snapshots | `order_items.name_snapshot` is a single `i18n_text` column that freezes **all three** languages at order time. A receipt reprinted for a Russian manager renders correctly for an order taken in Uzbek. | Snapshotting means copying N rows per line item, or denormalising back to JSON anyway. |
| Adding a 4th locale | A data change. `is_i18n_text` gets one more allowed key; nothing else moves. | Also a data change, but every read path must now handle a locale it may not find. |
| Partial translation | Native — a key is simply absent, and `t()` falls back. | A missing row, which every join must be `LEFT` and every consumer must null-check. |
| Full-text search | `menu_items.search_vector` is a generated column over `jsonb_each_text(name)` and `jsonb_each_text(description)`, so one GIN index searches all three languages at once. | Search needs a materialised view or a per-locale index. |

The one thing the JSONB approach gives up is per-locale row-level workflow (a "translations pending
review" queue). That is not in scope, and the admin menu editor's "Missing translation" badge
(§2, `admin.menu.missingTranslation`) covers the practical need.

**Columns that are `i18n_text`** (doc 01, exhaustive): `restaurants.welcome_message`,
`restaurants.description`, `menu_categories.name`, `menu_categories.description`,
`menu_items.name`, `menu_items.description`, `menu_items.ingredients`,
`menu_item_options.group_label`, `menu_item_options.name`, `promotions.title`,
`promotions.description`, `promotions.badge_label`, `order_items.name_snapshot`,
`order_items.description_snapshot`, `order_items.category_name_snapshot`,
`order_item_options.group_label_snapshot`, `order_item_options.name_snapshot`.

**Columns that are deliberately plain `TEXT`** and are *not* translated:
`restaurants.name`, `branches.name`, `tables.number`, `tables.name`, `tables.zone`,
`staff.display_name`, `menu_categories.icon`. A restaurant's name is a proper noun — "Samarqand Osh
Xonasi" is that in all three languages. Translating a branch name would produce two different
answers to "which branch?" on the same phone call.

### 3.2 The fallback chain

```
active UI locale
  → restaurants.default_locale   (per-tenant content fallback, from TableContext)
  → 'uz' → 'ru' → 'en'           (LOCALE_FALLBACK_ORDER, fixed)
  → ''                           (never null, never "undefined", never the raw JSON)
```

The tenant default sits **second**, not first, because the guest's choice must win whenever the
translation exists. It sits above the fixed order because an Uzbek restaurant with a Russian-only
description should show that description to an English-speaking guest rather than nothing.

Empty strings count as absent: `{"uz": "", "ru": "Плов"}` resolves to `Плов` for an Uzbek guest, not
to a blank line. This mirrors `is_i18n_text`, which requires at least one *non-empty* value.

### 3.3 `src/lib/i18n/t.ts` — the resolver

```ts
// src/lib/i18n/t.ts
// No 'server-only' / 'use client': this module runs in both, by design.
import { LOCALE_FALLBACK_ORDER, type I18nText, type Locale } from '@/types/i18n';

/**
 * Resolve an i18n_text value to a display string.
 *
 * @param value    the raw jsonb from the database (or null)
 * @param locale   the active UI locale
 * @param fallback the restaurant's default_locale; omit when there is no tenant in scope
 *
 * t({uz:'Osh', ru:'Плов'}, 'en', 'uz')  === 'Osh'
 * t({uz:'Osh', ru:'Плов'}, 'ru', 'uz')  === 'Плов'
 * t({ru:'Плов'},           'uz', 'en')  === 'Плов'   // fallback 'en' absent → fixed order
 * t({uz:'',    ru:'Плов'}, 'uz', 'uz')  === 'Плов'   // empty counts as absent
 * t(null,                  'uz')        === ''
 */
export function t(
  value: I18nText | null | undefined,
  locale: Locale,
  fallback?: Locale,
): string {
  if (!value || typeof value !== 'object') return '';

  const direct = value[locale];
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;

  if (fallback && fallback !== locale) {
    const viaTenant = value[fallback];
    if (typeof viaTenant === 'string' && viaTenant.trim().length > 0) return viaTenant;
  }

  for (const candidate of LOCALE_FALLBACK_ORDER) {
    const text = value[candidate];
    if (typeof text === 'string' && text.trim().length > 0) return text;
  }

  return '';
}

/** Same chain, but returns null instead of '' so a caller can hide an empty <p> entirely. */
export function tOrNull(
  value: I18nText | null | undefined,
  locale: Locale,
  fallback?: Locale,
): string | null {
  const resolved = t(value, locale, fallback);
  return resolved.length > 0 ? resolved : null;
}

/** Did this value actually carry the requested locale? Drives the "Missing translation" badge. */
export function hasLocale(value: I18nText | null | undefined, locale: Locale): boolean {
  const text = value?.[locale];
  return typeof text === 'string' && text.trim().length > 0;
}

/** Which locales are missing. Used by the admin editor's translation tabs. */
export function missingLocales(value: I18nText | null | undefined): Locale[] {
  return LOCALE_FALLBACK_ORDER.filter((l) => !hasLocale(value, l));
}

/** Build an I18nText from a form, dropping blanks so the DB CHECK sees a clean object. */
export function toI18nText(input: Partial<Record<Locale, string>>): I18nText {
  const out: I18nText = {};
  for (const locale of LOCALE_FALLBACK_ORDER) {
    const text = input[locale]?.trim();
    if (text) out[locale] = text;
  }
  return out;
}

/** Patch one locale of an existing value without disturbing the others. */
export function withLocale(value: I18nText | null | undefined, locale: Locale, text: string): I18nText {
  const next: I18nText = { ...(value ?? {}) };
  const trimmed = text.trim();
  if (trimmed) next[locale] = trimmed;
  else delete next[locale];
  return next;
}

/**
 * Narrow the generated `Json` type from supabase.generated.ts to I18nText.
 * The DB CHECK already guarantees the shape; this is the one place the assertion is made,
 * so mappers never sprinkle `as I18nText` around the codebase.
 */
export function asI18nText(value: unknown): I18nText | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as I18nText;
}
```

`src/lib/i18n/t.test.ts` pins every row of the doc-comment table above, plus:
`t({}, 'uz')` → `''`; `t({en:'Plov'}, 'uz', 'ru')` → `'Plov'`; and that `t` never returns
`'[object Object]'` or `'undefined'` for any malformed input in a 12-case fuzz table.

### 3.4 Where resolution happens

**Never at fetch time.** Mappers (`src/lib/mappers/*.ts`) keep `I18nText` intact all the way into
`src/types/domain.ts` (doc 03 §4 already declares them that way). Resolution happens in the leaf
component, at render:

- Client component → `const t = useT(); t.c(item.name)` — re-renders on a language switch with no
  refetch, which is exactly why the switcher can be a `useTransition` and not a reload.
- Server component → `<I18nTextView value={item.name} locale={locale} fallback={defaultLocale} />`.

The single exception is `orders.locale`: the guest's language is **frozen onto the order row** at
creation (doc 01 §1667) so a kitchen ticket prints in the language the guest ordered in, regardless
of what the KDS operator's own UI is set to. The KDS therefore renders `name_snapshot` with
`t(snapshot, order.locale, restaurant.defaultLocale)` — the *order's* locale, not the operator's —
while surrounding chrome ("PREPARING", "Table 12") stays in the operator's language. That mixed
rendering is deliberate: the cook needs to read the same words the guest chose.

### 3.5 Search across locales

`menu_items.search_vector` (doc 01) is generated over every locale at once:

```sql
-- Shape of the generated column, for reference. Defined in doc 01's menu_items DDL.
-- to_tsvector('simple', name->>'uz' || ' ' || name->>'ru' || ' ' || name->>'en' || ' ' || description…)
```

`'simple'` — not `'russian'` or `'english'` — is correct here: a single mixed-language column cannot
pick one stemmer, and Uzbek has no Postgres dictionary at all. The customer search box therefore
uses prefix matching (`plainto_tsquery` + `:*`), which is what a diner typing "lag" to find
"Lag'mon" actually wants, and it works identically for "лаг" and "lag".

Two consequences implementers must honour:

1. The apostrophe in Uzbek Latin (`Lag'mon`, `Sho'rva`, `O'zbek`) must be normalised out of the
   search input **and** out of the indexed text, or "lagmon" finds nothing. `src/lib/utils/text.ts`
   exports `foldSearch(input: string): string`, which lowercases, strips `'` `ʻ` `ʼ` `‘` `’`, and
   collapses whitespace. It is applied on the client before the query is sent and mirrored in SQL by
   `translate(text, '''ʻʼ‘’', '')` inside the generated column expression.
2. Cyrillic-typing users searching an Uzbek-Latin menu are served by the `ru` key being in the same
   vector — the Russian name is indexed too, so "плов" finds Osh.

---

## 4. Seed data — "Samarqand Osh Xonasi"

### 4.1 What exists, and the two artifacts that must agree

One tenant, marked `is_demo = true` so every analytics query and the demo banner can find it
(doc 05 §8.5):

| Entity | Count | Notes |
|---|---|---|
| `restaurants` | 1 | Samarqand Osh Xonasi · `samarqand-osh-xonasi` · UZS, 0 decimals · `default_locale 'uz'` · service fee **10 %** enabled |
| `branches` | 2 | `A` Chorsu, `B` Yunusobod — both `Asia/Tashkent` |
| `tables` | 12 | 7 at Chorsu (one **inactive**, table 7), 5 at Yunusobod. Table A-1 holds `DEMO_TOKEN` |
| `menu_categories` | 6 | Popular, Uzbek Cuisine, Fast Food, Salads, Drinks, Desserts |
| `menu_items` | 37 | all three languages, ingredients, dietary tags, spice, prep time; **one deliberately unavailable** (Beshbarmoq), **two** carrying `compare_at_price` |
| `menu_item_options` | 19 | across 6 dishes: portion/size, extras, spice |
| `promotions` | 2 | a 15 % weekday business lunch, and a Wednesday special price on plov |
| `promotion_items` | 1 | links the Wednesday promo to Toy oshi |
| `profiles` + `auth.users` | 5 | owner, manager, waiter ×2, kitchen |
| `staff` | 5 | one per profile, branch-scoped where the role demands it |
| `orders` + `order_items` | 4 | spread across `pending`, `preparing`, `ready`, `completed` |
| `waiter_calls` | 1 | one open call on table A-4 so the waiter console is not empty on first load |

**Two artifacts carry this content and must never drift:**

1. `supabase/seed.sql` — applied by `npm run db:reset`. The canonical, complete listing below.
2. `src/lib/demo/fixtures/*.json` — read by `src/lib/demo/repository.ts` when `isDemoMode()`
   (doc 05 §8). Same content, shaped as the RPC responses.

`scripts/check-seed-parity.ts` (`npm run check:seed`, wired into `npm run check`) parses both and
fails on any difference in: entity counts, slugs, `qr_token` values, `price`, `is_available`,
`sort_order`, and the full `i18n_text` object of every translatable field. Drift is a build failure,
not a code review question.

Fixed UUIDs throughout — a seed with random ids cannot be diffed, re-run idempotently, or referenced
from a fixture. Every statement is `ON CONFLICT (id) DO UPDATE`, so `seed.sql` is re-runnable.

### 4.2 `supabase/seed.sql` — part 1: tenant, branches, tables, staff

```sql
-- ============================================================================
-- supabase/seed.sql — RESTAURANT QR OS demo tenant
-- "Samarqand Osh Xonasi", Tashkent. is_demo = true.
-- Idempotent: every INSERT carries ON CONFLICT DO UPDATE on the primary key.
-- Money is BIGINT minor units. UZS has currency_decimals = 0, so 45000 = 45 000 so'm.
-- ============================================================================
BEGIN;

SET LOCAL search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Restaurant
-- ---------------------------------------------------------------------------
INSERT INTO public.restaurants (
  id, name, slug, logo_url, cover_image_url, phone, email,
  welcome_message, description,
  default_locale, currency, currency_decimals,
  service_fee_bps, service_fee_enabled, is_active, is_demo
) VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'Samarqand Osh Xonasi',
  'samarqand-osh-xonasi',
  '/demo/brand/logo.svg',
  '/demo/brand/cover.webp',
  '+998 71 200 45 45',
  'salom@samarqandosh.uz',
  jsonb_build_object(
    'uz', 'Xush kelibsiz! Qozon oldidan uzoqlashmaymiz — osh o''tin olovida damlanadi.',
    'ru', 'Добро пожаловать! Мы не отходим от казана — плов томится на дровах.',
    'en', 'Welcome. We never leave the cauldron — the plov steams over a wood fire.'
  )::public.i18n_text,
  jsonb_build_object(
    'uz', '1998-yildan beri Toshkentda. Har kuni ertalab bozordan olingan mahsulot, o''tin olovi va bitta qoida: osh sotib bo''lgandan keyin qaytadan damlanmaydi.',
    'ru', 'В Ташкенте с 1998 года. Продукты с базара каждое утро, дровяной огонь и одно правило: когда плов закончился — новый в тот же день не готовим.',
    'en', 'In Tashkent since 1998. Market-fresh every morning, a wood fire, and one rule: when the plov is gone, it is gone for the day.'
  )::public.i18n_text,
  'uz', 'UZS', 0,
  1000,          -- 10.00 % service charge
  true, true, true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, slug = EXCLUDED.slug, logo_url = EXCLUDED.logo_url,
  cover_image_url = EXCLUDED.cover_image_url, phone = EXCLUDED.phone, email = EXCLUDED.email,
  welcome_message = EXCLUDED.welcome_message, description = EXCLUDED.description,
  default_locale = EXCLUDED.default_locale, currency = EXCLUDED.currency,
  currency_decimals = EXCLUDED.currency_decimals, service_fee_bps = EXCLUDED.service_fee_bps,
  service_fee_enabled = EXCLUDED.service_fee_enabled, is_active = EXCLUDED.is_active,
  is_demo = EXCLUDED.is_demo, updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Branches
-- ---------------------------------------------------------------------------
INSERT INTO public.branches (
  id, restaurant_id, name, code, address, phone, timezone,
  latitude, longitude, opening_hours,
  waiter_call_cooldown_seconds, waiter_call_expiry_minutes, order_min_interval_seconds,
  default_prep_minutes, late_order_threshold_minutes, is_active, is_accepting_orders
) VALUES
(
  'b0000000-0000-4000-8000-00000000000a',
  'a0000000-0000-4000-8000-000000000001',
  'Chorsu', 'A',
  'Toshkent, Chorsu bozori yoni, Zarqaynar ko''chasi 12',
  '+998 71 200 45 45', 'Asia/Tashkent',
  41.326500, 69.234700,
  '{"mon":[{"open":"09:00","close":"23:00"}],"tue":[{"open":"09:00","close":"23:00"}],"wed":[{"open":"09:00","close":"23:00"}],"thu":[{"open":"09:00","close":"23:00"}],"fri":[{"open":"09:00","close":"00:00"}],"sat":[{"open":"09:00","close":"00:00"}],"sun":[{"open":"09:00","close":"22:00"}]}'::jsonb,
  90, 30, 20, 18, 25, true, true
),
(
  'b0000000-0000-4000-8000-00000000000b',
  'a0000000-0000-4000-8000-000000000001',
  'Yunusobod', 'B',
  'Toshkent, Yunusobod tumani, Amir Temur shoh ko''chasi 108',
  '+998 71 200 45 46', 'Asia/Tashkent',
  41.351900, 69.289400,
  '{"mon":[{"open":"10:00","close":"23:00"}],"tue":[{"open":"10:00","close":"23:00"}],"wed":[{"open":"10:00","close":"23:00"}],"thu":[{"open":"10:00","close":"23:00"}],"fri":[{"open":"10:00","close":"01:00"}],"sat":[{"open":"10:00","close":"01:00"}],"sun":[{"open":"10:00","close":"23:00"}]}'::jsonb,
  120, 30, 20, 20, 30, true, true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, code = EXCLUDED.code, address = EXCLUDED.address,
  phone = EXCLUDED.phone, timezone = EXCLUDED.timezone, latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude, opening_hours = EXCLUDED.opening_hours,
  waiter_call_cooldown_seconds = EXCLUDED.waiter_call_cooldown_seconds,
  waiter_call_expiry_minutes = EXCLUDED.waiter_call_expiry_minutes,
  order_min_interval_seconds = EXCLUDED.order_min_interval_seconds,
  default_prep_minutes = EXCLUDED.default_prep_minutes,
  late_order_threshold_minutes = EXCLUDED.late_order_threshold_minutes,
  is_active = EXCLUDED.is_active, is_accepting_orders = EXCLUDED.is_accepting_orders,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Tables — 12, with hand-fixed base64url tokens (24 chars, [A-Za-z0-9_-]).
--    Real tokens come from generate_qr_token(); these are pinned so the demo
--    fixtures, the printed sample QR sheet and this seed all agree.
--    Table A-1 carries DEMO_TOKEN from src/lib/demo/demo-mode.ts.
-- ---------------------------------------------------------------------------
INSERT INTO public.tables (
  id, restaurant_id, branch_id, number, name, zone, seats, sort_order, qr_token, is_active
) VALUES
-- Chorsu (A)
('c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a','1',NULL,'Zal',4, 1,'DEMOxK9f3PqA7xLmZ2vRt6',true),
('c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a','2',NULL,'Zal',4, 2,'Qm7Yt2Lp9Xd4Rk8Nv3Hs6Wc1',true),
('c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a','3',NULL,'Zal',6, 3,'Zf4Bn8Kq2Md7Ry5Tx9Jw3Ce6',true),
('c0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a','4',NULL,'Zal',6, 4,'Hv6Sd1Gp4Nz8Aq3Xk7Fm2Ly9',true),
('c0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a','5','Deraza yonidagi stol','Zal',2, 5,'Tj3Wr9Vb5Ph2Ks8Nd6Qz4Xm1',true),
('c0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a','6','Katta ayvon','Ayvon',10,6,'Lc8Md4Rt7Yn2Bq6Hx9Ws3Kv5',true),
('c0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a','7','Kichik ayvon','Ayvon',6, 7,'Nb2Qy7Fk3Lz9Cm5Rp8Td4Gh6',false),
-- Yunusobod (B)
('c0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','1',NULL,'Zal',4, 1,'Wp5Kn9Zt3Bd7Vq2Ly6Mx8Rc4',true),
('c0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','2',NULL,'Zal',4, 2,'Fd7Cs2Nq8Rw4Kx6Bt9Zm3Hp5',true),
('c0000000-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','3',NULL,'Zal',6, 3,'Gy4Vm8Ld2Tp6Nc9Rk5Xb7Qw3',true),
('c0000000-0000-4000-8000-00000000000b','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','4','VIP xona','VIP',8, 4,'Sx9Hb3Wm7Kd5Qt2Nf8Pv6Lz4',true),
('c0000000-0000-4000-8000-00000000000c','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','5','Terrasa','Terrasa',4,5,'Rm6Zk2Xn9Cp4Vt7Bd3Hy5Ws8',true)
ON CONFLICT (id) DO UPDATE SET
  number = EXCLUDED.number, name = EXCLUDED.name, zone = EXCLUDED.zone,
  seats = EXCLUDED.seats, sort_order = EXCLUDED.sort_order,
  qr_token = EXCLUDED.qr_token, is_active = EXCLUDED.is_active, updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. Staff accounts.
--
--    auth.users rows are created directly because a seed cannot call the GoTrue
--    API. Three things are easy to get wrong and are therefore explicit:
--      a) trg_on_auth_user_created (doc 01 §2290) creates the public.profiles row
--         from raw_user_meta_data, so full_name and locale go in the metadata,
--         not into a separate profiles INSERT.
--      b) email_confirmed_at must be set, or sign-in fails with "email not confirmed".
--      c) auth.identities needs a matching row per user, or GoTrue rejects the
--         password grant. provider_id must equal the user id for provider 'email'.
--
--    Shared development password for all five: DemoParol!2345
--    This seed must NEVER run against production. `is_demo = true` on the tenant and
--    the fixed UUIDs make that obvious at a glance in any environment.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES
('00000000-0000-0000-0000-000000000000','90000000-0000-4000-8000-000000000001','authenticated','authenticated',
 'rustam.karimov@samarqandosh.uz', extensions.crypt('DemoParol!2345', extensions.gen_salt('bf')), now(),
 '{"provider":"email","providers":["email"]}'::jsonb,
 '{"full_name":"Rustam Karimov","locale":"uz"}'::jsonb, now(), now(), '', '', '', ''),
('00000000-0000-0000-0000-000000000000','90000000-0000-4000-8000-000000000002','authenticated','authenticated',
 'dilnoza.yusupova@samarqandosh.uz', extensions.crypt('DemoParol!2345', extensions.gen_salt('bf')), now(),
 '{"provider":"email","providers":["email"]}'::jsonb,
 '{"full_name":"Dilnoza Yusupova","locale":"ru"}'::jsonb, now(), now(), '', '', '', ''),
('00000000-0000-0000-0000-000000000000','90000000-0000-4000-8000-000000000003','authenticated','authenticated',
 'aziz.tursunov@samarqandosh.uz', extensions.crypt('DemoParol!2345', extensions.gen_salt('bf')), now(),
 '{"provider":"email","providers":["email"]}'::jsonb,
 '{"full_name":"Aziz Tursunov","locale":"uz"}'::jsonb, now(), now(), '', '', '', ''),
('00000000-0000-0000-0000-000000000000','90000000-0000-4000-8000-000000000004','authenticated','authenticated',
 'kamola.rahimova@samarqandosh.uz', extensions.crypt('DemoParol!2345', extensions.gen_salt('bf')), now(),
 '{"provider":"email","providers":["email"]}'::jsonb,
 '{"full_name":"Kamola Rahimova","locale":"ru"}'::jsonb, now(), now(), '', '', '', ''),
('00000000-0000-0000-0000-000000000000','90000000-0000-4000-8000-000000000005','authenticated','authenticated',
 'sherzod.islomov@samarqandosh.uz', extensions.crypt('DemoParol!2345', extensions.gen_salt('bf')), now(),
 '{"provider":"email","providers":["email"]}'::jsonb,
 '{"full_name":"Sherzod Islomov","locale":"uz"}'::jsonb, now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
SELECT
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
FROM auth.users u
WHERE u.id IN (
  '90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000004',
  '90000000-0000-4000-8000-000000000005'
)
ON CONFLICT (provider_id, provider) DO NOTHING;

-- Belt and braces: if the trigger was disabled during a restore, profiles still exist.
INSERT INTO public.profiles (id, email, full_name, phone, locale, is_platform_admin, is_active)
VALUES
('90000000-0000-4000-8000-000000000001','rustam.karimov@samarqandosh.uz','Rustam Karimov','+998 90 100 45 45','uz',false,true),
('90000000-0000-4000-8000-000000000002','dilnoza.yusupova@samarqandosh.uz','Dilnoza Yusupova','+998 90 100 45 46','ru',false,true),
('90000000-0000-4000-8000-000000000003','aziz.tursunov@samarqandosh.uz','Aziz Tursunov','+998 90 100 45 47','uz',false,true),
('90000000-0000-4000-8000-000000000004','kamola.rahimova@samarqandosh.uz','Kamola Rahimova','+998 90 100 45 48','ru',false,true),
('90000000-0000-4000-8000-000000000005','sherzod.islomov@samarqandosh.uz','Sherzod Islomov','+998 90 100 45 49','uz',false,true)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email, full_name = EXCLUDED.full_name, phone = EXCLUDED.phone,
  locale = EXCLUDED.locale, is_active = EXCLUDED.is_active, updated_at = now();

INSERT INTO public.staff (
  id, restaurant_id, branch_id, profile_id, role, permissions,
  display_name, employee_code, is_active, joined_at
) VALUES
-- Owner: no branch — sees the whole restaurant.
('80000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',NULL,
 '90000000-0000-4000-8000-000000000001','RESTAURANT_OWNER','{}'::jsonb,'Rustam Karimov','SOX-001',true,now()),
-- Manager at Chorsu, with menu and staff permissions granted explicitly.
('80000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a',
 '90000000-0000-4000-8000-000000000002','MANAGER',
 '{"menu":true,"tables":true,"orders":true,"staff":true,"analytics":true}'::jsonb,
 'Dilnoza Yusupova','SOX-002',true,now()),
('80000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a',
 '90000000-0000-4000-8000-000000000003','WAITER','{}'::jsonb,'Aziz','SOX-011',true,now()),
('80000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b',
 '90000000-0000-4000-8000-000000000004','WAITER','{}'::jsonb,'Kamola','SOX-012',true,now()),
('80000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a',
 '90000000-0000-4000-8000-000000000005','KITCHEN','{}'::jsonb,'Sherzod','SOX-021',true,now())
ON CONFLICT (id) DO UPDATE SET
  branch_id = EXCLUDED.branch_id, role = EXCLUDED.role, permissions = EXCLUDED.permissions,
  display_name = EXCLUDED.display_name, employee_code = EXCLUDED.employee_code,
  is_active = EXCLUDED.is_active, updated_at = now();
```

### 4.3 `supabase/seed.sql` — part 2: categories

```sql
-- ---------------------------------------------------------------------------
-- 5. Categories. branch_id NULL = shared by both branches.
--    "Popular" is a real merchandising category holding the five house signatures,
--    not a virtual view over is_popular. Both exist: the category is where a guest
--    browses, the is_popular flag is what drives the "Most ordered" rail.
-- ---------------------------------------------------------------------------
INSERT INTO public.menu_categories (
  id, restaurant_id, branch_id, name, description, image_url, icon, sort_order, is_active
) VALUES
('d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',NULL,
 '{"uz":"Ommabop","ru":"Популярное","en":"Popular"}'::public.i18n_text,
 '{"uz":"Mehmonlarimiz eng ko''p buyurtma qiladigan beshta taom.","ru":"Пять блюд, которые гости заказывают чаще всего.","en":"The five dishes our guests order most."}'::public.i18n_text,
 '/demo/categories/popular.webp','flame',0,true),
('d0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001',NULL,
 '{"uz":"Milliy taomlar","ru":"Узбекская кухня","en":"Uzbek Cuisine"}'::public.i18n_text,
 '{"uz":"Qozon, tandir va o''tin olovi. Buvilarimiz retseptlari bo''yicha.","ru":"Казан, тандыр и дровяной огонь. По бабушкиным рецептам.","en":"Cauldron, tandoor and a wood fire. Our grandmothers'' recipes."}'::public.i18n_text,
 '/demo/categories/uzbek.webp','soup',10,true),
('d0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001',NULL,
 '{"uz":"Fast Food","ru":"Фастфуд","en":"Fast Food"}'::public.i18n_text,
 '{"uz":"Tez, issiq va bolalarga ma''qul.","ru":"Быстро, горячо и нравится детям.","en":"Fast, hot, and a hit with children."}'::public.i18n_text,
 '/demo/categories/fastfood.webp','sandwich',20,true),
('d0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001',NULL,
 '{"uz":"Salatlar","ru":"Салаты","en":"Salads"}'::public.i18n_text,
 '{"uz":"Har kuni ertalab bozordan olingan sabzavotlar.","ru":"Овощи с базара каждое утро.","en":"Vegetables from the market every morning."}'::public.i18n_text,
 '/demo/categories/salads.webp','salad',30,true),
('d0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001',NULL,
 '{"uz":"Ichimliklar","ru":"Напитки","en":"Drinks"}'::public.i18n_text,
 '{"uz":"Choynakda ko''k choy — osh yonida eng to''g''ri tanlov.","ru":"Зелёный чай в чайнике — лучший выбор к плову.","en":"Green tea in a pot — the right thing beside plov."}'::public.i18n_text,
 '/demo/categories/drinks.webp','cup-soda',40,true),
('d0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000001',NULL,
 '{"uz":"Shirinliklar","ru":"Десерты","en":"Desserts"}'::public.i18n_text,
 '{"uz":"Choy ustidan — an''anaviy va zamonaviy shirinliklar.","ru":"К чаю — традиционные и современные сладости.","en":"For the tea — traditional and modern sweets."}'::public.i18n_text,
 '/demo/categories/desserts.webp','cake-slice',50,true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, image_url = EXCLUDED.image_url,
  icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active,
  updated_at = now();
```

### 4.4 `supabase/seed.sql` — part 3: the 37 menu items

Prices are `BIGINT` minor units; UZS has `currency_decimals = 0`, so `45000` is 45 000 so'm.
`branch_id` is `NULL` on every item — one menu, both branches. The `VALUES`-then-`SELECT` shape
keeps the tenant id out of 37 repetitions and lets the `i18n_text`/`dietary_tag[]` casts happen once.

```sql
-- ---------------------------------------------------------------------------
-- 6. Menu items (37). Column order in v(...) is fixed; do not reorder.
-- ---------------------------------------------------------------------------
INSERT INTO public.menu_items (
  id, restaurant_id, branch_id, category_id, name, description, ingredients,
  price, compare_at_price, image_url, spicy_level, preparation_time, calories,
  dietary_tags, is_available, unavailable_until, is_featured, is_popular,
  popularity_score, sort_order
)
SELECT
  v.id,
  'a0000000-0000-4000-8000-000000000001'::uuid,
  NULL,
  v.category_id,
  v.name::public.i18n_text,
  v.description::public.i18n_text,
  v.ingredients::public.i18n_text,
  v.price,
  v.compare_at_price,
  v.image_url,
  v.spicy_level,
  v.preparation_time,
  v.calories,
  v.dietary_tags::public.dietary_tag[],
  v.is_available,
  v.unavailable_until,
  v.is_featured,
  v.is_popular,
  v.popularity_score,
  v.sort_order
FROM (VALUES

-- ===== Ommabop / Популярное / Popular =====================================
('e0000000-0000-4000-8000-000000000001'::uuid,'d0000000-0000-4000-8000-000000000001'::uuid,
 '{"uz":"Toy oshi","ru":"Плов «Той»","en":"Toy Osh (Wedding Plov)"}',
 '{"uz":"O''tin olovida damlangan Samarqand oshi: sarg''ish devzira guruch, qo''y go''shti, sariq sabzi va butun sarimsoq.","ru":"Самаркандский плов на дровах: рис девзира, баранина, жёлтая морковь и целая головка чеснока.","en":"Samarkand plov over a wood fire: devzira rice, lamb, yellow carrot and a whole head of garlic."}',
 '{"uz":"Devzira guruch, qo''y go''shti, sariq sabzi, piyoz, sarimsoq, zira, paxta moyi","ru":"Рис девзира, баранина, жёлтая морковь, лук, чеснок, зира, хлопковое масло","en":"Devzira rice, lamb, yellow carrot, onion, garlic, cumin, cottonseed oil"}',
 45000::bigint, 52000::bigint, '/demo/items/toy-oshi.webp', 0::smallint, 20::smallint, 720, '{halal}', true, NULL::timestamptz, true, true, 980, 1),

('e0000000-0000-4000-8000-000000000002'::uuid,'d0000000-0000-4000-8000-000000000001'::uuid,
 '{"uz":"Tandir somsa","ru":"Самса из тандыра","en":"Tandoor Somsa"}',
 '{"uz":"Tandirda pishirilgan qatlama somsa; ichida mayda to''g''ralgan mol go''shti va piyoz.","ru":"Слоёная самса из тандыра с рубленой говядиной и луком.","en":"Flaky tandoor-baked pastry filled with hand-chopped beef and onion."}',
 '{"uz":"Bug''doy uni, mol go''shti, piyoz, dumba yog''i, zira, qora sedana","ru":"Пшеничная мука, говядина, лук, курдючный жир, зира, чёрный тмин","en":"Wheat flour, beef, onion, tail fat, cumin, nigella seed"}',
 15000::bigint, NULL::bigint, '/demo/items/tandir-somsa.webp', 0::smallint, 8::smallint, 380, '{halal}', true, NULL::timestamptz, false, true, 870, 2),

('e0000000-0000-4000-8000-000000000003'::uuid,'d0000000-0000-4000-8000-000000000001'::uuid,
 '{"uz":"Qo''y shashlik","ru":"Шашлык из баранины","en":"Lamb Shashlik"}',
 '{"uz":"Cho''g''da pishgan qo''y go''shti shashligi, piyoz va tandir non bilan.","ru":"Шашлык из баранины на углях, с луком и лепёшкой из тандыра.","en":"Lamb skewers over charcoal, served with sliced onion and tandoor bread."}',
 '{"uz":"Qo''y go''shti, dumba, piyoz, achchiq qalampir, sirka, ziravorlar","ru":"Баранина, курдюк, лук, острый перец, уксус, специи","en":"Lamb, tail fat, onion, chilli, vinegar, spices"}',
 38000::bigint, NULL::bigint, '/demo/items/qoy-shashlik.webp', 1::smallint, 18::smallint, 540, '{halal}', true, NULL::timestamptz, true, true, 810, 3),

('e0000000-0000-4000-8000-000000000004'::uuid,'d0000000-0000-4000-8000-000000000001'::uuid,
 '{"uz":"Qovurma lag''mon","ru":"Лагман жареный","en":"Fried Lagman"}',
 '{"uz":"Qo''lda cho''zilgan xamir, mol go''shti va sabzavotlar bilan qovurilgan.","ru":"Домашняя тянутая лапша, обжаренная с говядиной и овощами.","en":"Hand-pulled noodles stir-fried with beef and vegetables."}',
 '{"uz":"Qo''lda cho''zilgan xamir, mol go''shti, bulg''or qalampir, pomidor, kartoshka, sarimsoq","ru":"Тянутая лапша, говядина, болгарский перец, помидор, картофель, чеснок","en":"Hand-pulled noodles, beef, bell pepper, tomato, potato, garlic"}',
 42000::bigint, NULL::bigint, '/demo/items/qovurma-lagmon.webp', 1::smallint, 16::smallint, 630, '{halal}', true, NULL::timestamptz, false, true, 760, 4),

('e0000000-0000-4000-8000-000000000005'::uuid,'d0000000-0000-4000-8000-000000000001'::uuid,
 '{"uz":"Manti","ru":"Манты","en":"Manti"}',
 '{"uz":"Bug''da pishgan besh dona manti; qo''y go''shti va piyoz, qatiq bilan beriladi.","ru":"Пять штук на пару: баранина с луком, подаём с катыком.","en":"Five steamed dumplings of lamb and onion, served with katyk."}',
 '{"uz":"Bug''doy uni, qo''y go''shti, piyoz, dumba yog''i, qora murch, qatiq","ru":"Пшеничная мука, баранина, лук, курдючный жир, чёрный перец, катык","en":"Wheat flour, lamb, onion, tail fat, black pepper, katyk"}',
 36000::bigint, NULL::bigint, '/demo/items/manti.webp', 0::smallint, 25::smallint, 590, '{halal}', true, NULL::timestamptz, false, true, 720, 5),

-- ===== Milliy taomlar / Узбекская кухня / Uzbek Cuisine ====================
('e0000000-0000-4000-8000-000000000006'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,
 '{"uz":"Chuchvara","ru":"Чучвара","en":"Chuchvara"}',
 '{"uz":"Mayda pelmen sho''rvasi; suyakdan qaynatilgan bulyon va ko''katlar bilan.","ru":"Суп с маленькими пельменями на костном бульоне и с зеленью.","en":"Tiny dumplings in a bone broth, finished with herbs."}',
 '{"uz":"Xamir, mol go''shti, piyoz, suyak bulyoni, kashnich, qalampir","ru":"Тесто, говядина, лук, костный бульон, кинза, перец","en":"Dough, beef, onion, bone broth, coriander, pepper"}',
 32000::bigint, NULL::bigint, '/demo/items/chuchvara.webp', 0::smallint, 14::smallint, 410, '{halal}', true, NULL::timestamptz, false, false, 320, 10),

('e0000000-0000-4000-8000-000000000007'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,
 '{"uz":"Norin","ru":"Нарын","en":"Norin"}',
 '{"uz":"Qo''lda kesilgan xamir va qaynatilgan qazi bilan sovuq taom — Toshkent klassikasi.","ru":"Тонко нарезанная лапша с отварной казы — ташкентская классика, подаётся холодным.","en":"Hand-cut noodles with boiled horse sausage — a Tashkent classic, served cool."}',
 '{"uz":"Xamir, qazi, qo''y go''shti, piyoz, murch, go''sht qaynatmasi","ru":"Тесто, казы, баранина, лук, перец, мясной отвар","en":"Dough, kazy, lamb, onion, pepper, meat stock"}',
 44000::bigint, NULL::bigint, '/demo/items/norin.webp', 0::smallint, 12::smallint, 560, '{halal}', true, NULL::timestamptz, true, false, 410, 11),

('e0000000-0000-4000-8000-000000000008'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,
 '{"uz":"Mastava","ru":"Мастава","en":"Mastava"}',
 '{"uz":"Guruchli qo''y sho''rvasi; qatiq va ko''kat bilan.","ru":"Рисовый суп на баранине, с катыком и зеленью.","en":"Rice and lamb soup, served with katyk and herbs."}',
 '{"uz":"Guruch, qo''y go''shti, sabzi, pomidor, kartoshka, qatiq, kashnich","ru":"Рис, баранина, морковь, помидор, картофель, катык, кинза","en":"Rice, lamb, carrot, tomato, potato, katyk, coriander"}',
 28000::bigint, NULL::bigint, '/demo/items/mastava.webp', 0::smallint, 12::smallint, 380, '{halal}', true, NULL::timestamptz, false, false, 290, 12),

('e0000000-0000-4000-8000-000000000009'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,
 '{"uz":"Qo''y sho''rva","ru":"Шурпа из баранины","en":"Lamb Shurpa"}',
 '{"uz":"Uzoq qaynatilgan qo''y sho''rvasi: yirik kesilgan sabzavot va suyakli go''sht.","ru":"Долго томлённая шурпа: крупно нарезанные овощи и мясо на кости.","en":"Slow-simmered lamb broth with coarsely cut vegetables and meat on the bone."}',
 '{"uz":"Suyakli qo''y go''shti, kartoshka, sabzi, piyoz, pomidor, no''xat, ko''kat","ru":"Баранина на кости, картофель, морковь, лук, помидор, нут, зелень","en":"Lamb on the bone, potato, carrot, onion, tomato, chickpeas, herbs"}',
 36000::bigint, NULL::bigint, '/demo/items/qoy-shorva.webp', 0::smallint, 15::smallint, 470, '{halal}', true, NULL::timestamptz, false, false, 350, 13),

('e0000000-0000-4000-8000-00000000000a'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,
 '{"uz":"Dimlama","ru":"Дымлама","en":"Dimlama"}',
 '{"uz":"Qozonda bug''da dimlangan go''sht va sabzavot qatlamlari.","ru":"Мясо и овощи слоями, томлённые в казане под крышкой.","en":"Meat and vegetables layered and steamed in a sealed cauldron."}',
 '{"uz":"Mol go''shti, kartoshka, sabzi, piyoz, karam, bulg''or qalampir, pomidor","ru":"Говядина, картофель, морковь, лук, капуста, болгарский перец, помидор","en":"Beef, potato, carrot, onion, cabbage, bell pepper, tomato"}',
 48000::bigint, NULL::bigint, '/demo/items/dimlama.webp', 0::smallint, 25::smallint, 610, '{halal}', true, NULL::timestamptz, false, false, 300, 14),

('e0000000-0000-4000-8000-00000000000b'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,
 '{"uz":"Qozon kabob","ru":"Казан-кабоб","en":"Kazan Kabob"}',
 '{"uz":"Qozonda qovurilgan qo''y go''shti va kartoshka, piyoz salat bilan.","ru":"Баранина с картофелем, обжаренные в казане, с луковым салатом.","en":"Lamb and potato fried in the cauldron, with an onion salad."}',
 '{"uz":"Qo''y go''shti, kartoshka, piyoz, zira, achchiq qalampir","ru":"Баранина, картофель, лук, зира, острый перец","en":"Lamb, potato, onion, cumin, chilli"}',
 54000::bigint, NULL::bigint, '/demo/items/qozon-kabob.webp', 1::smallint, 22::smallint, 780, '{halal}', true, NULL::timestamptz, true, false, 460, 15),

('e0000000-0000-4000-8000-00000000000c'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,
 '{"uz":"Xonim","ru":"Ханум","en":"Khonim"}',
 '{"uz":"Bug''da pishirilgan o''ram: yupqa xamir ichida go''sht va kartoshka.","ru":"Паровой рулет: тонкое тесто с мясом и картофелем.","en":"A steamed roll of thin dough filled with meat and potato."}',
 '{"uz":"Xamir, mol go''shti, kartoshka, piyoz, sariyog'', qatiq","ru":"Тесто, говядина, картофель, лук, сливочное масло, катык","en":"Dough, beef, potato, onion, butter, katyk"}',
 30000::bigint, NULL::bigint, '/demo/items/xonim.webp', 0::smallint, 20::smallint, 520, '{halal}', true, NULL::timestamptz, false, false, 240, 16),

('e0000000-0000-4000-8000-00000000000d'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,
 '{"uz":"Beshbarmoq","ru":"Бешбармак","en":"Beshbarmak"}',
 '{"uz":"Keng yoyilgan xamir ustida qaynatilgan qo''y go''shti va piyoz qaynatmasi.","ru":"Отварная баранина с луковым бульоном на широких пластах теста.","en":"Boiled lamb and onion broth over broad sheets of dough."}',
 '{"uz":"Xamir, qo''y go''shti, piyoz, qora murch, go''sht qaynatmasi","ru":"Тесто, баранина, лук, чёрный перец, мясной отвар","en":"Dough, lamb, onion, black pepper, meat stock"}',
 58000::bigint, NULL::bigint, '/demo/items/beshbarmoq.webp', 0::smallint, 30::smallint, 840, '{halal}', false, (now() + interval '1 day'), false, false, 180, 17),

('e0000000-0000-4000-8000-00000000000e'::uuid,'d0000000-0000-4000-8000-000000000002'::uuid,
 '{"uz":"Tandir go''sht","ru":"Мясо из тандыра","en":"Tandoor Lamb"}',
 '{"uz":"Tandirda sekin pishirilgan qo''y go''shti, 200 g; non va piyoz bilan.","ru":"Баранина медленного запекания в тандыре, 200 г; с лепёшкой и луком.","en":"Lamb slow-roasted in the tandoor, 200 g, with bread and onion."}',
 '{"uz":"Qo''y go''shti, tuz, zira, qora murch, tandir non","ru":"Баранина, соль, зира, чёрный перец, лепёшка","en":"Lamb, salt, cumin, black pepper, tandoor bread"}',
 72000::bigint, 85000::bigint, '/demo/items/tandir-gosht.webp', 0::smallint, 20::smallint, 690, '{halal}', true, NULL::timestamptz, true, false, 520, 18),

-- ===== Fast Food ===========================================================
('e0000000-0000-4000-8000-00000000000f'::uuid,'d0000000-0000-4000-8000-000000000003'::uuid,
 '{"uz":"Chizburger","ru":"Чизбургер","en":"Cheeseburger"}',
 '{"uz":"Mol go''shtidan kotlet, cheddar pishloq, marinadlangan bodring va uy sousi.","ru":"Говяжья котлета, чеддер, маринованный огурец и домашний соус.","en":"Beef patty, cheddar, pickles and our own sauce."}',
 '{"uz":"Bulochka, mol go''shti, cheddar pishloq, bodring, pomidor, salat bargi, sous","ru":"Булочка, говядина, чеддер, огурец, помидор, салат, соус","en":"Bun, beef, cheddar, pickle, tomato, lettuce, sauce"}',
 42000::bigint, NULL::bigint, '/demo/items/chizburger.webp', 0::smallint, 12::smallint, 720, '{halal}', true, NULL::timestamptz, false, true, 540, 20),

('e0000000-0000-4000-8000-000000000010'::uuid,'d0000000-0000-4000-8000-000000000003'::uuid,
 '{"uz":"Klub sendvich","ru":"Клаб-сэндвич","en":"Club Sandwich"}',
 '{"uz":"Uch qavat tost: tovuq, tuxum, pomidor va salat bargi. Fri bilan.","ru":"Трёхслойный тост: курица, яйцо, помидор и салат. С картофелем фри.","en":"Three-layer toast with chicken, egg, tomato and lettuce. Served with fries."}',
 '{"uz":"Tost non, tovuq filesi, tuxum, pomidor, salat bargi, mayonez","ru":"Тостовый хлеб, куриное филе, яйцо, помидор, салат, майонез","en":"Toast bread, chicken breast, egg, tomato, lettuce, mayonnaise"}',
 38000::bigint, NULL::bigint, '/demo/items/klub-sendvich.webp', 0::smallint, 12::smallint, 640, '{halal}', true, NULL::timestamptz, false, false, 280, 21),

('e0000000-0000-4000-8000-000000000011'::uuid,'d0000000-0000-4000-8000-000000000003'::uuid,
 '{"uz":"Tovuqli lavash","ru":"Лаваш с курицей","en":"Chicken Lavash"}',
 '{"uz":"Yupqa lavash ichida qovurilgan tovuq, fri va sarimsoqli sous.","ru":"Тонкий лаваш с жареной курицей, картофелем фри и чесночным соусом.","en":"Thin lavash wrapped around grilled chicken, fries and garlic sauce."}',
 '{"uz":"Lavash, tovuq filesi, kartoshka fri, bodring, pomidor, sarimsoqli sous","ru":"Лаваш, куриное филе, картофель фри, огурец, помидор, чесночный соус","en":"Lavash, chicken breast, fries, cucumber, tomato, garlic sauce"}',
 32000::bigint, NULL::bigint, '/demo/items/tovuqli-lavash.webp', 1::smallint, 10::smallint, 680, '{halal}', true, NULL::timestamptz, false, true, 610, 22),

('e0000000-0000-4000-8000-000000000012'::uuid,'d0000000-0000-4000-8000-000000000003'::uuid,
 '{"uz":"Hot-dog","ru":"Хот-дог","en":"Hot Dog"}',
 '{"uz":"Issiq bulochka, mol go''shtli sosiska, ketchup va xantal.","ru":"Тёплая булочка, говяжья сосиска, кетчуп и горчица.","en":"Warm bun, beef sausage, ketchup and mustard."}',
 '{"uz":"Bulochka, mol go''shtli sosiska, ketchup, xantal, marinadlangan bodring","ru":"Булочка, говяжья сосиска, кетчуп, горчица, маринованный огурец","en":"Bun, beef sausage, ketchup, mustard, pickle"}',
 22000::bigint, NULL::bigint, '/demo/items/hot-dog.webp', 0::smallint, 6::smallint, 430, '{halal}', true, NULL::timestamptz, false, false, 210, 23),

('e0000000-0000-4000-8000-000000000013'::uuid,'d0000000-0000-4000-8000-000000000003'::uuid,
 '{"uz":"Fri kartoshka","ru":"Картофель фри","en":"French Fries"}',
 '{"uz":"Ikki marta qovurilgan kartoshka, dengiz tuzi bilan.","ru":"Картофель двойной обжарки с морской солью.","en":"Twice-fried potatoes with sea salt."}',
 '{"uz":"Kartoshka, o''simlik moyi, dengiz tuzi","ru":"Картофель, растительное масло, морская соль","en":"Potato, vegetable oil, sea salt"}',
 18000::bigint, NULL::bigint, '/demo/items/fri-kartoshka.webp', 0::smallint, 7::smallint, 340, '{vegetarian,vegan,halal}', true, NULL::timestamptz, false, false, 400, 24),

('e0000000-0000-4000-8000-000000000014'::uuid,'d0000000-0000-4000-8000-000000000003'::uuid,
 '{"uz":"Tovuq naggets","ru":"Куриные наггетсы","en":"Chicken Nuggets"}',
 '{"uz":"Oltita nagets, panirovkada; sous tanlovingiz bilan.","ru":"Шесть наггетсов в панировке, с соусом на выбор.","en":"Six breaded nuggets with a sauce of your choice."}',
 '{"uz":"Tovuq filesi, bug''doy uni, ziravorlar, o''simlik moyi","ru":"Куриное филе, пшеничная мука, специи, растительное масло","en":"Chicken breast, wheat flour, spices, vegetable oil"}',
 26000::bigint, NULL::bigint, '/demo/items/tovuq-naggets.webp', 0::smallint, 9::smallint, 460, '{halal}', true, NULL::timestamptz, false, false, 260, 25),

-- ===== Salatlar / Салаты / Salads ==========================================
('e0000000-0000-4000-8000-000000000015'::uuid,'d0000000-0000-4000-8000-000000000004'::uuid,
 '{"uz":"Achichuk","ru":"Ачик-чучук","en":"Achichuk"}',
 '{"uz":"Yupqa to''g''ralgan pomidor va piyoz, achchiq qalampir bilan. Oshning eng to''g''ri jufti.","ru":"Тонко нарезанные помидоры и лук с острым перцем. Лучшая пара к плову.","en":"Thinly sliced tomato and onion with chilli. The right partner for plov."}',
 '{"uz":"Pomidor, piyoz, achchiq qalampir, rayhon, tuz","ru":"Помидоры, лук, острый перец, базилик, соль","en":"Tomato, onion, chilli, basil, salt"}',
 14000::bigint, NULL::bigint, '/demo/items/achichuk.webp', 2::smallint, 5::smallint, 90, '{vegetarian,vegan,halal,gluten_free,lactose_free}', true, NULL::timestamptz, false, true, 640, 30),

('e0000000-0000-4000-8000-000000000016'::uuid,'d0000000-0000-4000-8000-000000000004'::uuid,
 '{"uz":"Toshkent salati","ru":"Ташкентский салат","en":"Tashkent Salad"}',
 '{"uz":"Qaynatilgan mol tili, turp va piyoz; qaymoq sousi va qovurilgan piyoz bilan.","ru":"Отварной говяжий язык, редька и лук; сметанный соус и жареный лук.","en":"Boiled beef tongue, radish and onion in a sour-cream dressing, topped with fried onion."}',
 '{"uz":"Mol tili, ko''k turp, piyoz, qaymoq, tuxum, ko''kat","ru":"Говяжий язык, зелёная редька, лук, сметана, яйцо, зелень","en":"Beef tongue, green radish, onion, sour cream, egg, herbs"}',
 34000::bigint, NULL::bigint, '/demo/items/toshkent-salati.webp', 0::smallint, 10::smallint, 320, '{halal}', true, NULL::timestamptz, true, false, 330, 31),

('e0000000-0000-4000-8000-000000000017'::uuid,'d0000000-0000-4000-8000-000000000004'::uuid,
 '{"uz":"Sezar salati","ru":"Салат «Цезарь»","en":"Caesar Salad"}',
 '{"uz":"Romen salat, grilda pishirilgan tovuq, parmezan va krutonlar.","ru":"Салат романо, курица на гриле, пармезан и сухарики.","en":"Romaine, grilled chicken, parmesan and croutons."}',
 '{"uz":"Romen salat, tovuq filesi, parmezan, kruton, sezar sousi, tuxum","ru":"Романо, куриное филе, пармезан, сухарики, соус цезарь, яйцо","en":"Romaine, chicken breast, parmesan, croutons, Caesar dressing, egg"}',
 39000::bigint, NULL::bigint, '/demo/items/sezar-salati.webp', 0::smallint, 10::smallint, 420, '{halal}', true, NULL::timestamptz, false, false, 350, 32),

('e0000000-0000-4000-8000-000000000018'::uuid,'d0000000-0000-4000-8000-000000000004'::uuid,
 '{"uz":"Vinegret","ru":"Винегрет","en":"Vinaigrette Salad"}',
 '{"uz":"Lavlagi, kartoshka, sabzi va tuzlangan bodring; o''simlik moyi bilan.","ru":"Свёкла, картофель, морковь и солёный огурец с растительным маслом.","en":"Beetroot, potato, carrot and pickled cucumber with vegetable oil."}',
 '{"uz":"Lavlagi, kartoshka, sabzi, tuzlangan bodring, piyoz, no''xat, o''simlik moyi","ru":"Свёкла, картофель, морковь, солёный огурец, лук, горошек, растительное масло","en":"Beetroot, potato, carrot, pickled cucumber, onion, peas, vegetable oil"}',
 18000::bigint, NULL::bigint, '/demo/items/vinegret.webp', 0::smallint, 6::smallint, 210, '{vegetarian,vegan,halal,gluten_free,lactose_free}', true, NULL::timestamptz, false, false, 180, 33),

('e0000000-0000-4000-8000-000000000019'::uuid,'d0000000-0000-4000-8000-000000000004'::uuid,
 '{"uz":"Olivye","ru":"Оливье","en":"Olivier Salad"}',
 '{"uz":"Kartoshka, tuxum, mol go''shti va no''xat; mayonez bilan.","ru":"Картофель, яйцо, говядина и горошек под майонезом.","en":"Potato, egg, beef and peas in mayonnaise."}',
 '{"uz":"Kartoshka, tuxum, mol go''shti, no''xat, tuzlangan bodring, mayonez","ru":"Картофель, яйцо, говядина, горошек, солёный огурец, майонез","en":"Potato, egg, beef, peas, pickled cucumber, mayonnaise"}',
 26000::bigint, NULL::bigint, '/demo/items/olivye.webp', 0::smallint, 8::smallint, 380, '{halal}', true, NULL::timestamptz, false, false, 250, 34),

-- ===== Ichimliklar / Напитки / Drinks ======================================
('e0000000-0000-4000-8000-00000000001a'::uuid,'d0000000-0000-4000-8000-000000000005'::uuid,
 '{"uz":"Ko''k choy","ru":"Зелёный чай","en":"Green Tea"}',
 '{"uz":"Choynakda damlangan ko''k choy. Osh yonida albatta.","ru":"Зелёный чай, заваренный в чайнике. К плову — обязательно.","en":"Green tea brewed in a pot. Non-negotiable beside plov."}',
 '{"uz":"Ko''k choy bargi, qaynoq suv","ru":"Листовой зелёный чай, кипяток","en":"Loose green tea, boiling water"}',
 8000::bigint, NULL::bigint, '/demo/items/kok-choy.webp', 0::smallint, 4::smallint, 0, '{vegetarian,vegan,halal,gluten_free,lactose_free}', true, NULL::timestamptz, false, true, 900, 40),

('e0000000-0000-4000-8000-00000000001b'::uuid,'d0000000-0000-4000-8000-000000000005'::uuid,
 '{"uz":"Qora choy","ru":"Чёрный чай","en":"Black Tea"}',
 '{"uz":"Choynakda damlangan qora choy, limon bilan.","ru":"Чёрный чай в чайнике, с лимоном.","en":"Black tea in a pot, with lemon."}',
 '{"uz":"Qora choy bargi, limon, qaynoq suv","ru":"Листовой чёрный чай, лимон, кипяток","en":"Loose black tea, lemon, boiling water"}',
 8000::bigint, NULL::bigint, '/demo/items/qora-choy.webp', 0::smallint, 4::smallint, 0, '{vegetarian,vegan,halal,gluten_free,lactose_free}', true, NULL::timestamptz, false, false, 480, 41),

('e0000000-0000-4000-8000-00000000001c'::uuid,'d0000000-0000-4000-8000-000000000005'::uuid,
 '{"uz":"Ayron","ru":"Айран","en":"Ayran"}',
 '{"uz":"Sovuq tuzli qatiq ichimligi.","ru":"Холодный солёный кисломолочный напиток.","en":"Chilled salted yoghurt drink."}',
 '{"uz":"Qatiq, suv, tuz, yalpiz","ru":"Катык, вода, соль, мята","en":"Katyk, water, salt, mint"}',
 12000::bigint, NULL::bigint, '/demo/items/ayron.webp', 0::smallint, 3::smallint, 90, '{vegetarian,halal,gluten_free}', true, NULL::timestamptz, false, false, 330, 42),

('e0000000-0000-4000-8000-00000000001d'::uuid,'d0000000-0000-4000-8000-000000000005'::uuid,
 '{"uz":"O''rik kompoti","ru":"Компот из урюка","en":"Apricot Compote"}',
 '{"uz":"Quritilgan o''rikdan qaynatilgan sovuq kompot.","ru":"Холодный компот из сушёного урюка.","en":"Chilled compote of dried apricots."}',
 '{"uz":"Quritilgan o''rik, suv, shakar","ru":"Сушёный урюк, вода, сахар","en":"Dried apricots, water, sugar"}',
 10000::bigint, NULL::bigint, '/demo/items/orik-kompoti.webp', 0::smallint, 3::smallint, 120, '{vegetarian,vegan,halal,gluten_free,lactose_free}', true, NULL::timestamptz, false, false, 290, 43),

('e0000000-0000-4000-8000-00000000001e'::uuid,'d0000000-0000-4000-8000-000000000005'::uuid,
 '{"uz":"Coca-Cola 0,5 l","ru":"Coca-Cola 0,5 л","en":"Coca-Cola 0.5 l"}',
 '{"uz":"Sovutilgan gazlangan ichimlik, 0,5 l.","ru":"Охлаждённый газированный напиток, 0,5 л.","en":"Chilled soft drink, 0.5 l."}',
 '{"uz":"Gazlangan suv, shakar, karamel bo''yog''i, kofein","ru":"Газированная вода, сахар, карамельный колер, кофеин","en":"Carbonated water, sugar, caramel colour, caffeine"}',
 12000::bigint, NULL::bigint, '/demo/items/coca-cola.webp', 0::smallint, 1::smallint, 210, '{vegetarian,vegan,halal,gluten_free,lactose_free}', true, NULL::timestamptz, false, false, 420, 44),

('e0000000-0000-4000-8000-00000000001f'::uuid,'d0000000-0000-4000-8000-000000000005'::uuid,
 '{"uz":"Mineral suv 0,5 l","ru":"Минеральная вода 0,5 л","en":"Mineral Water 0.5 l"}',
 '{"uz":"Gazsiz tabiiy mineral suv.","ru":"Негазированная природная минеральная вода.","en":"Still natural mineral water."}',
 '{"uz":"Tabiiy mineral suv","ru":"Природная минеральная вода","en":"Natural mineral water"}',
 7000::bigint, NULL::bigint, '/demo/items/mineral-suv.webp', 0::smallint, 1::smallint, 0, '{vegetarian,vegan,halal,gluten_free,lactose_free}', true, NULL::timestamptz, false, false, 510, 45),

('e0000000-0000-4000-8000-000000000020'::uuid,'d0000000-0000-4000-8000-000000000005'::uuid,
 '{"uz":"Espresso","ru":"Эспрессо","en":"Espresso"}',
 '{"uz":"Ikki porsiya arabika, 30 ml.","ru":"Двойная порция арабики, 30 мл.","en":"A double shot of arabica, 30 ml."}',
 '{"uz":"Arabika qahvasi, suv","ru":"Кофе арабика, вода","en":"Arabica coffee, water"}',
 18000::bigint, NULL::bigint, '/demo/items/espresso.webp', 0::smallint, 3::smallint, 5, '{vegetarian,vegan,halal,gluten_free,lactose_free}', true, NULL::timestamptz, false, false, 200, 46),

-- ===== Shirinliklar / Десерты / Desserts ===================================
('e0000000-0000-4000-8000-000000000021'::uuid,'d0000000-0000-4000-8000-000000000006'::uuid,
 '{"uz":"Chak-chak","ru":"Чак-чак","en":"Chak-Chak"}',
 '{"uz":"Asal sirtiga botirilgan mayda xamir bo''laklari.","ru":"Кусочки теста в медовой глазури.","en":"Fried dough pieces glazed in honey."}',
 '{"uz":"Bug''doy uni, tuxum, asal, shakar, o''simlik moyi","ru":"Пшеничная мука, яйца, мёд, сахар, растительное масло","en":"Wheat flour, eggs, honey, sugar, vegetable oil"}',
 22000::bigint, NULL::bigint, '/demo/items/chak-chak.webp', 0::smallint, 5::smallint, 480, '{vegetarian,halal}', true, NULL::timestamptz, false, true, 430, 50),

('e0000000-0000-4000-8000-000000000022'::uuid,'d0000000-0000-4000-8000-000000000006'::uuid,
 '{"uz":"Tahinli holva","ru":"Халва тахинная","en":"Tahini Halva"}',
 '{"uz":"Kunjutdan tayyorlangan an''anaviy holva.","ru":"Традиционная халва из кунжута.","en":"Traditional sesame halva."}',
 '{"uz":"Kunjut, shakar, glyukoza siropi, pista","ru":"Кунжут, сахар, глюкозный сироп, фисташки","en":"Sesame, sugar, glucose syrup, pistachio"}',
 20000::bigint, NULL::bigint, '/demo/items/tahinli-holva.webp', 0::smallint, 3::smallint, 520, '{vegetarian,vegan,halal,gluten_free,lactose_free,contains_nuts}', true, NULL::timestamptz, false, false, 190, 51),

('e0000000-0000-4000-8000-000000000023'::uuid,'d0000000-0000-4000-8000-000000000006'::uuid,
 '{"uz":"Parvarda","ru":"Парварда","en":"Parvarda"}',
 '{"uz":"Un sepilgan an''anaviy karamel konfeti.","ru":"Традиционная карамель в мучной обсыпке.","en":"Traditional flour-dusted caramel sweets."}',
 '{"uz":"Shakar, bug''doy uni, limon kislotasi","ru":"Сахар, пшеничная мука, лимонная кислота","en":"Sugar, wheat flour, citric acid"}',
 12000::bigint, NULL::bigint, '/demo/items/parvarda.webp', 0::smallint, 2::smallint, 390, '{vegetarian,vegan,halal,lactose_free}', true, NULL::timestamptz, false, false, 150, 52),

('e0000000-0000-4000-8000-000000000024'::uuid,'d0000000-0000-4000-8000-000000000006'::uuid,
 '{"uz":"Medovik","ru":"Медовик","en":"Honey Cake"}',
 '{"uz":"Ko''p qavatli asalli tort, qaymoqli krem bilan.","ru":"Многослойный медовый торт со сметанным кремом.","en":"Layered honey cake with sour-cream frosting."}',
 '{"uz":"Bug''doy uni, asal, tuxum, qaymoq, shakar, sariyog''","ru":"Пшеничная мука, мёд, яйца, сметана, сахар, сливочное масло","en":"Wheat flour, honey, eggs, sour cream, sugar, butter"}',
 28000::bigint, NULL::bigint, '/demo/items/medovik.webp', 0::smallint, 3::smallint, 450, '{vegetarian,halal}', true, NULL::timestamptz, true, false, 380, 53),

('e0000000-0000-4000-8000-000000000025'::uuid,'d0000000-0000-4000-8000-000000000006'::uuid,
 '{"uz":"Pistali muzqaymoq","ru":"Фисташковое мороженое","en":"Pistachio Ice Cream"}',
 '{"uz":"Uyda tayyorlangan pista muzqaymoqi, ikki shar.","ru":"Домашнее фисташковое мороженое, два шарика.","en":"House-made pistachio ice cream, two scoops."}',
 '{"uz":"Sut, qaymoq, pista, shakar, tuxum sarig''i","ru":"Молоко, сливки, фисташки, сахар, яичный желток","en":"Milk, cream, pistachio, sugar, egg yolk"}',
 24000::bigint, NULL::bigint, '/demo/items/pistali-muzqaymoq.webp', 0::smallint, 3::smallint, 340, '{vegetarian,halal,gluten_free,contains_nuts}', true, NULL::timestamptz, false, false, 300, 54)

) AS v(id, category_id, name, description, ingredients, price, compare_at_price, image_url,
       spicy_level, preparation_time, calories, dietary_tags, is_available, unavailable_until,
       is_featured, is_popular, popularity_score, sort_order)
ON CONFLICT (id) DO UPDATE SET
  category_id = EXCLUDED.category_id, name = EXCLUDED.name, description = EXCLUDED.description,
  ingredients = EXCLUDED.ingredients, price = EXCLUDED.price,
  compare_at_price = EXCLUDED.compare_at_price, image_url = EXCLUDED.image_url,
  spicy_level = EXCLUDED.spicy_level, preparation_time = EXCLUDED.preparation_time,
  calories = EXCLUDED.calories, dietary_tags = EXCLUDED.dietary_tags,
  is_available = EXCLUDED.is_available, unavailable_until = EXCLUDED.unavailable_until,
  is_featured = EXCLUDED.is_featured, is_popular = EXCLUDED.is_popular,
  popularity_score = EXCLUDED.popularity_score, sort_order = EXCLUDED.sort_order,
  updated_at = now();
```

### 4.5 `supabase/seed.sql` — part 4: options, promotions, sample orders

```sql
-- ---------------------------------------------------------------------------
-- 7. Options and extras (19 rows across 6 dishes).
--    price_delta is money_minor, i.e. >= 0 — the domain forbids negative deltas.
--    A cheaper variant is therefore modelled by making the *base* price the cheap
--    one and charging for the larger option, never by a negative delta.
-- ---------------------------------------------------------------------------
INSERT INTO public.menu_item_options (
  id, restaurant_id, menu_item_id, group_key, group_label, selection_type,
  group_min_select, group_max_select, group_sort_order,
  name, price_delta, max_quantity, is_default, is_available, sort_order
)
SELECT
  v.id, 'a0000000-0000-4000-8000-000000000001'::uuid, v.menu_item_id, v.group_key,
  v.group_label::public.i18n_text, v.selection_type::public.option_selection_type,
  v.group_min_select, v.group_max_select, v.group_sort_order,
  v.name::public.i18n_text, v.price_delta, v.max_quantity, v.is_default, true, v.sort_order
FROM (VALUES

-- Toy oshi — extras
('f0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000001'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,3::smallint,0,
 '{"uz":"Qo''shimcha qo''y go''shti","ru":"Дополнительная баранина","en":"Extra lamb"}',12000::bigint,2::smallint,false,1),
('f0000000-0000-4000-8000-000000000002'::uuid,'e0000000-0000-4000-8000-000000000001'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,3::smallint,0,
 '{"uz":"Qazi","ru":"Казы","en":"Kazy (horse sausage)"}',18000::bigint,1::smallint,false,2),
('f0000000-0000-4000-8000-000000000003'::uuid,'e0000000-0000-4000-8000-000000000001'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,3::smallint,0,
 '{"uz":"Bedana tuxumi","ru":"Перепелиное яйцо","en":"Quail egg"}',6000::bigint,4::smallint,false,3),

-- Qo'y shashlik — extras
('f0000000-0000-4000-8000-000000000004'::uuid,'e0000000-0000-4000-8000-000000000003'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,3::smallint,0,
 '{"uz":"Achchiq sous","ru":"Острый соус","en":"Chilli sauce"}',3000::bigint,2::smallint,false,1),
('f0000000-0000-4000-8000-000000000005'::uuid,'e0000000-0000-4000-8000-000000000003'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,3::smallint,0,
 '{"uz":"Tandir non","ru":"Лепёшка из тандыра","en":"Tandoor bread"}',5000::bigint,3::smallint,false,2),
('f0000000-0000-4000-8000-000000000006'::uuid,'e0000000-0000-4000-8000-000000000003'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,3::smallint,0,
 '{"uz":"Piyoz salat","ru":"Луковый салат","en":"Onion salad"}',6000::bigint,1::smallint,false,3),

-- Qovurma lag'mon — spice (single, required)
('f0000000-0000-4000-8000-000000000007'::uuid,'e0000000-0000-4000-8000-000000000004'::uuid,'spice',
 '{"uz":"Achchiqligi","ru":"Острота","en":"Spice level"}','single',1::smallint,1::smallint,0,
 '{"uz":"Oddiy","ru":"Обычный","en":"Regular"}',0::bigint,1::smallint,true,1),
('f0000000-0000-4000-8000-000000000008'::uuid,'e0000000-0000-4000-8000-000000000004'::uuid,'spice',
 '{"uz":"Achchiqligi","ru":"Острота","en":"Spice level"}','single',1::smallint,1::smallint,0,
 '{"uz":"Achchiq","ru":"Острый","en":"Spicy"}',0::bigint,1::smallint,false,2),
('f0000000-0000-4000-8000-000000000009'::uuid,'e0000000-0000-4000-8000-000000000004'::uuid,'spice',
 '{"uz":"Achchiqligi","ru":"Острота","en":"Spice level"}','single',1::smallint,1::smallint,0,
 '{"uz":"Juda achchiq","ru":"Очень острый","en":"Extra spicy"}',0::bigint,1::smallint,false,3),

-- Chizburger — size (single, required) + extras (multiple)
('f0000000-0000-4000-8000-00000000000a'::uuid,'e0000000-0000-4000-8000-00000000000f'::uuid,'size',
 '{"uz":"Hajmi","ru":"Размер","en":"Size"}','single',1::smallint,1::smallint,0,
 '{"uz":"Oddiy","ru":"Обычный","en":"Single"}',0::bigint,1::smallint,true,1),
('f0000000-0000-4000-8000-00000000000b'::uuid,'e0000000-0000-4000-8000-00000000000f'::uuid,'size',
 '{"uz":"Hajmi","ru":"Размер","en":"Size"}','single',1::smallint,1::smallint,0,
 '{"uz":"Ikki kotletli","ru":"Двойной","en":"Double"}',18000::bigint,1::smallint,false,2),
('f0000000-0000-4000-8000-00000000000c'::uuid,'e0000000-0000-4000-8000-00000000000f'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,3::smallint,1,
 '{"uz":"Qo''shimcha pishloq","ru":"Дополнительный сыр","en":"Extra cheese"}',6000::bigint,2::smallint,false,1),
('f0000000-0000-4000-8000-00000000000d'::uuid,'e0000000-0000-4000-8000-00000000000f'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,3::smallint,1,
 '{"uz":"Qovurilgan piyoz","ru":"Жареный лук","en":"Fried onion"}',4000::bigint,1::smallint,false,2),
('f0000000-0000-4000-8000-00000000000e'::uuid,'e0000000-0000-4000-8000-00000000000f'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,3::smallint,1,
 '{"uz":"Jalapenyo","ru":"Халапеньо","en":"Jalapeño"}',4000::bigint,2::smallint,false,3),

-- Sezar salati — extras
('f0000000-0000-4000-8000-00000000000f'::uuid,'e0000000-0000-4000-8000-000000000017'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,2::smallint,0,
 '{"uz":"Qo''shimcha tovuq","ru":"Дополнительная курица","en":"Extra chicken"}',14000::bigint,2::smallint,false,1),
('f0000000-0000-4000-8000-000000000010'::uuid,'e0000000-0000-4000-8000-000000000017'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,2::smallint,0,
 '{"uz":"Parmezan","ru":"Пармезан","en":"Parmesan"}',8000::bigint,1::smallint,false,2),

-- Ko'k choy — pot size (single, required) + extras
('f0000000-0000-4000-8000-000000000011'::uuid,'e0000000-0000-4000-8000-00000000001a'::uuid,'size',
 '{"uz":"Choynak hajmi","ru":"Размер чайника","en":"Pot size"}','single',1::smallint,1::smallint,0,
 '{"uz":"Kichik choynak","ru":"Маленький чайник","en":"Small pot"}',0::bigint,1::smallint,true,1),
('f0000000-0000-4000-8000-000000000012'::uuid,'e0000000-0000-4000-8000-00000000001a'::uuid,'size',
 '{"uz":"Choynak hajmi","ru":"Размер чайника","en":"Pot size"}','single',1::smallint,1::smallint,0,
 '{"uz":"Katta choynak","ru":"Большой чайник","en":"Large pot"}',5000::bigint,1::smallint,false,2),
('f0000000-0000-4000-8000-000000000013'::uuid,'e0000000-0000-4000-8000-00000000001a'::uuid,'extras',
 '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}','multiple',0::smallint,1::smallint,1,
 '{"uz":"Limon","ru":"Лимон","en":"Lemon"}',2000::bigint,2::smallint,false,1)

) AS v(id, menu_item_id, group_key, group_label, selection_type, group_min_select,
       group_max_select, group_sort_order, name, price_delta, max_quantity, is_default, sort_order)
ON CONFLICT (id) DO UPDATE SET
  group_key = EXCLUDED.group_key, group_label = EXCLUDED.group_label,
  selection_type = EXCLUDED.selection_type, group_min_select = EXCLUDED.group_min_select,
  group_max_select = EXCLUDED.group_max_select, group_sort_order = EXCLUDED.group_sort_order,
  name = EXCLUDED.name, price_delta = EXCLUDED.price_delta, max_quantity = EXCLUDED.max_quantity,
  is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order, updated_at = now();

-- ---------------------------------------------------------------------------
-- 8. Promotions (2) — both restaurant-wide (branch_id NULL).
-- ---------------------------------------------------------------------------
INSERT INTO public.promotions (
  id, restaurant_id, branch_id, promo_type, title, description, badge_label,
  image_url, discount_bps, discount_amount, special_price,
  starts_at, ends_at, sort_order, is_active
) VALUES
('0a000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',NULL,'percentage',
 '{"uz":"Biznes-lanch — 15% chegirma","ru":"Бизнес-ланч — скидка 15%","en":"Business lunch — 15% off"}'::public.i18n_text,
 '{"uz":"Dushanbadan jumagacha, 12:00 dan 15:00 gacha butun menyuga 15% chegirma.","ru":"С понедельника по пятницу, с 12:00 до 15:00, скидка 15% на всё меню.","en":"Monday to Friday, 12:00–15:00, 15% off the whole menu."}'::public.i18n_text,
 '{"uz":"−15%","ru":"−15%","en":"−15%"}'::public.i18n_text,
 '/demo/promotions/biznes-lanch.webp',
 1500, NULL, NULL,
 date_trunc('day', now()) - interval '30 days', date_trunc('day', now()) + interval '90 days', 0, true),

('0a000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001',NULL,'special_price',
 '{"uz":"Chorshanba — osh kuni","ru":"Среда — день плова","en":"Wednesday is plov day"}'::public.i18n_text,
 '{"uz":"Har chorshanba kuni Toy oshi 35 000 so''m. Qozon 12:00 da ochiladi, osh tugaguncha.","ru":"Каждую среду плов «Той» за 35 000 сум. Казан открывается в 12:00 — пока плов не закончится.","en":"Every Wednesday, Toy Osh at 35 000 so''m. The cauldron opens at 12:00 and runs until the plov is gone."}'::public.i18n_text,
 '{"uz":"35 000 so''m","ru":"35 000 сум","en":"35 000 UZS"}'::public.i18n_text,
 '/demo/promotions/osh-kuni.webp',
 NULL, NULL, 35000,
 date_trunc('day', now()) - interval '7 days', date_trunc('day', now()) + interval '180 days', 1, true)
ON CONFLICT (id) DO UPDATE SET
  promo_type = EXCLUDED.promo_type, title = EXCLUDED.title, description = EXCLUDED.description,
  badge_label = EXCLUDED.badge_label, image_url = EXCLUDED.image_url,
  discount_bps = EXCLUDED.discount_bps, discount_amount = EXCLUDED.discount_amount,
  special_price = EXCLUDED.special_price, starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at, sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active, updated_at = now();

INSERT INTO public.promotion_items (id, restaurant_id, promotion_id, menu_item_id)
VALUES ('0b000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001')
ON CONFLICT (promotion_id, menu_item_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Four sample orders, one per interesting status, so the KDS, the waiter
--    console and the dashboard are not empty on first load.
--
--    Every order is inserted as 'pending' and then moved with UPDATEs, so
--    trg_orders_log_status_change writes a realistic order_status_history trail
--    instead of an order that appears from nowhere already completed.
--
--    Money check for each: total = subtotal - discount_total + service_fee,
--    service_fee = subtotal * 1000 / 10000 (10 %), exact integer division.
--    order_items.total is GENERATED and must not be inserted.
--    Distinct customer_session_id per order keeps trg_orders_rate_limit happy.
-- ---------------------------------------------------------------------------
INSERT INTO public.orders (
  id, restaurant_id, branch_id, table_id, order_type, channel, status,
  customer_session_id, customer_name, guest_count, customer_note, locale,
  currency, currency_decimals, subtotal, discount_total, service_fee, service_fee_bps, total,
  estimated_prep_minutes, placed_at
) VALUES
('0c000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-000000000002',
 'dine_in','qr','pending','0d000000-0000-4000-8000-000000000001','Jasur',4,'Osh yog''i kamroq bo''lsin','uz',
 'UZS',0,120000,0,12000,1000,132000,20, now() - interval '3 minutes'),
('0c000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-000000000003',
 'dine_in','qr','pending','0d000000-0000-4000-8000-000000000002','Olga',3,NULL,'ru',
 'UZS',0,128000,0,12800,1000,140800,18, now() - interval '14 minutes'),
('0c000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-000000000006',
 'dine_in','qr','pending','0d000000-0000-4000-8000-000000000003',NULL,6,'Bittasi juda achchiq bo''lsin','uz',
 'UZS',0,108000,0,10800,1000,118800,16, now() - interval '27 minutes'),
('0c000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-000000000008',
 'dine_in','qr','pending','0d000000-0000-4000-8000-000000000004','Nigora',2,NULL,'ru',
 'UZS',0,122000,0,12200,1000,134200,20, now() - interval '95 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.order_items (
  id, restaurant_id, order_id, menu_item_id, name_snapshot, description_snapshot,
  category_name_snapshot, image_url_snapshot, price_snapshot, spicy_level_snapshot,
  preparation_time_snapshot, dietary_tags_snapshot, quantity, options_total, note, sort_order
)
SELECT
  v.id, 'a0000000-0000-4000-8000-000000000001'::uuid, v.order_id, mi.id,
  mi.name, mi.description, mc.name, mi.image_url, mi.price, mi.spicy_level,
  mi.preparation_time, mi.dietary_tags, v.quantity, 0::bigint, v.note, v.sort_order
FROM (VALUES
  ('0e000000-0000-4000-8000-000000000001'::uuid,'0c000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000001'::uuid,2,NULL::text,1),
  ('0e000000-0000-4000-8000-000000000002'::uuid,'0c000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000015'::uuid,1,NULL::text,2),
  ('0e000000-0000-4000-8000-000000000003'::uuid,'0c000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-00000000001a'::uuid,2,NULL::text,3),
  ('0e000000-0000-4000-8000-000000000004'::uuid,'0c000000-0000-4000-8000-000000000002'::uuid,'e0000000-0000-4000-8000-000000000003'::uuid,3,'Хорошо прожарить',1),
  ('0e000000-0000-4000-8000-000000000005'::uuid,'0c000000-0000-4000-8000-000000000002'::uuid,'e0000000-0000-4000-8000-000000000015'::uuid,1,NULL::text,2),
  ('0e000000-0000-4000-8000-000000000006'::uuid,'0c000000-0000-4000-8000-000000000003'::uuid,'e0000000-0000-4000-8000-000000000004'::uuid,2,NULL::text,1),
  ('0e000000-0000-4000-8000-000000000007'::uuid,'0c000000-0000-4000-8000-000000000003'::uuid,'e0000000-0000-4000-8000-00000000001c'::uuid,2,NULL::text,2),
  ('0e000000-0000-4000-8000-000000000008'::uuid,'0c000000-0000-4000-8000-000000000004'::uuid,'e0000000-0000-4000-8000-00000000000e'::uuid,1,NULL::text,1),
  ('0e000000-0000-4000-8000-000000000009'::uuid,'0c000000-0000-4000-8000-000000000004'::uuid,'e0000000-0000-4000-8000-000000000016'::uuid,1,NULL::text,2),
  ('0e000000-0000-4000-8000-00000000000a'::uuid,'0c000000-0000-4000-8000-000000000004'::uuid,'e0000000-0000-4000-8000-00000000001b'::uuid,2,NULL::text,3)
) AS v(id, order_id, menu_item_id, quantity, note, sort_order)
JOIN public.menu_items    mi ON mi.id = v.menu_item_id
JOIN public.menu_categories mc ON mc.id = mi.category_id
ON CONFLICT (id) DO NOTHING;

-- Advance the three non-pending orders through legal transitions only.
UPDATE public.orders SET status = 'confirmed', confirmed_at = placed_at + interval '1 minute'
  WHERE id IN ('0c000000-0000-4000-8000-000000000002','0c000000-0000-4000-8000-000000000003','0c000000-0000-4000-8000-000000000004');
UPDATE public.orders SET status = 'preparing', preparing_at = placed_at + interval '3 minutes'
  WHERE id IN ('0c000000-0000-4000-8000-000000000002','0c000000-0000-4000-8000-000000000003','0c000000-0000-4000-8000-000000000004');
UPDATE public.orders SET status = 'ready', ready_at = placed_at + interval '16 minutes'
  WHERE id IN ('0c000000-0000-4000-8000-000000000003','0c000000-0000-4000-8000-000000000004');
UPDATE public.orders SET status = 'delivered', delivered_at = placed_at + interval '19 minutes'
  WHERE id = '0c000000-0000-4000-8000-000000000004';
UPDATE public.orders SET status = 'completed', completed_at = placed_at + interval '62 minutes'
  WHERE id = '0c000000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- 10. One open waiter call, so the waiter console has something to acknowledge.
-- ---------------------------------------------------------------------------
INSERT INTO public.waiter_calls (
  id, restaurant_id, branch_id, table_id, order_id, reason, status, note,
  customer_session_id, created_at
) VALUES (
  '0f000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-000000000004',
  NULL,'request_bill','pending','Naqd pulda to''laymiz',
  '0d000000-0000-4000-8000-000000000005', now() - interval '40 seconds'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

ANALYZE public.menu_items;
ANALYZE public.orders;
```

### 4.6 The demo fixture — TypeScript shape

`src/lib/demo/repository.ts` mirrors `src/lib/rpc/public.ts` (doc 05 §8), so the fixtures are
**database rows**, not view models: `snake_case`, minor-unit integers, raw `i18n_text` objects. The
mappers then run over them unchanged, which is the whole point — demo mode exercises the real
mapping code, not a parallel one.

```ts
// src/lib/demo/fixtures/types.ts
import type { I18nText, Locale } from '@/types/i18n';
import type { Money } from '@/lib/money';
import type {
  DietaryTag, OptionSelectionType, OrderChannel, OrderStatus, OrderType,
  PromotionType, StaffRole, WaiterCallReason, WaiterCallStatus,
} from '@/types/database';

/** ISO-8601 with offset, e.g. '2026-09-01T12:04:00+05:00'. Fixtures are absolute, never `now()`. */
export type IsoTimestamp = string;

export interface FixtureRestaurant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  cover_image_url: string | null;
  phone: string | null;
  email: string | null;
  welcome_message: I18nText | null;
  description: I18nText | null;
  default_locale: Locale;
  currency: string;
  currency_decimals: number;
  service_fee_bps: number;
  service_fee_enabled: boolean;
  is_active: boolean;
  is_demo: true;
}

export interface FixtureBranch {
  id: string;
  restaurant_id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  opening_hours: Record<string, { open: string; close: string }[]>;
  waiter_call_cooldown_seconds: number;
  order_min_interval_seconds: number;
  default_prep_minutes: number;
  late_order_threshold_minutes: number;
  is_active: boolean;
  is_accepting_orders: boolean;
}

export interface FixtureTable {
  id: string;
  restaurant_id: string;
  branch_id: string;
  number: string;
  name: string | null;
  zone: string | null;
  seats: number | null;
  sort_order: number;
  qr_token: string;
  is_active: boolean;
}

export interface FixtureCategory {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  name: I18nText;
  description: I18nText | null;
  image_url: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface FixtureMenuItem {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  category_id: string;
  name: I18nText;
  description: I18nText | null;
  ingredients: I18nText | null;
  /** Minor units. UZS → whole so'm. */
  price: Money;
  compare_at_price: Money | null;
  image_url: string | null;
  spicy_level: 0 | 1 | 2 | 3;
  preparation_time: number;
  calories: number | null;
  dietary_tags: DietaryTag[];
  is_available: boolean;
  /** Relative offset in hours from fixture load time, or null. Kept relative so the
   *  "back at" copy is always in the near future however old the checkout is. */
  unavailable_for_hours: number | null;
  is_featured: boolean;
  is_popular: boolean;
  popularity_score: number;
  sort_order: number;
}

export interface FixtureMenuItemOption {
  id: string;
  restaurant_id: string;
  menu_item_id: string;
  group_key: string;
  group_label: I18nText;
  selection_type: OptionSelectionType;
  group_min_select: number;
  group_max_select: number | null;
  group_sort_order: number;
  name: I18nText;
  price_delta: Money;
  max_quantity: number;
  is_default: boolean;
  is_available: boolean;
  sort_order: number;
}

export interface FixturePromotion {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  promo_type: PromotionType;
  title: I18nText;
  description: I18nText | null;
  badge_label: I18nText | null;
  image_url: string | null;
  discount_bps: number | null;
  discount_amount: Money | null;
  special_price: Money | null;
  menu_item_ids: string[];
  sort_order: number;
  is_active: boolean;
}

export interface FixtureOrderItem {
  id: string;
  menu_item_id: string;
  name_snapshot: I18nText;
  description_snapshot: I18nText | null;
  category_name_snapshot: I18nText | null;
  image_url_snapshot: string | null;
  price_snapshot: Money;
  spicy_level_snapshot: 0 | 1 | 2 | 3;
  preparation_time_snapshot: number;
  dietary_tags_snapshot: DietaryTag[];
  quantity: number;
  options_total: Money;
  note: string | null;
  sort_order: number;
}

export interface FixtureOrder {
  id: string;
  restaurant_id: string;
  branch_id: string;
  table_id: string;
  public_code: string;
  order_number: string;
  order_type: OrderType;
  channel: OrderChannel;
  status: OrderStatus;
  customer_name: string | null;
  guest_count: number | null;
  customer_note: string | null;
  locale: Locale;
  currency: string;
  currency_decimals: number;
  subtotal: Money;
  discount_total: Money;
  service_fee: Money;
  service_fee_bps: number;
  total: Money;
  estimated_prep_minutes: number;
  /** Minutes before load time. Keeps the KDS elapsed timers and the LATE flag alive forever. */
  placed_minutes_ago: number;
  items: FixtureOrderItem[];
}

export interface FixtureWaiterCall {
  id: string;
  restaurant_id: string;
  branch_id: string;
  table_id: string;
  reason: WaiterCallReason;
  status: WaiterCallStatus;
  note: string | null;
  created_seconds_ago: number;
}

export interface FixtureStaff {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  profile_id: string;
  role: StaffRole;
  display_name: string;
  full_name: string;
  email: string;
  employee_code: string;
  locale: Locale;
  permissions: Record<string, boolean>;
  is_active: boolean;
}

/** The whole fixture set, assembled by src/lib/demo/fixtures/index.ts. */
export interface DemoFixtures {
  restaurant: FixtureRestaurant;
  branches: FixtureBranch[];
  tables: FixtureTable[];
  categories: FixtureCategory[];
  menuItems: FixtureMenuItem[];
  menuItemOptions: FixtureMenuItemOption[];
  promotions: FixturePromotion[];
  orders: FixtureOrder[];
  waiterCalls: FixtureWaiterCall[];
  staff: FixtureStaff[];
}
```

```ts
// src/lib/demo/fixtures/index.ts
import restaurant from './restaurant.json';
import branches from './branches.json';
import tables from './tables.json';
import categories from './categories.json';
import menuItems from './menu-items.json';
import menuItemOptions from './menu-item-options.json';
import promotions from './promotions.json';
import orders from './orders.json';
import waiterCalls from './waiter-calls.json';
import staff from './staff.json';
import type { DemoFixtures } from './types';

/** Same `satisfies` discipline as the message catalogue: a mistyped fixture fails typecheck. */
export const FIXTURES = {
  restaurant, branches, tables, categories, menuItems,
  menuItemOptions, promotions, orders, waiterCalls, staff,
} satisfies DemoFixtures;
```

**Two deliberate differences from `seed.sql`, and only two:**

1. **Time is relative.** `unavailable_for_hours`, `placed_minutes_ago` and `created_seconds_ago`
   replace absolute timestamps, so a checkout six months old still shows a 3-minute-old ticket on
   the KDS and a 40-second-old waiter call. `repository.ts` converts them to absolute at read time.
2. **`promotion_items` is inlined** as `FixturePromotion.menu_item_ids`, because the fixture has no
   join engine.

Everything else — ids, tokens, prices, `i18n_text` objects, flags, sort orders — is byte-identical.

Two of the ten files in full, to fix the format beyond doubt:

```json
// src/lib/demo/fixtures/restaurant.json
{
  "id": "a0000000-0000-4000-8000-000000000001",
  "name": "Samarqand Osh Xonasi",
  "slug": "samarqand-osh-xonasi",
  "logo_url": "/demo/brand/logo.svg",
  "cover_image_url": "/demo/brand/cover.webp",
  "phone": "+998 71 200 45 45",
  "email": "salom@samarqandosh.uz",
  "welcome_message": {
    "uz": "Xush kelibsiz! Qozon oldidan uzoqlashmaymiz — osh o'tin olovida damlanadi.",
    "ru": "Добро пожаловать! Мы не отходим от казана — плов томится на дровах.",
    "en": "Welcome. We never leave the cauldron — the plov steams over a wood fire."
  },
  "description": {
    "uz": "1998-yildan beri Toshkentda. Har kuni ertalab bozordan olingan mahsulot, o'tin olovi va bitta qoida: osh sotib bo'lgandan keyin qaytadan damlanmaydi.",
    "ru": "В Ташкенте с 1998 года. Продукты с базара каждое утро, дровяной огонь и одно правило: когда плов закончился — новый в тот же день не готовим.",
    "en": "In Tashkent since 1998. Market-fresh every morning, a wood fire, and one rule: when the plov is gone, it is gone for the day."
  },
  "default_locale": "uz",
  "currency": "UZS",
  "currency_decimals": 0,
  "service_fee_bps": 1000,
  "service_fee_enabled": true,
  "is_active": true,
  "is_demo": true
}
```

```json
// src/lib/demo/fixtures/menu-items.json — first three of 37.
// The remaining 34 follow row-for-row from §4.4's VALUES list, in the same order,
// with the same ids. check-seed-parity.ts enumerates all 37 and fails on any gap.
[
  {
    "id": "e0000000-0000-4000-8000-000000000001",
    "restaurant_id": "a0000000-0000-4000-8000-000000000001",
    "branch_id": null,
    "category_id": "d0000000-0000-4000-8000-000000000001",
    "name": { "uz": "Toy oshi", "ru": "Плов «Той»", "en": "Toy Osh (Wedding Plov)" },
    "description": {
      "uz": "O'tin olovida damlangan Samarqand oshi: sarg'ish devzira guruch, qo'y go'shti, sariq sabzi va butun sarimsoq.",
      "ru": "Самаркандский плов на дровах: рис девзира, баранина, жёлтая морковь и целая головка чеснока.",
      "en": "Samarkand plov over a wood fire: devzira rice, lamb, yellow carrot and a whole head of garlic."
    },
    "ingredients": {
      "uz": "Devzira guruch, qo'y go'shti, sariq sabzi, piyoz, sarimsoq, zira, paxta moyi",
      "ru": "Рис девзира, баранина, жёлтая морковь, лук, чеснок, зира, хлопковое масло",
      "en": "Devzira rice, lamb, yellow carrot, onion, garlic, cumin, cottonseed oil"
    },
    "price": 45000,
    "compare_at_price": 52000,
    "image_url": "/demo/items/toy-oshi.webp",
    "spicy_level": 0,
    "preparation_time": 20,
    "calories": 720,
    "dietary_tags": ["halal"],
    "is_available": true,
    "unavailable_for_hours": null,
    "is_featured": true,
    "is_popular": true,
    "popularity_score": 980,
    "sort_order": 1
  },
  {
    "id": "e0000000-0000-4000-8000-000000000002",
    "restaurant_id": "a0000000-0000-4000-8000-000000000001",
    "branch_id": null,
    "category_id": "d0000000-0000-4000-8000-000000000001",
    "name": { "uz": "Tandir somsa", "ru": "Самса из тандыра", "en": "Tandoor Somsa" },
    "description": {
      "uz": "Tandirda pishirilgan qatlama somsa; ichida mayda to'g'ralgan mol go'shti va piyoz.",
      "ru": "Слоёная самса из тандыра с рубленой говядиной и луком.",
      "en": "Flaky tandoor-baked pastry filled with hand-chopped beef and onion."
    },
    "ingredients": {
      "uz": "Bug'doy uni, mol go'shti, piyoz, dumba yog'i, zira, qora sedana",
      "ru": "Пшеничная мука, говядина, лук, курдючный жир, зира, чёрный тмин",
      "en": "Wheat flour, beef, onion, tail fat, cumin, nigella seed"
    },
    "price": 15000,
    "compare_at_price": null,
    "image_url": "/demo/items/tandir-somsa.webp",
    "spicy_level": 0,
    "preparation_time": 8,
    "calories": 380,
    "dietary_tags": ["halal"],
    "is_available": true,
    "unavailable_for_hours": null,
    "is_featured": false,
    "is_popular": true,
    "popularity_score": 870,
    "sort_order": 2
  },
  {
    "id": "e0000000-0000-4000-8000-00000000000d",
    "restaurant_id": "a0000000-0000-4000-8000-000000000001",
    "branch_id": null,
    "category_id": "d0000000-0000-4000-8000-000000000002",
    "name": { "uz": "Beshbarmoq", "ru": "Бешбармак", "en": "Beshbarmak" },
    "description": {
      "uz": "Keng yoyilgan xamir ustida qaynatilgan qo'y go'shti va piyoz qaynatmasi.",
      "ru": "Отварная баранина с луковым бульоном на широких пластах теста.",
      "en": "Boiled lamb and onion broth over broad sheets of dough."
    },
    "ingredients": {
      "uz": "Xamir, qo'y go'shti, piyoz, qora murch, go'sht qaynatmasi",
      "ru": "Тесто, баранина, лук, чёрный перец, мясной отвар",
      "en": "Dough, lamb, onion, black pepper, meat stock"
    },
    "price": 58000,
    "compare_at_price": null,
    "image_url": "/demo/items/beshbarmoq.webp",
    "spicy_level": 0,
    "preparation_time": 30,
    "calories": 840,
    "dietary_tags": ["halal"],
    "is_available": false,
    "unavailable_for_hours": 24,
    "is_featured": false,
    "is_popular": false,
    "popularity_score": 180,
    "sort_order": 17
  }
]
```

### 4.7 `scripts/check-seed-parity.ts`

```ts
// scripts/check-seed-parity.ts — run by `npm run check:seed`, which `npm run check` calls.
//
// Reads supabase/seed.sql as text and src/lib/demo/fixtures/*.json as data, and asserts they
// describe the same restaurant. It does NOT need a database: every value it compares is a
// literal in the SQL, and the SQL is written (§4.2–4.5) in a shape a regex can read reliably —
// one VALUES row per record, ids first, no computed prices.
//
// Checks, in order, each with a message naming the offending id:
//   1. counts:      1 restaurant, 2 branches, 12 tables, 6 categories, 37 items,
//                   19 options, 2 promotions, 5 staff, 4 orders, 1 waiter call
//   2. id sets:     identical UUID sets per entity, both directions
//   3. qr_token:    identical per table id; all 12 unique; all match /^[A-Za-z0-9_-]{22,64}$/;
//                   table A-1's token === DEMO_TOKEN from src/lib/demo/demo-mode.ts
//   4. money:       price, compare_at_price, price_delta, subtotal, service_fee, total
//                   identical AND integral AND >= 0
//   5. i18n:        every i18n_text object deep-equal, and every one carries all three of
//                   uz/ru/en non-empty — the demo must never show a fallback
//   6. flags:       is_available, is_featured, is_popular, is_active, sort_order, spicy_level,
//                   preparation_time, dietary_tags (order-insensitive)
//   7. arithmetic:  for each order, service_fee === Math.floor(subtotal * bps / 10000)
//                   and total === subtotal - discount_total + service_fee
//   8. references:  every category_id, menu_item_id, table_id, branch_id resolves within the set
//
// Exit code 1 with a diff on any failure. No fixing, no writing — this script only reports.
export {};
```

Check 5 is stricter than the product's own rule on purpose. Real tenants may legitimately have a
partly-translated menu; the *demo* may not, because the language switcher is a headline feature and
a fallback in the demo reads as a bug.

---

## 5. Formatting helpers — files and signatures

### 5.1 The map

| File | Owner | Exports |
|---|---|---|
| `src/lib/money.ts` | doc 03 §5 | `Money`, `MONEY_MAX`, `BPS_DENOMINATOR`, `MoneyError`, `assertMoney`, `toMinor`, `fromMinor`, **`formatMoney`**, `sumMoney`, `multiplyMoney`, `applyBps` |
| `src/lib/i18n/format.ts` | **this doc** | `formatNumber`, `formatPercentFromBps`, `formatCompactNumber`, `formatList`, `formatFileSize` |
| `src/lib/i18n/plural.ts` | **this doc** | `PluralCategory`, `plural` |
| `src/lib/i18n/t.ts` | **this doc** | `t`, `tOrNull`, `hasLocale`, `missingLocales`, `toI18nText`, `withLocale`, `asI18nText` |
| `src/lib/utils/datetime.ts` | **this doc** (extends doc 03 §194's three) | `formatTime`, `formatDate`, `formatDateTime`, `formatWeekday`, `formatRelative`, `formatDuration`, `formatElapsed`, `formatCountdown`, `businessDateFor`, `minutesSince` |
| `src/lib/utils/text.ts` | **this doc** | `foldSearch`, `truncate`, `initials` |

Money is **not** re-implemented here. `formatMoney(amount, currency, decimals, locale)` from doc 03
§5.2 is the single money renderer, and it already handles the UZS-suffix/USD-prefix and per-locale
grouping. Everything below is what money formatting does *not* cover.

### 5.2 `src/lib/i18n/format.ts`

```ts
// src/lib/i18n/format.ts
import { BCP47, type Locale } from '@/types/i18n';

const numberCache = new Map<string, Intl.NumberFormat>();
const listCache = new Map<string, Intl.ListFormat>();

function cachedNumber(locale: Locale, key: string, init: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = `${locale}|${key}`;
  const hit = numberCache.get(cacheKey);
  if (hit) return hit;
  const created = new Intl.NumberFormat(BCP47[locale], init);
  numberCache.set(cacheKey, created);
  return created;
}

/**
 * Plain number with locale grouping. The default is 0 fraction digits because
 * every number this product shows a user — counts, minutes, so'm — is a whole one.
 *
 * formatNumber(45000, 'uz')            === '45 000'   (U+00A0 group separator)
 * formatNumber(45000, 'ru')            === '45 000'
 * formatNumber(45000, 'en')            === '45,000'
 * formatNumber(12.5, 'ru', { maximumFractionDigits: 1 }) === '12,5'
 */
export function formatNumber(
  value: number,
  locale: Locale,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  const min = options?.minimumFractionDigits ?? 0;
  const max = options?.maximumFractionDigits ?? Math.max(min, 0);
  return cachedNumber(locale, `n${min}-${max}`, {
    style: 'decimal',
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: true,
  }).format(value);
}

/**
 * Basis points as a human percentage. bps is the only percentage representation in the
 * system (public.bps, service_fee_bps, discount_bps), so this is the only converter.
 *
 * formatPercentFromBps(1000, 'uz') === '10%'
 * formatPercentFromBps(1000, 'ru') === '10 %'
 * formatPercentFromBps(1000, 'en') === '10%'
 * formatPercentFromBps(1250, 'en') === '12.5%'
 * formatPercentFromBps(1250, 'ru') === '12,5 %'
 */
export function formatPercentFromBps(bps: number, locale: Locale): string {
  if (!Number.isInteger(bps)) throw new TypeError(`bps must be an integer, got ${bps}`);
  return cachedNumber(locale, 'pct', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(bps / 10_000);
}

/**
 * Compact form for dashboard tiles where a full number would wrap.
 * NEVER used for money — a revenue figure is always exact.
 *
 * formatCompactNumber(1200, 'en')  === '1.2K'
 * formatCompactNumber(1200, 'ru')  === '1,2 тыс.'
 * formatCompactNumber(1200, 'uz')  === '1,2 ming'   (falls back to '1200' on partial ICU)
 */
export function formatCompactNumber(value: number, locale: Locale): string {
  try {
    return cachedNumber(locale, 'compact', {
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return formatNumber(value, locale);
  }
}

/**
 * "Osh, Somsa va Choy" / "Плов, самса и чай" / "Plov, somsa and tea".
 * Used for the KDS ticket summary and the "extras" line in the cart.
 *
 * type 'conjunction' → "va / и / and"; 'unit' → comma-separated, no conjunction.
 */
export function formatList(
  items: readonly string[],
  locale: Locale,
  type: 'conjunction' | 'unit' = 'conjunction',
): string {
  const cacheKey = `${locale}|${type}`;
  let formatter = listCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.ListFormat(BCP47[locale], { style: 'long', type });
    listCache.set(cacheKey, formatter);
  }
  return formatter.format(items);
}

/** Image-upload limits in the admin menu editor. Binary units, locale-formatted number. */
export function formatFileSize(bytes: number, locale: Locale): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${formatNumber(value, locale, { maximumFractionDigits: digits })} ${units[unit]}`;
}
```

### 5.3 `src/lib/utils/datetime.ts`

Every timestamp in the database is `TIMESTAMPTZ` in UTC. Every function here takes an **explicit
IANA time zone** — `branches.timezone`, threaded down from `TableContext` or the staff session.
There is no "local time" default, because the server's local time is UTC and a Tashkent diner
must never see it.

```ts
// src/lib/utils/datetime.ts
import { BCP47, type Locale } from '@/types/i18n';

export type Instant = Date | string | number;

function toDate(value: Instant): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid date: ${String(value)}`);
  return date;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: Locale, timeZone: string, key: string, opts: Intl.DateTimeFormatOptions) {
  const cacheKey = `${locale}|${timeZone}|${key}`;
  const hit = dtfCache.get(cacheKey);
  if (hit) return hit;
  const created = new Intl.DateTimeFormat(BCP47[locale], { ...opts, timeZone });
  dtfCache.set(cacheKey, created);
  return created;
}

/** '14:05' in all three locales — hour12 is forced off. Uzbekistan does not use AM/PM. */
export function formatTime(at: Instant, locale: Locale, timeZone: string): string {
  return dtf(locale, timeZone, 'time', { hour: '2-digit', minute: '2-digit', hour12: false })
    .format(toDate(at));
}

/** '1-sentabr, 2026' / '1 сентября 2026 г.' / '1 September 2026' */
export function formatDate(at: Instant, locale: Locale, timeZone: string): string {
  return dtf(locale, timeZone, 'date', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(toDate(at));
}

/** Date + time, one string, for order detail headers and CSV exports. */
export function formatDateTime(at: Instant, locale: Locale, timeZone: string): string {
  return dtf(locale, timeZone, 'datetime', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(toDate(at));
}

/** 'dushanba' / 'понедельник' / 'Monday'. Used by the opening-hours editor. */
export function formatWeekday(at: Instant, locale: Locale, timeZone: string): string {
  return dtf(locale, timeZone, 'weekday', { weekday: 'long' }).format(toDate(at));
}

const rtfCache = new Map<Locale, Intl.RelativeTimeFormat>();

/**
 * '3 daqiqa oldin' / '3 минуты назад' / '3 minutes ago'.
 * Uses Intl.RelativeTimeFormat, which handles Russian's few/many for us here — this is the
 * one place we do delegate, because the unit noun is CLDR data rather than our own copy.
 * Anything under 45 s renders as `common.justNow` by the caller, not here.
 */
export function formatRelative(at: Instant, locale: Locale, now: Instant = Date.now()): string {
  let formatter = rtfCache.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(BCP47[locale], { numeric: 'auto', style: 'long' });
    rtfCache.set(locale, formatter);
  }
  const deltaMs = toDate(at).getTime() - toDate(now).getTime();
  const table: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 1000], ['minute', 60_000], ['hour', 3_600_000],
    ['day', 86_400_000], ['month', 2_592_000_000], ['year', 31_536_000_000],
  ];
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  let divisor = 1000;
  for (const [candidateUnit, candidateDivisor] of table) {
    if (Math.abs(deltaMs) < candidateDivisor * 60 || candidateUnit === 'year') {
      unit = candidateUnit;
      divisor = candidateDivisor;
      break;
    }
  }
  return formatter.format(Math.round(deltaMs / divisor), unit);
}

/**
 * Fixed-width clock for the KDS and waiter timers: '04:12', '1:07:30'.
 * NOT localised and deliberately so — a cook reads a stopwatch, not a sentence, and a
 * fixed-width digit string does not reflow every second.
 */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Prose duration for guest-facing copy: '20 daqiqa' / '20 минут' / '20 minutes'.
 * Delegates to the caller's translator via `plurals.minutes` / `plurals.hours`; the
 * signature takes the two already-resolved strings so this module stays dictionary-free.
 */
export function formatDuration(
  minutes: number,
  render: { hours: (n: number) => string; minutes: (n: number) => string },
): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return render.minutes(m);
  if (m === 0) return render.hours(h);
  return `${render.hours(h)} ${render.minutes(m)}`;
}

/** 'Try again in 42 s' countdowns on rate-limited buttons. Seconds only, no localisation. */
export function formatCountdown(secondsRemaining: number): string {
  return String(Math.max(0, Math.ceil(secondsRemaining)));
}

/**
 * The branch-local calendar date of an instant, as 'YYYY-MM-DD'.
 * Mirrors what next_order_number() computes server-side for orders.business_date, so a
 * client-side "today" filter agrees with the database's idea of today.
 * en-CA is used purely because its long-standing output is exactly ISO 8601.
 */
export function businessDateFor(timeZone: string, at: Instant = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(toDate(at));
}

/** Whole minutes elapsed. Drives the KDS LATE flag against late_order_threshold_minutes. */
export function minutesSince(at: Instant, now: Instant = Date.now()): number {
  return Math.floor((toDate(now).getTime() - toDate(at).getTime()) / 60_000);
}
```

### 5.4 `src/lib/utils/text.ts`

```ts
// src/lib/utils/text.ts

/**
 * Normalise a string for search. Uzbek Latin writes o'/g' with any of five apostrophe
 * characters depending on keyboard; a diner typing "lagmon" must find "Lag'mon", and a
 * menu entered as "Lagʻmon" must match a query typed as "lag'mon".
 * Mirrored in SQL by the generated search_vector expression (§3.5).
 */
export function foldSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/['ʻʼ‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ellipsis truncation on a word boundary. Used by KDS ticket lines and admin tables. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** 'Rustam Karimov' → 'RK'. Avatar fallback; works for Cyrillic and Latin alike. */
export function initials(fullName: string | null | undefined): string {
  if (!fullName) return '';
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join('');
}
```

### 5.5 Per-locale formatting, at a glance

| Value | `uz` | `ru` | `en` | Helper |
|---|---|---|---|---|
| 45 000 UZS | `45 000 so'm` | `45 000 сўм` | `45,000 UZS` | `formatMoney` (doc 03) |
| 12.50 USD | `12,50 $` | `12,50 $` | `$12.50` | `formatMoney` |
| 45000 | `45 000` | `45 000` | `45,000` | `formatNumber` |
| 1000 bps | `10%` | `10 %` | `10%` | `formatPercentFromBps` |
| 1200 (compact) | `1,2 ming` | `1,2 тыс.` | `1.2K` | `formatCompactNumber` |
| 14:05 | `14:05` | `14:05` | `14:05` | `formatTime` |
| 1 Sep 2026 | `1-sentabr, 2026` | `1 сентября 2026 г.` | `1 September 2026` | `formatDate` |
| Monday | `dushanba` | `понедельник` | `Monday` | `formatWeekday` |
| 3 min ago | `3 daqiqa oldin` | `3 минуты назад` | `3 minutes ago` | `formatRelative` |
| 2 dishes | `2 ta taom` | `2 блюда` | `2 dishes` | `useT().n('plurals.dishes', 2)` |
| 5 dishes | `5 ta taom` | `5 блюд` | `5 dishes` | `useT().n('plurals.dishes', 5)` |
| 04:12 elapsed | `04:12` | `04:12` | `04:12` | `formatElapsed` (not localised) |

The two rows worth staring at are the plurals: Uzbek does not change the noun, Russian changes it
twice. Any implementation that reaches for `count === 1 ? singular : plural` produces "5 блюда",
which is wrong in a way every Russian speaker notices immediately.

---

## 6. Definition of done for this layer

1. `npm run typecheck` passes with `Dictionary` fully implemented and all three JSON files
   `satisfies Dictionary` — a deleted key anywhere fails the build.
2. `npm run test src/lib/i18n` passes: `messages.test.ts` (all 8 gates of §1.10), `plural.test.ts`,
   `t.test.ts`, `format.test.ts` (including the full-ICU `uz-UZ` month-name assertion).
3. `npm run check:seed` passes: `supabase/seed.sql` and `src/lib/demo/fixtures/*.json` agree on all
   8 checks of §4.7.
4. `npm run db:reset` applies `seed.sql` without error and, run twice in a row, produces byte-identical
   `SELECT count(*)` results for all ten seeded tables.
5. `SELECT count(*) FROM public.menu_items WHERE NOT (name ? 'uz' AND name ? 'ru' AND name ? 'en')`
   returns `0`. Same for `menu_categories.name`, `menu_item_options.name`, `promotions.title`.
6. `grep -rn "\.json'" src --include=*.ts --include=*.tsx | grep -v "src/messages\|src/lib/demo/fixtures"`
   returns nothing — no component reads a catalogue or a fixture directly.
7. `grep -rn "getDictionary\|getMessages" src/app | grep -v "src/app/layout.tsx"` returns nothing —
   the catalogue is resolved once, at the root.
8. `grep -rn "new Intl\." src | grep -v "src/lib/i18n/format.ts\|src/lib/money.ts\|src/lib/utils/datetime.ts"`
   returns nothing — every `Intl` construction is cached in one of the three helper modules.
9. Manual: `/t/DEMOxK9f3PqA7xLmZ2vRt6?lang=ru` renders the menu in Russian with Russian dish names,
   `?lang=en` in English, no query parameter in Uzbek; the switcher changes all three without a page
   reload and without emptying the cart.
10. Manual: the KDS shows the Uzbek dish name on order `0c000000-…0001` (placed with `locale = 'uz'`)
    even when the KDS operator's own UI is set to Russian, per §3.4.
