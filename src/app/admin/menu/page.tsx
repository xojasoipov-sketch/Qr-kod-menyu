'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { MenuItem, MenuCategory, Restaurant } from '@/types/database';
import { getMenuItems, getCategories, getRestaurant } from '@/lib/api';
import { useRealtime } from '@/lib/use-realtime';
import type { RealtimePayload } from '@/lib/realtime/event-bus';
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
  X,
  ImagePlus,
  UtensilsCrossed,
  Soup,
  Trash2,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import Image from 'next/image';

/** Serverdagi chegara bilan bir xil: rasm hajmi 3 MB dan oshmasligi kerak. */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** POST /api/uploads qabul qiladigan formatlar. */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const IMAGE_ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(',');

/** 184320 -> "180 KB". Xodimga tushunarli, qisqa yozuv. */
function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * next/image faqat ichki yo'l ("/api/uploads/...") yoki to'liq http(s) havolani
 * ko'tara oladi. Qo'lda yozilayotgan yarim havola ko'rinishni buzmasligi uchun tekshiramiz.
 */
function isDisplayableImageSrc(value: string): boolean {
  const src = value.trim();
  if (!src) return false;
  if (src.startsWith('/')) return true;
  return /^https?:\/\/.+/i.test(src);
}

/** Server o'zbekcha matn qaytarmasa — holat kodiga mos izoh. */
function uploadFallbackMessage(status: number): string {
  if (status === 413) return "Rasm hajmi 3 MB dan oshmasligi kerak.";
  if (status === 415) return 'Faqat JPEG, PNG, WEBP yoki GIF formatidagi rasmlar qabul qilinadi.';
  if (status === 429) return "Juda ko'p rasm yuklandi. Iltimos, biroz kutib turing.";
  if (status === 401 || status === 403) return 'Rasm yuklash uchun administrator sifatida kiring.';
  return "Rasmni yuklab bo'lmadi. Iltimos, qaytadan urinib ko'ring.";
}

export default function AdminMenuPage() {
  const [restaurantId] = useState('rest-001');
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [prepTime, setPrepTime] = useState('15');
  const [spicyLevel, setSpicyLevel] = useState('0');
  const [ingredientsText, setIngredientsText] = useState('');

  // Rasm bo'limi: fayl tanlash, sudrab tashlash va ko'rinish holati.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [imageError, setImageError] = useState('');
  const [uploadedImageSize, setUploadedImageSize] = useState<number | null>(null);
  const [isPreviewBroken, setIsPreviewBroken] = useState(false);

  // Server is the source of truth: menu data is pulled from the API, never from a client store copy.
  const refreshItems = useCallback(async () => {
    try {
      setItems(await getMenuItems(restaurantId));
    } catch (err: unknown) {
      console.error("Taomlarni yuklab bo'lmadi:", err);
    }
  }, [restaurantId]);

  const refreshCategories = useCallback(async () => {
    try {
      const nextCategories = await getCategories(restaurantId);
      setCategories(nextCategories);
      setCategoryId((prev) => prev || nextCategories[0]?.id || '');
    } catch (err: unknown) {
      console.error("Kategoriyalarni yuklab bo'lmadi:", err);
    }
  }, [restaurantId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getMenuItems(restaurantId),
      getCategories(restaurantId),
      getRestaurant(restaurantId),
    ])
      .then(([nextItems, nextCategories, nextRestaurant]) => {
        if (cancelled) return;
        setItems(nextItems);
        setCategories(nextCategories);
        setCategoryId((prev) => prev || nextCategories[0]?.id || '');
        setRestaurant(nextRestaurant);
      })
      .catch((err: unknown) => {
        console.error("Menyu ma'lumotlarini yuklab bo'lmadi:", err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const handleRealtime = useCallback(
    (payload: RealtimePayload) => {
      if (payload.type === 'MENU_UPDATED') {
        void refreshItems();
        void refreshCategories();
      }
    },
    [refreshItems, refreshCategories]
  );

  useRealtime({ restaurantId }, handleRealtime);

  const handleToggleAvailability = async (itemId: string) => {
    try {
      const res = await fetch(`/api/menu-items/${itemId}/toggle`, {
        method: 'POST',
      });
      if (res.ok) {
        await refreshItems();
      }
    } catch {
      alert('Holatni o\'zgartirib bo\'lmadi');
    }
  };

  // Havola o'zgarganda oldingi ko'rish xatosi eskiradi.
  useEffect(() => {
    setIsPreviewBroken(false);
  }, [imageUrl]);

  // Modal yopilsa, rasm bo'limi toza holatga qaytadi.
  useEffect(() => {
    if (isAddModalOpen) return;
    setIsUploadingImage(false);
    setIsDraggingImage(false);
    setImageError('');
    setUploadedImageSize(null);
  }, [isAddModalOpen]);

  const clearImage = () => {
    setImageUrl('');
    setImageError('');
    setUploadedImageSize(null);
    setIsPreviewBroken(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * Tanlangan faylni serverga yuboradi. Muvaffaqiyatli bo'lsa, forma
   * `image_url` maydoni javobdagi ichki havola bilan almashtiriladi.
   */
  const uploadImageFile = async (file: File) => {
    setImageError('');
    setUploadedImageSize(null);
    // Darhol bo'shatamiz: shu (noto'g'ri) faylni ikkinchi marta tanlasa ham
    // <input type="file"> qiymati o'zgargani uchun onChange qayta ishga tushadi.
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Serverga bormasdan turib, bu yerda ham tekshiramiz — javob tezroq bo'ladi.
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError('Faqat JPEG, PNG, WEBP yoki GIF formatidagi rasmlar qabul qilinadi.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Rasm hajmi 3 MB dan oshmasligi kerak.");
      return;
    }

    const body = new FormData();
    body.append('file', file);

    setIsUploadingImage(true);
    try {
      const res = await fetch('/api/uploads', { method: 'POST', body });
      const data = (await res.json().catch(() => null)) as
        | { url?: string; size?: number; error?: string }
        | null;

      // 413 / 415 / 429 — server o'zbekcha `error` matnini yuboradi, uni ko'rsatamiz.
      if (!res.ok || !data?.url) {
        setImageError(data?.error || uploadFallbackMessage(res.status));
        return;
      }

      setImageUrl(data.url);
      setUploadedImageSize(typeof data.size === 'number' ? data.size : file.size);
    } catch {
      setImageError("Tarmoq xatosi: rasmni yuklab bo'lmadi.");
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleImageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingImage(false);
    if (isUploadingImage) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadImageFile(file);
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
        await refreshItems();
        setIsAddModalOpen(false);
        setName('');
        setDescription('');
        setPrice('');
        clearImage();
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
              {isLoading && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-stone-400">
                    Yuklanmoqda...
                  </td>
                </tr>
              )}
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

              {/* Taom surati: fayldan yuklash yoki tashqi havola */}
              <div className="rounded-2xl border border-surface-border bg-surface-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <UtensilsCrossed className="w-3.5 h-3.5 text-gold-400" />
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-stone-400">
                      Taom Surati
                    </span>
                  </div>

                  {imageUrl && !isUploadingImage && (
                    <button
                      type="button"
                      onClick={clearImage}
                      className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-stone-500 hover:text-stone-200 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Rasmni olib tashlash</span>
                    </button>
                  )}
                </div>

                <div className="flex items-start gap-4">
                  {/* Menyudagidek taqdim etilgan taom kartochkasi */}
                  <div className="relative w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden border border-gold-400/25 bg-gradient-to-b from-surface-300 to-surface-100 shadow-luxury">
                    {imageUrl && isDisplayableImageSrc(imageUrl) && !isPreviewBroken ? (
                      <Image
                        src={imageUrl}
                        alt="Taom surati"
                        fill
                        sizes="96px"
                        className="object-cover"
                        onError={() => setIsPreviewBroken(true)}
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-stone-600">
                        <Soup className="w-5 h-5" />
                        <span className="text-[9px] uppercase tracking-wider">Rasm yo&apos;q</span>
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-0 shadow-[inset_0_1px_0_rgba(250,245,238,0.06),inset_0_-20px_28px_-20px_rgba(0,0,0,0.9)]" />
                  </div>

                  {/* Sudrab tashlash / bosib tanlash maydoni */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-busy={isUploadingImage}
                    onClick={() => {
                      if (!isUploadingImage) fileInputRef.current?.click();
                    }}
                    onKeyDown={(e) => {
                      if (isUploadingImage) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!isUploadingImage) setIsDraggingImage(true);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingImage(false);
                    }}
                    onDrop={handleImageDrop}
                    className={`flex-1 min-h-[6rem] rounded-xl border border-dashed px-4 py-3 flex flex-col items-center justify-center text-center gap-1.5 transition-colors focus:outline-none focus:border-gold-400 ${
                      isUploadingImage ? 'cursor-wait' : 'cursor-pointer'
                    } ${
                      isDraggingImage
                        ? 'border-gold-400/70 bg-gold-400/5'
                        : 'border-surface-border bg-surface-100/40 hover:border-gold-400/40'
                    }`}
                  >
                    {isUploadingImage ? (
                      <>
                        <Loader2 className="w-4 h-4 text-gold-400 animate-spin" />
                        <span className="text-[11px] text-stone-300">Rasm yuklanmoqda...</span>
                      </>
                    ) : (
                      <>
                        <ImagePlus className="w-4 h-4 text-gold-400" />
                        <span className="text-[11px] font-semibold text-stone-200">Rasm yuklash</span>
                        <span className="text-[10px] text-stone-500 leading-relaxed">
                          Faylni shu yerga tashlang yoki bosib tanlang &middot; JPEG, PNG, WEBP, GIF &middot; 3 MB gacha
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={IMAGE_ACCEPT_ATTRIBUTE}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadImageFile(file);
                  }}
                />

                {imageError && (
                  <p className="flex items-start gap-1.5 text-[11px] text-red-300">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px text-red-400" />
                    <span>{imageError}</span>
                  </p>
                )}

                {!imageError && uploadedImageSize !== null && (
                  <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Rasm yuklandi ({formatFileSize(uploadedImageSize)}) va menyuga biriktirildi.</span>
                  </p>
                )}

                {isPreviewBroken && (
                  <p className="flex items-start gap-1.5 text-[11px] text-stone-400">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px text-gold-400" />
                    <span>Bu havoladagi rasmni ko&apos;rsatib bo&apos;lmadi. Havolani tekshiring.</span>
                  </p>
                )}

                <div className="pt-3 border-t border-gold-400/10">
                  <label className="block text-stone-300 font-semibold mb-1">Rasm Havolasi (URL)</label>
                  <input
                    type="text"
                    inputMode="url"
                    value={imageUrl}
                    onChange={(e) => {
                      setImageUrl(e.target.value);
                      setImageError('');
                      setUploadedImageSize(null);
                    }}
                    placeholder="https://images.unsplash.com/..."
                    className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400"
                  />
                  <p className="mt-1 text-[10px] text-stone-500">
                    Tashqi manbadagi rasm uchun havolani shu yerga qo&apos;ying. Yuklangan rasm ham shu maydonda ko&apos;rinadi.
                  </p>
                </div>
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
