'use client';

import { useState, useEffect, useCallback } from 'react';
import { Order, Restaurant } from '@/types/database';
import { getAnalytics, getOrders, getRestaurant, type Analytics } from '@/lib/api';
import { useRealtime } from '@/lib/use-realtime';
import type { RealtimePayload } from '@/lib/realtime/event-bus';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';
import { 
  DollarSign, 
  ShoppingBag, 
  TrendingUp, 
  Users, 
  Clock, 
  ArrowUpRight, 
  Sparkles,
  QrCode
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

const EMPTY_ANALYTICS: Analytics = {
  todayRevenue: 0,
  todayOrders: 0,
  averageOrderValue: 0,
  pendingOrdersCount: 0,
  activeTables: 0,
  popularDishes: [],
};

export default function AdminDashboardPage() {
  const [restaurantId] = useState('rest-001');
  const [analytics, setAnalytics] = useState<Analytics>(EMPTY_ANALYTICS);
  const [orders, setOrders] = useState<Order[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Server is the source of truth: analytics and the live order feed are pulled from the API.
  const refreshData = useCallback(async () => {
    try {
      const [nextAnalytics, nextOrders] = await Promise.all([
        getAnalytics(restaurantId),
        getOrders({ restaurantId }),
      ]);
      setAnalytics(nextAnalytics);
      setOrders(nextOrders);
    } catch (err: unknown) {
      console.error('Boshqaruv paneli ma\'lumotlarini yuklab bo\'lmadi:', err);
    } finally {
      setIsLoading(false);
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
    void refreshData();
  }, [refreshData]);

  const handleRealtimeEvent = useCallback(
    (payload: RealtimePayload) => {
      if (payload.type === 'ORDER_CREATED' || payload.type === 'ORDER_STATUS_CHANGED') {
        void refreshData();
      }
    },
    [refreshData]
  );

  useRealtime({ restaurantId }, handleRealtimeEvent);

  const currencySymbol = restaurant?.currency_symbol || "so'm";

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
        <div>
          <h1 className="font-serif font-bold text-2xl sm:text-3xl text-white">
            Asosiy Boshqaruv Paneli
          </h1>
          <p className="text-xs text-stone-400 mt-1">
            <span className="text-gold-300 font-semibold">{restaurant?.name}</span> uchun barcha buyurtmalar, daromad va stollar hisoboti
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/t/flavoria-t12"
            target="_blank"
            className="px-3.5 py-2 rounded-xl bg-gold-400 text-stone-950 font-bold text-xs shadow-gold-glow hover:brightness-110 transition-all flex items-center gap-1.5"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Mijoz Menyusini Ochish</span>
          </Link>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metrika 1: Tushum */}
        <div className="p-5 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
              Bugungi Umumiy Tushum
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="font-serif font-black text-xl sm:text-2xl text-white">
            {formatCurrency(analytics.todayRevenue, currencySymbol)}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-400 mt-2">
            <TrendingUp className="w-3 h-3" />
            <span>Serverda aniq hisoblangan summa</span>
          </div>
        </div>

        {/* Metrika 2: Buyurtmalar soni */}
        <div className="p-5 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
              Jami Buyurtmalar
            </span>
            <div className="w-8 h-8 rounded-xl bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-400">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="font-serif font-black text-xl sm:text-2xl text-white">
            {analytics.todayOrders} ta buyurtma
          </div>
          <div className="text-[11px] text-stone-400 mt-2">
            O&apos;rtacha chek: <strong className="text-gold-300">{formatCurrency(analytics.averageOrderValue, currencySymbol)}</strong>
          </div>
        </div>

        {/* Metrika 3: Band Stollar */}
        <div className="p-5 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
              Band Stollar
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="font-serif font-black text-xl sm:text-2xl text-white">
            {analytics.activeTables} ta stol band
          </div>
          <div className="text-[11px] text-blue-400 mt-2">
            Zalda hozir ovqatlanayotgan mijozlar
          </div>
        </div>

        {/* Metrika 4: Oshxonadagi Navbat */}
        <div className="p-5 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
              Oshxonadagi Navbat
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="font-serif font-black text-xl sm:text-2xl text-white">
            {analytics.pendingOrdersCount} ta taom
          </div>
          <div className="text-[11px] text-amber-400 mt-2">
            Qabul qilingan & Pishirilmoqda
          </div>
        </div>
      </div>

      {/* Grid: Jonli buyurtmalar & Ko'p sotilganlar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Jonli buyurtmalar */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-surface-100 border border-surface-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-gold-400" />
              <h2 className="font-serif font-bold text-base text-white">
                Jonli Buyurtmalar Oqimi
              </h2>
            </div>
            <Link
              href="/admin/orders"
              className="text-xs text-gold-400 hover:text-gold-300 flex items-center gap-1 font-semibold"
            >
              <span>Hammasini ko&apos;rish</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="space-y-3">
            {orders.slice(0, 5).map((order) => (
              <div
                key={order.id}
                className="p-3.5 rounded-xl bg-surface-50 border border-surface-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-serif font-bold text-sm text-white">
                      {order.order_number}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-surface-200 text-stone-300 text-xs">
                      {order.table_name || `${order.table_number}-stol`}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        order.status === 'ready'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : order.status === 'preparing'
                          ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                          : order.status === 'pending'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-stone-800 text-stone-400'
                      }`}
                    >
                      {order.status === 'ready' ? 'Tayyor' : order.status === 'preparing' ? 'Pishirilmoqda' : order.status === 'pending' ? 'Yangi' : order.status}
                    </span>
                  </div>

                  <div className="text-xs text-stone-400 mt-1">
                    {order.items.map((i) => `${i.quantity}x ${i.name_snapshot}`).join(', ')}
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="font-serif font-bold text-sm text-gold-300">
                    {formatCurrency(order.total, currencySymbol)}
                  </div>
                  <div className="text-[10px] text-stone-500">
                    {formatRelativeTime(order.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Ko'p sotilgan taomlar */}
        <div className="p-5 rounded-2xl bg-surface-100 border border-surface-border">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-gold-400" />
            <h2 className="font-serif font-bold text-base text-white">
              Eng Ko&apos;p Buyurtma Qilinganlar
            </h2>
          </div>

          <div className="space-y-3">
            {analytics.popularDishes.length === 0 ? (
              <p className="text-xs text-stone-500 text-center py-8">
                {isLoading ? 'Yuklanmoqda...' : 'Hozircha sotuvlar qayd etilmadi.'}
              </p>
            ) : (
              analytics.popularDishes.map((dish, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-50 border border-surface-border/60"
                >
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-stone-900 flex-shrink-0 border border-surface-border">
                    <Image
                      src={dish.image}
                      alt={dish.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-serif font-bold text-xs text-stone-100 truncate">
                      {dish.name}
                    </h4>
                    <div className="text-[11px] text-gold-400/90 font-medium">
                      {dish.quantity} ta sotildi • {formatCurrency(dish.revenue, currencySymbol)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
