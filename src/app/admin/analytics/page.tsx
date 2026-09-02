'use client';

import { useState, useEffect, useCallback } from 'react';
import { Restaurant } from '@/types/database';
import { getAnalytics, getRestaurant, type Analytics } from '@/lib/api';
import { useRealtime } from '@/lib/use-realtime';
import type { RealtimePayload } from '@/lib/realtime/event-bus';
import { formatCurrency } from '@/lib/utils';
import { TrendingUp, DollarSign, UtensilsCrossed, Sparkles } from 'lucide-react';
import Image from 'next/image';

const EMPTY_ANALYTICS: Analytics = {
  todayRevenue: 0,
  todayOrders: 0,
  averageOrderValue: 0,
  pendingOrdersCount: 0,
  activeTables: 0,
  popularDishes: [],
};

export default function AdminAnalyticsPage() {
  const [restaurantId] = useState('rest-001');
  const [analytics, setAnalytics] = useState<Analytics>(EMPTY_ANALYTICS);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const currencySymbol = restaurant?.currency_symbol || "so'm";

  // Server is the source of truth: analytics are computed on the server and pulled from the API.
  const refreshAnalytics = useCallback(async () => {
    try {
      const next = await getAnalytics(restaurantId);
      setAnalytics(next);
    } catch (err: unknown) {
      console.error('Tahlil ma\'lumotlarini yuklab bo\'lmadi:', err);
    }
  }, [restaurantId]);

  useEffect(() => {
    let cancelled = false;
    getRestaurant(restaurantId)
      .then((r) => {
        if (!cancelled) setRestaurant(r);
      })
      .catch((err: unknown) => {
        console.error('Restoran ma\'lumotlarini yuklab bo\'lmadi:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  useEffect(() => {
    void refreshAnalytics();
  }, [refreshAnalytics]);

  const handleRealtimeEvent = useCallback(
    (payload: RealtimePayload) => {
      if (payload.type === 'ORDER_STATUS_CHANGED' || payload.type === 'ORDER_CREATED') {
        void refreshAnalytics();
      }
    },
    [refreshAnalytics]
  );

  useRealtime({ restaurantId }, handleRealtimeEvent);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
        <div>
          <h1 className="font-serif font-bold text-2xl sm:text-3xl text-white">
            Moliyaviy Tahlil & Savdo Ko&apos;rsatkichlari
          </h1>
          <p className="text-xs text-stone-400 mt-1">
            Haqiqiy buyurtmalar tahlili, o&apos;rtacha chek va eng ko&apos;p daromad keltirgan taomlar.
          </p>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-stone-400 font-semibold uppercase tracking-wider">
              Haqiqiy Tushum
            </span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="font-serif font-black text-xl sm:text-2xl text-white">
            {formatCurrency(analytics.todayRevenue, currencySymbol)}
          </div>
          <div className="text-[11px] text-emerald-400 mt-2">
            Serverda tekshirilgan va hisoblangan
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-stone-400 font-semibold uppercase tracking-wider">
              O&apos;rtacha Chek Summasi (AOV)
            </span>
            <TrendingUp className="w-4 h-4 text-gold-400" />
          </div>
          <div className="font-serif font-black text-xl sm:text-2xl text-white">
            {formatCurrency(analytics.averageOrderValue, currencySymbol)}
          </div>
          <div className="text-[11px] text-stone-400 mt-2">
            {analytics.todayOrders} ta muvaffaqiyatli buyurtma bo&apos;yicha
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-stone-400 font-semibold uppercase tracking-wider">
              Band Qilingan Stollar
            </span>
            <UtensilsCrossed className="w-4 h-4 text-blue-400" />
          </div>
          <div className="font-serif font-black text-xl sm:text-2xl text-white">
            {analytics.activeTables} ta stol
          </div>
          <div className="text-[11px] text-blue-400 mt-2">
            Zaldagi yuqori xizmat ko&apos;rsatish ko&apos;rsatkichi
          </div>
        </div>
      </div>

      {/* Top Dishes */}
      <div className="p-6 rounded-2xl bg-surface-100 border border-surface-border space-y-4 shadow-luxury">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gold-400" />
          <h2 className="font-serif font-bold text-base text-white">
            Eng Ko&apos;p Daromad Keltirgan Taomlar
          </h2>
        </div>

        <div className="space-y-3">
          {analytics.popularDishes.map((dish, idx) => {
            const revenuePct = analytics.todayRevenue > 0 ? (dish.revenue / analytics.todayRevenue) * 100 : 0;

            return (
              <div key={idx} className="p-3.5 rounded-xl bg-surface-50 border border-surface-border/60">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3">
                    <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-stone-900 border border-surface-border flex-shrink-0">
                      <Image
                        src={dish.image}
                        alt={dish.name}
                        fill
                        className="object-cover"
                      />
                    </div>
                    <div>
                      <h3 className="font-serif font-bold text-xs text-white">
                        {dish.name}
                      </h3>
                      <span className="text-[11px] text-stone-400">
                        {dish.quantity} porsiya tortildi
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-serif font-bold text-gold-300 text-sm">
                    {formatCurrency(dish.revenue, currencySymbol)}
                  </div>
                </div>

                <div className="w-full h-1.5 rounded-full bg-stone-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-gold-400 to-amber-500 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(5, revenuePct))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
