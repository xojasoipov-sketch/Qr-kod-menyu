'use client';

import { useCallback, useState } from 'react';

/**
 * "Chiqish" tugmasi.
 *
 * Ilgari bu oddiy `<Link href="/">` edi va aslida hech narsa qilmasdi:
 * sessiya cookie'si joyida qolardi. Bosh sahifa har doim raqamli klaviaturani
 * ko'rsatgani uchun bu chiqishga o'xshab ko'rinardi, xolos. Endi bosh sahifa
 * kirgan odamni o'z paneliga qaytaradi — ya'ni smena almashuvida ofitsiant
 * chiqolmay qolardi.
 *
 * Shuning uchun chiqish ikki ishni bajaradi:
 *  1) serverdan cookie'ni o'chirishni so'raydi;
 *  2) sahifani BUTUNLAY qayta yuklaydi (router emas). Umumiy planshetda bu
 *     muhim: avvalgi xodimning stollari, buyurtmalari va realtime oqimi
 *     xotirada qolib ketmaydi. `replace` esa "orqaga" tugmasi bilan panelga
 *     qaytib kirishning oldini oladi.
 */
export default function SignOutButton({
  className,
  label = 'Chiqish',
  children,
}: {
  className?: string;
  label?: string;
  children?: React.ReactNode;
}) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err: unknown) {
      // Tarmoq uzilgan bo'lsa ham ekranni tark etamiz: cookie qisqa muddatli
      // va keyingi so'rov baribir kirishga qaytaradi.
      console.error('Tizimdan chiqishda xatolik:', err);
    } finally {
      window.location.replace('/login');
    }
  }, [isSigningOut]);

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={isSigningOut}
      aria-busy={isSigningOut}
      className={className}
    >
      {children}
      {isSigningOut ? 'Chiqilmoqda…' : label}
    </button>
  );
}
