'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CartItem, Restaurant, Table } from '@/types/database';
import { ShoppingBag, X, Trash2, Plus, Minus, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { soundManager } from '@/lib/sound/audio-alerts';

interface CartDrawerProps {
  cart: CartItem[];
  restaurant: Restaurant;
  table: Table;
  qrToken: string;
  onUpdateQuantity: (index: number, newQty: number) => void;
  onRemoveItem: (index: number) => void;
  onClearCart: () => void;
}

export default function CartDrawer({
  cart,
  restaurant,
  table,
  qrToken,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
}: CartDrawerProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const subtotal = cart.reduce((sum, ci) => {
    const optsPrice = ci.selected_options.reduce((oSum, o) => oSum + o.price, 0);
    return sum + (ci.item.price + optsPrice) * ci.quantity;
  }, 0);

  const serviceFee = parseFloat(
    ((subtotal * (restaurant.service_fee_percentage || 0)) / 100).toFixed(2)
  );
  const grandTotal = parseFloat((subtotal + serviceFee).toFixed(2));

  const handlePlaceOrder = async () => {
    if (cart.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        table_id: table.id,
        customer_notes: orderNotes.trim() || undefined,
        items: cart.map((ci) => ({
          menu_item_id: ci.item.id,
          quantity: ci.quantity,
          selected_options: ci.selected_options,
          notes: ci.notes,
        })),
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Buyurtma berishda xatolik yuz berdi.');
      }

      soundManager.playKitchenOrderBell();
      onClearCart();
      setIsOpen(false);

      router.push(`/t/${qrToken}/order/${data.order.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Buyurtma berishda xatolik';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (totalItemsCount === 0 && !isOpen) return null;

  return (
    <>
      {/* Floating Bottom Cart Bar */}
      {!isOpen && totalItemsCount > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40 max-w-lg mx-auto animate-slide-up">
          <button
            onClick={() => setIsOpen(true)}
            className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-gold-400 via-amber-400 to-amber-500 text-stone-950 font-bold text-xs sm:text-sm shadow-gold-glow-lg flex items-center justify-between hover:brightness-110 active:scale-98 transition-all"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-stone-950 text-gold-400 flex items-center justify-center text-xs font-black">
                {totalItemsCount}
              </div>
              <span className="font-serif tracking-wide text-stone-950">Savatcha & Buyurtma berish</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-serif text-sm sm:text-base">{formatCurrency(grandTotal, restaurant.currency_symbol)}</span>
              <ArrowRight className="w-4 h-4 text-stone-950" />
            </div>
          </button>
        </div>
      )}

      {/* Cart Drawer Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-lg max-h-[92vh] bg-surface-100 border border-surface-border rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden shadow-2xl animate-slide-up">
            {/* Header */}
            <div className="p-4 bg-surface-50 border-b border-surface-border flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-400">
                  <ShoppingBag className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-serif font-bold text-base text-white">Sizning Buyurtmangiz</h3>
                  <p className="text-[11px] text-stone-400">
                    {table.name || `${table.number}-stol`} {table.zone ? `• ${table.zone}` : ''}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div className="p-3 bg-red-500/15 border-b border-red-500/30 text-red-300 text-xs flex items-center justify-between">
                <span>{errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-red-200">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Items List */}
            <div className="overflow-y-auto flex-1 p-4 space-y-3 divide-y divide-surface-border/60">
              {cart.length === 0 ? (
                <div className="py-12 text-center text-stone-400">
                  <ShoppingBag className="w-12 h-12 text-stone-600 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Savatchangiz bo&apos;sh</p>
                </div>
              ) : (
                cart.map((ci, idx) => {
                  const optsDelta = ci.selected_options.reduce((s, o) => s + o.price, 0);
                  const itemUnitPrice = ci.item.price + optsDelta;
                  const itemTotal = itemUnitPrice * ci.quantity;

                  return (
                    <div key={idx} className="pt-3 first:pt-0 flex gap-3 items-start">
                      <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-stone-900 flex-shrink-0 border border-surface-border">
                        <Image
                          src={ci.item.image_url}
                          alt={ci.item.name}
                          fill
                          className="object-cover"
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-serif font-bold text-sm text-stone-100 truncate">
                            {ci.item.name}
                          </h4>
                          <span className="font-serif font-bold text-xs text-gold-300">
                            {formatCurrency(itemTotal, restaurant.currency_symbol)}
                          </span>
                        </div>

                        {ci.selected_options.length > 0 && (
                          <div className="text-[11px] text-stone-400 space-y-0.5 mt-0.5">
                            {ci.selected_options.map((opt) => (
                              <div key={opt.option_id} className="text-gold-300/80">
                                + {opt.option_name}
                                {opt.price > 0 && <span> ({formatCurrency(opt.price, restaurant.currency_symbol)})</span>}
                              </div>
                            ))}
                          </div>
                        )}

                        {ci.notes && (
                          <p className="text-[10px] text-amber-400/90 italic mt-0.5 line-clamp-1">
                            Eslatma: &quot;{ci.notes}&quot;
                          </p>
                        )}

                        <div className="flex items-center justify-between mt-2.5">
                          <div className="flex items-center rounded-lg bg-surface-50 border border-surface-border p-0.5">
                            <button
                              onClick={() => {
                                if (ci.quantity === 1) {
                                  onRemoveItem(idx);
                                } else {
                                  onUpdateQuantity(idx, ci.quantity - 1);
                                }
                              }}
                              className="w-6 h-6 rounded bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center"
                            >
                              {ci.quantity === 1 ? <Trash2 className="w-3 h-3 text-red-400" /> : <Minus className="w-3 h-3" />}
                            </button>
                            <span className="w-7 text-center text-xs font-bold text-stone-200">
                              {ci.quantity}
                            </span>
                            <button
                              onClick={() => onUpdateQuantity(idx, ci.quantity + 1)}
                              className="w-6 h-6 rounded bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <button
                            onClick={() => onRemoveItem(idx)}
                            className="text-[11px] text-stone-500 hover:text-red-400 transition-colors"
                          >
                            O&apos;chirish
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {cart.length > 0 && (
                <div className="pt-4">
                  <label htmlFor="general-order-notes" className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                    Umumiy stol eslatmasi (Ixtiyoriy)
                  </label>
                  <textarea
                    id="general-order-notes"
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Masalan: Nonni oldinroq keltiring, suv stakanlari qo'shilsin..."
                    rows={2}
                    className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-xs text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-gold-400/60 transition-colors resize-none"
                  />
                </div>
              )}
            </div>

            {/* Totals & Submit */}
            {cart.length > 0 && (
              <div className="p-4 bg-surface-50 border-t border-surface-border space-y-3">
                <div className="space-y-1.5 text-xs text-stone-400">
                  <div className="flex justify-between">
                    <span>Taomlar summasi ({totalItemsCount} ta)</span>
                    <span className="text-stone-200 font-medium">{formatCurrency(subtotal, restaurant.currency_symbol)}</span>
                  </div>
                  {restaurant.service_fee_percentage > 0 && (
                    <div className="flex justify-between">
                      <span>Xizmat haqi ({restaurant.service_fee_percentage}%)</span>
                      <span className="text-stone-200 font-medium">{formatCurrency(serviceFee, restaurant.currency_symbol)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-white pt-1.5 border-t border-surface-border">
                    <span className="font-serif">Jami to&apos;lov</span>
                    <span className="font-serif text-gold-300 text-base">{formatCurrency(grandTotal, restaurant.currency_symbol)}</span>
                  </div>
                </div>

                <button
                  onClick={handlePlaceOrder}
                  disabled={isSubmitting || cart.length === 0}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-gold-400 via-amber-400 to-amber-500 text-stone-950 font-bold text-xs sm:text-sm tracking-wide shadow-gold-glow hover:brightness-110 active:scale-98 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-stone-950" />
                      <span>Oshxonaga yuborilmoqda...</span>
                    </>
                  ) : (
                    <>
                      <span>Buyurtmani Oshxonaga Yuborish</span>
                      <span>•</span>
                      <span>{formatCurrency(grandTotal, restaurant.currency_symbol)}</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
