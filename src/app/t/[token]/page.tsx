'use client';

import { use, useState, useMemo } from 'react';
import { db } from '@/lib/db/store';
import { CartItem, MenuItem, SelectedOption } from '@/types/database';
import CustomerHeader from '@/components/customer/CustomerHeader';
import CategoryNav from '@/components/customer/CategoryNav';
import FeaturedCarousel from '@/components/customer/FeaturedCarousel';
import FoodCard from '@/components/customer/FoodCard';
import ProductDetailModal from '@/components/customer/ProductDetailModal';
import CartDrawer from '@/components/customer/CartDrawer';
import { AlertCircle, Utensils } from 'lucide-react';
import Link from 'next/link';

export default function CustomerMenuPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const resolution = useMemo(() => {
    return db.getTableByQrToken(token);
  }, [token]);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [selectedItemForModal, setSelectedItemForModal] = useState<MenuItem | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  if (!resolution) {
    return (
      <div className="min-h-screen bg-[#0C0A09] text-[#FAF5EE] flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full p-8 rounded-3xl bg-surface-100 border border-surface-border shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="font-serif text-2xl font-bold text-white mb-2">
            Stol QR Kodi Faol Emas
          </h1>
          <p className="text-stone-400 text-xs sm:text-sm mb-6 leading-relaxed">
            Ushbu QR kod (<code className="text-gold-300 font-mono">{token}</code>) muddati tugagan, eskirgan yoki yangisiga almashtirilgan bo&apos;lishi mumkin.
          </p>
          <div className="space-y-2">
            <Link
              href="/"
              className="block w-full py-3 px-4 rounded-xl bg-gold-400 text-stone-950 font-bold text-xs tracking-wider uppercase hover:bg-gold-300 transition-colors"
            >
              Bosh Sahifaga Qaytish
            </Link>
            <p className="text-[11px] text-stone-500">
              Iltimos, ofitsiantdan yordam so&apos;rang yoki stoldagi yangi QR kodni skanerlang.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { restaurant, branch, table, categories, items } = resolution;

  const filteredItems = items.filter((item) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const nameMatch = item.name.toLowerCase().includes(q);
      const descMatch = item.description.toLowerCase().includes(q);
      const ingMatch = item.ingredients.some((ing) => ing.toLowerCase().includes(q));
      if (!nameMatch && !descMatch && !ingMatch) return false;
    }

    if (activeCategoryId !== 'all') {
      if (item.category_id !== activeCategoryId) return false;
    }

    return true;
  });

  const categoryItemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      counts[item.category_id] = (counts[item.category_id] || 0) + 1;
    });
    return counts;
  }, [items]);

  const handleAddToCart = (
    item: MenuItem,
    quantity: number,
    selectedOptions: SelectedOption[],
    notes: string
  ) => {
    setCart((prevCart) => {
      const existingIdx = prevCart.findIndex(
        (ci) =>
          ci.item.id === item.id &&
          ci.notes === notes &&
          JSON.stringify(ci.selected_options) === JSON.stringify(selectedOptions)
      );

      if (existingIdx > -1) {
        const updated = [...prevCart];
        updated[existingIdx].quantity += quantity;
        return updated;
      } else {
        return [...prevCart, { item, quantity, selected_options: selectedOptions, notes }];
      }
    });
  };

  const handleUpdateQuantity = (index: number, newQty: number) => {
    setCart((prev) => {
      const updated = [...prev];
      if (newQty <= 0) {
        return updated.filter((_, i) => i !== index);
      }
      updated[index].quantity = newQty;
      return updated;
    });
  };

  const handleRemoveItem = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearCart = () => {
    setCart([]);
  };

  return (
    <main className="min-h-screen bg-[#0C0A09] text-[#FAF5EE] pb-28">
      {/* Restaurant Header */}
      <CustomerHeader
        restaurant={restaurant}
        branch={branch}
        table={table}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Category Nav */}
      <CategoryNav
        categories={categories}
        activeCategoryId={activeCategoryId}
        onSelectCategory={setActiveCategoryId}
        categoryItemCounts={categoryItemCounts}
        totalItemsCount={items.length}
      />

      {/* Featured Specialties */}
      {!searchQuery && activeCategoryId === 'all' && (
        <FeaturedCarousel
          items={items}
          currencySymbol={restaurant.currency_symbol}
          onSelectItem={setSelectedItemForModal}
        />
      )}

      {/* Food Discovery Grid */}
      <div className="px-4 py-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-base sm:text-lg font-bold text-white">
            {activeCategoryId === 'all'
              ? searchQuery
                ? `Qidiruv natijalari (${filteredItems.length})`
                : 'Barcha Taomlar & Ichimliklar'
              : categories.find((c) => c.id === activeCategoryId)?.name || 'Menyu'}
          </h2>
          <span className="text-xs text-stone-400">
            {filteredItems.length} ta taom
          </span>
        </div>

        {filteredItems.length === 0 ? (
          <div className="py-16 text-center text-stone-400 bg-surface-100/50 rounded-2xl border border-surface-border">
            <Utensils className="w-10 h-10 text-stone-600 mx-auto mb-2 opacity-60" />
            <p className="text-sm font-medium">Taomlar topilmadi</p>
            <p className="text-xs text-stone-500 mt-1">
              Boshqa so&apos;z bilan qidirib ko&apos;ring yoki kategoriyani o&apos;zgartiring.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item) => (
              <FoodCard
                key={item.id}
                item={item}
                currencySymbol={restaurant.currency_symbol}
                onSelectItem={setSelectedItemForModal}
              />
            ))}
          </div>
        )}
      </div>

      {/* Product Modal */}
      <ProductDetailModal
        item={selectedItemForModal}
        currencySymbol={restaurant.currency_symbol}
        onClose={() => setSelectedItemForModal(null)}
        onAddToCart={handleAddToCart}
      />

      {/* Cart Drawer */}
      <CartDrawer
        cart={cart}
        restaurant={restaurant}
        table={table}
        qrToken={token}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveItem={handleRemoveItem}
        onClearCart={handleClearCart}
      />
    </main>
  );
}
