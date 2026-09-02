'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/db/store';
import { WaiterCall, Order, Table } from '@/types/database';
import { soundManager } from '@/lib/sound/audio-alerts';
import { formatRelativeTime } from '@/lib/utils';
import { 
  BellRing, 
  CheckCircle2, 
  Sparkles, 
  Clock, 
  UserCheck, 
  Filter, 
  Volume2, 
  VolumeX, 
  RefreshCw, 
  Check, 
  Layers
} from 'lucide-react';
import Link from 'next/link';

export default function WaiterPanelPage() {
  const [branchId, setBranchId] = useState('branch-001');
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>(() => db.getWaiterCalls(branchId));
  const [orders, setOrders] = useState<Order[]>(() => db.getOrdersByBranch(branchId));
  const [tables, setTables] = useState<Table[]>(() => db.getTablesByBranch(branchId));
  const [audioEnabled, setAudioEnabled] = useState(true);

  const refreshAll = () => {
    setWaiterCalls([...db.getWaiterCalls(branchId)]);
    setOrders([...db.getOrdersByBranch(branchId)]);
    setTables([...db.getTablesByBranch(branchId)]);
  };

  useEffect(() => {
    const sse = new EventSource(`/api/realtime?branch_id=${branchId}`);

    sse.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'WAITER_CALLED') {
          if (audioEnabled) {
            soundManager.playWaiterCallAlert();
          }
          refreshAll();
        } else if (payload.type === 'WAITER_CALL_ACKNOWLEDGED') {
          refreshAll();
        } else if (payload.type === 'ORDER_STATUS_CHANGED') {
          if (payload.newStatus === 'ready' && audioEnabled) {
            soundManager.playOrderReadyChime();
          }
          refreshAll();
        } else if (payload.type === 'ORDER_CREATED') {
          refreshAll();
        }
      } catch (err) {
        console.error('SSE Ofitsiant xatosi:', err);
      }
    };

    return () => sse.close();
  }, [branchId, audioEnabled]);

  const handleAcknowledgeCall = async (callId: string) => {
    try {
      const res = await fetch('/api/waiter-calls', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: callId }),
      });

      if (!res.ok) {
        alert('Xatolik yuz berdi');
      } else {
        refreshAll();
      }
    } catch {
      alert('Tarmoq xatosi');
    }
  };

  const handleMarkDelivered = async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'delivered',
          changed_by: 'OFITSIANT',
          reason: 'Ofitsiant taomni stolga eltib berdi',
        }),
      });

      if (!res.ok) {
        alert('Xatolik yuz berdi');
      } else {
        refreshAll();
      }
    } catch {
      alert('Tarmoq xatosi');
    }
  };

  const pendingCalls = waiterCalls.filter((c) => c.status === 'PENDING');
  const readyOrders = orders.filter((o) => o.status === 'ready');

  const branches = db.branches;

  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-100 font-sans pb-16">
      {/* Header */}
      <header className="px-6 py-3.5 bg-[#141210] border-b border-surface-border flex items-center justify-between sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <BellRing className="w-6 h-6" />
          </div>
          <div>
            <div className="font-serif font-bold text-lg text-white flex items-center gap-2">
              <span>OFITSIANT TERMINALI</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold">
                ULANGAN
              </span>
            </div>
            <div className="text-xs text-stone-400">Stollarga xizmat ko&apos;rsatish va chaqiruvlar</div>
          </div>
        </div>

        {/* Branch Filter */}
        <div className="flex items-center gap-2 bg-surface-100 px-3 py-1.5 rounded-xl border border-surface-border">
          <Filter className="w-3.5 h-3.5 text-stone-400" />
          <select
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setWaiterCalls([...db.getWaiterCalls(e.target.value)]);
              setOrders([...db.getOrdersByBranch(e.target.value)]);
              setTables([...db.getTablesByBranch(e.target.value)]);
            }}
            className="bg-transparent text-xs text-stone-200 focus:outline-none cursor-pointer"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id} className="bg-surface-100 text-stone-200">
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
              audioEnabled
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                : 'bg-surface-100 text-stone-500 border-surface-border'
            }`}
          >
            {audioEnabled ? <Volume2 className="w-4 h-4 text-blue-400" /> : <VolumeX className="w-4 h-4" />}
            <span>{audioEnabled ? 'Qo\'ng\'iroq Yoqilgan' : 'Ovozsiz'}</span>
          </button>

          <button
            onClick={refreshAll}
            className="p-2 rounded-xl bg-surface-100 text-stone-300 hover:text-white border border-surface-border"
            title="Yangilash"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <Link href="/" className="text-xs text-stone-400 hover:text-white px-2 py-1">
            Chiqish
          </Link>
        </div>
      </header>

      {/* Main Grid */}
      <main className="p-6 max-w-7xl mx-auto space-y-6">
        {/* 1-BO'LIM: STOL CHAQIRUVLARI */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-400 animate-ping" />
              <h2 className="font-serif font-bold text-base text-white">
                Mijozlar Tomonidan Chaqiruvlar (Jonli)
              </h2>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-300 text-xs font-bold font-mono">
              {pendingCalls.length} ta kutilmoqda
            </span>
          </div>

          {pendingCalls.length === 0 ? (
            <div className="p-6 rounded-2xl bg-surface-100/40 border border-surface-border text-center text-stone-400 text-xs">
              <UserCheck className="w-8 h-8 text-stone-600 mx-auto mb-1.5" />
              Barcha stollarga xizmat ko&apos;rsatilgan. Yangi chaqiruvlar yo&apos;q.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingCalls.map((call) => (
                <div
                  key={call.id}
                  className="p-4 rounded-2xl bg-red-950/30 border border-red-500/50 shadow-luxury animate-pulse-subtle flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-red-400">
                        OFITSIANT CHAQIRILMOQDA
                      </span>
                      <h3 className="font-serif font-black text-xl text-white">
                        {call.table_name || `${call.table_number}-stol`}
                      </h3>
                      <div className="flex items-center gap-1 text-xs text-stone-300 mt-1">
                        <Clock className="w-3.5 h-3.5 text-red-400" />
                        <span>{formatRelativeTime(call.created_at)} chaqirdi</span>
                      </div>
                    </div>

                    <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400">
                      <BellRing className="w-5 h-5 animate-bounce" />
                    </div>
                  </div>

                  <button
                    onClick={() => handleAcknowledgeCall(call.id)}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold text-xs tracking-wider uppercase shadow-md hover:brightness-110 active:scale-98 transition-all flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>Qabul qildim (Bordim)</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 2-BO'LIM: OSHXONADAN TAYYOR TAOMLAR */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <h2 className="font-serif font-bold text-base text-white">
                Oshxonada Pishgan va Stolga Olib Borish Kerak Bo&apos;lgan Taomlar
              </h2>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold font-mono">
              {readyOrders.length} ta tayyor
            </span>
          </div>

          {readyOrders.length === 0 ? (
            <div className="p-6 rounded-2xl bg-surface-100/40 border border-surface-border text-center text-stone-400 text-xs">
              Oshxona tarqatish joyida tayyor taomlar yo&apos;q.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {readyOrders.map((order) => (
                <div
                  key={order.id}
                  className="p-4 rounded-2xl bg-emerald-950/25 border border-emerald-500/40 shadow-luxury flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-serif font-black text-lg text-white">
                        {order.order_number}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold text-xs border border-emerald-500/40">
                        {order.table_name || `${order.table_number}-stol`}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-stone-200 mb-4 divide-y divide-stone-800/40">
                      {order.items.map((item, i) => (
                        <div key={i} className="pt-1.5 first:pt-0 flex items-center justify-between">
                          <span>
                            <strong className="text-emerald-400 mr-1">{item.quantity}x</strong>
                            {item.name_snapshot}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => handleMarkDelivered(order.id)}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-stone-950 font-bold text-xs tracking-wider uppercase hover:brightness-110 active:scale-98 transition-all flex items-center justify-center gap-1.5 shadow-md"
                  >
                    <CheckCircle2 className="w-4 h-4 text-stone-950" />
                    <span>Stolga Yetkazildi</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3-BO'LIM: ZALDAGI STOLLAR HOLATI */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-gold-400" />
              <h2 className="font-serif font-bold text-base text-white">
                Zaldagi Stollar Holati
              </h2>
            </div>
            <span className="text-xs text-stone-400">
              Jami: {tables.length} ta stol
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {tables.map((table) => {
              const tableActiveOrders = orders.filter(
                (o) => o.table_id === table.id && !['completed', 'cancelled'].includes(o.status)
              );
              const isOccupied = tableActiveOrders.length > 0;
              const hasReady = tableActiveOrders.some((o) => o.status === 'ready');
              const hasCall = pendingCalls.some((c) => c.table_id === table.id);

              return (
                <div
                  key={table.id}
                  className={`p-3.5 rounded-xl border transition-all ${
                    hasCall
                      ? 'bg-red-950/40 border-red-500 shadow-red-900/40 shadow-lg'
                      : hasReady
                      ? 'bg-emerald-950/40 border-emerald-500 shadow-emerald-900/30 shadow-md'
                      : isOccupied
                      ? 'bg-surface-100 border-gold-400/40'
                      : 'bg-surface-50 border-surface-border/60 opacity-70'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-serif font-bold text-sm text-white">
                      {table.name || `${table.number}-stol`}
                    </span>
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        hasCall
                          ? 'bg-red-400 animate-ping'
                          : hasReady
                          ? 'bg-emerald-400 animate-pulse'
                          : isOccupied
                          ? 'bg-amber-400'
                          : 'bg-stone-600'
                      }`}
                    />
                  </div>

                  <div className="text-[11px] text-stone-400 truncate">
                    {table.zone || 'Asosiy Zal'}
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-surface-border/40 text-[10px]">
                    {hasCall ? (
                      <span className="text-red-300 font-bold">Chaqiryapti!</span>
                    ) : hasReady ? (
                      <span className="text-emerald-300 font-bold">Taom tayyor</span>
                    ) : isOccupied ? (
                      <span className="text-amber-300 font-medium">Faol buyurtma ({tableActiveOrders.length})</span>
                    ) : (
                      <span className="text-stone-500">Bo&apos;sh</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
