'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/db/store';
import { Order, OrderStatus } from '@/types/database';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';
import { STATUS_DISPLAY_INFO } from '@/lib/order-state-machine';
import { 
  ShoppingBag, 
  Search, 
  Receipt, 
  ChevronRight, 
  X,
  History,
  AlertCircle
} from 'lucide-react';

export default function AdminOrdersPage() {
  const [restaurantId] = useState('rest-001');
  const [orders, setOrders] = useState<Order[]>(() => db.getOrdersByRestaurant(restaurantId));
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [restaurant] = useState(() => db.getRestaurant(restaurantId));

  const refreshOrders = () => {
    const updated = db.getOrdersByRestaurant(restaurantId);
    setOrders([...updated]);
    if (selectedOrder) {
      const refreshedSelected = updated.find((o) => o.id === selectedOrder.id);
      if (refreshedSelected) setSelectedOrder(refreshedSelected);
    }
  };

  useEffect(() => {
    const sse = new EventSource(`/api/realtime?restaurant_id=${restaurantId}`);
    sse.onmessage = () => refreshOrders();
    return () => sse.close();
  }, [restaurantId]);

  const filteredOrders = orders.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNum = o.order_number.toLowerCase().includes(q);
      const matchTable = `stol ${o.table_number || ''}`.includes(q);
      const matchItem = o.items.some((i) => i.name_snapshot.toLowerCase().includes(q));
      if (!matchNum && !matchTable && !matchItem) return false;
    }
    return true;
  });

  const currencySymbol = restaurant?.currency_symbol || "so'm";

  const STATUS_FILTER_LABELS: Record<string, string> = {
    all: 'Barcha Buyurtmalar',
    pending: 'Yangi',
    preparing: 'Pishirilmoqda',
    ready: 'Tayyor',
    delivered: 'Yetkazilgan',
    completed: 'Yakunlangan',
    cancelled: 'Bekor qilingan',
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
        <div>
          <h1 className="font-serif font-bold text-2xl sm:text-3xl text-white">
            Buyurtmalar Ro&apos;yxati va Tarix
          </h1>
          <p className="text-xs text-stone-400 mt-1">
            Barcha xarid cheklari, taomlar va har bir buyurtmaning bosqichma-bosqich tarixi.
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface-100 p-3 rounded-2xl border border-surface-border">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buyurtma raqami, stol yoki taom nomi bo'yicha qidiring..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-50 border border-surface-border text-xs text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400"
          />
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto no-scrollbar">
          {['all', 'pending', 'preparing', 'ready', 'delivered', 'completed', 'cancelled'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                statusFilter === status
                  ? 'bg-gold-400 text-stone-950 font-bold'
                  : 'bg-surface-50 text-stone-400 hover:text-white border border-surface-border'
              }`}
            >
              {STATUS_FILTER_LABELS[status] || status}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-100 rounded-2xl border border-surface-border overflow-hidden shadow-luxury">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-300">
            <thead className="bg-surface-50 text-stone-400 uppercase tracking-wider text-[10px] border-b border-surface-border font-semibold">
              <tr>
                <th className="p-4">Buyurtma #</th>
                <th className="p-4">Stol Raqami</th>
                <th className="p-4">Taomlar Ro&apos;yxati</th>
                <th className="p-4">Holati</th>
                <th className="p-4">Umumiy Summa</th>
                <th className="p-4">Vaqti</th>
                <th className="p-4 text-right">Batafsil</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/60">
              {filteredOrders.map((order) => {
                const statusInfo = STATUS_DISPLAY_INFO[order.status];
                return (
                  <tr
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                    className="hover:bg-surface-200/50 transition-colors cursor-pointer"
                  >
                    <td className="p-4 font-serif font-bold text-sm text-white">
                      {order.order_number}
                    </td>

                    <td className="p-4">
                      <span className="px-2.5 py-1 rounded-lg bg-surface-50 border border-surface-border text-stone-300 font-medium">
                        {order.table_name || `${order.table_number}-stol`}
                      </span>
                    </td>

                    <td className="p-4">
                      <div className="line-clamp-1 max-w-xs text-stone-300">
                        {order.items.map((i) => `${i.quantity}x ${i.name_snapshot}`).join(', ')}
                      </div>
                    </td>

                    <td className="p-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase border ${statusInfo.bg} ${statusInfo.color}`}
                      >
                        {statusInfo.label}
                      </span>
                    </td>

                    <td className="p-4 font-serif font-bold text-gold-300 text-sm">
                      {formatCurrency(order.total, currencySymbol)}
                    </td>

                    <td className="p-4 text-stone-400 text-[11px]">
                      {formatRelativeTime(order.created_at)}
                    </td>

                    <td className="p-4 text-right">
                      <span className="text-xs text-gold-400 hover:text-gold-300 font-semibold flex items-center justify-end gap-1">
                        <span>Chekni ko&apos;rish</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-2xl bg-surface-100 border border-surface-border rounded-3xl p-6 shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-surface-border">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-serif font-bold text-xl text-white">
                    {selectedOrder.order_number}
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-lg bg-surface-50 text-gold-300 font-bold text-xs border border-surface-border">
                    {selectedOrder.table_name || `${selectedOrder.table_number}-stol`}
                  </span>
                </div>
                <div className="text-[11px] text-stone-400 mt-0.5">
                  ID: <code className="font-mono text-stone-300">{selectedOrder.id}</code>
                </div>
              </div>

              <button
                onClick={() => setSelectedOrder(null)}
                className="w-8 h-8 rounded-full bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedOrder.customer_notes && (
              <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong>Mijoz Istagi:</strong> &quot;{selectedOrder.customer_notes}&quot;
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="font-serif font-bold text-sm text-stone-200 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-gold-400" />
                <span>Buyurtma Cheki & Taomlar</span>
              </h3>

              <div className="bg-surface-50 rounded-xl p-4 border border-surface-border divide-y divide-surface-border/40 text-xs space-y-2.5">
                {selectedOrder.items.map((item) => (
                  <div key={item.id} className="pt-2 first:pt-0 flex items-start justify-between gap-4">
                    <div>
                      <div className="font-bold text-white">
                        <span className="text-gold-400 mr-1.5">{item.quantity}x</span>
                        {item.name_snapshot}
                      </div>

                      {item.selected_options && item.selected_options.length > 0 && (
                        <div className="text-[11px] text-stone-400 pl-4 space-y-0.5 mt-0.5">
                          {item.selected_options.map((opt) => (
                            <div key={opt.option_id} className="text-gold-300/80">
                              + {opt.option_name} ({formatCurrency(opt.price, currencySymbol)})
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

                    <div className="font-serif font-bold text-gold-300">
                      {formatCurrency(item.total, currencySymbol)}
                    </div>
                  </div>
                ))}

                <div className="pt-3 border-t border-surface-border/60 space-y-1 text-stone-400 text-[11px]">
                  <div className="flex justify-between">
                    <span>Taomlar summasi</span>
                    <span className="text-stone-200">{formatCurrency(selectedOrder.subtotal, currencySymbol)}</span>
                  </div>
                  {selectedOrder.service_fee > 0 && (
                    <div className="flex justify-between">
                      <span>Xizmat haqi ({restaurant?.service_fee_percentage}%)</span>
                      <span className="text-stone-200">{formatCurrency(selectedOrder.service_fee, currencySymbol)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-white pt-1.5 border-t border-surface-border">
                    <span className="font-serif">Jami to&apos;lov</span>
                    <span className="font-serif text-gold-300 text-base">{formatCurrency(selectedOrder.total, currencySymbol)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tarix */}
            <div className="space-y-2">
              <h3 className="font-serif font-bold text-sm text-stone-200 flex items-center gap-1.5">
                <History className="w-4 h-4 text-gold-400" />
                <span>Bosqichma-bosqich O&apos;zgarish Tarixi</span>
              </h3>

              <div className="bg-surface-50 rounded-xl p-3 border border-surface-border space-y-2 text-xs">
                {db.statusHistory.filter((h) => h.order_id === selectedOrder.id).length === 0 ? (
                  <div className="text-stone-500 text-[11px]">
                    Mijoz tomonidan QR menyudan berildi
                  </div>
                ) : (
                  db.statusHistory
                    .filter((h) => h.order_id === selectedOrder.id)
                    .map((history) => (
                      <div key={history.id} className="flex items-center justify-between text-[11px] text-stone-300 pb-1.5 border-b border-surface-border/40 last:border-0 last:pb-0">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-surface-200 font-mono text-[10px]">
                            {history.changed_by}
                          </span>
                          <span>
                            Holat: <strong className="text-gold-300 uppercase">{history.new_status}</strong>
                          </span>
                        </div>
                        <span className="text-stone-500">
                          {formatRelativeTime(history.created_at)}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
