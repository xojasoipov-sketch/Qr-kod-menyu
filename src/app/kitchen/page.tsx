'use client';

import { useState, useEffect, useCallback } from 'react';
import { Branch, Order, OrderStatus } from '@/types/database';
import { getOrders, getBranches } from '@/lib/api';
import { useRealtime } from '@/lib/use-realtime';
import type { RealtimePayload } from '@/lib/realtime/event-bus';
import { soundManager } from '@/lib/sound/audio-alerts';
import { formatRelativeTime } from '@/lib/utils';
import { 
  ChefHat, 
  Volume2, 
  VolumeX, 
  Clock, 
  AlertTriangle, 
  Sparkles, 
  Check, 
  RefreshCw, 
  Filter,
  UserCheck,
  HandPlatter
} from 'lucide-react';
import SignOutButton from '@/components/auth/SignOutButton';

const RESTAURANT_ID = 'rest-001';

export default function KitchenDisplaySystemPage() {
  const [branchId, setBranchId] = useState('branch-001');
  const [orders, setOrders] = useState<Order[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [completedItems, setCompletedItems] = useState<Record<string, boolean>>({});
  // Kutish vaqti shu soatdan hisoblanadi: har 30 soniyada bir marta yangilanadi.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Branch list is hydrated once from the server API.
  useEffect(() => {
    let cancelled = false;
    getBranches(RESTAURANT_ID)
      .then((list) => {
        if (!cancelled) setBranches(list);
      })
      .catch((err: unknown) => {
        console.error('Filiallarni yuklab bo\'lmadi:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Server is the source of truth: every refresh pulls the branch's orders from the API.
  const refreshOrders = useCallback(async () => {
    try {
      const list = await getOrders({ branchId });
      setOrders(list);
    } catch (err: unknown) {
      console.error('Buyurtmalarni yuklab bo\'lmadi:', err);
    }
  }, [branchId]);

  // Hydrate on mount and whenever the selected branch changes.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getOrders({ branchId })
      .then((list) => {
        if (cancelled) return;
        setOrders(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Buyurtmalarni yuklab bo\'lmadi:', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const handleRealtimeEvent = useCallback(
    (payload: RealtimePayload) => {
      if (payload.type === 'ORDER_CREATED') {
        if (audioEnabled) {
          soundManager.playKitchenOrderBell();
        }
        const created = payload.order;
        if (created && created.branch_id === branchId) {
          // Instant feedback: show the ticket immediately, then reconcile with the server.
          setOrders((prev) =>
            prev.some((o) => o.id === created.id) ? prev : [created, ...prev]
          );
        }
        void refreshOrders();
      } else if (payload.type === 'ORDER_STATUS_CHANGED') {
        const changedId = payload.orderId ?? payload.order?.id;
        const nextStatus = payload.newStatus ?? payload.order?.status;
        if (changedId && nextStatus) {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === changedId ? (payload.order ?? { ...o, status: nextStatus }) : o
            )
          );
        }
        void refreshOrders();
      }
    },
    [audioEnabled, branchId, refreshOrders]
  );

  useRealtime({ branchId }, handleRealtimeEvent);

  const handleUpdateStatus = async (orderId: string, nextStatus: OrderStatus) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          changed_by: 'OSHXONA',
          reason: `Oshxona liniyasida yangilandi`,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Holatni yangilab bo\'lmadi');
      } else {
        await refreshOrders();
      }
    } catch {
      alert('Tarmoq xatosi');
    }
  };

  const toggleItemDone = (itemId: string) => {
    setCompletedItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const newOrders = orders.filter((o) => o.status === 'confirmed');
  const preparingOrders = orders.filter((o) => o.status === 'preparing');
  const readyOrders = orders.filter((o) => o.status === 'ready');

  return (
    <div className="min-h-screen bg-[#0A0908] text-stone-100 flex flex-col font-sans">
      {/* Top Bar */}
      <header className="px-6 py-3 bg-[#141210] border-b border-stone-800 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <ChefHat className="w-6 h-6" />
          </div>
          <div>
            <div className="font-serif font-bold text-lg text-white flex items-center gap-2">
              <span>OSHXONA EKRANI (KDS)</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono uppercase tracking-wider">
                JONLI
              </span>
            </div>
            <div className="text-xs text-stone-400">Tezkor oshpazlik liniyasi terminali</div>
          </div>
        </div>

        {/* Branch Filter */}
        <div className="flex items-center gap-2 bg-stone-900 px-3 py-1.5 rounded-xl border border-stone-800">
          <Filter className="w-3.5 h-3.5 text-stone-400" />
          <select
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
            }}
            className="bg-transparent text-xs text-stone-200 focus:outline-none cursor-pointer"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id} className="bg-stone-900 text-stone-200">
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
              audioEnabled
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-stone-800 text-stone-500 border-stone-700'
            }`}
          >
            {audioEnabled ? <Volume2 className="w-4 h-4 text-amber-400" /> : <VolumeX className="w-4 h-4" />}
            <span>{audioEnabled ? 'Qo\'ng\'iroq Yoqilgan' : 'Ovozsiz'}</span>
          </button>

          <button
            onClick={() => void refreshOrders()}
            className="p-2 rounded-xl bg-stone-800 text-stone-300 hover:text-white border border-stone-700"
            title="Yangilash"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <SignOutButton className="text-xs text-stone-400 hover:text-white px-2 py-1 disabled:opacity-60" />
        </div>
      </header>

      {/* 3-Column Kanban Board */}
      <main className="flex-1 p-4 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-y-auto">
        {/* USTUN 1: YANGI BUYURTMALAR */}
        <div className="flex flex-col bg-[#110F0D] rounded-2xl border border-stone-800/80 overflow-hidden">
          <div className="p-3.5 bg-amber-950/40 border-b border-amber-900/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
                <h2 className="font-serif font-bold text-sm text-amber-200 tracking-wide">
                  YANGI BUYURTMALAR
                </h2>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-xs font-bold font-mono">
                {newOrders.length} ta
              </span>
            </div>
            <p className="mt-1.5 pl-5 text-[11px] leading-snug text-amber-200/60">
              Buyurtmalar ofitsiant tasdiqlagandan so&apos;ng shu ustunga tushadi.
            </p>
          </div>

          <div className="p-3 space-y-3 flex-1 overflow-y-auto">
            {newOrders.length === 0 ? (
              <div className="py-20 text-center text-stone-600 text-xs">
                {isLoading ? 'Yuklanmoqda...' : <>Yangi kelgan buyurtmalar yo&apos;q</>}
              </div>
            ) : (
              newOrders.map((order) => (
                <OrderTicketCard
                  key={order.id}
                  order={order}
                  now={now}
                  completedItems={completedItems}
                  onToggleItem={toggleItemDone}
                  primaryAction={{
                    label: 'Qabul qilish & Pishirishni boshlash',
                    icon: <Sparkles className="w-4 h-4" />,
                    bg: 'bg-gradient-to-r from-amber-500 to-amber-600 text-stone-950 hover:brightness-110',
                    onClick: () => handleUpdateStatus(order.id, 'preparing'),
                  }}
                />
              ))
            )}
          </div>
        </div>

        {/* USTUN 2: TAYYORLANMOQDA */}
        <div className="flex flex-col bg-[#110F0D] rounded-2xl border border-stone-800/80 overflow-hidden">
          <div className="p-3.5 bg-yellow-950/40 border-b border-yellow-900/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-yellow-400" />
              <h2 className="font-serif font-bold text-sm text-yellow-200 tracking-wide">
                HOZIR PISHIRILMOQDA
              </h2>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-300 text-xs font-bold font-mono">
              {preparingOrders.length} ta
            </span>
          </div>

          <div className="p-3 space-y-3 flex-1 overflow-y-auto">
            {preparingOrders.length === 0 ? (
              <div className="py-20 text-center text-stone-600 text-xs">
                {isLoading ? 'Yuklanmoqda...' : <>Hozir pishirilayotgan taomlar yo&apos;q</>}
              </div>
            ) : (
              preparingOrders.map((order) => (
                <OrderTicketCard
                  key={order.id}
                  order={order}
                  now={now}
                  completedItems={completedItems}
                  onToggleItem={toggleItemDone}
                  primaryAction={{
                    label: 'Taom Tayyor! (Stolga chaqirish)',
                    icon: <Check className="w-4 h-4 stroke-[3]" />,
                    bg: 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-stone-950 hover:brightness-110',
                    onClick: () => handleUpdateStatus(order.id, 'ready'),
                  }}
                />
              ))
            )}
          </div>
        </div>

        {/* USTUN 3: STOLGA TAYYOR */}
        <div className="flex flex-col bg-[#110F0D] rounded-2xl border border-stone-800/80 overflow-hidden">
          <div className="p-3.5 bg-emerald-950/40 border-b border-emerald-900/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-400" />
              <h2 className="font-serif font-bold text-sm text-emerald-200 tracking-wide">
                DASTURXONGA TAYYOR
              </h2>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 text-xs font-bold font-mono">
              {readyOrders.length} ta
            </span>
          </div>

          <div className="p-3 space-y-3 flex-1 overflow-y-auto">
            {readyOrders.length === 0 ? (
              <div className="py-20 text-center text-stone-600 text-xs">
                {isLoading ? 'Yuklanmoqda...' : <>Olib ketish kutilayotgan taomlar yo&apos;q</>}
              </div>
            ) : (
              readyOrders.map((order) => (
                <OrderTicketCard
                  key={order.id}
                  order={order}
                  now={now}
                  completedItems={completedItems}
                  onToggleItem={toggleItemDone}
                  primaryAction={{
                    label: 'Yetkazildi deb yopish',
                    icon: <Check className="w-4 h-4 stroke-[3]" />,
                    bg: 'bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700',
                    onClick: () => handleUpdateStatus(order.id, 'delivered'),
                  }}
                />
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// --- Ticket Card ---
interface OrderTicketCardProps {
  order: Order;
  /** Sahifadagi umumiy soat (har 30 soniyada yangilanadi) — kutish vaqti shundan hisoblanadi. */
  now: number;
  completedItems: Record<string, boolean>;
  onToggleItem: (id: string) => void;
  primaryAction: {
    label: string;
    icon: React.ReactNode;
    bg: string;
    onClick: () => void;
  };
}

function OrderTicketCard({
  order,
  now,
  completedItems,
  onToggleItem,
  primaryAction,
}: OrderTicketCardProps) {
  // Buyurtma qancha vaqtdan beri kutmoqda (created_at dan hozirgacha).
  const createdAtMs = new Date(order.created_at).getTime();
  const waitingMinutes = Number.isFinite(createdAtMs)
    ? Math.max(0, Math.floor((now - createdAtMs) / 60000))
    : 0;

  // 15 daqiqadan oshsa — sokin, miltillamaydigan diqqat belgisi.
  const isWarning = waitingMinutes >= 15 && waitingMinutes < 30;
  const isOverdue = waitingMinutes >= 30;

  const waiterName = order.waiter_name?.trim();

  return (
    <div
      className={`rounded-2xl border bg-stone-900/90 shadow-xl overflow-hidden transition-all ${
        isOverdue
          ? 'border-red-500/80 shadow-red-950/40'
          : isWarning
          ? 'border-amber-500/60 shadow-amber-950/30'
          : 'border-stone-800 hover:border-stone-700'
      }`}
    >
      {/* Ticket Header */}
      <div className="p-3.5 bg-stone-950/80 border-b border-stone-800 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-serif font-black text-lg text-white">
              {order.order_number}
            </span>
            <span className="px-2.5 py-0.5 rounded-lg bg-stone-800 text-gold-300 font-bold text-xs border border-stone-700">
              {order.table_name || `${order.table_number}-stol`}
            </span>
          </div>
          <span className="text-[10px] text-stone-400">
            {formatRelativeTime(order.created_at)}
          </span>
        </div>

        {/* Kutish vaqti */}
        <div className="flex flex-col items-end gap-1">
          <div
            className={`px-3 py-1 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 whitespace-nowrap ${
              isOverdue
                ? 'bg-red-500/15 text-red-200 border border-red-500/50'
                : isWarning
                ? 'bg-amber-500/15 text-amber-200 border border-amber-500/45'
                : 'bg-stone-800 text-stone-300 border border-stone-700'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{waitingMinutes} daqiqa kutmoqda</span>
          </div>
          {(isWarning || isOverdue) && (
            <span
              className={`text-[10px] uppercase tracking-wider ${
                isOverdue ? 'text-red-300/80' : 'text-amber-300/80'
              }`}
            >
              {isOverdue ? 'Kechikmoqda' : 'Kutish uzoq'}
            </span>
          )}
        </div>
      </div>

      {/* Buyurtmani tasdiqlagan ofitsiant */}
      <div className="px-3.5 py-2 bg-stone-950/50 border-b border-stone-800/70 flex items-center gap-2">
        {waiterName ? (
          <>
            <UserCheck className="w-3.5 h-3.5 text-gold-400 flex-shrink-0" />
            <span className="text-[10px] uppercase tracking-wider text-stone-500">Ofitsiant</span>
            <span className="text-xs font-medium text-stone-200 truncate">{waiterName}</span>
          </>
        ) : (
          <>
            <HandPlatter className="w-3.5 h-3.5 text-stone-600 flex-shrink-0" />
            <span className="text-xs text-stone-500 truncate">Ofitsiant biriktirilmagan</span>
          </>
        )}
      </div>

      {/* Customer Notes */}
      {order.customer_notes && (
        <div className="p-2.5 bg-amber-950/30 border-b border-amber-900/30 text-amber-200 text-xs flex items-start gap-1.5 font-medium">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <span>Eslatma: &quot;{order.customer_notes}&quot;</span>
        </div>
      )}

      {/* Line Items */}
      <div className="p-3.5 space-y-2.5 divide-y divide-stone-800/60">
        {order.items.map((item) => {
          const isDone = completedItems[item.id];
          return (
            <div
              key={item.id}
              onClick={() => onToggleItem(item.id)}
              className={`pt-2 first:pt-0 cursor-pointer flex items-start justify-between gap-3 group transition-opacity ${
                isDone ? 'opacity-40 line-through' : 'opacity-100'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`w-5 h-5 rounded-md flex items-center justify-center border mt-0.5 transition-colors ${
                    isDone
                      ? 'bg-emerald-500 border-emerald-500 text-stone-950'
                      : 'border-stone-600 group-hover:border-gold-400'
                  }`}
                >
                  {isDone && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>

                <div>
                  <div className="text-sm font-bold text-stone-100 group-hover:text-gold-200">
                    <span className="text-amber-400 font-extrabold mr-1.5 text-base">
                      {item.quantity}x
                    </span>
                    {item.name_snapshot}
                  </div>

                  {item.selected_options && item.selected_options.length > 0 && (
                    <div className="text-xs text-amber-300 font-medium pl-6 space-y-0.5 mt-0.5">
                      {item.selected_options.map((opt) => (
                        <div key={opt.option_id}>• {opt.option_name}</div>
                      ))}
                    </div>
                  )}

                  {item.notes && (
                    <div className="text-xs text-yellow-300/90 italic pl-6 mt-0.5">
                      &quot;{item.notes}&quot;
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Primary Transition CTA */}
      <div className="p-3 bg-stone-950/60 border-t border-stone-800">
        <button
          onClick={primaryAction.onClick}
          className={`w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 active:scale-98 transition-all shadow-md ${primaryAction.bg}`}
        >
          {primaryAction.icon}
          <span>{primaryAction.label}</span>
        </button>
      </div>
    </div>
  );
}
