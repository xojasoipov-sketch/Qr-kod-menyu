'use client';

import { useState } from 'react';
import { db } from '@/lib/db/store';
import { MenuCategory } from '@/types/database';
import { FolderTree, Plus, X } from 'lucide-react';
import Image from 'next/image';

export default function AdminCategoriesPage() {
  const [restaurantId] = useState('rest-001');
  const [categories, setCategories] = useState<MenuCategory[]>(() => db.getCategories(restaurantId));
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [icon, setIcon] = useState('UtensilsCrossed');
  const [imageUrl, setImageUrl] = useState('');

  const refreshCategories = () => {
    setCategories([...db.getCategories(restaurantId)]);
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    try {
      const payload = {
        restaurant_id: restaurantId,
        name,
        slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
        icon,
        image_url: imageUrl || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=400&q=80',
        sort_order: categories.length + 1,
        is_active: true,
      };

      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        refreshCategories();
        setIsAddModalOpen(false);
        setName('');
        setSlug('');
        setImageUrl('');
      } else {
        const d = await res.json();
        alert(d.error || 'Kategoriyani qo\'shib bo\'lmadi');
      }
    } catch {
      alert('Tarmoq xatosi');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
        <div>
          <h1 className="font-serif font-bold text-2xl sm:text-3xl text-white">
            Kategoriyalar Boshqaruvi
          </h1>
          <p className="text-xs text-stone-400 mt-1">
            Menyudagi taomlar turlarini ajratish, ketma-ketlik va rasmlarini sozlash.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-gold-400 to-amber-500 text-stone-950 font-bold text-xs shadow-gold-glow hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Yangi Kategoriya Qo&apos;shish</span>
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((cat, idx) => (
          <div
            key={cat.id}
            className="p-4 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury flex items-center justify-between gap-3 group hover:border-gold-400/50 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-stone-900 border border-surface-border flex-shrink-0">
                {cat.image_url ? (
                  <Image
                    src={cat.image_url}
                    alt={cat.name}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gold-400">
                    <FolderTree className="w-6 h-6" />
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-gold-400 font-bold">
                    #{idx + 1}
                  </span>
                  <h3 className="font-serif font-bold text-sm text-white">
                    {cat.name}
                  </h3>
                </div>
                <span className="text-[11px] text-stone-400">
                  Kalit: <code className="text-stone-300 font-mono">{cat.slug}</code>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold border border-emerald-500/30">
                Faol
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-surface-100 border border-surface-border rounded-3xl p-6 shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between pb-4 border-b border-surface-border mb-4">
              <h2 className="font-serif font-bold text-lg text-white">Kategoriya Qo&apos;shish</h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-stone-300 font-semibold mb-1">Kategoriya Nomi *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Masalan: Milliy Taomlar"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Belgi (Icon)</label>
                <select
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                >
                  <option value="Sparkles">Yulduzcha / Tavsiyalar</option>
                  <option value="UtensilsCrossed">Milliy Taomlar / Vilka-pichoq</option>
                  <option value="Flame">Olov / Shashliklar</option>
                  <option value="CookingPot">Qozon / Issiq Taomlar</option>
                  <option value="Sandwich">Burgerlar / Fast Food</option>
                  <option value="Salad">Salatlar</option>
                  <option value="Cake">Shirinliklar</option>
                  <option value="Wine">Choylar & Ichimliklar</option>
                </select>
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Rasm Havolasi (URL)</label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div className="pt-4 border-t border-surface-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-surface-200 text-stone-300 hover:text-white"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gold-400 text-stone-950 font-bold hover:bg-gold-300"
                >
                  Saqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
