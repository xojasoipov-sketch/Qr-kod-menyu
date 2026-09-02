'use client';

import { useState } from 'react';
import { db } from '@/lib/db/store';
import { Restaurant, Branch } from '@/types/database';
import { Store, MapPin, DollarSign, Save, Check } from 'lucide-react';

export default function AdminSettingsPage() {
  const [restaurant, setRestaurant] = useState<Restaurant | undefined>(() => db.getRestaurant('rest-001'));
  const [branches] = useState<Branch[]>(() => db.getBranchesByRestaurant('rest-001'));
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [name, setName] = useState(restaurant?.name || '');
  const [tagline, setTagline] = useState(restaurant?.tagline || '');
  const [serviceFee, setServiceFee] = useState(restaurant?.service_fee_percentage.toString() || '10');
  const [phone, setPhone] = useState(restaurant?.phone || '');
  const [currencySymbol, setCurrencySymbol] = useState(restaurant?.currency_symbol || "so'm");

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant) return;

    restaurant.name = name;
    restaurant.tagline = tagline;
    restaurant.service_fee_percentage = parseFloat(serviceFee) || 0;
    restaurant.phone = phone;
    restaurant.currency_symbol = currencySymbol;
    restaurant.updated_at = new Date().toISOString();

    setRestaurant({ ...restaurant });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
        <div>
          <h1 className="font-serif font-bold text-2xl sm:text-3xl text-white">
            Restoran va Filiallar Sozlamalari
          </h1>
          <p className="text-xs text-stone-400 mt-1">
            Restoran nomi, xizmat haqi foizi, valyuta belgisi va filiallar manzili.
          </p>
        </div>
      </div>

      {savedSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>Sozlamalar muvaffaqiyatli saqlandi va barcha qurilmalarga yangilandi.</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="p-6 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-surface-border">
            <Store className="w-4 h-4 text-gold-400" />
            <h2 className="font-serif font-bold text-base text-white">Restoran Profili</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-stone-300 font-semibold mb-1">Restoran Nomi</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
              />
            </div>

            <div>
              <label className="block text-stone-300 font-semibold mb-1">Aloqa Uchun Telefon</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-stone-300 font-semibold mb-1">Restoran Shiori (Slogan)</label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
              />
            </div>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-surface-border">
            <DollarSign className="w-4 h-4 text-gold-400" />
            <h2 className="font-serif font-bold text-base text-white">Xizmat Haqi va Valyuta</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-stone-300 font-semibold mb-1">
                Xizmat Haq Foizi (%)
              </label>
              <input
                type="number"
                step="0.5"
                value={serviceFee}
                onChange={(e) => setServiceFee(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
              />
              <p className="text-[10px] text-stone-500 mt-1">
                Har bir chek uchun serverda avtomatik hisoblanadi.
              </p>
            </div>

            <div>
              <label className="block text-stone-300 font-semibold mb-1">
                Valyuta Belgisi
              </label>
              <input
                type="text"
                value={currencySymbol}
                onChange={(e) => setCurrencySymbol(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
              />
            </div>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-surface-100 border border-surface-border shadow-luxury space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-surface-border">
            <MapPin className="w-4 h-4 text-gold-400" />
            <h2 className="font-serif font-bold text-base text-white">Mavjud Filiallar</h2>
          </div>

          <div className="space-y-3">
            {branches.map((b) => (
              <div key={b.id} className="p-3.5 rounded-xl bg-surface-50 border border-surface-border/60 flex items-center justify-between">
                <div>
                  <h3 className="font-serif font-bold text-sm text-white">{b.name}</h3>
                  <p className="text-xs text-stone-400">{b.address}</p>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/30">
                  Faol Ishlamoqda
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-gold-400 to-amber-500 text-stone-950 font-bold text-xs tracking-wider uppercase shadow-gold-glow hover:brightness-110 active:scale-98 transition-all flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>O&apos;zgarishlarni Saqlash</span>
          </button>
        </div>
      </form>
    </div>
  );
}
