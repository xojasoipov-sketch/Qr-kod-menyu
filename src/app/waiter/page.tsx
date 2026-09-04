'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Armchair,
  ArrowLeftRight,
  Ban,
  CheckCheck,
  ChefHat,
  Clock,
  ConciergeBell,
  DoorOpen,
  Filter,
  HandPlatter,
  Receipt,
  RefreshCw,
  UserCheck,
  UserMinus,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  acceptOrder,
  claimTable,
  getBranches,
  getOrders,
  getSession,
  getStaff,
  getTables,
  getWaiterCalls,
  rejectOrder,
  releaseTable,
  transferTable,
  type SessionInfo,
} from '@/lib/api';
import { useRealtime } from '@/lib/use-realtime';
import type { RealtimePayload } from '@/lib/realtime/event-bus';
import { soundManager } from '@/lib/sound/audio-alerts';
import { formatCurrency, formatRelativeTime, getElapsedMinutes } from '@/lib/utils';
import type {
  Branch,
  Order,
  OrderStatus,
  SessionRole,
  Staff,
  Table,
  WaiterCall,
} from '@/types/database';

const RESTAURANT_ID = 'rest-001';

/** Server ham shu chegarani talab qiladi (POST /api/orders/[id]/reject). */
const MIN_REASON_LENGTH = 3;

/** Rad etishda eng ko'p uchraydigan sabablar — bir bosishda to'ldiriladi. */
const REJECTION_PRESETS = [
  'Taom tugagan',
  'Oshxona hozir band',
  'Mijoz buyurtmadan voz kechdi',
] as const;

const ROLE_LABEL: Record<SessionRole, string> = {
  ADMIN: 'Administrator',
  WAITER: 'Ofitsiant',
  KITCHEN: 'Oshxona',
};

const CALL_TYPE_LABEL: Record<WaiterCall['call_type'], string> = {
  SERVICE: 'Xizmat kerak',
  BILL: 'Hisob-kitob',
  ASSISTANCE: 'Yordam kerak',
};

/** Yakunlanmagan (stolda hali "ochiq" turgan) buyurtma holatlari. */
const CLOSED_ORDER_STATUSES = new Set<Order['status']>(['completed', 'cancelled']);

// ==========================================
// UMUMIY USLUBLAR — mis/oltin plaka, plastik tugma emas
// ==========================================

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed";

const BTN_GOLD = `${BTN_BASE} border border-gold-500/60 bg-gold-400 text-[#17120C] hover:bg-gold-300 disabled:bg-gold-400/35 disabled:text-[#17120C]/60`;

const BTN_QUIET = `${BTN_BASE} border border-surface-border bg-surface-200 text-stone-300 hover:border-gold-400/45 hover:text-gold-200 disabled:opacity-45`;

const BTN_DANGER = `${BTN_BASE} border border-red-900/60 bg-red-950/30 text-red-200/90 hover:bg-red-950/50 disabled:opacity-45`;

// ==========================================
// KICHIK YORDAMCHILAR
// ==========================================

function errorText(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : "Amalni bajarib bo'lmadi. Qaytadan urinib ko'ring.";
}

function tableLabel(table: Pick<Table, 'name' | 'number'>): string {
  return table.name?.trim() || `${table.number}-stol`;
}

function orderTableLabel(order: Order): string {
  return order.table_name?.trim() || `${order.table_number ?? '?'}-stol`;
}

/** "12 daqiqa kutmoqda" — ofitsiant uchun eng muhim raqam. */
function waitedLabel(iso: string): string {
  const minutes = getElapsedMinutes(iso);
  if (minutes < 1) return 'Hozirgina keldi';
  return `${minutes} daqiqa kutmoqda`;
}

/** "34 daqiqa" / "1 soat 12 daq." — stol qachondan beri ofitsiantda. */
function heldForLabel(iso?: string): string {
  if (!iso) return '—';
  const minutes = getElapsedMinutes(iso);
  if (minutes < 1) return 'Hozirgina';
  if (minutes < 60) return `${minutes} daqiqa`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} soat ${rest} daq.` : `${hours} soat`;
}

function SectionHeading({
  icon: Icon,
  label,
  title,
  meta,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 border-b border-surface-border/70 pb-2.5">
      <div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-gold-500/80">
          <Icon className="h-3.5 w-3.5 text-gold-400/80" />
          <span>{label}</span>
        </div>
        <h2 className="mt-1 font-serif text-lg leading-tight text-stone-100">{title}</h2>
      </div>
      {meta ? (
        <span className="shrink-0 font-mono text-[11px] text-stone-500">{meta}</span>
      ) : null}
    </div>
  );
}

/** Bo'sh holat: sokin bir qator matn, katta bo'sh quti emas. */
function QuietNote({ children }: { children: ReactNode }) {
  return <p className="py-1 text-xs leading-relaxed text-stone-500">{children}</p>;
}

function FieldRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-stone-500">{label}</span>
      <span className={`font-mono text-[11px] ${strong ? 'text-gold-200' : 'text-stone-300'}`}>
        {value}
      </span>
    </div>
  );
}

// ==========================================
// SAHIFA
// ==========================================

export default function WaiterPanelPage() {
  const [branchId, setBranchId] = useState('branch-001');
  const [branches, setBranches] = useState<Branch[]>([]);

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<Table[]>([]);

  const [colleagues, setColleagues] = useState<Staff[]>([]);
  const [canTransfer, setCanTransfer] = useState(false);

  const [audioEnabled, setAudioEnabled] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);

  const [rejectTarget, setRejectTarget] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const [transferTarget, setTransferTarget] = useState<Table | null>(null);
  const [transferTo, setTransferTo] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);

  const [billTargetId, setBillTargetId] = useState<string | null>(null);
  const [guestCountInput, setGuestCountInput] = useState('');
  const [guestCountError, setGuestCountError] = useState<string | null>(null);

  // Nisbiy vaqtlar ("12 daqiqa kutmoqda") o'zi yangilanib tursin.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 20000);
    return () => clearInterval(id);
  }, []);

  // Tanlangan filial: eskirgan javoblar tashlab yuboriladi.
  const branchRef = useRef(branchId);
  useEffect(() => {
    branchRef.current = branchId;
  }, [branchId]);

  // Ayni paytda bajarilayotgan amallar — takroriy bosishning oldini oladi.
  const inFlight = useRef<Set<string>>(new Set());

  const refreshAll = useCallback(() => {
    const target = branchId;
    Promise.all([getWaiterCalls(target), getOrders({ branchId: target }), getTables(target)])
      .then(([calls, branchOrders, branchTables]) => {
        if (branchRef.current !== target) return;
        setWaiterCalls(calls);
        setOrders(branchOrders);
        setTables(branchTables);
      })
      .catch((err: unknown) => {
        console.error('Ofitsiant ma\'lumotlarini yuklashda xato:', err);
      });
  }, [branchId]);

  useEffect(() => {
    setWaiterCalls([]);
    setOrders([]);
    setTables([]);
    refreshAll();
  }, [refreshAll]);

  // Sessiya bir marta olinadi: staffId bilan "mening stollarim" ajratiladi.
  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((info) => {
        if (cancelled) return;
        setSession(info);
      })
      .finally(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getBranches(RESTAURANT_ID)
      .then((list) => {
        if (!cancelled) setBranches(list);
      })
      .catch((err: unknown) => {
        console.error('Filiallarni yuklashda xato:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // `GET /api/staff` faqat ADMIN uchun ochiq (ro'yxatda PIN kodlar bor).
  // Ofitsiantda 401 qaytadi — bunday holda "topshirish" amali umuman ko'rsatilmaydi.
  useEffect(() => {
    let cancelled = false;
    getStaff(RESTAURANT_ID)
      .then((list) => {
        if (cancelled) return;
        setColleagues(list.filter((s) => s.role === 'WAITER' && s.is_active));
        setCanTransfer(true);
      })
      .catch(() => {
        if (cancelled) return;
        setColleagues([]);
        setCanTransfer(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Kim ishlayapti. Parol bilan kirgan administratorda xodim id si bo'lmaydi —
   * server ham shunday holatda 'admin' ni ishlatadi, shuning uchun bu yerda ham
   * xuddi shu qoida (aks holda admin olgan stol "meniki" ko'rinmay qoladi).
   */
  const myStaffId = useMemo(() => (session ? session.staffId || 'admin' : ''), [session]);

  const myStaffIdRef = useRef(myStaffId);
  useEffect(() => {
    myStaffIdRef.current = myStaffId;
  }, [myStaffId]);

  // `handleRealtimeEvent` shu holatni har chaqirilganda eng so'nggi holatda ko'rishi kerak
  // (closure eskirib qolmasligi uchun) — myStaffIdRef bilan bir xil naqsh.
  const tablesRef = useRef(tables);
  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  // --- HODISALAR ---

  const handleRealtimeEvent = useCallback(
    (payload: RealtimePayload) => {
      if (payload.branch_id && payload.branch_id !== branchRef.current) return;

      switch (payload.type) {
        case 'WAITER_CALLED':
          if (audioEnabled) soundManager.playWaiterCallAlert();
          refreshAll();
          break;
        case 'ORDER_CREATED': {
          // Mening stolimdan tushgan yangi buyurtma, yoki hali hech kimga biriktirilmagan
          // stoldan tushgan buyurtma (bunda hamma ofitsiantga ovoz chalinadi — kim birinchi
          // borsa, o'sha tasdiqlaydi).
          const orderTable = tablesRef.current.find((t) => t.id === payload.order?.table_id);
          if (
            audioEnabled &&
            (payload.order?.waiter_id === myStaffIdRef.current || !orderTable?.claimed_by)
          ) {
            soundManager.playKitchenOrderBell();
          }
          refreshAll();
          break;
        }
        case 'ORDER_STATUS_CHANGED':
          if (payload.newStatus === 'ready' && audioEnabled) {
            soundManager.playOrderReadyChime();
          }
          refreshAll();
          break;
        case 'TABLE_CLAIMED':
        case 'TABLE_RELEASED':
        case 'ORDER_ACCEPTED':
        case 'ORDER_REJECTED':
        case 'WAITER_CALL_ACKNOWLEDGED':
        case 'TABLE_UPDATED':
          refreshAll();
          break;
        default:
          break;
      }
    },
    [audioEnabled, refreshAll]
  );

  const { connected } = useRealtime({ branchId }, handleRealtimeEvent);

  // --- AMALLAR ---

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>, okText?: string) => {
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      setBusy((prev) => ({ ...prev, [key]: true }));
      setNotice(null);
      try {
        await action();
        if (okText) setNotice({ tone: 'ok', text: okText });
      } catch (err: unknown) {
        setNotice({ tone: 'error', text: errorText(err) });
      } finally {
        inFlight.current.delete(key);
        setBusy((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        refreshAll();
      }
    },
    [refreshAll]
  );

  const handleClaim = useCallback(
    (table: Table) => {
      void runAction(
        `claim:${table.id}`,
        () => claimTable(table.id),
        `${tableLabel(table)} sizga biriktirildi.`
      );
    },
    [runAction]
  );

  const handleRelease = useCallback(
    (table: Table) => {
      void runAction(
        `release:${table.id}`,
        () => releaseTable(table.id),
        `${tableLabel(table)} bo'shatildi.`
      );
    },
    [runAction]
  );

  const handleAccept = useCallback(
    (order: Order) => {
      void runAction(
        `accept:${order.id}`,
        () => acceptOrder(order.id),
        `${order.order_number} tasdiqlandi — oshxona tayyorlashni boshlaydi.`
      );
    },
    [runAction]
  );

  const handleAcknowledgeCall = useCallback(
    (call: WaiterCall) => {
      void runAction(
        `call:${call.id}`,
        async () => {
          const res = await fetch('/api/waiter-calls', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ call_id: call.id }),
          });
          if (!res.ok) throw new Error(await readError(res));
          setWaiterCalls((prev) => prev.filter((c) => c.id !== call.id));
        },
        `${call.table_name || `${call.table_number}-stol`} chaqiruvi yopildi.`
      );
    },
    [runAction]
  );

  /**
   * Buyurtmani keyingi holatga o'tkazadi.
   *
   * Oshxonada ekran bo'lmagan restoranlarda butun zanjirni shu funksiya
   * yuritadi: ofitsiant oshxonaga borib og'zaki aytadi va bu yerda belgilaydi.
   */
  const advanceOrder = useCallback(
    (order: Order, status: OrderStatus, reason: string, done: string) => {
      void runAction(
        `advance:${order.id}`,
        async () => {
          const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/status`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status, changed_by: 'OFITSIANT', reason }),
          });
          if (!res.ok) throw new Error(await readError(res));
        },
        done
      );
    },
    [runAction]
  );

  const handleTellKitchen = useCallback(
    (order: Order) =>
      advanceOrder(
        order,
        'preparing',
        'Ofitsiant oshxonaga og\'zaki yetkazdi',
        `${order.order_number} oshxonaga aytildi.`
      ),
    [advanceOrder]
  );

  const handleMarkCooked = useCallback(
    (order: Order) =>
      advanceOrder(
        order,
        'ready',
        'Ofitsiant oshxonadan tayyor deb oldi',
        `${order.order_number} tayyor deb belgilandi.`
      ),
    [advanceOrder]
  );

  const handleMarkDelivered = useCallback(
    (order: Order) =>
      advanceOrder(
        order,
        'delivered',
        'Ofitsiant taomni stolga eltib berdi',
        `${order.order_number} stolga yetkazildi.`
      ),
    [advanceOrder]
  );

  const openReject = useCallback((order: Order) => {
    setRejectTarget(order);
    setRejectReason('');
    setRejectError(null);
  }, []);

  const submitReject = useCallback(async () => {
    const order = rejectTarget;
    if (!order) return;

    const reason = rejectReason.trim();
    if (reason.length < MIN_REASON_LENGTH) {
      setRejectError(`Sabab kamida ${MIN_REASON_LENGTH} ta belgidan iborat bo'lsin.`);
      return;
    }

    const key = `reject:${order.id}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setBusy((prev) => ({ ...prev, [key]: true }));
    setRejectError(null);

    try {
      await rejectOrder(order.id, reason);
      setRejectTarget(null);
      setRejectReason('');
      setNotice({
        tone: 'ok',
        text: `${order.order_number} rad etildi. Sabab mijozga ko'rinadi.`,
      });
    } catch (err: unknown) {
      setRejectError(errorText(err));
    } finally {
      inFlight.current.delete(key);
      setBusy((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      refreshAll();
    }
  }, [rejectTarget, rejectReason, refreshAll]);

  const openTransfer = useCallback((table: Table) => {
    setTransferTarget(table);
    setTransferTo('');
    setTransferError(null);
  }, []);

  const submitTransfer = useCallback(async () => {
    const table = transferTarget;
    if (!table) return;

    if (!transferTo) {
      setTransferError('Stol topshiriladigan ofitsiantni tanlang.');
      return;
    }

    const key = `transfer:${table.id}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setBusy((prev) => ({ ...prev, [key]: true }));
    setTransferError(null);

    try {
      const updated = await transferTable(table.id, transferTo);
      setTransferTarget(null);
      setTransferTo('');
      setNotice({
        tone: 'ok',
        text: `${tableLabel(table)} ${updated.claimed_by_name || 'ofitsiantga'} topshirildi.`,
      });
    } catch (err: unknown) {
      setTransferError(errorText(err));
    } finally {
      inFlight.current.delete(key);
      setBusy((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      refreshAll();
    }
  }, [transferTarget, transferTo, refreshAll]);

  const openBill = useCallback((table: Table) => {
    setBillTargetId(table.id);
    setGuestCountInput(table.guest_count ? String(table.guest_count) : '');
    setGuestCountError(null);
  }, []);

  /** "Necha kishi?" o'zgarganda (blur yoki tasdiqlash tugmasi orqali) serverga yuboriladi. */
  const saveGuestCount = useCallback(
    (table: Table, rawValue: string) => {
      const trimmed = rawValue.trim();
      const guestCount = trimmed === '' ? null : Number(trimmed);
      if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1)) {
        setGuestCountError("Mehmonlar soni musbat butun son bo'lishi kerak.");
        return;
      }
      // O'zgarish bo'lmasa — bekorga so'rov yubormaymiz.
      if ((table.guest_count ?? null) === guestCount) return;

      setGuestCountError(null);
      void runAction(`guests:${table.id}`, async () => {
        const res = await fetch(`/api/tables/${encodeURIComponent(table.id)}/guests`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ guest_count: guestCount }),
        });
        if (!res.ok) throw new Error(await readError(res));
      });
    },
    [runAction]
  );

  // Modalni Escape bilan yopish.
  useEffect(() => {
    if (!rejectTarget && !transferTarget && !billTargetId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setRejectTarget(null);
      setTransferTarget(null);
      setBillTargetId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rejectTarget, transferTarget, billTargetId]);

  // --- HOSILA MA'LUMOTLAR ---

  const myTables = useMemo(
    () =>
      myStaffId
        ? tables.filter((t) => t.claimed_by === myStaffId).sort((a, b) => a.number - b.number)
        : [],
    [tables, myStaffId]
  );

  const myTableIds = useMemo(() => new Set(myTables.map((t) => t.id)), [myTables]);

  const freeZones = useMemo(() => {
    const groups = new Map<string, Table[]>();
    for (const table of tables) {
      if (table.claimed_by || !table.is_active) continue;
      const zone = table.zone?.trim() || 'Asosiy zal';
      const list = groups.get(zone);
      if (list) list.push(table);
      else groups.set(zone, [table]);
    }
    return Array.from(groups.entries())
      .map(([zone, list]) => ({ zone, list: list.sort((a, b) => a.number - b.number) }))
      .sort((a, b) => a.zone.localeCompare(b.zone));
  }, [tables]);

  const freeCount = useMemo(
    () => freeZones.reduce((sum, group) => sum + group.list.length, 0),
    [freeZones]
  );

  const otherTables = useMemo(
    () =>
      tables
        .filter((t) => t.claimed_by && t.claimed_by !== myStaffId)
        .sort((a, b) => a.number - b.number),
    [tables, myStaffId]
  );

  const activeOrderCountByTable = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of orders) {
      if (CLOSED_ORDER_STATUSES.has(order.status)) continue;
      counts.set(order.table_id, (counts.get(order.table_id) ?? 0) + 1);
    }
    return counts;
  }, [orders]);

  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);

  /**
   * Mening stollarimdan kelgan buyurtmalar VA egasiz stolga (claimed_by yo'q) tushgan
   * buyurtmalar — bular hali hech kimga ko'rinmasa, hech qaysi ofitsiant ularni tasdiqlay
   * olmay qoladi. Kim birinchi tasdiqlasa, o'sha xodimga biriktiriladi (server tomonida).
   */
  const pendingForMe = useMemo(
    () =>
      myStaffId
        ? orders
            .filter(
              (o) =>
                o.status === 'pending' &&
                (myTableIds.has(o.table_id) ||
                  o.waiter_id === myStaffId ||
                  !tableById.get(o.table_id)?.claimed_by)
            )
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
        : [],
    [orders, myTableIds, myStaffId, tableById]
  );

  /*
   * OSHXONA EKRANISIZ ISHLASH.
   *
   * Ba'zi restoranlarda oshxonada planshet ham, telefon ham bo'lmaydi — bu
   * normal holat. Unda zanjirni ofitsiantning o'zi yuritadi: buyurtmani
   * tasdiqlaydi, oshxonaga borib og'zaki aytadi va shu yerda belgilaydi,
   * taom tayyor bo'lgach yana shu yerdan belgilab, stolga olib chiqadi.
   *
   * Bu tugmalar oshxonada ekran bor bo'lsa ham zarar qilmaydi: kim birinchi
   * belgilasa, holat o'shanda o'zgaradi, ikkinchisi esa allaqachon o'tgan
   * holatni qayta o'zgartira olmaydi (holat mashinasi to'sadi).
   */

  /** Tasdiqlangan, lekin oshxonaga hali aytilmagan buyurtmalar. */
  const toTellKitchen = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'confirmed')
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [orders]
  );

  /** Oshxonada tayyorlanayotgan — ofitsiant tayyor bo'lganini belgilay oladi. */
  const cookingOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'preparing')
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [orders]
  );

  const readyOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'ready')
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at)),
    [orders]
  );

  const pendingCalls = useMemo(
    () =>
      waiterCalls
        .filter((c) => c.status === 'PENDING')
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [waiterCalls]
  );

  const transferOptions = useMemo(
    () =>
      colleagues.filter(
        (s) => s.id !== myStaffId && (!s.branch_id || s.branch_id === branchId)
      ),
    [colleagues, myStaffId, branchId]
  );

  const rejectReasonValid = rejectReason.trim().length >= MIN_REASON_LENGTH;

  const billTarget = useMemo(
    () => (billTargetId ? tableById.get(billTargetId) ?? null : null),
    [billTargetId, tableById]
  );

  /** Shu stolning joriy o'tirishiga tegishli, bekor qilinmagan buyurtmalar — hisob shulardan. */
  const billOrders = useMemo(() => {
    if (!billTarget) return [];
    return orders
      .filter((o) => o.table_id === billTarget.id && o.status !== 'cancelled')
      .filter((o) => !billTarget.claimed_at || o.created_at >= billTarget.claimed_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [orders, billTarget]);

  const billTotal = useMemo(
    () => billOrders.reduce((sum, o) => sum + o.total, 0),
    [billOrders]
  );

  // ==========================================
  // KO'RINISH
  // ==========================================

  return (
    <div className="min-h-screen bg-[#0C0A09] pb-20 font-sans text-stone-100">
      {/* SARLAVHA */}
      <header className="sticky top-0 z-30 border-b border-surface-border bg-[#141210]/95 px-4 py-3 backdrop-blur-sm sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gold-400/30 bg-gold-400/10">
              <ConciergeBell className="h-5 w-5 text-gold-300" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-500/80">
                Zal xizmati
              </div>
              <h1 className="font-serif text-lg leading-tight text-stone-50">
                Ofitsiant terminali
              </h1>
              <div className="mt-0.5 text-[11px] text-stone-400">
                {!sessionReady ? (
                  'Sessiya tekshirilmoqda...'
                ) : session ? (
                  <>
                    <span className="text-stone-200">{session.name}</span>
                    <span className="mx-1.5 text-stone-600">·</span>
                    <span className="uppercase tracking-wider">{ROLE_LABEL[session.role]}</span>
                  </>
                ) : (
                  'Sessiya aniqlanmadi — qaytadan kiring.'
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-gold-400/25 bg-gold-400/5 px-3 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-stone-500">
                Mening stollarim
              </div>
              <div className="font-mono text-sm text-gold-200">{myTables.length} ta</div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-surface-border bg-surface-100 px-3 py-2">
              <Filter className="h-3.5 w-3.5 text-stone-500" />
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                aria-label="Filial"
                className="cursor-pointer bg-transparent text-xs text-stone-200 focus:outline-none"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id} className="bg-surface-100 text-stone-200">
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-surface-border bg-surface-100 px-3 py-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connected ? 'bg-gold-400' : 'bg-stone-600'
                }`}
              />
              <span className="text-[10px] uppercase tracking-wider text-stone-400">
                {connected ? 'Jonli aloqa' : 'Aloqa uzildi'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setAudioEnabled((value) => !value)}
              className={`${BTN_QUIET} ${audioEnabled ? 'text-gold-200' : ''}`}
            >
              {audioEnabled ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
              <span>{audioEnabled ? 'Ovoz yoniq' : 'Ovozsiz'}</span>
            </button>

            <button
              type="button"
              onClick={refreshAll}
              title="Yangilash"
              aria-label="Yangilash"
              className="rounded-lg border border-surface-border bg-surface-200 p-2 text-stone-400 transition-colors hover:border-gold-400/45 hover:text-gold-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>

            <Link
              href="/"
              className="px-2 py-1 text-[11px] uppercase tracking-wider text-stone-500 transition-colors hover:text-stone-200"
            >
              Chiqish
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-6 sm:px-6">
        {/* AMAL NATIJASI / SERVER XATOSI */}
        {notice ? (
          <div
            role="status"
            className={`flex items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${
              notice.tone === 'error'
                ? 'border-red-900/60 bg-red-950/25 text-red-100'
                : 'border-gold-400/30 bg-gold-400/10 text-gold-100'
            }`}
          >
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 text-[10px] uppercase tracking-wider text-stone-400 transition-colors hover:text-stone-200"
            >
              Yopish
            </button>
          </div>
        ) : null}

        {/* 1) TASDIQLASHNI KUTMOQDA */}
        <section>
          <SectionHeading
            icon={HandPlatter}
            label="Birinchi navbatda"
            title="Tasdiqlashni kutmoqda"
            meta={`${pendingForMe.length} ta buyurtma`}
          />

          {!sessionReady ? (
            <QuietNote>Sessiya tekshirilmoqda...</QuietNote>
          ) : !myStaffId ? (
            <QuietNote>
              Sessiya aniqlanmadi. Buyurtmalarni ko&apos;rish uchun PIN bilan qaytadan kiring.
            </QuietNote>
          ) : pendingForMe.length === 0 ? (
            <QuietNote>
              Tasdiqlash kutayotgan buyurtma yo&apos;q. Stollaringiz osoyishta.
            </QuietNote>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {pendingForMe.map((order) => {
                const acceptKey = `accept:${order.id}`;
                const rejectKey = `reject:${order.id}`;
                const isBusy = Boolean(busy[acceptKey]) || Boolean(busy[rejectKey]);
                const isUnclaimedTable = !tableById.get(order.table_id)?.claimed_by;

                return (
                  <article
                    key={order.id}
                    className="flex flex-col rounded-2xl border border-gold-400/30 bg-surface-100 p-4 shadow-luxury"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-gold-500/80">
                          {orderTableLabel(order)}
                        </div>
                        <h3 className="font-serif text-lg leading-tight text-stone-50">
                          {order.order_number}
                        </h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-[11px] text-stone-400">
                        <Clock className="h-3.5 w-3.5 text-stone-500" />
                        <span className="font-mono">{waitedLabel(order.created_at)}</span>
                      </div>
                    </div>

                    {isUnclaimedTable ? (
                      <div className="mt-2 inline-flex w-fit items-center gap-1 rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold-300">
                        <DoorOpen className="h-3 w-3" />
                        <span>Stol bo&apos;sh — birinchi boruvchiga</span>
                      </div>
                    ) : null}

                    <ul className="my-3 divide-y divide-surface-border/60 border-y border-surface-border/60">
                      {order.items.map((item, index) => (
                        <li
                          key={item.id || `${order.id}-${index}`}
                          className="flex items-baseline justify-between gap-3 py-1.5 text-xs text-stone-200"
                        >
                          <span>
                            <span className="mr-1.5 font-mono text-gold-300">
                              {item.quantity}×
                            </span>
                            {item.name_snapshot}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-stone-500">
                            {formatCurrency(item.total)}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {order.customer_notes ? (
                      <p className="mb-3 text-[11px] leading-relaxed text-stone-400">
                        <span className="uppercase tracking-wider text-stone-500">Izoh:</span>{' '}
                        {order.customer_notes}
                      </p>
                    ) : null}

                    <div className="mb-3">
                      <FieldRow label="Jami" value={formatCurrency(order.total)} strong />
                    </div>

                    <div className="mt-auto grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleAccept(order)}
                        disabled={isBusy}
                        className={BTN_GOLD}
                      >
                        <CheckCheck className="h-4 w-4" />
                        <span>{busy[acceptKey] ? 'Tasdiqlanmoqda...' : 'Qabul qilaman'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openReject(order)}
                        disabled={isBusy}
                        className={BTN_DANGER}
                      >
                        <Ban className="h-4 w-4" />
                        <span>Rad etish</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 2) OSHXONA ZANJIRI — ekran bo'lmasa ham ishlaydi */}
        <section>
          <SectionHeading
            icon={ChefHat}
            label="Oshxonada"
            title="Oshxonaga aytish va tayyorini olish"
            meta={`${toTellKitchen.length + cookingOrders.length} ta`}
          />

          <p className="mb-3 text-[11px] leading-relaxed text-stone-500">
            Oshxonada ekran bo&apos;lmasa, buyurtmani o&apos;zingiz olib boring va shu
            yerda belgilang. Oshxonada ekran bo&apos;lsa, ular belgilashi bilan bu
            kartalar o&apos;zi yo&apos;qoladi.
          </p>

          {toTellKitchen.length === 0 && cookingOrders.length === 0 ? (
            <QuietNote>Oshxonada sizning buyurtmangiz yo&apos;q.</QuietNote>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...toTellKitchen, ...cookingOrders].map((order) => {
                const key = `advance:${order.id}`;
                const isBusy = Boolean(busy[key]);
                const needsTelling = order.status === 'confirmed';

                return (
                  <article
                    key={order.id}
                    className="flex flex-col rounded-2xl border border-surface-border bg-surface-100 p-4 shadow-luxury"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-stone-500">
                          {orderTableLabel(order)}
                        </div>
                        <h3 className="font-serif text-base leading-tight text-stone-50">
                          {order.order_number}
                        </h3>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                          needsTelling
                            ? 'border-gold-500/40 bg-gold-500/10 text-gold-300'
                            : 'border-surface-border bg-surface-200 text-stone-400'
                        }`}
                      >
                        {needsTelling ? 'Aytilmagan' : 'Pishirilmoqda'}
                      </span>
                    </div>

                    <ul className="my-3 space-y-1 border-y border-surface-border/60 py-2 text-xs text-stone-200">
                      {order.items.map((item, index) => (
                        <li key={item.id || `${order.id}-${index}`}>
                          <span className="mr-1.5 font-mono text-gold-300">{item.quantity}×</span>
                          {item.name_snapshot}
                          {item.notes ? (
                            <span className="ml-1.5 text-stone-500">— {item.notes}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>

                    {order.customer_notes ? (
                      <p className="mb-3 text-[11px] leading-relaxed text-stone-400">
                        Izoh: {order.customer_notes}
                      </p>
                    ) : null}

                    <button
                      type="button"
                      onClick={() =>
                        needsTelling ? handleTellKitchen(order) : handleMarkCooked(order)
                      }
                      disabled={isBusy}
                      className={`${needsTelling ? BTN_GOLD : BTN_QUIET} mt-auto w-full`}
                    >
                      <CheckCheck className="h-4 w-4" />
                      <span>
                        {isBusy
                          ? 'Belgilanmoqda...'
                          : needsTelling
                          ? 'Oshxonaga aytdim'
                          : 'Tayyor bo\'ldi'}
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 3) OSHXONADAN TAYYOR — STOLGA ELTISH */}
        <section>
          <SectionHeading
            icon={ChefHat}
            label="Oshxonadan"
            title="Tayyor — stolga eltish"
            meta={`${readyOrders.length} ta`}
          />

          {readyOrders.length === 0 ? (
            <QuietNote>Tarqatish joyida kutayotgan taom yo&apos;q.</QuietNote>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {readyOrders.map((order) => {
                const key = `advance:${order.id}`;
                return (
                  <article
                    key={order.id}
                    className="flex flex-col rounded-2xl border border-surface-border bg-surface-100 p-4 shadow-luxury"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-stone-500">
                          {orderTableLabel(order)}
                        </div>
                        <h3 className="font-serif text-base leading-tight text-stone-50">
                          {order.order_number}
                        </h3>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-stone-500">
                        {formatRelativeTime(order.updated_at)}
                      </span>
                    </div>

                    <ul className="my-3 space-y-1 border-y border-surface-border/60 py-2 text-xs text-stone-200">
                      {order.items.map((item, index) => (
                        <li key={item.id || `${order.id}-${index}`}>
                          <span className="mr-1.5 font-mono text-gold-300">{item.quantity}×</span>
                          {item.name_snapshot}
                        </li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      onClick={() => handleMarkDelivered(order)}
                      disabled={Boolean(busy[key])}
                      className={`${BTN_GOLD} mt-auto w-full`}
                    >
                      <CheckCheck className="h-4 w-4" />
                      <span>{busy[key] ? 'Belgilanmoqda...' : 'Stolga yetkazdim'}</span>
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 3) MENING STOLLARIM */}
        <section>
          <SectionHeading
            icon={Armchair}
            label="Zal"
            title="Mening stollarim"
            meta={`${myTables.length} ta`}
          />

          {myTables.length === 0 ? (
            <QuietNote>
              Hozircha sizda biriktirilgan stol yo&apos;q. Quyidagi bo&apos;sh stollardan birini
              oling yoki chaqiruvga borib o&apos;sha yerdan oling.
            </QuietNote>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {myTables.map((table) => {
                const releaseKey = `release:${table.id}`;
                const transferKey = `transfer:${table.id}`;
                const activeCount = activeOrderCountByTable.get(table.id) ?? 0;

                return (
                  <article
                    key={table.id}
                    className="rounded-2xl border border-surface-border bg-surface-100 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-serif text-base leading-tight text-stone-50">
                          {tableLabel(table)}
                        </h3>
                        <div className="text-[11px] text-stone-500">
                          {table.zone?.trim() || 'Asosiy zal'}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-stone-600">
                        №{table.number}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1 border-t border-surface-border/60 pt-2.5">
                      <FieldRow label="Menda" value={heldForLabel(table.claimed_at)} />
                      <FieldRow
                        label="Faol buyurtma"
                        value={`${activeCount} ta`}
                        strong={activeCount > 0}
                      />
                      {table.guest_count ? (
                        <FieldRow label="Mehmon" value={`${table.guest_count} kishi`} />
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openBill(table)}
                        className={BTN_QUIET}
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        <span>Hisob</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRelease(table)}
                        disabled={Boolean(busy[releaseKey])}
                        className={BTN_QUIET}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        <span>{busy[releaseKey] ? "Bo'shatilmoqda..." : "Bo'shatish"}</span>
                      </button>

                      {canTransfer ? (
                        <button
                          type="button"
                          onClick={() => openTransfer(table)}
                          disabled={Boolean(busy[transferKey])}
                          className={BTN_QUIET}
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                          <span>{busy[transferKey] ? 'Topshirilmoqda...' : 'Topshirish'}</span>
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 4) BO'SH STOLLAR */}
        <section>
          <SectionHeading
            icon={DoorOpen}
            label="Zalda"
            title="Bo'sh stollar"
            meta={`${freeCount} ta`}
          />

          {freeCount === 0 ? (
            <QuietNote>Barcha stollar band. Zal to&apos;la.</QuietNote>
          ) : (
            <div className="space-y-4">
              {freeZones.map((group) => (
                <div key={group.zone}>
                  <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-stone-500">
                    {group.zone}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                    {group.list.map((table) => {
                      const key = `claim:${table.id}`;
                      const isBusy = Boolean(busy[key]);
                      return (
                        <button
                          key={table.id}
                          type="button"
                          onClick={() => handleClaim(table)}
                          disabled={isBusy}
                          className="group rounded-xl border border-surface-border bg-surface-50 px-3 py-2.5 text-left transition-colors hover:border-gold-400/50 hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-serif text-sm text-stone-100">
                              {tableLabel(table)}
                            </span>
                            {table.capacity ? (
                              <span className="font-mono text-[10px] text-stone-600">
                                {table.capacity} o&apos;rin
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-stone-500 transition-colors group-hover:text-gold-300">
                            <UserCheck className="h-3.5 w-3.5" />
                            <span>{isBusy ? 'Olinmoqda...' : 'Olaman'}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5) MIJOZ CHAQIRUVLARI */}
        <section>
          <SectionHeading
            icon={ConciergeBell}
            label="Jonli"
            title="Mijoz chaqiruvlari"
            meta={`${pendingCalls.length} ta`}
          />

          {pendingCalls.length === 0 ? (
            <QuietNote>Chaqirayotgan stol yo&apos;q. Barcha stolga xizmat ko&apos;rsatilgan.</QuietNote>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pendingCalls.map((call) => {
                const table = tableById.get(call.table_id);
                const claimKey = table ? `claim:${table.id}` : '';
                const isMine = Boolean(table && table.claimed_by === myStaffId && myStaffId);
                const heldByOther = Boolean(
                  table && table.claimed_by && table.claimed_by !== myStaffId
                );

                return (
                  <article
                    key={call.id}
                    className="rounded-2xl border border-surface-border border-l-2 border-l-gold-400 bg-surface-100 p-4 shadow-luxury"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-gold-500/80">
                          {CALL_TYPE_LABEL[call.call_type]}
                        </div>
                        <h3 className="font-serif text-base leading-tight text-stone-50">
                          {call.table_name || `${call.table_number}-stol`}
                        </h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-[11px] text-stone-400">
                        <Clock className="h-3.5 w-3.5 text-stone-500" />
                        <span className="font-mono">{formatRelativeTime(call.created_at)}</span>
                      </div>
                    </div>

                    <div className="mt-2 text-[11px] text-stone-500">
                      {isMine
                        ? 'Bu stol sizda.'
                        : heldByOther
                          ? `Stol ${table?.claimed_by_name || 'boshqa ofitsiant'}da.`
                          : 'Stol hali hech kimga biriktirilmagan.'}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleAcknowledgeCall(call)}
                        disabled={Boolean(busy[`call:${call.id}`])}
                        className={BTN_GOLD}
                      >
                        <CheckCheck className="h-4 w-4" />
                        <span>
                          {busy[`call:${call.id}`] ? 'Yopilmoqda...' : 'Bordim'}
                        </span>
                      </button>

                      {table && !isMine && !heldByOther ? (
                        <button
                          type="button"
                          onClick={() => handleClaim(table)}
                          disabled={Boolean(busy[claimKey])}
                          className={BTN_QUIET}
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>{busy[claimKey] ? 'Olinmoqda...' : 'Stolni olaman'}</span>
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 6) BOSHQA OFITSIANTLARDA */}
        <section>
          <SectionHeading
            icon={UserCheck}
            label="Band"
            title="Boshqa ofitsiantlarda"
            meta={`${otherTables.length} ta`}
          />

          {otherTables.length === 0 ? (
            <QuietNote>Boshqa ofitsiantlarda biriktirilgan stol yo&apos;q.</QuietNote>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {otherTables.map((table) => (
                <div
                  key={table.id}
                  className="rounded-xl border border-surface-border/70 bg-surface-50/60 px-3 py-2.5"
                >
                  <div className="font-serif text-sm text-stone-300">{tableLabel(table)}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-stone-600">
                    Band
                  </div>
                  <div className="truncate text-[11px] text-stone-400">
                    {table.claimed_by_name || 'Ofitsiant'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* RAD ETISH MODALI */}
      {rejectTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Buyurtmani rad etish"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
        >
          <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-100 p-5 shadow-luxury">
            <div className="text-[10px] uppercase tracking-[0.18em] text-gold-500/80">
              Buyurtmani rad etish
            </div>
            <h3 className="mt-1 font-serif text-lg leading-tight text-stone-50">
              {rejectTarget.order_number}
              <span className="ml-2 text-sm text-stone-500">
                {orderTableLabel(rejectTarget)}
              </span>
            </h3>
            <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
              Sabab majburiy — u mijozga ko&apos;rsatiladi va buyurtma tarixida qoladi.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {REJECTION_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setRejectReason(preset);
                    setRejectError(null);
                  }}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                    rejectReason.trim() === preset
                      ? 'border-gold-400/60 bg-gold-400/10 text-gold-200'
                      : 'border-surface-border bg-surface-200 text-stone-300 hover:border-gold-400/40 hover:text-gold-200'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            <label
              htmlFor="reject-reason"
              className="mt-4 block text-[10px] uppercase tracking-wider text-stone-500"
            >
              Sabab
            </label>
            <textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                if (rejectError) setRejectError(null);
              }}
              rows={3}
              placeholder="Masalan: taom tugagan"
              className="mt-1.5 w-full resize-none rounded-xl border border-surface-border bg-surface-50 px-3 py-2.5 text-xs text-stone-100 placeholder:text-stone-600 focus:border-gold-400/50 focus:outline-none"
            />

            {rejectError ? (
              <p className="mt-2 text-[11px] text-red-300">{rejectError}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                disabled={Boolean(busy[`reject:${rejectTarget.id}`])}
                className={BTN_QUIET}
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={() => void submitReject()}
                disabled={!rejectReasonValid || Boolean(busy[`reject:${rejectTarget.id}`])}
                className={BTN_DANGER}
              >
                <Ban className="h-4 w-4" />
                <span>
                  {busy[`reject:${rejectTarget.id}`] ? 'Yuborilmoqda...' : 'Rad etaman'}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* TOPSHIRISH MODALI */}
      {transferTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Stolni topshirish"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
        >
          <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-100 p-5 shadow-luxury">
            <div className="text-[10px] uppercase tracking-[0.18em] text-gold-500/80">
              Boshqa ofitsiantga topshirish
            </div>
            <h3 className="mt-1 font-serif text-lg leading-tight text-stone-50">
              {tableLabel(transferTarget)}
            </h3>
            <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
              Stol va uning ochiq buyurtmalari tanlangan ofitsiantga o&apos;tadi.
            </p>

            {transferOptions.length === 0 ? (
              <p className="mt-4 text-xs text-stone-500">
                Ro&apos;yxatda boshqa faol ofitsiant yo&apos;q.
              </p>
            ) : (
              <>
                <label
                  htmlFor="transfer-to"
                  className="mt-4 block text-[10px] uppercase tracking-wider text-stone-500"
                >
                  Ofitsiant
                </label>
                <select
                  id="transfer-to"
                  value={transferTo}
                  onChange={(e) => {
                    setTransferTo(e.target.value);
                    if (transferError) setTransferError(null);
                  }}
                  className="mt-1.5 w-full cursor-pointer rounded-xl border border-surface-border bg-surface-50 px-3 py-2.5 text-xs text-stone-100 focus:border-gold-400/50 focus:outline-none"
                >
                  <option value="" className="bg-surface-100 text-stone-400">
                    Tanlang...
                  </option>
                  {transferOptions.map((staff) => (
                    <option
                      key={staff.id}
                      value={staff.id}
                      className="bg-surface-100 text-stone-200"
                    >
                      {staff.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            {transferError ? (
              <p className="mt-2 text-[11px] text-red-300">{transferError}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTransferTarget(null)}
                disabled={Boolean(busy[`transfer:${transferTarget.id}`])}
                className={BTN_QUIET}
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={() => void submitTransfer()}
                disabled={
                  !transferTo ||
                  transferOptions.length === 0 ||
                  Boolean(busy[`transfer:${transferTarget.id}`])
                }
                className={BTN_GOLD}
              >
                <ArrowLeftRight className="h-4 w-4" />
                <span>
                  {busy[`transfer:${transferTarget.id}`] ? 'Topshirilmoqda...' : 'Topshiraman'}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* HISOB MODALI */}
      {billTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Hisob"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
        >
          <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-100 p-5 shadow-luxury">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-gold-500/80">
                  Hisob
                </div>
                <h3 className="mt-1 font-serif text-lg leading-tight text-stone-50">
                  {tableLabel(billTarget)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBillTargetId(null)}
                aria-label="Yopish"
                className="rounded-lg border border-surface-border bg-surface-200 p-1.5 text-stone-400 transition-colors hover:border-gold-400/45 hover:text-gold-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {billOrders.length === 0 ? (
              <QuietNote>Bu o&apos;tirishda hali buyurtma yo&apos;q.</QuietNote>
            ) : (
              <ul className="mt-3 max-h-56 divide-y divide-surface-border/60 overflow-y-auto border-y border-surface-border/60">
                {billOrders.map((order) =>
                  order.items.map((item, index) => (
                    <li
                      key={item.id || `${order.id}-${index}`}
                      className="flex items-baseline justify-between gap-3 py-1.5 text-xs text-stone-200"
                    >
                      <span>
                        <span className="mr-1.5 font-mono text-gold-300">{item.quantity}×</span>
                        {item.name_snapshot}
                        <span className="ml-1.5 text-[10px] text-stone-600">
                          {order.order_number}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-stone-500">
                        {formatCurrency(item.total)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            )}

            <div className="mt-3">
              <FieldRow label="Jami" value={formatCurrency(billTotal)} strong />
            </div>

            <label
              htmlFor="bill-guest-count"
              className="mt-4 block text-[10px] uppercase tracking-wider text-stone-500"
            >
              Necha kishi?
            </label>
            <input
              id="bill-guest-count"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={guestCountInput}
              onChange={(e) => {
                setGuestCountInput(e.target.value);
                if (guestCountError) setGuestCountError(null);
              }}
              onBlur={() => saveGuestCount(billTarget, guestCountInput)}
              placeholder="Masalan: 4"
              className="mt-1.5 w-full rounded-xl border border-surface-border bg-surface-50 px-3 py-2.5 text-xs text-stone-100 placeholder:text-stone-600 focus:border-gold-400/50 focus:outline-none"
            />

            {guestCountError ? (
              <p className="mt-2 text-[11px] text-red-300">{guestCountError}</p>
            ) : null}

            {Number(guestCountInput) > 0 ? (
              <div className="mt-3 rounded-xl border border-gold-400/25 bg-gold-400/5 px-3 py-2.5">
                <FieldRow
                  label="Har kishiga"
                  value={formatCurrency(Math.round(billTotal / Number(guestCountInput)))}
                  strong
                />
              </div>
            ) : null}

            <p className="mt-4 text-[11px] leading-relaxed text-stone-500">
              Mijoz shu hisobni ko&apos;rib kassaga to&apos;lov qiladi.
            </p>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setBillTargetId(null)}
                disabled={Boolean(busy[`guests:${billTarget.id}`])}
                className={BTN_GOLD}
              >
                <Receipt className="h-4 w-4" />
                <span>{busy[`guests:${billTarget.id}`] ? 'Saqlanmoqda...' : 'Yopish'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Server javobidagi o'zbekcha `error` matnini oladi. */
async function readError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string'
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // JSON emas — umumiy xabar qoladi.
  }
  return "Amalni bajarib bo'lmadi. Qaytadan urinib ko'ring.";
}
