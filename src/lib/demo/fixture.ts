/**
 * The demo restaurant: "Samarqand Osh Xonasi", Tashkent.
 *
 * `git clone && npm install && npm run dev` with no `.env.local` must open a
 * complete, explorable Restaurant QR OS. This file is the content that makes
 * that true: two branches, twelve tables, six categories, thirty-seven dishes
 * in three languages, nineteen option rows, two promotions, four orders spread
 * across the interesting statuses, an open waiter call and five staff accounts.
 *
 * THREE RULES, and they are the whole design:
 *
 * 1. **Rows, not view models.** Every record below is shaped like the database
 *    row or the RPC payload it stands in for — `snake_case`, minor-unit
 *    integers, raw `i18n_text` objects. `demo-mode.ts` runs it through the SAME
 *    mappers the live path uses, so demo mode exercises the real mapping code
 *    instead of a parallel one that can rot.
 *
 * 2. **Time is relative.** `unavailable_for_hours`, `placed_minutes_ago` and
 *    `created_seconds_ago` replace absolute timestamps, so a checkout six months
 *    old still shows a three-minute-old ticket on the kitchen display and a
 *    forty-second-old waiter call. Absolute instants are computed at read time.
 *
 * 3. **All three locales, always.** Real tenants may legitimately run a
 *    partly-translated menu; the demo may not, because the language switcher is
 *    a headline feature and a fallback in the demo reads as a bug.
 *
 * This content mirrors `supabase/seed.sql` (doc 07 §4) row for row and id for
 * id, so a developer who does run Supabase locally sees the same restaurant,
 * the same prices and the same table numbers.
 *
 * Prices are UZS with `currency_decimals = 0`: `45000` is 45 000 so'm.
 */
import type { Money } from '@/lib/money'
import type {
  DietaryTag,
  OptionSelectionType,
  OrderChannel,
  OrderStatus,
  OrderType,
  PromotionType,
  StaffRole,
  WaiterCallReason,
  WaiterCallStatus,
} from '@/types/database'
import type { I18nText, Locale } from '@/types/i18n'

/* ================================================================== */
/* Shapes                                                              */
/* ================================================================== */

export interface FixtureRestaurant {
  id: string
  name: string
  slug: string
  logo_url: string | null
  cover_image_url: string | null
  phone: string | null
  email: string | null
  welcome_message: I18nText | null
  description: I18nText | null
  default_locale: Locale
  currency: string
  currency_decimals: number
  service_fee_bps: number
  service_fee_enabled: boolean
  is_active: boolean
  is_demo: true
}

export interface FixtureBranch {
  id: string
  restaurant_id: string
  name: string
  code: string
  address: string | null
  phone: string | null
  timezone: string
  waiter_call_cooldown_seconds: number
  waiter_call_expiry_minutes: number
  order_min_interval_seconds: number
  default_prep_minutes: number
  late_order_threshold_minutes: number
  service_fee_bps: number | null
  is_active: boolean
  is_accepting_orders: boolean
}

export interface FixtureTable {
  id: string
  restaurant_id: string
  branch_id: string
  number: string
  name: string | null
  zone: string | null
  seats: number | null
  sort_order: number
  qr_token: string
  is_active: boolean
}

export interface FixtureCategory {
  id: string
  restaurant_id: string
  branch_id: string | null
  name: I18nText
  description: I18nText | null
  image_url: string | null
  icon: string | null
  sort_order: number
  is_active: boolean
}

export interface FixtureMenuItem {
  id: string
  restaurant_id: string
  branch_id: string | null
  category_id: string
  name: I18nText
  description: I18nText
  ingredients: I18nText
  price: Money
  compare_at_price: Money | null
  image_url: string | null
  spicy_level: number
  preparation_time: number
  calories: number | null
  dietary_tags: DietaryTag[]
  is_available: boolean
  /** Hours from load time, kept relative so "back tomorrow" is always true. */
  unavailable_for_hours: number | null
  is_featured: boolean
  is_popular: boolean
  popularity_score: number
  sort_order: number
}

export interface FixtureMenuItemOption {
  id: string
  restaurant_id: string
  menu_item_id: string
  group_key: string
  group_label: I18nText
  selection_type: OptionSelectionType
  group_min_select: number
  group_max_select: number | null
  group_sort_order: number
  name: I18nText
  price_delta: Money
  max_quantity: number
  is_default: boolean
  is_available: boolean
  sort_order: number
}

export interface FixturePromotion {
  id: string
  restaurant_id: string
  branch_id: string | null
  promo_type: PromotionType
  title: I18nText
  description: I18nText
  badge_label: I18nText
  image_url: string | null
  discount_bps: number | null
  discount_amount: Money | null
  special_price: Money | null
  /** `promotion_items`, inlined: the fixture has no join engine. */
  menu_item_ids: string[]
  sort_order: number
  is_active: boolean
}

export interface FixtureOrderItem {
  id: string
  menu_item_id: string
  quantity: number
  note: string | null
  sort_order: number
}

export interface FixtureOrder {
  id: string
  restaurant_id: string
  branch_id: string
  table_id: string
  public_code: string
  order_number: string
  order_type: OrderType
  channel: OrderChannel
  status: OrderStatus
  customer_name: string | null
  guest_count: number | null
  customer_note: string | null
  locale: Locale
  estimated_prep_minutes: number
  /** Minutes before load time. Keeps the KDS timers and the LATE flag alive forever. */
  placed_minutes_ago: number
  items: FixtureOrderItem[]
}

export interface FixtureWaiterCall {
  id: string
  restaurant_id: string
  branch_id: string
  table_id: string
  order_id: string | null
  reason: WaiterCallReason
  status: WaiterCallStatus
  note: string | null
  created_seconds_ago: number
}

export interface FixtureStaff {
  id: string
  restaurant_id: string
  branch_id: string | null
  profile_id: string
  role: StaffRole
  display_name: string
  full_name: string
  email: string
  employee_code: string
  locale: Locale
  is_active: boolean
}

export interface DemoFixtures {
  restaurant: FixtureRestaurant
  branches: FixtureBranch[]
  tables: FixtureTable[]
  categories: FixtureCategory[]
  menuItems: FixtureMenuItem[]
  menuItemOptions: FixtureMenuItemOption[]
  promotions: FixturePromotion[]
  orders: FixtureOrder[]
  waiterCalls: FixtureWaiterCall[]
  staff: FixtureStaff[]
}

/* ================================================================== */
/* Ids — fixed, so the fixture and seed.sql can be diffed              */
/* ================================================================== */

const R = 'a0000000-0000-4000-8000-000000000001'
const BRANCH_A = 'b0000000-0000-4000-8000-00000000000a'
const BRANCH_B = 'b0000000-0000-4000-8000-00000000000b'

const CAT_POPULAR = 'd0000000-0000-4000-8000-000000000001'
const CAT_UZBEK = 'd0000000-0000-4000-8000-000000000002'
const CAT_FAST = 'd0000000-0000-4000-8000-000000000003'
const CAT_SALAD = 'd0000000-0000-4000-8000-000000000004'
const CAT_DRINK = 'd0000000-0000-4000-8000-000000000005'
const CAT_DESSERT = 'd0000000-0000-4000-8000-000000000006'

const item = (suffix: string) => `e0000000-0000-4000-8000-0000000000${suffix}`
const option = (suffix: string) => `f0000000-0000-4000-8000-0000000000${suffix}`
const table = (suffix: string) => `c0000000-0000-4000-8000-0000000000${suffix}`

/** The QR token printed on demo table A-1. Shaped exactly like a real token. */
export const DEMO_TOKEN = 'DEMOxK9f3PqA7xLmZ2vRt6'

/* ================================================================== */
/* 1. Restaurant                                                       */
/* ================================================================== */

const restaurant: FixtureRestaurant = {
  id: R,
  name: 'Samarqand Osh Xonasi',
  slug: 'samarqand-osh-xonasi',
  logo_url: '/demo/brand/logo.svg',
  cover_image_url: '/demo/brand/cover.webp',
  phone: '+998 71 200 45 45',
  email: 'salom@samarqandosh.uz',
  welcome_message: {
    uz: "Xush kelibsiz! Qozon oldidan uzoqlashmaymiz — osh o'tin olovida damlanadi.",
    ru: 'Добро пожаловать! Мы не отходим от казана — плов томится на дровах.',
    en: 'Welcome. We never leave the cauldron — the plov steams over a wood fire.',
  },
  description: {
    uz: "1998-yildan beri Toshkentda. Har kuni ertalab bozordan olingan mahsulot, o'tin olovi va bitta qoida: osh sotib bo'lgandan keyin qaytadan damlanmaydi.",
    ru: 'В Ташкенте с 1998 года. Продукты с базара каждое утро, дровяной огонь и одно правило: когда плов закончился — новый в тот же день не готовим.',
    en: 'In Tashkent since 1998. Market-fresh every morning, a wood fire, and one rule: when the plov is gone, it is gone for the day.',
  },
  default_locale: 'uz',
  currency: 'UZS',
  currency_decimals: 0,
  service_fee_bps: 1000,
  service_fee_enabled: true,
  is_active: true,
  is_demo: true,
}

/* ================================================================== */
/* 2. Branches                                                         */
/* ================================================================== */

const branches: FixtureBranch[] = [
  {
    id: BRANCH_A,
    restaurant_id: R,
    name: 'Chorsu',
    code: 'A',
    address: "Toshkent, Chorsu bozori yoni, Zarqaynar ko'chasi 12",
    phone: '+998 71 200 45 45',
    timezone: 'Asia/Tashkent',
    waiter_call_cooldown_seconds: 90,
    waiter_call_expiry_minutes: 30,
    order_min_interval_seconds: 20,
    default_prep_minutes: 18,
    late_order_threshold_minutes: 25,
    service_fee_bps: null,
    is_active: true,
    is_accepting_orders: true,
  },
  {
    id: BRANCH_B,
    restaurant_id: R,
    name: 'Yunusobod',
    code: 'B',
    address: "Toshkent, Yunusobod tumani, Amir Temur shoh ko'chasi 108",
    phone: '+998 71 200 45 46',
    timezone: 'Asia/Tashkent',
    waiter_call_cooldown_seconds: 120,
    waiter_call_expiry_minutes: 30,
    order_min_interval_seconds: 20,
    default_prep_minutes: 20,
    late_order_threshold_minutes: 30,
    service_fee_bps: null,
    is_active: true,
    is_accepting_orders: true,
  },
]

/* ================================================================== */
/* 3. Tables — table 7 is deliberately inactive, so brief §32's        */
/*    "this table is out of service" screen is reachable in the demo.  */
/* ================================================================== */

const tables: FixtureTable[] = [
  { id: table('01'), restaurant_id: R, branch_id: BRANCH_A, number: '1', name: null, zone: 'Zal', seats: 4, sort_order: 1, qr_token: DEMO_TOKEN, is_active: true },
  { id: table('02'), restaurant_id: R, branch_id: BRANCH_A, number: '2', name: null, zone: 'Zal', seats: 4, sort_order: 2, qr_token: 'Qm7Yt2Lp9Xd4Rk8Nv3Hs6Wc1', is_active: true },
  { id: table('03'), restaurant_id: R, branch_id: BRANCH_A, number: '3', name: null, zone: 'Zal', seats: 6, sort_order: 3, qr_token: 'Zf4Bn8Kq2Md7Ry5Tx9Jw3Ce6', is_active: true },
  { id: table('04'), restaurant_id: R, branch_id: BRANCH_A, number: '4', name: null, zone: 'Zal', seats: 6, sort_order: 4, qr_token: 'Hv6Sd1Gp4Nz8Aq3Xk7Fm2Ly9', is_active: true },
  { id: table('05'), restaurant_id: R, branch_id: BRANCH_A, number: '5', name: 'Deraza yonidagi stol', zone: 'Zal', seats: 2, sort_order: 5, qr_token: 'Tj3Wr9Vb5Ph2Ks8Nd6Qz4Xm1', is_active: true },
  { id: table('06'), restaurant_id: R, branch_id: BRANCH_A, number: '6', name: 'Katta ayvon', zone: 'Ayvon', seats: 10, sort_order: 6, qr_token: 'Lc8Md4Rt7Yn2Bq6Hx9Ws3Kv5', is_active: true },
  { id: table('07'), restaurant_id: R, branch_id: BRANCH_A, number: '7', name: 'Kichik ayvon', zone: 'Ayvon', seats: 6, sort_order: 7, qr_token: 'Nb2Qy7Fk3Lz9Cm5Rp8Td4Gh6', is_active: false },
  { id: table('08'), restaurant_id: R, branch_id: BRANCH_B, number: '1', name: null, zone: 'Zal', seats: 4, sort_order: 1, qr_token: 'Wp5Kn9Zt3Bd7Vq2Ly6Mx8Rc4', is_active: true },
  { id: table('09'), restaurant_id: R, branch_id: BRANCH_B, number: '2', name: null, zone: 'Zal', seats: 4, sort_order: 2, qr_token: 'Fd7Cs2Nq8Rw4Kx6Bt9Zm3Hp5', is_active: true },
  { id: table('0a'), restaurant_id: R, branch_id: BRANCH_B, number: '3', name: null, zone: 'Zal', seats: 6, sort_order: 3, qr_token: 'Gy4Vm8Ld2Tp6Nc9Rk5Xb7Qw3', is_active: true },
  { id: table('0b'), restaurant_id: R, branch_id: BRANCH_B, number: '4', name: 'VIP xona', zone: 'VIP', seats: 8, sort_order: 4, qr_token: 'Sx9Hb3Wm7Kd5Qt2Nf8Pv6Lz4', is_active: true },
  { id: table('0c'), restaurant_id: R, branch_id: BRANCH_B, number: '5', name: 'Terrasa', zone: 'Terrasa', seats: 4, sort_order: 5, qr_token: 'Rm6Zk2Xn9Cp4Vt7Bd3Hy5Ws8', is_active: true },
]

/* ================================================================== */
/* 4. Categories                                                       */
/* ================================================================== */

const categories: FixtureCategory[] = [
  {
    id: CAT_POPULAR, restaurant_id: R, branch_id: null,
    name: { uz: 'Ommabop', ru: 'Популярное', en: 'Popular' },
    description: {
      uz: "Mehmonlarimiz eng ko'p buyurtma qiladigan beshta taom.",
      ru: 'Пять блюд, которые гости заказывают чаще всего.',
      en: 'The five dishes our guests order most.',
    },
    image_url: '/demo/categories/popular.webp', icon: 'flame', sort_order: 0, is_active: true,
  },
  {
    id: CAT_UZBEK, restaurant_id: R, branch_id: null,
    name: { uz: 'Milliy taomlar', ru: 'Узбекская кухня', en: 'Uzbek Cuisine' },
    description: {
      uz: "Qozon, tandir va o'tin olovi. Buvilarimiz retseptlari bo'yicha.",
      ru: 'Казан, тандыр и дровяной огонь. По бабушкиным рецептам.',
      en: "Cauldron, tandoor and a wood fire. Our grandmothers' recipes.",
    },
    image_url: '/demo/categories/uzbek.webp', icon: 'soup', sort_order: 10, is_active: true,
  },
  {
    id: CAT_FAST, restaurant_id: R, branch_id: null,
    name: { uz: 'Fast Food', ru: 'Фастфуд', en: 'Fast Food' },
    description: {
      uz: "Tez, issiq va bolalarga ma'qul.",
      ru: 'Быстро, горячо и нравится детям.',
      en: 'Fast, hot, and a hit with children.',
    },
    image_url: '/demo/categories/fastfood.webp', icon: 'sandwich', sort_order: 20, is_active: true,
  },
  {
    id: CAT_SALAD, restaurant_id: R, branch_id: null,
    name: { uz: 'Salatlar', ru: 'Салаты', en: 'Salads' },
    description: {
      uz: 'Har kuni ertalab bozordan olingan sabzavotlar.',
      ru: 'Овощи с базара каждое утро.',
      en: 'Vegetables from the market every morning.',
    },
    image_url: '/demo/categories/salads.webp', icon: 'salad', sort_order: 30, is_active: true,
  },
  {
    id: CAT_DRINK, restaurant_id: R, branch_id: null,
    name: { uz: 'Ichimliklar', ru: 'Напитки', en: 'Drinks' },
    description: {
      uz: "Choynakda ko'k choy — osh yonida eng to'g'ri tanlov.",
      ru: 'Зелёный чай в чайнике — лучший выбор к плову.',
      en: 'Green tea in a pot — the right thing beside plov.',
    },
    image_url: '/demo/categories/drinks.webp', icon: 'cup-soda', sort_order: 40, is_active: true,
  },
  {
    id: CAT_DESSERT, restaurant_id: R, branch_id: null,
    name: { uz: 'Shirinliklar', ru: 'Десерты', en: 'Desserts' },
    description: {
      uz: "Choy ustidan — an'anaviy va zamonaviy shirinliklar.",
      ru: 'К чаю — традиционные и современные сладости.',
      en: 'For the tea — traditional and modern sweets.',
    },
    image_url: '/demo/categories/desserts.webp', icon: 'cake-slice', sort_order: 50, is_active: true,
  },
]

/* ================================================================== */
/* 5. Menu items (37)                                                  */
/* ================================================================== */

const ALL_FREE: DietaryTag[] = ['vegetarian', 'vegan', 'halal', 'gluten_free', 'lactose_free']
const HALAL: DietaryTag[] = ['halal']

const menuItems: FixtureMenuItem[] = [
  /* ---- Ommabop / Популярное / Popular ---- */
  {
    id: item('01'), restaurant_id: R, branch_id: null, category_id: CAT_POPULAR,
    name: { uz: 'Toy oshi', ru: 'Плов «Той»', en: 'Toy Osh (Wedding Plov)' },
    description: {
      uz: "O'tin olovida damlangan Samarqand oshi: sarg'ish devzira guruch, qo'y go'shti, sariq sabzi va butun sarimsoq.",
      ru: 'Самаркандский плов на дровах: рис девзира, баранина, жёлтая морковь и целая головка чеснока.',
      en: 'Samarkand plov over a wood fire: devzira rice, lamb, yellow carrot and a whole head of garlic.',
    },
    ingredients: {
      uz: "Devzira guruch, qo'y go'shti, sariq sabzi, piyoz, sarimsoq, zira, paxta moyi",
      ru: 'Рис девзира, баранина, жёлтая морковь, лук, чеснок, зира, хлопковое масло',
      en: 'Devzira rice, lamb, yellow carrot, onion, garlic, cumin, cottonseed oil',
    },
    price: 45000, compare_at_price: 52000, image_url: '/demo/items/toy-oshi.webp',
    spicy_level: 0, preparation_time: 20, calories: 720, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: true, is_popular: true, popularity_score: 980, sort_order: 1,
  },
  {
    id: item('02'), restaurant_id: R, branch_id: null, category_id: CAT_POPULAR,
    name: { uz: 'Tandir somsa', ru: 'Самса из тандыра', en: 'Tandoor Somsa' },
    description: {
      uz: "Tandirda pishirilgan qatlama somsa; ichida mayda to'g'ralgan mol go'shti va piyoz.",
      ru: 'Слоёная самса из тандыра с рубленой говядиной и луком.',
      en: 'Flaky tandoor-baked pastry filled with hand-chopped beef and onion.',
    },
    ingredients: {
      uz: "Bug'doy uni, mol go'shti, piyoz, dumba yog'i, zira, qora sedana",
      ru: 'Пшеничная мука, говядина, лук, курдючный жир, зира, чёрный тмин',
      en: 'Wheat flour, beef, onion, tail fat, cumin, nigella seed',
    },
    price: 15000, compare_at_price: null, image_url: '/demo/items/tandir-somsa.webp',
    spicy_level: 0, preparation_time: 8, calories: 380, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: true, popularity_score: 870, sort_order: 2,
  },
  {
    id: item('03'), restaurant_id: R, branch_id: null, category_id: CAT_POPULAR,
    name: { uz: "Qo'y shashlik", ru: 'Шашлык из баранины', en: 'Lamb Shashlik' },
    description: {
      uz: "Cho'g'da pishgan qo'y go'shti shashligi, piyoz va tandir non bilan.",
      ru: 'Шашлык из баранины на углях, с луком и лепёшкой из тандыра.',
      en: 'Lamb skewers over charcoal, served with sliced onion and tandoor bread.',
    },
    ingredients: {
      uz: "Qo'y go'shti, dumba, piyoz, achchiq qalampir, sirka, ziravorlar",
      ru: 'Баранина, курдюк, лук, острый перец, уксус, специи',
      en: 'Lamb, tail fat, onion, chilli, vinegar, spices',
    },
    price: 38000, compare_at_price: null, image_url: '/demo/items/qoy-shashlik.webp',
    spicy_level: 1, preparation_time: 18, calories: 540, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: true, is_popular: true, popularity_score: 810, sort_order: 3,
  },
  {
    id: item('04'), restaurant_id: R, branch_id: null, category_id: CAT_POPULAR,
    name: { uz: "Qovurma lag'mon", ru: 'Лагман жареный', en: 'Fried Lagman' },
    description: {
      uz: "Qo'lda cho'zilgan xamir, mol go'shti va sabzavotlar bilan qovurilgan.",
      ru: 'Домашняя тянутая лапша, обжаренная с говядиной и овощами.',
      en: 'Hand-pulled noodles stir-fried with beef and vegetables.',
    },
    ingredients: {
      uz: "Qo'lda cho'zilgan xamir, mol go'shti, bulg'or qalampir, pomidor, kartoshka, sarimsoq",
      ru: 'Тянутая лапша, говядина, болгарский перец, помидор, картофель, чеснок',
      en: 'Hand-pulled noodles, beef, bell pepper, tomato, potato, garlic',
    },
    price: 42000, compare_at_price: null, image_url: '/demo/items/qovurma-lagmon.webp',
    spicy_level: 1, preparation_time: 16, calories: 630, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: true, popularity_score: 760, sort_order: 4,
  },
  {
    id: item('05'), restaurant_id: R, branch_id: null, category_id: CAT_POPULAR,
    name: { uz: 'Manti', ru: 'Манты', en: 'Manti' },
    description: {
      uz: "Bug'da pishgan besh dona manti; qo'y go'shti va piyoz, qatiq bilan beriladi.",
      ru: 'Пять штук на пару: баранина с луком, подаём с катыком.',
      en: 'Five steamed dumplings of lamb and onion, served with katyk.',
    },
    ingredients: {
      uz: "Bug'doy uni, qo'y go'shti, piyoz, dumba yog'i, qora murch, qatiq",
      ru: 'Пшеничная мука, баранина, лук, курдючный жир, чёрный перец, катык',
      en: 'Wheat flour, lamb, onion, tail fat, black pepper, katyk',
    },
    price: 36000, compare_at_price: null, image_url: '/demo/items/manti.webp',
    spicy_level: 0, preparation_time: 25, calories: 590, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: true, popularity_score: 720, sort_order: 5,
  },

  /* ---- Milliy taomlar / Узбекская кухня / Uzbek Cuisine ---- */
  {
    id: item('06'), restaurant_id: R, branch_id: null, category_id: CAT_UZBEK,
    name: { uz: 'Chuchvara', ru: 'Чучвара', en: 'Chuchvara' },
    description: {
      uz: "Mayda pelmen sho'rvasi; suyakdan qaynatilgan bulyon va ko'katlar bilan.",
      ru: 'Суп с маленькими пельменями на костном бульоне и с зеленью.',
      en: 'Tiny dumplings in a bone broth, finished with herbs.',
    },
    ingredients: {
      uz: "Xamir, mol go'shti, piyoz, suyak bulyoni, kashnich, qalampir",
      ru: 'Тесто, говядина, лук, костный бульон, кинза, перец',
      en: 'Dough, beef, onion, bone broth, coriander, pepper',
    },
    price: 32000, compare_at_price: null, image_url: '/demo/items/chuchvara.webp',
    spicy_level: 0, preparation_time: 14, calories: 410, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 320, sort_order: 10,
  },
  {
    id: item('07'), restaurant_id: R, branch_id: null, category_id: CAT_UZBEK,
    name: { uz: 'Norin', ru: 'Нарын', en: 'Norin' },
    description: {
      uz: "Qo'lda kesilgan xamir va qaynatilgan qazi bilan sovuq taom — Toshkent klassikasi.",
      ru: 'Тонко нарезанная лапша с отварной казы — ташкентская классика, подаётся холодным.',
      en: 'Hand-cut noodles with boiled horse sausage — a Tashkent classic, served cool.',
    },
    ingredients: {
      uz: "Xamir, qazi, qo'y go'shti, piyoz, murch, go'sht qaynatmasi",
      ru: 'Тесто, казы, баранина, лук, перец, мясной отвар',
      en: 'Dough, kazy, lamb, onion, pepper, meat stock',
    },
    price: 44000, compare_at_price: null, image_url: '/demo/items/norin.webp',
    spicy_level: 0, preparation_time: 12, calories: 560, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: true, is_popular: false, popularity_score: 410, sort_order: 11,
  },
  {
    id: item('08'), restaurant_id: R, branch_id: null, category_id: CAT_UZBEK,
    name: { uz: 'Mastava', ru: 'Мастава', en: 'Mastava' },
    description: {
      uz: "Guruchli qo'y sho'rvasi; qatiq va ko'kat bilan.",
      ru: 'Рисовый суп на баранине, с катыком и зеленью.',
      en: 'Rice and lamb soup, served with katyk and herbs.',
    },
    ingredients: {
      uz: "Guruch, qo'y go'shti, sabzi, pomidor, kartoshka, qatiq, kashnich",
      ru: 'Рис, баранина, морковь, помидор, картофель, катык, кинза',
      en: 'Rice, lamb, carrot, tomato, potato, katyk, coriander',
    },
    price: 28000, compare_at_price: null, image_url: '/demo/items/mastava.webp',
    spicy_level: 0, preparation_time: 12, calories: 380, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 290, sort_order: 12,
  },
  {
    id: item('09'), restaurant_id: R, branch_id: null, category_id: CAT_UZBEK,
    name: { uz: "Qo'y sho'rva", ru: 'Шурпа из баранины', en: 'Lamb Shurpa' },
    description: {
      uz: "Uzoq qaynatilgan qo'y sho'rvasi: yirik kesilgan sabzavot va suyakli go'sht.",
      ru: 'Долго томлённая шурпа: крупно нарезанные овощи и мясо на кости.',
      en: 'Slow-simmered lamb broth with coarsely cut vegetables and meat on the bone.',
    },
    ingredients: {
      uz: "Suyakli qo'y go'shti, kartoshka, sabzi, piyoz, pomidor, no'xat, ko'kat",
      ru: 'Баранина на кости, картофель, морковь, лук, помидор, нут, зелень',
      en: 'Lamb on the bone, potato, carrot, onion, tomato, chickpeas, herbs',
    },
    price: 36000, compare_at_price: null, image_url: '/demo/items/qoy-shorva.webp',
    spicy_level: 0, preparation_time: 15, calories: 470, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 350, sort_order: 13,
  },
  {
    id: item('0a'), restaurant_id: R, branch_id: null, category_id: CAT_UZBEK,
    name: { uz: 'Dimlama', ru: 'Дымлама', en: 'Dimlama' },
    description: {
      uz: "Qozonda bug'da dimlangan go'sht va sabzavot qatlamlari.",
      ru: 'Мясо и овощи слоями, томлённые в казане под крышкой.',
      en: 'Meat and vegetables layered and steamed in a sealed cauldron.',
    },
    ingredients: {
      uz: "Mol go'shti, kartoshka, sabzi, piyoz, karam, bulg'or qalampir, pomidor",
      ru: 'Говядина, картофель, морковь, лук, капуста, болгарский перец, помидор',
      en: 'Beef, potato, carrot, onion, cabbage, bell pepper, tomato',
    },
    price: 48000, compare_at_price: null, image_url: '/demo/items/dimlama.webp',
    spicy_level: 0, preparation_time: 25, calories: 610, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 300, sort_order: 14,
  },
  {
    id: item('0b'), restaurant_id: R, branch_id: null, category_id: CAT_UZBEK,
    name: { uz: 'Qozon kabob', ru: 'Казан-кабоб', en: 'Kazan Kabob' },
    description: {
      uz: "Qozonda qovurilgan qo'y go'shti va kartoshka, piyoz salat bilan.",
      ru: 'Баранина с картофелем, обжаренные в казане, с луковым салатом.',
      en: 'Lamb and potato fried in the cauldron, with an onion salad.',
    },
    ingredients: {
      uz: "Qo'y go'shti, kartoshka, piyoz, zira, achchiq qalampir",
      ru: 'Баранина, картофель, лук, зира, острый перец',
      en: 'Lamb, potato, onion, cumin, chilli',
    },
    price: 54000, compare_at_price: null, image_url: '/demo/items/qozon-kabob.webp',
    spicy_level: 1, preparation_time: 22, calories: 780, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: true, is_popular: false, popularity_score: 460, sort_order: 15,
  },
  {
    id: item('0c'), restaurant_id: R, branch_id: null, category_id: CAT_UZBEK,
    name: { uz: 'Xonim', ru: 'Ханум', en: 'Khonim' },
    description: {
      uz: "Bug'da pishirilgan o'ram: yupqa xamir ichida go'sht va kartoshka.",
      ru: 'Паровой рулет: тонкое тесто с мясом и картофелем.',
      en: 'A steamed roll of thin dough filled with meat and potato.',
    },
    ingredients: {
      uz: "Xamir, mol go'shti, kartoshka, piyoz, sariyog', qatiq",
      ru: 'Тесто, говядина, картофель, лук, сливочное масло, катык',
      en: 'Dough, beef, potato, onion, butter, katyk',
    },
    price: 30000, compare_at_price: null, image_url: '/demo/items/xonim.webp',
    spicy_level: 0, preparation_time: 20, calories: 520, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 240, sort_order: 16,
  },
  {
    // Deliberately unavailable: brief §5 requires an out-of-stock dish to be
    // visible and visibly unavailable, and the demo must be able to show it.
    id: item('0d'), restaurant_id: R, branch_id: null, category_id: CAT_UZBEK,
    name: { uz: 'Beshbarmoq', ru: 'Бешбармак', en: 'Beshbarmak' },
    description: {
      uz: "Keng yoyilgan xamir ustida qaynatilgan qo'y go'shti va piyoz qaynatmasi.",
      ru: 'Отварная баранина с луковым бульоном на широких пластах теста.',
      en: 'Boiled lamb and onion broth over broad sheets of dough.',
    },
    ingredients: {
      uz: "Xamir, qo'y go'shti, piyoz, qora murch, go'sht qaynatmasi",
      ru: 'Тесто, баранина, лук, чёрный перец, мясной отвар',
      en: 'Dough, lamb, onion, black pepper, meat stock',
    },
    price: 58000, compare_at_price: null, image_url: '/demo/items/beshbarmoq.webp',
    spicy_level: 0, preparation_time: 30, calories: 840, dietary_tags: HALAL,
    is_available: false, unavailable_for_hours: 24,
    is_featured: false, is_popular: false, popularity_score: 180, sort_order: 17,
  },
  {
    id: item('0e'), restaurant_id: R, branch_id: null, category_id: CAT_UZBEK,
    name: { uz: "Tandir go'sht", ru: 'Мясо из тандыра', en: 'Tandoor Lamb' },
    description: {
      uz: "Tandirda sekin pishirilgan qo'y go'shti, 200 g; non va piyoz bilan.",
      ru: 'Баранина медленного запекания в тандыре, 200 г; с лепёшкой и луком.',
      en: 'Lamb slow-roasted in the tandoor, 200 g, with bread and onion.',
    },
    ingredients: {
      uz: "Qo'y go'shti, tuz, zira, qora murch, tandir non",
      ru: 'Баранина, соль, зира, чёрный перец, лепёшка',
      en: 'Lamb, salt, cumin, black pepper, tandoor bread',
    },
    price: 72000, compare_at_price: 85000, image_url: '/demo/items/tandir-gosht.webp',
    spicy_level: 0, preparation_time: 20, calories: 690, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: true, is_popular: false, popularity_score: 520, sort_order: 18,
  },

  /* ---- Fast Food ---- */
  {
    id: item('0f'), restaurant_id: R, branch_id: null, category_id: CAT_FAST,
    name: { uz: 'Chizburger', ru: 'Чизбургер', en: 'Cheeseburger' },
    description: {
      uz: "Mol go'shtidan kotlet, cheddar pishloq, marinadlangan bodring va uy sousi.",
      ru: 'Говяжья котлета, чеддер, маринованный огурец и домашний соус.',
      en: 'Beef patty, cheddar, pickles and our own sauce.',
    },
    ingredients: {
      uz: "Bulochka, mol go'shti, cheddar pishloq, bodring, pomidor, salat bargi, sous",
      ru: 'Булочка, говядина, чеддер, огурец, помидор, салат, соус',
      en: 'Bun, beef, cheddar, pickle, tomato, lettuce, sauce',
    },
    price: 42000, compare_at_price: null, image_url: '/demo/items/chizburger.webp',
    spicy_level: 0, preparation_time: 12, calories: 720, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: true, popularity_score: 540, sort_order: 20,
  },
  {
    id: item('10'), restaurant_id: R, branch_id: null, category_id: CAT_FAST,
    name: { uz: 'Klub sendvich', ru: 'Клаб-сэндвич', en: 'Club Sandwich' },
    description: {
      uz: 'Uch qavat tost: tovuq, tuxum, pomidor va salat bargi. Fri bilan.',
      ru: 'Трёхслойный тост: курица, яйцо, помидор и салат. С картофелем фри.',
      en: 'Three-layer toast with chicken, egg, tomato and lettuce. Served with fries.',
    },
    ingredients: {
      uz: 'Tost non, tovuq filesi, tuxum, pomidor, salat bargi, mayonez',
      ru: 'Тостовый хлеб, куриное филе, яйцо, помидор, салат, майонез',
      en: 'Toast bread, chicken breast, egg, tomato, lettuce, mayonnaise',
    },
    price: 38000, compare_at_price: null, image_url: '/demo/items/klub-sendvich.webp',
    spicy_level: 0, preparation_time: 12, calories: 640, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 280, sort_order: 21,
  },
  {
    id: item('11'), restaurant_id: R, branch_id: null, category_id: CAT_FAST,
    name: { uz: 'Tovuqli lavash', ru: 'Лаваш с курицей', en: 'Chicken Lavash' },
    description: {
      uz: 'Yupqa lavash ichida qovurilgan tovuq, fri va sarimsoqli sous.',
      ru: 'Тонкий лаваш с жареной курицей, картофелем фри и чесночным соусом.',
      en: 'Thin lavash wrapped around grilled chicken, fries and garlic sauce.',
    },
    ingredients: {
      uz: 'Lavash, tovuq filesi, kartoshka fri, bodring, pomidor, sarimsoqli sous',
      ru: 'Лаваш, куриное филе, картофель фри, огурец, помидор, чесночный соус',
      en: 'Lavash, chicken breast, fries, cucumber, tomato, garlic sauce',
    },
    price: 32000, compare_at_price: null, image_url: '/demo/items/tovuqli-lavash.webp',
    spicy_level: 1, preparation_time: 10, calories: 680, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: true, popularity_score: 610, sort_order: 22,
  },
  {
    id: item('12'), restaurant_id: R, branch_id: null, category_id: CAT_FAST,
    name: { uz: 'Hot-dog', ru: 'Хот-дог', en: 'Hot Dog' },
    description: {
      uz: "Issiq bulochka, mol go'shtli sosiska, ketchup va xantal.",
      ru: 'Тёплая булочка, говяжья сосиска, кетчуп и горчица.',
      en: 'Warm bun, beef sausage, ketchup and mustard.',
    },
    ingredients: {
      uz: "Bulochka, mol go'shtli sosiska, ketchup, xantal, marinadlangan bodring",
      ru: 'Булочка, говяжья сосиска, кетчуп, горчица, маринованный огурец',
      en: 'Bun, beef sausage, ketchup, mustard, pickle',
    },
    price: 22000, compare_at_price: null, image_url: '/demo/items/hot-dog.webp',
    spicy_level: 0, preparation_time: 6, calories: 430, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 210, sort_order: 23,
  },
  {
    id: item('13'), restaurant_id: R, branch_id: null, category_id: CAT_FAST,
    name: { uz: 'Fri kartoshka', ru: 'Картофель фри', en: 'French Fries' },
    description: {
      uz: 'Ikki marta qovurilgan kartoshka, dengiz tuzi bilan.',
      ru: 'Картофель двойной обжарки с морской солью.',
      en: 'Twice-fried potatoes with sea salt.',
    },
    ingredients: {
      uz: "Kartoshka, o'simlik moyi, dengiz tuzi",
      ru: 'Картофель, растительное масло, морская соль',
      en: 'Potato, vegetable oil, sea salt',
    },
    price: 18000, compare_at_price: null, image_url: '/demo/items/fri-kartoshka.webp',
    spicy_level: 0, preparation_time: 7, calories: 340,
    dietary_tags: ['vegetarian', 'vegan', 'halal'],
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 400, sort_order: 24,
  },
  {
    id: item('14'), restaurant_id: R, branch_id: null, category_id: CAT_FAST,
    name: { uz: 'Tovuq naggets', ru: 'Куриные наггетсы', en: 'Chicken Nuggets' },
    description: {
      uz: 'Oltita nagets, panirovkada; sous tanlovingiz bilan.',
      ru: 'Шесть наггетсов в панировке, с соусом на выбор.',
      en: 'Six breaded nuggets with a sauce of your choice.',
    },
    ingredients: {
      uz: "Tovuq filesi, bug'doy uni, ziravorlar, o'simlik moyi",
      ru: 'Куриное филе, пшеничная мука, специи, растительное масло',
      en: 'Chicken breast, wheat flour, spices, vegetable oil',
    },
    price: 26000, compare_at_price: null, image_url: '/demo/items/tovuq-naggets.webp',
    spicy_level: 0, preparation_time: 9, calories: 460, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 260, sort_order: 25,
  },

  /* ---- Salatlar / Салаты / Salads ---- */
  {
    id: item('15'), restaurant_id: R, branch_id: null, category_id: CAT_SALAD,
    name: { uz: 'Achichuk', ru: 'Ачик-чучук', en: 'Achichuk' },
    description: {
      uz: "Yupqa to'g'ralgan pomidor va piyoz, achchiq qalampir bilan. Oshning eng to'g'ri jufti.",
      ru: 'Тонко нарезанные помидоры и лук с острым перцем. Лучшая пара к плову.',
      en: 'Thinly sliced tomato and onion with chilli. The right partner for plov.',
    },
    ingredients: {
      uz: 'Pomidor, piyoz, achchiq qalampir, rayhon, tuz',
      ru: 'Помидоры, лук, острый перец, базилик, соль',
      en: 'Tomato, onion, chilli, basil, salt',
    },
    price: 14000, compare_at_price: null, image_url: '/demo/items/achichuk.webp',
    spicy_level: 2, preparation_time: 5, calories: 90, dietary_tags: ALL_FREE,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: true, popularity_score: 640, sort_order: 30,
  },
  {
    id: item('16'), restaurant_id: R, branch_id: null, category_id: CAT_SALAD,
    name: { uz: 'Toshkent salati', ru: 'Ташкентский салат', en: 'Tashkent Salad' },
    description: {
      uz: 'Qaynatilgan mol tili, turp va piyoz; qaymoq sousi va qovurilgan piyoz bilan.',
      ru: 'Отварной говяжий язык, редька и лук; сметанный соус и жареный лук.',
      en: 'Boiled beef tongue, radish and onion in a sour-cream dressing, topped with fried onion.',
    },
    ingredients: {
      uz: "Mol tili, ko'k turp, piyoz, qaymoq, tuxum, ko'kat",
      ru: 'Говяжий язык, зелёная редька, лук, сметана, яйцо, зелень',
      en: 'Beef tongue, green radish, onion, sour cream, egg, herbs',
    },
    price: 34000, compare_at_price: null, image_url: '/demo/items/toshkent-salati.webp',
    spicy_level: 0, preparation_time: 10, calories: 320, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: true, is_popular: false, popularity_score: 330, sort_order: 31,
  },
  {
    id: item('17'), restaurant_id: R, branch_id: null, category_id: CAT_SALAD,
    name: { uz: 'Sezar salati', ru: 'Салат «Цезарь»', en: 'Caesar Salad' },
    description: {
      uz: 'Romen salat, grilda pishirilgan tovuq, parmezan va krutonlar.',
      ru: 'Салат романо, курица на гриле, пармезан и сухарики.',
      en: 'Romaine, grilled chicken, parmesan and croutons.',
    },
    ingredients: {
      uz: 'Romen salat, tovuq filesi, parmezan, kruton, sezar sousi, tuxum',
      ru: 'Романо, куриное филе, пармезан, сухарики, соус цезарь, яйцо',
      en: 'Romaine, chicken breast, parmesan, croutons, Caesar dressing, egg',
    },
    price: 39000, compare_at_price: null, image_url: '/demo/items/sezar-salati.webp',
    spicy_level: 0, preparation_time: 10, calories: 420, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 350, sort_order: 32,
  },
  {
    id: item('18'), restaurant_id: R, branch_id: null, category_id: CAT_SALAD,
    name: { uz: 'Vinegret', ru: 'Винегрет', en: 'Vinaigrette Salad' },
    description: {
      uz: "Lavlagi, kartoshka, sabzi va tuzlangan bodring; o'simlik moyi bilan.",
      ru: 'Свёкла, картофель, морковь и солёный огурец с растительным маслом.',
      en: 'Beetroot, potato, carrot and pickled cucumber with vegetable oil.',
    },
    ingredients: {
      uz: "Lavlagi, kartoshka, sabzi, tuzlangan bodring, piyoz, no'xat, o'simlik moyi",
      ru: 'Свёкла, картофель, морковь, солёный огурец, лук, горошек, растительное масло',
      en: 'Beetroot, potato, carrot, pickled cucumber, onion, peas, vegetable oil',
    },
    price: 18000, compare_at_price: null, image_url: '/demo/items/vinegret.webp',
    spicy_level: 0, preparation_time: 6, calories: 210, dietary_tags: ALL_FREE,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 180, sort_order: 33,
  },
  {
    id: item('19'), restaurant_id: R, branch_id: null, category_id: CAT_SALAD,
    name: { uz: 'Olivye', ru: 'Оливье', en: 'Olivier Salad' },
    description: {
      uz: "Kartoshka, tuxum, mol go'shti va no'xat; mayonez bilan.",
      ru: 'Картофель, яйцо, говядина и горошек под майонезом.',
      en: 'Potato, egg, beef and peas in mayonnaise.',
    },
    ingredients: {
      uz: "Kartoshka, tuxum, mol go'shti, no'xat, tuzlangan bodring, mayonez",
      ru: 'Картофель, яйцо, говядина, горошек, солёный огурец, майонез',
      en: 'Potato, egg, beef, peas, pickled cucumber, mayonnaise',
    },
    price: 26000, compare_at_price: null, image_url: '/demo/items/olivye.webp',
    spicy_level: 0, preparation_time: 8, calories: 380, dietary_tags: HALAL,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 250, sort_order: 34,
  },

  /* ---- Ichimliklar / Напитки / Drinks ---- */
  {
    id: item('1a'), restaurant_id: R, branch_id: null, category_id: CAT_DRINK,
    name: { uz: "Ko'k choy", ru: 'Зелёный чай', en: 'Green Tea' },
    description: {
      uz: 'Choynakda damlangan ko\'k choy. Osh yonida albatta.',
      ru: 'Зелёный чай, заваренный в чайнике. К плову — обязательно.',
      en: 'Green tea brewed in a pot. Non-negotiable beside plov.',
    },
    ingredients: {
      uz: "Ko'k choy bargi, qaynoq suv",
      ru: 'Листовой зелёный чай, кипяток',
      en: 'Loose green tea, boiling water',
    },
    price: 8000, compare_at_price: null, image_url: '/demo/items/kok-choy.webp',
    spicy_level: 0, preparation_time: 4, calories: 0, dietary_tags: ALL_FREE,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: true, popularity_score: 900, sort_order: 40,
  },
  {
    id: item('1b'), restaurant_id: R, branch_id: null, category_id: CAT_DRINK,
    name: { uz: 'Qora choy', ru: 'Чёрный чай', en: 'Black Tea' },
    description: {
      uz: 'Choynakda damlangan qora choy, limon bilan.',
      ru: 'Чёрный чай в чайнике, с лимоном.',
      en: 'Black tea in a pot, with lemon.',
    },
    ingredients: {
      uz: 'Qora choy bargi, limon, qaynoq suv',
      ru: 'Листовой чёрный чай, лимон, кипяток',
      en: 'Loose black tea, lemon, boiling water',
    },
    price: 8000, compare_at_price: null, image_url: '/demo/items/qora-choy.webp',
    spicy_level: 0, preparation_time: 4, calories: 0, dietary_tags: ALL_FREE,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 480, sort_order: 41,
  },
  {
    id: item('1c'), restaurant_id: R, branch_id: null, category_id: CAT_DRINK,
    name: { uz: 'Ayron', ru: 'Айран', en: 'Ayran' },
    description: {
      uz: 'Sovuq tuzli qatiq ichimligi.',
      ru: 'Холодный солёный кисломолочный напиток.',
      en: 'Chilled salted yoghurt drink.',
    },
    ingredients: {
      uz: 'Qatiq, suv, tuz, yalpiz',
      ru: 'Катык, вода, соль, мята',
      en: 'Katyk, water, salt, mint',
    },
    price: 12000, compare_at_price: null, image_url: '/demo/items/ayron.webp',
    spicy_level: 0, preparation_time: 3, calories: 90,
    dietary_tags: ['vegetarian', 'halal', 'gluten_free'],
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 330, sort_order: 42,
  },
  {
    id: item('1d'), restaurant_id: R, branch_id: null, category_id: CAT_DRINK,
    name: { uz: "O'rik kompoti", ru: 'Компот из урюка', en: 'Apricot Compote' },
    description: {
      uz: "Quritilgan o'rikdan qaynatilgan sovuq kompot.",
      ru: 'Холодный компот из сушёного урюка.',
      en: 'Chilled compote of dried apricots.',
    },
    ingredients: {
      uz: "Quritilgan o'rik, suv, shakar",
      ru: 'Сушёный урюк, вода, сахар',
      en: 'Dried apricots, water, sugar',
    },
    price: 10000, compare_at_price: null, image_url: '/demo/items/orik-kompoti.webp',
    spicy_level: 0, preparation_time: 3, calories: 120, dietary_tags: ALL_FREE,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 290, sort_order: 43,
  },
  {
    id: item('1e'), restaurant_id: R, branch_id: null, category_id: CAT_DRINK,
    name: { uz: 'Coca-Cola 0,5 l', ru: 'Coca-Cola 0,5 л', en: 'Coca-Cola 0.5 l' },
    description: {
      uz: 'Sovutilgan gazlangan ichimlik, 0,5 l.',
      ru: 'Охлаждённый газированный напиток, 0,5 л.',
      en: 'Chilled soft drink, 0.5 l.',
    },
    ingredients: {
      uz: "Gazlangan suv, shakar, karamel bo'yog'i, kofein",
      ru: 'Газированная вода, сахар, карамельный колер, кофеин',
      en: 'Carbonated water, sugar, caramel colour, caffeine',
    },
    price: 12000, compare_at_price: null, image_url: '/demo/items/coca-cola.webp',
    spicy_level: 0, preparation_time: 1, calories: 210, dietary_tags: ALL_FREE,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 420, sort_order: 44,
  },
  {
    id: item('1f'), restaurant_id: R, branch_id: null, category_id: CAT_DRINK,
    name: { uz: 'Mineral suv 0,5 l', ru: 'Минеральная вода 0,5 л', en: 'Mineral Water 0.5 l' },
    description: {
      uz: 'Gazsiz tabiiy mineral suv.',
      ru: 'Негазированная природная минеральная вода.',
      en: 'Still natural mineral water.',
    },
    ingredients: {
      uz: 'Tabiiy mineral suv',
      ru: 'Природная минеральная вода',
      en: 'Natural mineral water',
    },
    price: 7000, compare_at_price: null, image_url: '/demo/items/mineral-suv.webp',
    spicy_level: 0, preparation_time: 1, calories: 0, dietary_tags: ALL_FREE,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 510, sort_order: 45,
  },
  {
    id: item('20'), restaurant_id: R, branch_id: null, category_id: CAT_DRINK,
    name: { uz: 'Espresso', ru: 'Эспрессо', en: 'Espresso' },
    description: {
      uz: 'Ikki porsiya arabika, 30 ml.',
      ru: 'Двойная порция арабики, 30 мл.',
      en: 'A double shot of arabica, 30 ml.',
    },
    ingredients: {
      uz: 'Arabika qahvasi, suv',
      ru: 'Кофе арабика, вода',
      en: 'Arabica coffee, water',
    },
    price: 18000, compare_at_price: null, image_url: '/demo/items/espresso.webp',
    spicy_level: 0, preparation_time: 3, calories: 5, dietary_tags: ALL_FREE,
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 200, sort_order: 46,
  },

  /* ---- Shirinliklar / Десерты / Desserts ---- */
  {
    id: item('21'), restaurant_id: R, branch_id: null, category_id: CAT_DESSERT,
    name: { uz: 'Chak-chak', ru: 'Чак-чак', en: 'Chak-Chak' },
    description: {
      uz: "Asal sirtiga botirilgan mayda xamir bo'laklari.",
      ru: 'Кусочки теста в медовой глазури.',
      en: 'Fried dough pieces glazed in honey.',
    },
    ingredients: {
      uz: "Bug'doy uni, tuxum, asal, shakar, o'simlik moyi",
      ru: 'Пшеничная мука, яйца, мёд, сахар, растительное масло',
      en: 'Wheat flour, eggs, honey, sugar, vegetable oil',
    },
    price: 22000, compare_at_price: null, image_url: '/demo/items/chak-chak.webp',
    spicy_level: 0, preparation_time: 5, calories: 480,
    dietary_tags: ['vegetarian', 'halal'],
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: true, popularity_score: 430, sort_order: 50,
  },
  {
    id: item('22'), restaurant_id: R, branch_id: null, category_id: CAT_DESSERT,
    name: { uz: 'Tahinli holva', ru: 'Халва тахинная', en: 'Tahini Halva' },
    description: {
      uz: "Kunjutdan tayyorlangan an'anaviy holva.",
      ru: 'Традиционная халва из кунжута.',
      en: 'Traditional sesame halva.',
    },
    ingredients: {
      uz: 'Kunjut, shakar, glyukoza siropi, pista',
      ru: 'Кунжут, сахар, глюкозный сироп, фисташки',
      en: 'Sesame, sugar, glucose syrup, pistachio',
    },
    price: 20000, compare_at_price: null, image_url: '/demo/items/tahinli-holva.webp',
    spicy_level: 0, preparation_time: 3, calories: 520,
    dietary_tags: ['vegetarian', 'vegan', 'halal', 'gluten_free', 'lactose_free', 'contains_nuts'],
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 190, sort_order: 51,
  },
  {
    id: item('23'), restaurant_id: R, branch_id: null, category_id: CAT_DESSERT,
    name: { uz: 'Parvarda', ru: 'Парварда', en: 'Parvarda' },
    description: {
      uz: "Un sepilgan an'anaviy karamel konfeti.",
      ru: 'Традиционная карамель в мучной обсыпке.',
      en: 'Traditional flour-dusted caramel sweets.',
    },
    ingredients: {
      uz: "Shakar, bug'doy uni, limon kislotasi",
      ru: 'Сахар, пшеничная мука, лимонная кислота',
      en: 'Sugar, wheat flour, citric acid',
    },
    price: 12000, compare_at_price: null, image_url: '/demo/items/parvarda.webp',
    spicy_level: 0, preparation_time: 2, calories: 390,
    dietary_tags: ['vegetarian', 'vegan', 'halal', 'lactose_free'],
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 150, sort_order: 52,
  },
  {
    id: item('24'), restaurant_id: R, branch_id: null, category_id: CAT_DESSERT,
    name: { uz: 'Medovik', ru: 'Медовик', en: 'Honey Cake' },
    description: {
      uz: "Ko'p qavatli asalli tort, qaymoqli krem bilan.",
      ru: 'Многослойный медовый торт со сметанным кремом.',
      en: 'Layered honey cake with sour-cream frosting.',
    },
    ingredients: {
      uz: "Bug'doy uni, asal, tuxum, qaymoq, shakar, sariyog'",
      ru: 'Пшеничная мука, мёд, яйца, сметана, сахар, сливочное масло',
      en: 'Wheat flour, honey, eggs, sour cream, sugar, butter',
    },
    price: 28000, compare_at_price: null, image_url: '/demo/items/medovik.webp',
    spicy_level: 0, preparation_time: 3, calories: 450,
    dietary_tags: ['vegetarian', 'halal'],
    is_available: true, unavailable_for_hours: null,
    is_featured: true, is_popular: false, popularity_score: 380, sort_order: 53,
  },
  {
    id: item('25'), restaurant_id: R, branch_id: null, category_id: CAT_DESSERT,
    name: { uz: 'Pistali muzqaymoq', ru: 'Фисташковое мороженое', en: 'Pistachio Ice Cream' },
    description: {
      uz: 'Uyda tayyorlangan pista muzqaymoqi, ikki shar.',
      ru: 'Домашнее фисташковое мороженое, два шарика.',
      en: 'House-made pistachio ice cream, two scoops.',
    },
    ingredients: {
      uz: "Sut, qaymoq, pista, shakar, tuxum sarig'i",
      ru: 'Молоко, сливки, фисташки, сахар, яичный желток',
      en: 'Milk, cream, pistachio, sugar, egg yolk',
    },
    price: 24000, compare_at_price: null, image_url: '/demo/items/pistali-muzqaymoq.webp',
    spicy_level: 0, preparation_time: 3, calories: 340,
    dietary_tags: ['vegetarian', 'halal', 'gluten_free', 'contains_nuts'],
    is_available: true, unavailable_for_hours: null,
    is_featured: false, is_popular: false, popularity_score: 300, sort_order: 54,
  },
]

/* ================================================================== */
/* 6. Options (19 rows across 6 dishes)                                */
/*    price_delta is never negative: the domain forbids it, so a       */
/*    cheaper variant is the BASE price and the larger one is the      */
/*    option that costs money.                                         */
/* ================================================================== */

const EXTRAS: I18nText = { uz: "Qo'shimchalar", ru: 'Добавки', en: 'Extras' }
const SIZE: I18nText = { uz: 'Hajmi', ru: 'Размер', en: 'Size' }
const SPICE: I18nText = { uz: 'Achchiqligi', ru: 'Острота', en: 'Spice level' }
const POT: I18nText = { uz: 'Choynak hajmi', ru: 'Размер чайника', en: 'Pot size' }

const menuItemOptions: FixtureMenuItemOption[] = [
  // Toy oshi — extras
  { id: option('01'), restaurant_id: R, menu_item_id: item('01'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 3, group_sort_order: 0, name: { uz: "Qo'shimcha qo'y go'shti", ru: 'Дополнительная баранина', en: 'Extra lamb' }, price_delta: 12000, max_quantity: 2, is_default: false, is_available: true, sort_order: 1 },
  { id: option('02'), restaurant_id: R, menu_item_id: item('01'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 3, group_sort_order: 0, name: { uz: 'Qazi', ru: 'Казы', en: 'Kazy (horse sausage)' }, price_delta: 18000, max_quantity: 1, is_default: false, is_available: true, sort_order: 2 },
  { id: option('03'), restaurant_id: R, menu_item_id: item('01'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 3, group_sort_order: 0, name: { uz: 'Bedana tuxumi', ru: 'Перепелиное яйцо', en: 'Quail egg' }, price_delta: 6000, max_quantity: 4, is_default: false, is_available: true, sort_order: 3 },

  // Qo'y shashlik — extras
  { id: option('04'), restaurant_id: R, menu_item_id: item('03'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 3, group_sort_order: 0, name: { uz: 'Achchiq sous', ru: 'Острый соус', en: 'Chilli sauce' }, price_delta: 3000, max_quantity: 2, is_default: false, is_available: true, sort_order: 1 },
  { id: option('05'), restaurant_id: R, menu_item_id: item('03'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 3, group_sort_order: 0, name: { uz: 'Tandir non', ru: 'Лепёшка из тандыра', en: 'Tandoor bread' }, price_delta: 5000, max_quantity: 3, is_default: false, is_available: true, sort_order: 2 },
  { id: option('06'), restaurant_id: R, menu_item_id: item('03'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 3, group_sort_order: 0, name: { uz: 'Piyoz salat', ru: 'Луковый салат', en: 'Onion salad' }, price_delta: 6000, max_quantity: 1, is_default: false, is_available: true, sort_order: 3 },

  // Qovurma lag'mon — spice (single, required)
  { id: option('07'), restaurant_id: R, menu_item_id: item('04'), group_key: 'spice', group_label: SPICE, selection_type: 'single', group_min_select: 1, group_max_select: 1, group_sort_order: 0, name: { uz: 'Oddiy', ru: 'Обычный', en: 'Regular' }, price_delta: 0, max_quantity: 1, is_default: true, is_available: true, sort_order: 1 },
  { id: option('08'), restaurant_id: R, menu_item_id: item('04'), group_key: 'spice', group_label: SPICE, selection_type: 'single', group_min_select: 1, group_max_select: 1, group_sort_order: 0, name: { uz: 'Achchiq', ru: 'Острый', en: 'Spicy' }, price_delta: 0, max_quantity: 1, is_default: false, is_available: true, sort_order: 2 },
  { id: option('09'), restaurant_id: R, menu_item_id: item('04'), group_key: 'spice', group_label: SPICE, selection_type: 'single', group_min_select: 1, group_max_select: 1, group_sort_order: 0, name: { uz: 'Juda achchiq', ru: 'Очень острый', en: 'Extra spicy' }, price_delta: 0, max_quantity: 1, is_default: false, is_available: true, sort_order: 3 },

  // Chizburger — size (single, required) + extras (multiple)
  { id: option('0a'), restaurant_id: R, menu_item_id: item('0f'), group_key: 'size', group_label: SIZE, selection_type: 'single', group_min_select: 1, group_max_select: 1, group_sort_order: 0, name: { uz: 'Oddiy', ru: 'Обычный', en: 'Single' }, price_delta: 0, max_quantity: 1, is_default: true, is_available: true, sort_order: 1 },
  { id: option('0b'), restaurant_id: R, menu_item_id: item('0f'), group_key: 'size', group_label: SIZE, selection_type: 'single', group_min_select: 1, group_max_select: 1, group_sort_order: 0, name: { uz: 'Ikki kotletli', ru: 'Двойной', en: 'Double' }, price_delta: 18000, max_quantity: 1, is_default: false, is_available: true, sort_order: 2 },
  { id: option('0c'), restaurant_id: R, menu_item_id: item('0f'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 3, group_sort_order: 1, name: { uz: "Qo'shimcha pishloq", ru: 'Дополнительный сыр', en: 'Extra cheese' }, price_delta: 6000, max_quantity: 2, is_default: false, is_available: true, sort_order: 1 },
  { id: option('0d'), restaurant_id: R, menu_item_id: item('0f'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 3, group_sort_order: 1, name: { uz: 'Qovurilgan piyoz', ru: 'Жареный лук', en: 'Fried onion' }, price_delta: 4000, max_quantity: 1, is_default: false, is_available: true, sort_order: 2 },
  { id: option('0e'), restaurant_id: R, menu_item_id: item('0f'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 3, group_sort_order: 1, name: { uz: 'Jalapenyo', ru: 'Халапеньо', en: 'Jalapeño' }, price_delta: 4000, max_quantity: 2, is_default: false, is_available: true, sort_order: 3 },

  // Sezar salati — extras
  { id: option('0f'), restaurant_id: R, menu_item_id: item('17'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 2, group_sort_order: 0, name: { uz: "Qo'shimcha tovuq", ru: 'Дополнительная курица', en: 'Extra chicken' }, price_delta: 14000, max_quantity: 2, is_default: false, is_available: true, sort_order: 1 },
  { id: option('10'), restaurant_id: R, menu_item_id: item('17'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 2, group_sort_order: 0, name: { uz: 'Parmezan', ru: 'Пармезан', en: 'Parmesan' }, price_delta: 8000, max_quantity: 1, is_default: false, is_available: true, sort_order: 2 },

  // Ko'k choy — pot size (single, required) + extras
  { id: option('11'), restaurant_id: R, menu_item_id: item('1a'), group_key: 'size', group_label: POT, selection_type: 'single', group_min_select: 1, group_max_select: 1, group_sort_order: 0, name: { uz: 'Kichik choynak', ru: 'Маленький чайник', en: 'Small pot' }, price_delta: 0, max_quantity: 1, is_default: true, is_available: true, sort_order: 1 },
  { id: option('12'), restaurant_id: R, menu_item_id: item('1a'), group_key: 'size', group_label: POT, selection_type: 'single', group_min_select: 1, group_max_select: 1, group_sort_order: 0, name: { uz: 'Katta choynak', ru: 'Большой чайник', en: 'Large pot' }, price_delta: 5000, max_quantity: 1, is_default: false, is_available: true, sort_order: 2 },
  { id: option('13'), restaurant_id: R, menu_item_id: item('1a'), group_key: 'extras', group_label: EXTRAS, selection_type: 'multiple', group_min_select: 0, group_max_select: 1, group_sort_order: 1, name: { uz: 'Limon', ru: 'Лимон', en: 'Lemon' }, price_delta: 2000, max_quantity: 2, is_default: false, is_available: true, sort_order: 1 },
]

/* ================================================================== */
/* 7. Promotions — display only. No discount is applied to any order:  */
/*    the pricing path reads menu_items.price and nothing else.        */
/* ================================================================== */

const promotions: FixturePromotion[] = [
  {
    id: '0a000000-0000-4000-8000-000000000001',
    restaurant_id: R,
    branch_id: null,
    promo_type: 'percentage',
    title: {
      uz: 'Biznes-lanch — 15% chegirma',
      ru: 'Бизнес-ланч — скидка 15%',
      en: 'Business lunch — 15% off',
    },
    description: {
      uz: 'Dushanbadan jumagacha, 12:00 dan 15:00 gacha butun menyuga 15% chegirma.',
      ru: 'С понедельника по пятницу, с 12:00 до 15:00, скидка 15% на всё меню.',
      en: 'Monday to Friday, 12:00–15:00, 15% off the whole menu.',
    },
    badge_label: { uz: '−15%', ru: '−15%', en: '−15%' },
    image_url: '/demo/promotions/biznes-lanch.webp',
    discount_bps: 1500,
    discount_amount: null,
    special_price: null,
    menu_item_ids: [],
    sort_order: 0,
    is_active: true,
  },
  {
    id: '0a000000-0000-4000-8000-000000000002',
    restaurant_id: R,
    branch_id: null,
    promo_type: 'special_price',
    title: {
      uz: 'Chorshanba — osh kuni',
      ru: 'Среда — день плова',
      en: 'Wednesday is plov day',
    },
    description: {
      uz: "Har chorshanba kuni Toy oshi 35 000 so'm. Qozon 12:00 da ochiladi, osh tugaguncha.",
      ru: 'Каждую среду плов «Той» за 35 000 сум. Казан открывается в 12:00 — пока плов не закончится.',
      en: 'Every Wednesday, Toy Osh at 35 000 so\'m. The cauldron opens at 12:00 and runs until the plov is gone.',
    },
    badge_label: { uz: "35 000 so'm", ru: '35 000 сум', en: '35 000 UZS' },
    image_url: '/demo/promotions/osh-kuni.webp',
    discount_bps: null,
    discount_amount: null,
    special_price: 35000,
    menu_item_ids: [item('01')],
    sort_order: 1,
    is_active: true,
  },
]

/* ================================================================== */
/* 8. Four orders, one per interesting status.                         */
/*    Totals are NOT stored here: demo-mode.ts prices them from this   */
/*    same menu with src/lib/money.ts, which is the arithmetic the     */
/*    receipt uses. A hand-typed total is a total that can drift.      */
/* ================================================================== */

const orders: FixtureOrder[] = [
  {
    id: '0c000000-0000-4000-8000-000000000001',
    restaurant_id: R, branch_id: BRANCH_A, table_id: table('02'),
    public_code: 'DEMOA014PLOV', order_number: 'A-014',
    order_type: 'dine_in', channel: 'qr', status: 'pending',
    customer_name: 'Jasur', guest_count: 4,
    customer_note: "Osh yog'i kamroq bo'lsin", locale: 'uz',
    estimated_prep_minutes: 20, placed_minutes_ago: 3,
    items: [
      { id: '0e000000-0000-4000-8000-000000000001', menu_item_id: item('01'), quantity: 2, note: null, sort_order: 1 },
      { id: '0e000000-0000-4000-8000-000000000002', menu_item_id: item('15'), quantity: 1, note: null, sort_order: 2 },
      { id: '0e000000-0000-4000-8000-000000000003', menu_item_id: item('1a'), quantity: 2, note: null, sort_order: 3 },
    ],
  },
  {
    id: '0c000000-0000-4000-8000-000000000002',
    restaurant_id: R, branch_id: BRANCH_A, table_id: table('03'),
    public_code: 'DEMOA015SHSH', order_number: 'A-015',
    order_type: 'dine_in', channel: 'qr', status: 'preparing',
    customer_name: 'Olga', guest_count: 3,
    customer_note: null, locale: 'ru',
    estimated_prep_minutes: 18, placed_minutes_ago: 14,
    items: [
      { id: '0e000000-0000-4000-8000-000000000004', menu_item_id: item('03'), quantity: 3, note: 'Хорошо прожарить', sort_order: 1 },
      { id: '0e000000-0000-4000-8000-000000000005', menu_item_id: item('15'), quantity: 1, note: null, sort_order: 2 },
    ],
  },
  {
    // 27 minutes old against a 25-minute threshold: this ticket is LATE on the
    // kitchen display from the first render, so the flag is demonstrable.
    id: '0c000000-0000-4000-8000-000000000003',
    restaurant_id: R, branch_id: BRANCH_A, table_id: table('06'),
    public_code: 'DEMOA016LAGM', order_number: 'A-016',
    order_type: 'dine_in', channel: 'qr', status: 'ready',
    customer_name: null, guest_count: 6,
    customer_note: "Bittasi juda achchiq bo'lsin", locale: 'uz',
    estimated_prep_minutes: 16, placed_minutes_ago: 27,
    items: [
      { id: '0e000000-0000-4000-8000-000000000006', menu_item_id: item('04'), quantity: 2, note: null, sort_order: 1 },
      { id: '0e000000-0000-4000-8000-000000000007', menu_item_id: item('1c'), quantity: 2, note: null, sort_order: 2 },
    ],
  },
  {
    id: '0c000000-0000-4000-8000-000000000004',
    restaurant_id: R, branch_id: BRANCH_B, table_id: table('08'),
    public_code: 'DEMOB007TAND', order_number: 'B-007',
    order_type: 'dine_in', channel: 'qr', status: 'completed',
    customer_name: 'Nigora', guest_count: 2,
    customer_note: null, locale: 'ru',
    estimated_prep_minutes: 20, placed_minutes_ago: 95,
    items: [
      { id: '0e000000-0000-4000-8000-000000000008', menu_item_id: item('0e'), quantity: 1, note: null, sort_order: 1 },
      { id: '0e000000-0000-4000-8000-000000000009', menu_item_id: item('16'), quantity: 1, note: null, sort_order: 2 },
      { id: '0e000000-0000-4000-8000-00000000000a', menu_item_id: item('1b'), quantity: 2, note: null, sort_order: 3 },
    ],
  },
]

/* ================================================================== */
/* 9. One open waiter call, so the console is not empty on first load. */
/* ================================================================== */

const waiterCalls: FixtureWaiterCall[] = [
  {
    id: '0f000000-0000-4000-8000-000000000001',
    restaurant_id: R,
    branch_id: BRANCH_A,
    table_id: table('04'),
    order_id: null,
    reason: 'request_bill',
    status: 'pending',
    note: "Naqd pulda to'laymiz",
    created_seconds_ago: 40,
  },
]

/* ================================================================== */
/* 10. Staff — one per role, so every panel has a plausible actor.     */
/*     No passwords, no tokens: demo mode has no auth server.          */
/* ================================================================== */

const staff: FixtureStaff[] = [
  { id: '80000000-0000-4000-8000-000000000001', restaurant_id: R, branch_id: null, profile_id: '90000000-0000-4000-8000-000000000001', role: 'RESTAURANT_OWNER', display_name: 'Rustam Karimov', full_name: 'Rustam Karimov', email: 'rustam.karimov@samarqandosh.uz', employee_code: 'SOX-001', locale: 'uz', is_active: true },
  { id: '80000000-0000-4000-8000-000000000002', restaurant_id: R, branch_id: BRANCH_A, profile_id: '90000000-0000-4000-8000-000000000002', role: 'MANAGER', display_name: 'Dilnoza Yusupova', full_name: 'Dilnoza Yusupova', email: 'dilnoza.yusupova@samarqandosh.uz', employee_code: 'SOX-002', locale: 'ru', is_active: true },
  { id: '80000000-0000-4000-8000-000000000003', restaurant_id: R, branch_id: BRANCH_A, profile_id: '90000000-0000-4000-8000-000000000003', role: 'WAITER', display_name: 'Aziz', full_name: 'Aziz Tursunov', email: 'aziz.tursunov@samarqandosh.uz', employee_code: 'SOX-011', locale: 'uz', is_active: true },
  { id: '80000000-0000-4000-8000-000000000004', restaurant_id: R, branch_id: BRANCH_B, profile_id: '90000000-0000-4000-8000-000000000004', role: 'WAITER', display_name: 'Kamola', full_name: 'Kamola Rahimova', email: 'kamola.rahimova@samarqandosh.uz', employee_code: 'SOX-012', locale: 'ru', is_active: true },
  { id: '80000000-0000-4000-8000-000000000005', restaurant_id: R, branch_id: BRANCH_A, profile_id: '90000000-0000-4000-8000-000000000005', role: 'KITCHEN', display_name: 'Sherzod', full_name: 'Sherzod Islomov', email: 'sherzod.islomov@samarqandosh.uz', employee_code: 'SOX-021', locale: 'uz', is_active: true },
]

/* ================================================================== */

export const FIXTURES: DemoFixtures = {
  restaurant,
  branches,
  tables,
  categories,
  menuItems,
  menuItemOptions,
  promotions,
  orders,
  waiterCalls,
  staff,
}

/** Ids worth naming from outside, so a caller never hard-codes a UUID literal. */
export const DEMO_IDS = {
  restaurantId: R,
  branchA: BRANCH_A,
  branchB: BRANCH_B,
  /** Table A-1, whose QR carries DEMO_TOKEN. */
  demoTableId: table('01'),
  /** Table A-7, deliberately inactive, for the "out of service" screen. */
  inactiveTableId: table('07'),
  /** Beshbarmoq, deliberately unavailable. */
  unavailableItemId: item('0d'),
  ownerStaffId: '80000000-0000-4000-8000-000000000001',
  ownerProfileId: '90000000-0000-4000-8000-000000000001',
} as const
