'use client';

import { MenuCategory } from '@/types/database';
import { 
  Sparkles, 
  UtensilsCrossed, 
  Flame, 
  CookingPot, 
  Sandwich, 
  Salad, 
  Cake, 
  Wine, 
  Tag, 
  Layers 
} from 'lucide-react';

interface CategoryNavProps {
  categories: MenuCategory[];
  activeCategoryId: string;
  onSelectCategory: (id: string) => void;
  categoryItemCounts: Record<string, number>;
  totalItemsCount: number;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  Sparkles: <Sparkles className="w-3.5 h-3.5" />,
  UtensilsCrossed: <UtensilsCrossed className="w-3.5 h-3.5" />,
  Flame: <Flame className="w-3.5 h-3.5" />,
  CookingPot: <CookingPot className="w-3.5 h-3.5" />,
  Sandwich: <Sandwich className="w-3.5 h-3.5" />,
  Salad: <Salad className="w-3.5 h-3.5" />,
  Cake: <Cake className="w-3.5 h-3.5" />,
  Wine: <Wine className="w-3.5 h-3.5" />,
};

export default function CategoryNav({
  categories,
  activeCategoryId,
  onSelectCategory,
  categoryItemCounts,
  totalItemsCount,
}: CategoryNavProps) {
  return (
    <nav aria-label="Menu categories" className="sticky top-0 z-30 bg-[#0C0A09]/95 backdrop-blur-md border-b border-surface-border py-2.5 px-4 overflow-x-auto no-scrollbar shadow-md">
      <div className="flex items-center gap-2 min-w-max">
        {/* Barcha Taomlar */}
        <button
          onClick={() => onSelectCategory('all')}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 flex items-center gap-1.5 ${
            activeCategoryId === 'all'
              ? 'bg-gradient-to-r from-gold-400 to-amber-500 text-stone-950 shadow-gold-glow font-bold'
              : 'bg-surface-100 text-stone-400 border border-surface-border hover:border-gold-400/40 hover:text-stone-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Barcha Taomlar</span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
            activeCategoryId === 'all' ? 'bg-stone-950/20 text-stone-950 font-bold' : 'bg-surface-200 text-stone-400'
          }`}>
            {totalItemsCount}
          </span>
        </button>

        {/* Kategoriyalar */}
        {categories.map((cat) => {
          const isActive = activeCategoryId === cat.id;
          const count = categoryItemCounts[cat.id] || 0;
          const icon = cat.icon && ICON_MAP[cat.icon] ? ICON_MAP[cat.icon] : <Tag className="w-3.5 h-3.5" />;

          return (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${
                isActive
                  ? 'bg-gradient-to-r from-gold-400 to-amber-500 text-stone-950 shadow-gold-glow font-bold'
                  : 'bg-surface-100 text-stone-400 border border-surface-border hover:border-gold-400/40 hover:text-stone-200'
              }`}
            >
              <span className={isActive ? 'text-stone-950' : 'text-gold-400'}>{icon}</span>
              <span>{cat.name}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  isActive ? 'bg-stone-950/20 text-stone-950 font-bold' : 'bg-surface-200 text-stone-400'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
