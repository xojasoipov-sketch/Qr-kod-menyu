'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { MenuItem, SelectedOption } from '@/types/database';
import { X, Minus, Plus, Clock, Flame, Check, Info } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface ProductDetailModalProps {
  item: MenuItem | null;
  currencySymbol: string;
  onClose: () => void;
  onAddToCart: (
    item: MenuItem,
    quantity: number,
    selectedOptions: SelectedOption[],
    notes: string
  ) => void;
}

export default function ProductDetailModal({
  item,
  currencySymbol,
  onClose,
  onAddToCart,
}: ProductDetailModalProps) {
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<SelectedOption[]>([]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!item) return;
    setQuantity(1);
    setNotes('');

    const initialOpts: SelectedOption[] = [];
    item.option_groups?.forEach((group) => {
      if (group.required && !group.multiple && group.options.length > 0) {
        const defaultOpt = group.options[0];
        initialOpts.push({
          group_id: group.id,
          group_name: group.name,
          option_id: defaultOpt.id,
          option_name: defaultOpt.name,
          price: defaultOpt.price,
        });
      }
    });
    setSelectedOptions(initialOpts);
  }, [item]);

  if (!item) return null;

  const optionsPriceDelta = selectedOptions.reduce((sum, opt) => sum + opt.price, 0);
  const unitPrice = item.price + optionsPriceDelta;
  const totalPrice = unitPrice * quantity;

  const handleToggleOption = (
    group: NonNullable<MenuItem['option_groups']>[number],
    option: NonNullable<MenuItem['option_groups']>[number]['options'][number]
  ) => {
    if (group.multiple) {
      const exists = selectedOptions.some((o) => o.option_id === option.id);
      if (exists) {
        setSelectedOptions(selectedOptions.filter((o) => o.option_id !== option.id));
      } else {
        setSelectedOptions([
          ...selectedOptions,
          {
            group_id: group.id,
            group_name: group.name,
            option_id: option.id,
            option_name: option.name,
            price: option.price,
          },
        ]);
      }
    } else {
      const filtered = selectedOptions.filter((o) => o.group_id !== group.id);
      setSelectedOptions([
        ...filtered,
        {
          group_id: group.id,
          group_name: group.name,
          option_id: option.id,
          option_name: option.name,
          price: option.price,
        },
      ]);
    }
  };

  const handleAdd = () => {
    onAddToCart(item, quantity, selectedOptions, notes.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg max-h-[90vh] bg-surface-100 border border-surface-border rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden shadow-2xl animate-slide-up">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center text-stone-200 hover:text-white hover:bg-black/80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Scrollable Modal Content */}
        <div className="overflow-y-auto flex-1 pb-24">
          {/* Hero Food Image */}
          <div className="relative h-64 sm:h-72 w-full bg-stone-950">
            <Image
              src={item.image_url}
              alt={item.name}
              fill
              priority
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-surface-100 via-transparent to-black/30" />

            <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-black/70 backdrop-blur-md text-gold-300 text-xs font-semibold border border-gold-400/30 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-gold-400" />
                  <span>{item.preparation_time} daqiqa</span>
                </span>
                {item.spicy_level > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-red-950/80 backdrop-blur-md text-red-300 text-xs font-semibold border border-red-500/30 flex items-center gap-1">
                    <Flame className="w-3.5 h-3.5 text-red-400" />
                    <span>Achchiqligi: {item.spicy_level}/3</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Title & Description */}
          <div className="p-5">
            <div className="flex items-start justify-between gap-4 mb-2">
              <h2 className="font-serif text-xl sm:text-2xl font-bold text-white tracking-wide">
                {item.name}
              </h2>
              <div className="font-serif text-lg sm:text-xl font-bold text-gold-300 flex-shrink-0">
                {formatCurrency(item.price, currencySymbol)}
              </div>
            </div>

            <p className="text-stone-300 text-xs sm:text-sm leading-relaxed font-light mb-4">
              {item.description}
            </p>

            {/* Ingredients */}
            {item.ingredients && item.ingredients.length > 0 && (
              <div className="mb-5 p-3.5 rounded-xl bg-surface-50 border border-surface-border/60">
                <div className="text-[11px] font-semibold text-gold-400/90 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  <span>Taom masalliqlari</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {item.ingredients.map((ing, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-lg bg-surface-200 text-stone-300 text-xs border border-surface-border"
                    >
                      {ing}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Option Groups */}
            {item.option_groups && item.option_groups.length > 0 && (
              <div className="space-y-4 mb-5">
                {item.option_groups.map((group) => (
                  <div key={group.id} className="p-4 rounded-xl bg-surface-50 border border-surface-border">
                    <div className="flex items-center justify-between mb-2.5">
                      <h4 className="font-serif font-bold text-sm text-stone-100">
                        {group.name}
                      </h4>
                      <span className="text-[11px] text-stone-400">
                        {group.required ? 'Tanlash shart' : 'Ixtiyoriy'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      {group.options.map((opt) => {
                        const isSelected = selectedOptions.some((o) => o.option_id === opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleToggleOption(group, opt)}
                            className={`p-2.5 rounded-xl border text-xs font-medium transition-all flex items-center justify-between ${
                              isSelected
                                ? 'bg-gold-500/15 border-gold-400 text-gold-200'
                                : 'bg-surface-100 border-surface-border text-stone-300 hover:border-stone-600'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-4 h-4 rounded-full flex items-center justify-center border ${
                                  isSelected
                                    ? 'border-gold-400 bg-gold-400 text-stone-950'
                                    : 'border-stone-600 bg-surface-200'
                                }`}
                              >
                                {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                              </div>
                              <span>{opt.name}</span>
                            </div>
                            {opt.price > 0 && (
                              <span className="text-gold-300 font-semibold">
                                +{formatCurrency(opt.price, currencySymbol)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Special Instructions */}
            <div className="mb-2">
              <label htmlFor="special-notes-input" className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                Oshxonaga maxsus istak (Ixtiyoriy)
              </label>
              <textarea
                id="special-notes-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Masalan: Piyoz solinmasin, sousi alohida bo'lsin, issiqroq bo'lsin..."
                rows={2}
                maxLength={200}
                className="w-full p-3 rounded-xl bg-surface-50 border border-surface-border text-xs text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400/60 transition-colors resize-none"
              />
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-surface-100/95 backdrop-blur-md border-t border-surface-border flex items-center gap-3 z-30">
          <div className="flex items-center rounded-xl bg-surface-50 border border-surface-border p-1">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              className="w-8 h-8 rounded-lg bg-surface-200 text-stone-300 hover:text-white disabled:opacity-40 flex items-center justify-center transition-colors"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="w-8 text-center text-sm font-bold text-stone-100">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="w-8 h-8 rounded-lg bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={handleAdd}
            className="flex-1 py-3.5 px-4 rounded-xl bg-gradient-to-r from-gold-400 via-amber-400 to-amber-500 text-stone-950 font-bold text-xs sm:text-sm tracking-wide shadow-gold-glow hover:brightness-110 active:scale-98 transition-all flex items-center justify-between"
          >
            <span>Savatchaga qo&apos;shish</span>
            <span>{formatCurrency(totalPrice, currencySymbol)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
