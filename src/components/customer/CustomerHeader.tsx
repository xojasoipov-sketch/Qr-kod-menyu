'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Restaurant, Branch, Table } from '@/types/database';
import { BellRing, CheckCircle2, Clock, MapPin, Search, Utensils } from 'lucide-react';
import { soundManager } from '@/lib/sound/audio-alerts';

interface CustomerHeaderProps {
  restaurant: Restaurant;
  branch: Branch;
  table: Table;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export default function CustomerHeader({
  restaurant,
  branch,
  table,
  searchQuery,
  onSearchChange,
}: CustomerHeaderProps) {
  const [callingWaiter, setCallingWaiter] = useState(false);
  const [callCooldown, setCallCooldown] = useState(0);
  const [callSuccess, setCallSuccess] = useState(false);

  const handleCallWaiter = async () => {
    if (callCooldown > 0 || callingWaiter) return;

    setCallingWaiter(true);
    try {
      const res = await fetch('/api/waiter-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_id: table.id,
          call_type: 'SERVICE',
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

  return (
    <header className="relative bg-[#0C0A09] border-b border-surface-border">
      {/* Restaurant Banner */}
      <div className="relative h-44 sm:h-52 w-full overflow-hidden">
        {restaurant.banner_url ? (
          <Image
            src={restaurant.banner_url}
            alt={restaurant.name}
            fill
            priority
            className="object-cover brightness-[0.45] scale-105 transition-transform duration-1000"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-stone-900 via-stone-950 to-stone-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0C0A09] via-transparent to-black/60" />

        {/* Top Badges: Table Number & Call Waiter */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-gold-400/30 text-gold-300 text-xs font-semibold shadow-luxury">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{table.name || `${table.number}-stol`}</span>
            {table.zone && <span className="text-stone-400 font-normal">• {table.zone}</span>}
          </div>

          <button
            onClick={handleCallWaiter}
            disabled={callingWaiter || callCooldown > 0}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium backdrop-blur-md transition-all flex items-center gap-1.5 shadow-luxury ${
              callSuccess
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : callCooldown > 0
                ? 'bg-stone-800/80 text-stone-400 border border-stone-700 cursor-not-allowed'
                : 'bg-gold-500/20 text-gold-300 border border-gold-400/40 hover:bg-gold-500/30 active:scale-95'
            }`}
          >
            {callSuccess ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Ofitsiantga xabar berildi</span>
              </>
            ) : callCooldown > 0 ? (
              <>
                <Clock className="w-3.5 h-3.5 animate-spin" />
                <span>Kuting: {callCooldown}s</span>
              </>
            ) : (
              <>
                <BellRing className="w-3.5 h-3.5 text-gold-400 animate-bounce" />
                <span>Ofitsiantni chaqirish</span>
              </>
            )}
          </button>
        </div>

        {/* Restaurant Identity */}
        <div className="absolute bottom-3 left-4 right-4 flex items-end gap-3 z-10">
          <div className="relative w-16 h-16 rounded-2xl overflow-hidden border-2 border-gold-400/50 shadow-gold-glow bg-stone-900 flex-shrink-0">
            <Image
              src={restaurant.logo_url}
              alt={restaurant.name}
              fill
              className="object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-serif text-xl sm:text-2xl font-bold text-white tracking-wide truncate">
              {restaurant.name}
            </h1>
            <p className="text-xs text-gold-300/80 truncate font-light">
              {restaurant.tagline || branch.name}
            </p>
            <div className="flex items-center gap-1 text-[11px] text-stone-400 mt-0.5">
              <MapPin className="w-3 h-3 text-gold-400 flex-shrink-0" />
              <span className="truncate">{branch.address}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search Input */}
      <div className="px-4 py-3 bg-[#14110E]">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Taomlar, osh, shashlik yoki ichimliklarni qidiring..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-100 border border-surface-border text-sm text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400/60 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 hover:text-stone-200 px-1.5 py-0.5 rounded bg-surface-200"
            >
              Tozalash
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
