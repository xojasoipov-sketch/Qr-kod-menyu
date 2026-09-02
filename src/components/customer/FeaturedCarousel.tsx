'use client';

import Image from 'next/image';
import { MenuItem } from '@/types/database';
import { Sparkles, Plus, Clock, Flame } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface FeaturedCarouselProps {
  items: MenuItem[];
  currencySymbol: string;
  onSelectItem: (item: MenuItem) => void;
}

export default function FeaturedCarousel({
  items,
  currencySymbol,
  onSelectItem,
}: FeaturedCarouselProps) {
  const featured = items.filter((i) => i.is_featured);

  if (featured.length === 0) return null;

  return (
    <section className="py-4 px-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gold-400" />
          <h2 className="font-serif text-base font-bold text-white tracking-wide">
            Bosh Oshpaz Tavsiyalari
          </h2>
        </div>
        <span className="text-[11px] text-gold-400/80 font-medium">Yangi pishirilgan</span>
      </div>

      <div className="flex gap-3.5 overflow-x-auto no-scrollbar pb-2 snap-x snap-mandatory">
        {featured.map((item) => (
          <div
            key={item.id}
            onClick={() => onSelectItem(item)}
            className="flex-shrink-0 w-[270px] sm:w-[300px] snap-start rounded-2xl bg-surface-100 border border-surface-border overflow-hidden cursor-pointer hover:border-gold-400/50 hover:bg-surface-200 transition-all duration-300 shadow-luxury group"
          >
            {/* Rasm */}
            <div className="relative h-36 w-full overflow-hidden">
              <Image
                src={item.image_url}
                alt={item.name}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-surface-100 via-transparent to-black/30" />
              
              <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-full bg-gold-500/90 text-stone-950 text-[10px] font-bold tracking-wider uppercase">
                  Tavsiya
                </span>
                {item.spicy_level > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-red-500/80 text-white text-[10px] font-semibold flex items-center gap-0.5">
                    <Flame className="w-2.5 h-2.5" />
                    {'🌶️'.repeat(item.spicy_level)}
                  </span>
                )}
              </div>

              <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[11px] text-stone-300 flex items-center gap-1">
                <Clock className="w-3 h-3 text-gold-400" />
                <span>{item.preparation_time} daqiqa</span>
              </div>
            </div>

            {/* Matn */}
            <div className="p-3.5 flex flex-col justify-between">
              <div>
                <h3 className="font-serif font-bold text-sm text-white group-hover:text-gold-300 transition-colors line-clamp-1">
                  {item.name}
                </h3>
                <p className="text-xs text-stone-400 line-clamp-2 mt-1 font-light leading-relaxed">
                  {item.description}
                </p>
              </div>

              <div className="mt-3 pt-2.5 border-t border-surface-border/60 flex items-center justify-between">
                <div className="font-serif text-base font-bold text-gold-300">
                  {formatCurrency(item.price, currencySymbol)}
                </div>
                <button
                  type="button"
                  aria-label={`${item.name} taomini tanlash`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectItem(item);
                  }}
                  className="px-3 py-1 rounded-xl bg-gold-400/20 border border-gold-400/40 text-gold-300 text-xs font-semibold hover:bg-gold-400 hover:text-stone-950 active:scale-95 transition-all flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tanlash</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
