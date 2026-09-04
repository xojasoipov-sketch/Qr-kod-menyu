'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ChefHat, ConciergeBell, Delete, ShieldCheck } from 'lucide-react';
import type { SessionRole } from '@/types/database';
import { safeNextPath } from './next-path';

/**
 * Xodimlar terminali — haqiqiy xizmat stantsiyasidagi kod paneli kabi.
 * Ofitsiant bir marta kiradi: sessiya 30 kun saqlanadi.
 *
 * Bu komponent ilgari `src/app/pin/page.tsx` ichida turardi. Endi u umumiy
 * kirish sahifasining ("Xodim" yorlig'i) bir qismi — ko'rinishi o'zgarmagan.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

const ROLE_LABEL: Record<SessionRole, string> = {
  ADMIN: "Ma'muriyat",
  WAITER: 'Ofitsiant',
  KITCHEN: 'Oshxona',
};

function RoleMark({ role }: { role: SessionRole }) {
  const className = 'w-5 h-5 text-gold-400/90';
  if (role === 'KITCHEN') return <ChefHat className={className} strokeWidth={1.5} />;
  if (role === 'ADMIN') return <ShieldCheck className={className} strokeWidth={1.5} />;
  return <ConciergeBell className={className} strokeWidth={1.5} />;
}

interface WelcomeState {
  name: string;
  role: SessionRole;
}

export default function StaffPinTerminal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'));

  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [welcome, setWelcome] = useState<WelcomeState | null>(null);

  // Bir vaqtning o'zida ikkinchi so'rov ketmasligi uchun.
  const busyRef = useRef(false);

  const submitPin = useCallback(
    async (pin: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setIsChecking(true);
      setError(null);

      try {
        const res = await fetch('/api/auth/pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin }),
        });

        const data = (await res.json()) as {
          error?: string;
          name?: string;
          role?: SessionRole;
          redirect?: string;
        };

        if (!res.ok || !data.role || !data.name) {
          setError(data.error || "Kodni tekshirib bo'lmadi.");
          setDigits('');
          setIsChecking(false);
          busyRef.current = false;
          return;
        }

        setWelcome({ name: data.name, role: data.role });
        const target = nextPath || data.redirect || '/waiter';
        window.setTimeout(() => {
          router.push(target);
          router.refresh();
        }, 900);
      } catch {
        setError("Tarmoq bilan aloqa yo'q. Ulanishni tekshiring.");
        setDigits('');
        setIsChecking(false);
        busyRef.current = false;
      }
    },
    [nextPath, router]
  );

  const pressDigit = useCallback((digit: string) => {
    if (busyRef.current) return;
    setError(null);
    setDigits((prev) => (prev.length >= 4 ? prev : prev + digit));
  }, []);

  // To'rtinchi raqam kiritilishi bilan kod avtomatik yuboriladi.
  useEffect(() => {
    if (digits.length === 4 && !busyRef.current) {
      void submitPin(digits);
    }
  }, [digits, submitPin]);

  const pressBackspace = useCallback(() => {
    if (busyRef.current) return;
    setError(null);
    setDigits((prev) => prev.slice(0, -1));
  }, []);

  const pressClear = useCallback(() => {
    if (busyRef.current) return;
    setError(null);
    setDigits('');
  }, []);

  // Planshetga klaviatura ulangan bo'lsa ham ishlasin.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        pressDigit(e.key);
      } else if (e.key === 'Backspace') {
        pressBackspace();
      } else if (e.key === 'Escape') {
        pressClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pressBackspace, pressClear, pressDigit]);

  const keyClass =
    'h-14 sm:h-16 rounded-xl border border-surface-border bg-surface-200/50 font-serif text-xl text-stone-200 transition-colors hover:border-gold-500/30 hover:bg-surface-300/60 active:bg-surface-300 disabled:opacity-40 disabled:hover:border-surface-border disabled:hover:bg-surface-200/50';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-full select-none"
    >
      <div className="mb-7 text-center">
        <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gold-400/25 bg-gold-400/[0.06] text-gold-400/90">
          <ConciergeBell className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <div className="text-[10px] font-medium uppercase tracking-[0.3em] text-stone-500">
          Muhtasham &middot; Xizmat terminali
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-100/90 shadow-luxury">
        <div className="px-7 pt-8 pb-6 text-center">
          <h1 className="font-serif text-2xl tracking-wide text-stone-100">Xizmat kodi</h1>
          <p className="mx-auto mt-2.5 max-w-[15rem] text-xs leading-relaxed text-stone-500">
            {welcome ? 'Kod qabul qilindi.' : '4 xonali shaxsiy kodingizni kiriting.'}
          </p>
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-gold-500/35 to-transparent" />

        {welcome ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="px-7 py-12 text-center"
          >
            <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gold-400/25 bg-gold-400/[0.06]">
              <RoleMark role={welcome.role} />
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500">
              Xush kelibsiz
            </div>
            <div className="mt-2 font-serif text-xl text-stone-100">{welcome.name}</div>
            <div className="mt-1.5 text-xs text-gold-400/80">{ROLE_LABEL[welcome.role]}</div>
            <div className="mt-6 text-[11px] text-stone-600">Ish o&apos;rningizga o&apos;tilmoqda…</div>
          </motion.div>
        ) : (
          <div className="px-7 py-7">
            {/* Kiritilgan raqamlar ko'rsatkichi */}
            <div className="mb-6 flex items-center justify-center gap-3.5">
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={index}
                  className={`h-2.5 w-2.5 rounded-full transition-colors duration-200 ${
                    index < digits.length
                      ? 'bg-gold-400'
                      : 'border border-stone-700 bg-transparent'
                  }`}
                />
              ))}
            </div>

            <div className="mb-5 h-8">
              {error ? (
                <motion.p
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="text-center text-xs leading-relaxed text-rose-300/85"
                >
                  {error}
                </motion.p>
              ) : (
                <p className="text-center text-[11px] leading-relaxed text-stone-600">
                  {isChecking ? 'Tekshirilmoqda…' : 'Bir marta kiriting — tizim sizni eslab qoladi.'}
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => pressDigit(key)}
                  disabled={isChecking}
                  className={keyClass}
                  aria-label={`${key} raqami`}
                >
                  {key}
                </button>
              ))}

              <button
                type="button"
                onClick={pressClear}
                disabled={isChecking}
                className="h-14 rounded-xl border border-surface-border bg-surface-200/30 text-[10px] uppercase tracking-[0.15em] text-stone-500 transition-colors hover:border-gold-500/25 hover:text-stone-300 disabled:opacity-40 sm:h-16"
              >
                Tozalash
              </button>

              <button
                type="button"
                onClick={() => pressDigit('0')}
                disabled={isChecking}
                className={keyClass}
                aria-label="0 raqami"
              >
                0
              </button>

              <button
                type="button"
                onClick={pressBackspace}
                disabled={isChecking}
                className="flex h-14 items-center justify-center rounded-xl border border-surface-border bg-surface-200/30 text-stone-500 transition-colors hover:border-gold-500/25 hover:text-stone-300 disabled:opacity-40 sm:h-16"
                aria-label="Oxirgi raqamni o'chirish"
              >
                <Delete className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
