'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ConciergeBell, ShieldCheck } from 'lucide-react';
import AdminSignInCard from './AdminSignInCard';
import StaffPinTerminal from './StaffPinTerminal';
import { isUnderSection, safeNextPath } from './next-path';
import { rememberSignInMode, type SignInMode } from './signin-mode';

/**
 * Yagona kirish oynasi.
 *
 * Restoranda hamma bitta eshikdan kiradi: ofitsiant ham, oshpaz ham, rahbar ham.
 * Shuning uchun bu yerda ikkala usul yonma-yon turadi va odam "men qaysi
 * manzilga borishim kerak" deb o'ylamaydi — yuqoridagi kichik almashtirgichdan
 * o'zining usulini tanlaydi, qolganini server hal qiladi (rolga qarab o'z
 * paneliga yo'naltiradi).
 */

/**
 * Manzildagi aniq ko'rsatma: avval `?mode=`, so'ng `?next=`.
 * Hech biri bo'lmasa `null` — u holda qurilma eslab qolgani ishlatiladi.
 */
function modeFromSearch(rawMode: string | null, rawNext: string | null): SignInMode | null {
  const mode = rawMode?.trim().toLowerCase();
  if (mode === 'parol' || mode === 'admin') return 'admin';
  if (mode === 'pin' || mode === 'xodim') return 'pin';

  const next = safeNextPath(rawNext);
  if (next) {
    if (isUnderSection(next, '/admin')) return 'admin';
    if (isUnderSection(next, '/waiter') || isUnderSection(next, '/kitchen')) return 'pin';
  }

  return null;
}

const TABS: { value: SignInMode; label: string; Icon: typeof ConciergeBell }[] = [
  { value: 'pin', label: 'Xodim', Icon: ConciergeBell },
  { value: 'admin', label: "Ma'muriyat", Icon: ShieldCheck },
];

export default function SignInPanels({ initialMode }: { initialMode: SignInMode }) {
  const searchParams = useSearchParams();
  const explicitMode = modeFromSearch(searchParams.get('mode'), searchParams.get('next'));

  // `initialMode` — server cookie'dan o'qigan qiymat. Shu sababli birinchi
  // chizilishning o'zi to'g'ri yorliq bilan chiqadi, "sakrash" bo'lmaydi.
  const [mode, setMode] = useState<SignInMode>(explicitMode ?? initialMode);

  useEffect(() => {
    // Manzil o'zgarsa (masalan, middleware `?next=` bilan qaytarsa) —
    // ko'rsatilgan yorliqqa o'tamiz. Lekin buni ESLAB QOLMAYMIZ.
    if (explicitMode) setMode(explicitMode);
  }, [explicitMode]);

  const selectMode = useCallback((value: SignInMode) => {
    setMode(value);
    // Faqat shu yerda — odam o'zi tanlagandagina — qurilma eslab qoladi.
    rememberSignInMode(value);
  }, []);

  return (
    <div className="w-full max-w-sm">
      <div
        role="tablist"
        aria-label="Kirish usuli"
        className="mb-7 grid grid-cols-2 gap-1.5 rounded-xl border border-surface-border bg-surface-100/70 p-1.5"
      >
        {TABS.map(({ value, label, Icon }) => {
          const isActive = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              id={`signin-tab-${value}`}
              aria-selected={isActive}
              aria-controls={`signin-panel-${value}`}
              onClick={() => selectMode(value)}
              className={`flex h-11 items-center justify-center gap-2 rounded-lg border text-xs font-medium tracking-wide transition-colors ${
                isActive
                  ? 'border-gold-500/40 bg-gold-500/[0.10] text-gold-200'
                  : 'border-transparent text-stone-500 hover:bg-surface-200/40 hover:text-stone-300'
              }`}
            >
              <Icon
                className={`h-3.5 w-3.5 ${isActive ? 'text-gold-400/90' : 'text-stone-600'}`}
                strokeWidth={1.5}
              />
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`signin-panel-${mode}`}
        aria-labelledby={`signin-tab-${mode}`}
      >
        {mode === 'pin' ? <StaffPinTerminal /> : <AdminSignInCard />}
      </div>
    </div>
  );
}
