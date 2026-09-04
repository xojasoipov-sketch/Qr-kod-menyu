'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { KeyRound, Lock, ShieldCheck, UtensilsCrossed, ArrowRight } from 'lucide-react';
import { safeNextPath } from './next-path';

/**
 * Ma'muriyat kirish ekrani — restoran metrdotelining stoli kabi:
 * qorong'i yong'oq rangli fon, ingichka oltin chiziq va bitta parol maydoni.
 *
 * Bu komponent ilgari `src/app/login/page.tsx` ichida turardi. Endi u umumiy
 * kirish sahifasining ("Ma'muriyat" yorlig'i) bir qismi — ko'rinishi o'zgarmagan.
 */
export default function AdminSignInCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'));

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!password.trim()) {
      setError('Parolni kiriting.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = (await res.json()) as { error?: string; redirect?: string };

      if (!res.ok) {
        setError(data.error || 'Kirishda xatolik yuz berdi.');
        setPassword('');
        setIsSubmitting(false);
        return;
      }

      router.push(nextPath || data.redirect || '/admin');
      router.refresh();
    } catch {
      setError("Tarmoq bilan aloqa yo'q. Ulanishni tekshiring.");
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-full"
    >
      {/* Peshtoqdagi yozuv */}
      <div className="text-center mb-7">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-gold-400/25 bg-gold-400/[0.06] text-gold-400/90 mb-5">
          <UtensilsCrossed className="w-5 h-5" strokeWidth={1.5} />
        </div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 font-medium">
          Muhtasham &middot; Boshqaruv
        </div>
      </div>

      <div className="rounded-2xl border border-surface-border bg-surface-100/90 shadow-luxury overflow-hidden">
        {/* Sarlavha */}
        <div className="px-8 pt-8 pb-6 text-center">
          <h1 className="font-serif text-2xl text-stone-100 tracking-wide">
            Ma&apos;muriyat kirishi
          </h1>
          <p className="mt-2.5 text-xs leading-relaxed text-stone-500">
            Panelga faqat restoran rahbariyati kira oladi.
          </p>
        </div>

        {/* Ingichka oltin chiziq */}
        <div className="h-px bg-gradient-to-r from-transparent via-gold-500/35 to-transparent" />

        <form onSubmit={handleSubmit} className="px-8 py-7 space-y-5">
          <div className="space-y-2.5">
            <label
              htmlFor="admin-password"
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-stone-500"
            >
              <Lock className="w-3 h-3 text-gold-500/70" strokeWidth={1.75} />
              Parol
            </label>

            <div className="relative">
              <KeyRound
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600"
                strokeWidth={1.5}
              />
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                autoComplete="current-password"
                autoFocus
                placeholder="••••••••"
                className="w-full rounded-xl border border-surface-border bg-surface-200/60 py-3 pl-10 pr-4 text-sm text-stone-100 tracking-widest placeholder-stone-700 outline-none transition-colors focus:border-gold-500/45 focus:bg-surface-200"
              />
            </div>
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="rounded-lg border border-rose-900/40 bg-rose-950/25 px-3.5 py-2.5 text-xs leading-relaxed text-rose-300/85"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="group w-full rounded-xl border border-gold-600/60 bg-gold-500 py-3 text-sm font-semibold tracking-wide text-stone-950 transition-colors hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-surface-border disabled:bg-surface-300 disabled:text-stone-500"
          >
            <span className="inline-flex items-center justify-center gap-2">
              {isSubmitting ? 'Tekshirilmoqda…' : 'Kirish'}
              {!isSubmitting && (
                <ArrowRight
                  className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={2}
                />
              )}
            </span>
          </button>

          <div className="flex items-start gap-2 pt-1 text-[11px] leading-relaxed text-stone-600">
            <ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0 text-stone-600" strokeWidth={1.5} />
            <span>Sessiya 12 soat davom etadi, so&apos;ngra qaytadan kirish so&apos;raladi.</span>
          </div>
        </form>
      </div>
    </motion.div>
  );
}
