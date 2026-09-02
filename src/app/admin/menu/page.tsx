'use client';

import { useState } from 'react';
import { db } from '@/lib/db/store';
import { MenuItem, MenuCategory } from '@/types/database';
import { formatCurrency } from '@/lib/utils';
import { 
  Plus, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Flame, 
  Clock, 
  ToggleLeft, 
  ToggleRight,
  X
} from 'lucide-react';
import Image from 'next/image';

export default function AdminMenuPage() {
  const [restaurantId] = useState('rest-001');
  const [items, setItems] = useState<MenuItem[]>(() => db.getMenuItems(restaurantId));
  const [categories] = useState<MenuCategory[]>(() => db.getCategories(restaurantId));
  const [restaurant] = useState(() => db.getRestaurant(restaurantId));
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [prepTime, setPrepTime] = useState('15');
  const [spicyLevel, setSpicyLevel] = useState('0');
  const [ingredientsText, setIngredientsText] = useState('');

  const refreshItems = () => {
    setItems([...db.getMenuItems(restaurantId)]);
  };

  const handleToggleAvailability = async (itemId: string) => {
    try {
      const res = await fetch(`/api/menu-items/${itemId}/toggle`, {
        method: 'POST',
      });
      if (res.ok) {
        refreshItems();
      }
    } catch {
      alert('Holatni o\'zgartirib bo\'lmadi');
    }
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !price || !categoryId) {
      alert('Iltimos, barcha maydonlarni to\'ldiring');
      return;
    }

    try {
      const payload = {
        restaurant_id: restaurantId,
        category_id: categoryId,
        name,
        description,
        price: parseFloat(price),
        image_url: imageUrl || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
        ingredients: ingredientsText.split(',').map((s) => s.trim()).filter(Boolean),
        spicy_level: parseInt(spicyLevel, 10),
        preparation_time: parseInt(prepTime, 10),
        is_available: true,
      };

      const res = await fetch('/api/menu-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        refreshItems();
        setIsAddModalOpen(false);
        setName('');
        setDescription('');
        setPrice('');
        setImageUrl('');
        setIngredientsText('');
      } else {
        const d = await res.json();
        alert(d.error || 'Taomni qo\'shib bo\'lmadi');
      }
    } catch {
      alert('Tarmoq xatosi');
    }
  };

  const filteredItems = items.filter((item) => {
    if (selectedCategory !== 'all' && item.category_id !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const currencySymbol = restaurant?.currency_symbol || "so'm";

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
        <div>
          <h1 className="font-serif font-bold text-2xl sm:text-3xl text-white">
            Menyu & Taomlar Boshqaruvi
          </h1>
          <p className="text-xs text-stone-400 mt-1">
            Taomlar qo&apos;shish, narxlarni belgilash va 1 ta bosishda &quot;Sotuvda bor / yo&apos;q&quot; qilish.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-gold-400 to-amber-500 text-stone-950 font-bold text-xs shadow-gold-glow hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Yangi Taom Qo&apos;shish</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface-100 p-3 rounded-2xl border border-surface-border">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Taomlarni qidirish..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-50 border border-surface-border text-xs text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto no-scrollbar">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
              selectedCategory === 'all'
                ? 'bg-gold-400 text-stone-950 font-bold'
                : 'bg-surface-50 text-stone-400 hover:text-white border border-surface-border'
            }`}
          >
            Barcha Taomlar ({items.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                selectedCategory === cat.id
                  ? 'bg-gold-400 text-stone-950 font-bold'
                  : 'bg-surface-50 text-stone-400 hover:text-white border border-surface-border'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Dishes Table */}
      <div className="bg-surface-100 rounded-2xl border border-surface-border overflow-hidden shadow-luxury">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-300">
            <thead className="bg-surface-50 text-stone-400 uppercase tracking-wider text-[10px] border-b border-surface-border font-semibold">
              <tr>
                <th className="p-4">Taom Nomi va Ma&apos;lumoti</th>
                <th className="p-4">Kategoriya</th>
                <th className="p-4">Narxi</th>
                <th className="p-4">Tayyorlanish</th>
                <th className="p-4">Achchiqligi</th>
                <th className="p-4">Sotuvda Borligi</th>
                <th className="p-4 text-right">O&apos;zgartirish</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/60">
              {filteredItems.map((item) => {
                const category = categories.find((c) => c.id === item.category_id);
                return (
                  <tr key={item.id} className="hover:bg-surface-200/50 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-stone-900 border border-surface-border flex-shrink-0">
                          <Image
                            src={item.image_url}
                            alt={item.name}
                            fill
                            className="object-cover"
                          />
                        </div>
                        <div>
                          <div className="font-serif font-bold text-sm text-white">
                            {item.name}
                          </div>
                          <div className="text-[11px] text-stone-400 line-clamp-1 max-w-xs">
                            {item.description}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="p-4">
                      <span className="px-2.5 py-1 rounded-lg bg-surface-50 border border-surface-border text-stone-300">
                        {category?.name || 'Kategoriyasiz'}
                      </span>
                    </td>

                    <td className="p-4 font-serif font-bold text-gold-300 text-sm">
                      {formatCurrency(item.price, currencySymbol)}
                    </td>

                    <td className="p-4">
                      <div className="flex items-center gap-1 text-stone-300">
                        <Clock className="w-3.5 h-3.5 text-gold-400" />
                        <span>{item.preparation_time} daq</span>
                      </div>
                    </td>

                    <td className="p-4">
                      {item.spicy_level > 0 ? (
                        <div className="flex items-center gap-1 text-red-400">
                          <Flame className="w-3.5 h-3.5" />
                          <span>{'🌶️'.repeat(item.spicy_level)}</span>
                        </div>
                      ) : (
                        <span className="text-stone-500">Oddiy</span>
                      )}
                    </td>

                    <td className="p-4">
                      <button
                        onClick={() => handleToggleAvailability(item.id)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all ${
                          item.is_available
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-red-500/20 text-red-300 border border-red-500/30'
                        }`}
                      >
                        {item.is_available ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Sotuvda Bor (Faol)</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5 text-red-400" />
                            <span>Sotuvda Yo&apos;q</span>
                          </>
                        )}
                      </button>
                    </td>

                    <td className="p-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleToggleAvailability(item.id)}
                          className="p-1.5 rounded-lg bg-surface-50 text-stone-300 hover:text-white border border-surface-border"
                          title="Sotuv holatini o'zgartirish"
                        >
                          {item.is_available ? <ToggleRight className="w-4 h-4 text-emerald-400" /> : <ToggleLeft className="w-4 h-4 text-stone-500" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-xl bg-surface-100 border border-surface-border rounded-3xl p-6 shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-surface-border mb-4">
              <h2 className="font-serif font-bold text-xl text-white">Yangi Taom Qo&apos;shish</h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateItem} className="space-y-4 text-xs">
              <div>
                <label className="block text-stone-300 font-semibold mb-1">Taom Nomi *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Masalan: Samarqandcha Qozon Kabob"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-300 font-semibold mb-1">Kategoriya *</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id} className="bg-surface-100">
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-stone-300 font-semibold mb-1">Narxi (so&apos;mda) *</label>
                  <input
                    type="number"
                    step="1000"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="65000"
                    className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Taom Haqida Qisqacha Ta&apos;rif</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Qanday pishirilgani, ta'mi va tortilishi haqida..."
                  rows={2}
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Rasm Havolasi (URL)</label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Tarkibi (Vergul bilan ajrating)</label>
                <input
                  type="text"
                  value={ingredientsText}
                  onChange={(e) => setIngredientsText(e.target.value)}
                  placeholder="Qo'y go'shti, Devzira guruch, Sabzi, Zira"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-300 font-semibold mb-1">Tayyorlanish Vaqti (Daqiqa)</label>
                  <input
                    type="number"
                    value={prepTime}
                    onChange={(e) => setPrepTime(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                  />
                </div>

                <div>
                  <label className="block text-stone-300 font-semibold mb-1">Achchiqlik Darajasi</label>
                  <select
                    value={spicyLevel}
                    onChange={(e) => setSpicyLevel(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                  >
                    <option value="0" className="bg-surface-100">0 - Achchiq emas (Oddiy)</option>
                    <option value="1" className="bg-surface-100">1 - Yengil achchiq 🌶️</option>
                    <option value="2" className="bg-surface-100">2 - O&apos;rtacha achchiq 🌶️🌶️</option>
                    <option value="3" className="bg-surface-100">3 - Juda achchiq 🌶️🌶️🌶️</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-surface-border flex items-center justify-end gap-3">
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
                  Saqlash & Menyoga Qo&apos;shish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
