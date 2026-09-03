'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getOrder, resolveTable } from '@/lib/api';
import { useRealtime } from '@/lib/use-realtime';
import type { RealtimePayload } from '@/lib/realtime/event-bus';
import { Order, OrderStatus, TableResolution } from '@/types/database';
import { STATUS_DISPLAY_INFO } from '@/lib/order-state-machine';
import { soundManager } from '@/lib/sound/audio-alerts';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';
import { 
  CheckCircle2, 
  Clock, 
  ChefHat, 
  Utensils, 
  ArrowLeft, 
  BellRing, 
  Receipt, 
  Sparkles, 
  AlertCircle,
  Check
} from 'lucide-react';

export default function CustomerOrderTrackingPage({
  params,
}: {
  params: Promise<{ token: string; orderId: string }>;
}) {
  const { token, orderId } = use(params);

  const [order, setOrder] = useState<Order | null>(null);
  const [resolution, setResolution] = useState<TableResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [callingWaiter, setCallingWaiter] = useState(false);
  const [callCooldown, setCallCooldown] = useState(0);
  const [callSuccess, setCallSuccess] = useState(false);

  const refetchOrder = useCallback(() => {
    getOrder(orderId)
      .then(setOrder)
      .catch((err: unknown) => {
        console.error('Failed to fetch order', err);
      });
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      getOrder(orderId).catch((err: unknown) => {
        console.error('Failed to fetch order', err);
        return null;
      }),
      resolveTable(token).catch((err: unknown) => {
        console.error('Failed to resolve QR token', err);
        return null;
      }),
    ]).then(([orderData, resolutionData]) => {
      if (cancelled) return;
      setOrder(orderData);
      setResolution(resolutionData);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [orderId, token]);

  const handleRealtimeEvent = useCallback(
    (payload: RealtimePayload) => {
      if (payload.type === 'ORDER_STATUS_CHANGED' && payload.orderId === orderId) {
        if (payload.order) {
          setOrder(payload.order);
        }
        if (payload.newStatus === 'ready') {
          soundManager.playOrderReadyChime();
        }
        refetchOrder();
      }
    },
    [orderId, refetchOrder]
  );

  useRealtime({ orderId }, handleRealtimeEvent);

  const handleCallWaiter = async () => {
    if (callCooldown > 0 || callingWaiter || !resolution) return;

    setCallingWaiter(true);
    try {
      const res = await fetch('/api/waiter-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_id: resolution.table.id,
          call_type: 'ASSISTANCE',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Hozircha ofitsiantni chaqirib bo\'lmadi.');
      } else {
        soundManager.playWaiterCallAlert();
        setCallSuccess(true);
        setCallCooldown(45);

        const timer = setInterval(() => {
          setCallCooldown((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              setCallSuccess(false);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    } catch {
      alert('Tarmoq xatosi.');
    } finally {
      setCallingWaiter(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0C0A09] text-[#FAF5EE] flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full p-8 rounded-3xl bg-surface-100 border border-surface-border animate-pulse">
          <Clock className="w-12 h-12 text-gold-400 mx-auto mb-3" />
          <h1 className="font-serif text-xl font-bold text-white mb-2">Buyurtma yuklanmoqda...</h1>
          <p className="text-stone-400 text-xs">
            <code className="text-gold-300">{orderId}</code>
          </p>
        </div>
      </div>
    );
  }

  if (!order || !resolution) {
    return (
      <div className="min-h-screen bg-[#0C0A09] text-[#FAF5EE] flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full p-8 rounded-3xl bg-surface-100 border border-surface-border">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
          <h1 className="font-serif text-xl font-bold text-white mb-2">Buyurtma Topilmadi</h1>
          <p className="text-stone-400 text-xs mb-6">
            Ushbu buyurtma topilmadi: <code className="text-gold-300">{orderId}</code>.
          </p>
          <Link
            href={`/t/${token}`}
            className="inline-block py-2.5 px-5 rounded-xl bg-gold-400 text-stone-950 font-bold text-xs"
          >
            Menyuga Qaytish
          </Link>
        </div>
      </div>
    );
  }

  const { restaurant, table } = resolution;
  const currentStatusInfo = STATUS_DISPLAY_INFO[order.status];

  /*
   * Mijoz uchun uchta bosqich yetarli. "Yetkazildi" bosqichi olib tashlangan:
   * ofitsiant taomni stolga qo'yganini mijoz o'z ko'zi bilan ko'rib turadi,
   * telefonda buni yana takrorlash ortiqcha. Oshxona va ofitsiant tomonida
   * "yetkazildi" holati o'z o'rnida qoladi — u yerda bu ish holati sifatida
   * kerak.
   */
  const milestones: { key: OrderStatus; label: string; icon: React.ReactNode }[] = [
    { key: 'pending', label: 'Qabul qilindi', icon: <CheckCircle2 className="w-4 h-4" /> },
    { key: 'preparing', label: 'Pishirilmoqda', icon: <ChefHat className="w-4 h-4" /> },
    { key: 'ready', label: 'Stolga tayyor', icon: <Sparkles className="w-4 h-4" /> },
  ];

  const lastStep = milestones.length;

  const getStepProgress = (status: OrderStatus) => {
    switch (status) {
      case 'pending': return 1;
      case 'confirmed': return 1.5;
      case 'preparing': return 2;
      // Taom stolga chiqqach kuzatuv tugaydi — keyingi holatlar ham
      // shu oxirgi bosqichda to'liq bajarilgan ko'rinadi.
      case 'ready':
      case 'delivered':
      case 'completed': return lastStep;
      default: return 0;
    }
  };

  const currentStep = getStepProgress(order.status);

  return (
    <main className="min-h-screen bg-[#0C0A09] text-[#FAF5EE] pb-24">
      {/* Top Header */}
      <header className="sticky top-0 z-30 glass-nav px-4 py-3.5 flex items-center justify-between">
        <Link
          href={`/t/${token}`}
          className="flex items-center gap-1.5 text-xs text-stone-300 hover:text-gold-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Yana Taom Qo&apos;shish</span>
        </Link>

        <div className="text-center">
          <div className="font-serif font-bold text-sm text-gold-300">{order.order_number}</div>
          <div className="text-[10px] text-stone-400">{table.name || `${table.number}-stol`}</div>
        </div>

        <button
          onClick={handleCallWaiter}
          disabled={callingWaiter || callCooldown > 0}
          className={`px-3 py-1 rounded-full text-xs font-medium backdrop-blur-md transition-all flex items-center gap-1 ${
            callSuccess
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : callCooldown > 0
              ? 'bg-stone-800 text-stone-500 cursor-not-allowed'
              : 'bg-gold-500/20 text-gold-300 border border-gold-400/40 hover:bg-gold-500/30'
          }`}
        >
          <BellRing className="w-3 h-3 text-gold-400" />
          <span>{callSuccess ? 'Ofitsiantga aytildi' : callCooldown > 0 ? `${callCooldown}s` : 'Ofitsiantni chaqirish'}</span>
        </button>
      </header>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {/* Live Status Card */}
        <div className="p-6 rounded-3xl bg-surface-100 border border-surface-border relative overflow-hidden shadow-luxury text-center">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gold-400/10 rounded-full blur-3xl" />
          
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-gold-400/20 to-amber-500/10 border-2 border-gold-400/40 flex items-center justify-center mx-auto mb-4 relative">
            <div className="w-14 h-14 rounded-full bg-gold-400/20 flex items-center justify-center text-gold-300 animate-pulse">
              {order.status === 'preparing' ? (
                <ChefHat className="w-7 h-7 animate-bounce" />
              ) : order.status === 'ready' ? (
                <Sparkles className="w-7 h-7 animate-spin" />
              ) : order.status === 'delivered' || order.status === 'completed' ? (
                <Utensils className="w-7 h-7 text-emerald-400" />
              ) : (
                <Clock className="w-7 h-7" />
              )}
            </div>
          </div>

          <span className="text-[11px] font-mono uppercase tracking-widest text-gold-400/90 font-bold block mb-1">
            Buyurtma Holati Jonli
          </span>

          <h1 className="font-serif text-xl sm:text-2xl font-bold text-white mb-2">
            {currentStatusInfo.label}
          </h1>

          <p className="text-xs text-stone-300 max-w-xs mx-auto leading-relaxed">
            {currentStatusInfo.description}
          </p>

          {/* Stepper Timeline */}
          <div className="mt-8 pt-6 border-t border-surface-border/60">
            <div className="grid grid-cols-3 gap-1 relative">
              <div className="absolute top-3.5 left-6 right-6 h-0.5 bg-surface-border -z-0" />
              <div
                className="absolute top-3.5 left-6 h-0.5 bg-gradient-to-r from-gold-400 to-amber-500 -z-0 transition-all duration-700"
                style={{
                  // Chiziq aynan birinchi va oxirgi doira orasida to'ladi
                  // (ikki chetdagi 1.5rem bo'shliq hisobga olingan).
                  width: `calc((100% - 3rem) * ${Math.min(
                    1,
                    Math.max(0, (currentStep - 1) / (milestones.length - 1))
                  )})`,
                }}
              />

              {milestones.map((m, idx) => {
                const stepNum = idx + 1;
                const isPassed = currentStep >= stepNum;
                const isCurrent = Math.floor(currentStep) === stepNum;

                return (
                  <div key={m.key} className="flex flex-col items-center relative z-10">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                        isPassed
                          ? 'bg-gold-400 text-stone-950 shadow-gold-glow scale-105'
                          : 'bg-surface-200 text-stone-500 border border-surface-border'
                      } ${isCurrent ? 'ring-4 ring-gold-400/20' : ''}`}
                    >
                      {isPassed ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : stepNum}
                    </div>
                    <span
                      className={`text-[10px] mt-2 font-medium tracking-tight truncate max-w-full ${
                        isPassed ? 'text-gold-300 font-bold' : 'text-stone-500'
                      }`}
                    >
                      {m.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Digital Receipt */}
        <div className="p-5 rounded-2xl bg-surface-100 border border-surface-border space-y-4">
          <div className="flex items-center justify-between border-b border-surface-border/60 pb-3">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-gold-400" />
              <h2 className="font-serif font-bold text-sm text-white">Buyurtma Cheki</h2>
            </div>
            <span className="text-[11px] text-stone-400">
              {formatRelativeTime(order.created_at)}
            </span>
          </div>

          <div className="space-y-3 divide-y divide-surface-border/40">
            {order.items.map((item, idx) => (
              <div key={idx} className="pt-2.5 first:pt-0 flex items-start justify-between gap-3 text-xs">
                <div>
                  <div className="font-medium text-stone-200">
                    <span className="text-gold-400 font-bold mr-1.5">{item.quantity}x</span>
                    {item.name_snapshot}
                  </div>

                  {item.selected_options && item.selected_options.length > 0 && (
                    <div className="text-[10px] text-stone-400 pl-4 space-y-0.5 mt-0.5">
                      {item.selected_options.map((opt) => (
                        <div key={opt.option_id} className="text-gold-300/80">
                          + {opt.option_name}
                        </div>
                      ))}
                    </div>
                  )}

                  {item.notes && (
                    <div className="text-[10px] text-amber-400/80 italic pl-4 mt-0.5">
                      &quot;{item.notes}&quot;
                    </div>
                  )}
                </div>

                <div className="font-serif font-semibold text-stone-200 flex-shrink-0">
                  {formatCurrency(item.total, restaurant.currency_symbol)}
                </div>
              </div>
            ))}
          </div>

          {/* Totals Breakdown */}
          <div className="pt-3 border-t border-surface-border/60 space-y-1.5 text-xs text-stone-400">
            <div className="flex justify-between">
              <span>Taomlar summasi</span>
              <span className="text-stone-200">{formatCurrency(order.subtotal, restaurant.currency_symbol)}</span>
            </div>
            {order.service_fee > 0 && (
              <div className="flex justify-between">
                <span>Xizmat haqi ({restaurant.service_fee_percentage}%)</span>
                <span className="text-stone-200">{formatCurrency(order.service_fee, restaurant.currency_symbol)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-white pt-2 border-t border-surface-border">
              <span className="font-serif">Jami to&apos;lov</span>
              <span className="font-serif text-gold-300 text-base">{formatCurrency(order.total, restaurant.currency_symbol)}</span>
            </div>
          </div>
        </div>

        {/* Back CTA */}
        <Link
          href={`/t/${token}`}
          className="w-full py-3.5 px-4 rounded-xl bg-surface-100 border border-surface-border hover:border-gold-400/40 text-stone-200 hover:text-white text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-2"
        >
          <Utensils className="w-4 h-4 text-gold-400" />
          <span>Menyuga Qaytish & Yana Taom Tanlash</span>
        </Link>
      </div>
    </main>
  );
}
