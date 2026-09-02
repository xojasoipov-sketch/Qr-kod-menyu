'use client';

import Image from 'next/image';
import { MenuItem } from '@/types/database';
import { Clock, Plus, Ban, Flame } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface FoodCardProps {
  item: MenuItem;
  currencySymbol: string;
  onSelectItem: (item: MenuItem) => void;
}

const DIETARY_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  halal: { label: 'Halol', bg: 'bg-emerald-500/15 border-emerald-500/30', text: 'text-emerald-300' },
  vegan: { label: 'Vegan', bg: 'bg-green-500/15 border-green-500/30', text: 'text-green-300' },
  vegetarian: { label: 'Vegetarian', bg: 'bg-lime-500/15 border-lime-500/30', text: 'text-lime-300' },
  gluten_free: { label: 'Glyutensiz', bg: 'bg-amber-500/15 border-amber-500/30', text: 'text-amber-300' },
  chef_special: { label: 'Oshpaz Tavsiyasi', bg: 'bg-gold-500/20 border-gold-500/40', text: 'text-gold-300' },
};

export default function FoodCard({ item, currencySymbol, onSelectItem }: FoodCardProps) {
  const isAvailable = item.is_available;

  return (
    <div
      onClick={() => isAvailable && onSelectItem(item)}
      className={`relative rounded-2xl bg-surface-100 border transition-all duration-300 overflow-hidden flex flex-col justify-between ${
        isAvailable
          ? 'border-surface-border hover:border-gold-400/50 hover:bg-surface-200 cursor-pointer shadow-luxury group'
          : 'border-stone-800/60 opacity-60 cursor-not-allowed bg-stone-900/40'
      }`}
    >
      {/* Top Image */}
      <div className="relative h-44 w-full overflow-hidden bg-stone-950">
        <Image
          src={item.image_url}
          alt={item.name}
          fill
          className={`object-cover transition-transform duration-500 ${
            isAvailable ? 'group-hover:scale-105' : 'grayscale'
          }`}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-surface-100 via-transparent to-black/20" />

        {/* Unavailable banner */}
        {!isAvailable && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-3 text-center">
            <div className="px-3 py-1 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-semibold flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5" />
              <span>Sotuvda tugagan</span>
            </div>
          </div>
        )}

        {/* Dietary Chips */}
        {isAvailable && item.dietary_flags && item.dietary_flags.length > 0 && (
          <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1">
            {item.dietary_flags.slice(0, 2).map((flag) => {
              const d = DIETARY_LABELS[flag];
              if (!d) return null;
              return (
                <span
                  key={flag}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium border backdrop-blur-md ${d.bg} ${d.text}`}
                >
                  {d.label}
                </span>
              );
            })}
          </div>
        )}

        {/* Spicy & Prep Time */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
          {item.spicy_level > 0 && (
            <div className="px-2 py-0.5 rounded-md bg-red-950/80 border border-red-500/30 text-[10px] text-red-300 font-semibold flex items-center gap-0.5 backdrop-blur-sm">
              <Flame className="w-2.5 h-2.5 text-red-400" />
              <span>{'🌶️'.repeat(item.spicy_level)}</span>
            </div>
          )}
          <div className="px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-sm text-[10px] text-stone-300 flex items-center gap-1">
            <Clock className="w-3 h-3 text-gold-400" />
            <span>{item.preparation_time} daq</span>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="p-3.5 flex flex-col justify-between flex-1">
        <div>
          <h3 className="font-serif font-bold text-sm text-stone-100 group-hover:text-gold-300 transition-colors line-clamp-1">
            {item.name}
          </h3>
          <p className="text-xs text-stone-400 line-clamp-2 mt-1 leading-relaxed font-light">
            {item.description}
          </p>
        </div>

        {/* Footer with Price and Add CTA */}
        <div className="mt-3.5 pt-2.5 border-t border-surface-border/60 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-stone-500 uppercase tracking-wider block">Narxi</span>
            <span className="font-serif font-bold text-sm text-gold-300">
              {formatCurrency(item.price, currencySymbol)}
            </span>
          </div>

          <button
            type="button"
            disabled={!isAvailable}
            onClick={(e) => {
              e.stopPropagation();
              if (isAvailable) onSelectItem(item);
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
              isAvailable
                ? 'bg-gradient-to-r from-gold-400 to-amber-500 text-stone-950 shadow-gold-glow hover:brightness-110 active:scale-95'
                : 'bg-stone-800 text-stone-500 cursor-not-allowed'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{item.option_groups && item.option_groups.length > 0 ? 'Tanlash' : 'Qo\'shish'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
