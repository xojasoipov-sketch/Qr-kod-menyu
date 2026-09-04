import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession, landingPathFor } from '@/lib/auth/session';
import SignInPanels from '@/components/auth/SignInPanels';
import { firstSearchParam, safeNextPath } from '@/components/auth/next-path';
import { SIGNIN_MODE_COOKIE, parseSignInMode } from '@/components/auth/signin-mode';

/**
 * YAGONA kirish sahifasi.
 *
 * Ilgari kirish ikkiga bo'lingan edi — xodim `/pin` ga, rahbar `/login` ga
 * borishi kerak edi va odam qaysi manzilni ochishini bilmasdi. Endi hamma shu
 * yerdan kiradi: yuqorida ikki bo'lakli almashtirgich, ostida esa o'sha
 * o'zgarmagan ikki forma (xizmat kodi terminali va parol maydoni).
 *
 * Bu sahifa server komponenti: allaqachon kirgan odamni forma bilan
 * bezovta qilmaymiz — uni to'g'ridan-to'g'ri o'z paneliga o'tkazamiz.
 */

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();

  if (session) {
    const params = await searchParams;
    // `?next=` faqat xavfsiz ichki yo'l bo'lsa hurmat qilinadi (ochiq
    // qayta yo'naltirishga yo'l qo'ymaymiz), aks holda rolning o'z paneli.
    const next = safeNextPath(firstSearchParam(params.next));
    redirect(next ?? landingPathFor(session.role));
  }

  // Qurilma o'zi tanlagan yorliqni eslab qoladi — shuni birinchi chizilishdayoq
  // qo'llaymiz, shunda planshetda ekran "sakramaydi".
  const cookieStore = await cookies();
  const initialMode = parseSignInMode(cookieStore.get(SIGNIN_MODE_COOKIE)?.value);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0C0A09] px-5 py-12">
      {/* Iliq, sokin yorug'lik — xuddi devor bra chirog'i */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-14%] h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-gold-500/[0.07] blur-[130px]" />
        <div className="absolute bottom-[-18%] left-[8%] h-[300px] w-[300px] rounded-full bg-amber-700/[0.06] blur-[130px]" />
      </div>

      <div className="relative flex w-full justify-center">
        <Suspense
          fallback={
            <div className="w-full max-w-sm rounded-2xl border border-surface-border bg-surface-100/70 px-8 py-20 text-center text-xs text-stone-600 shadow-luxury">
              Yuklanmoqda…
            </div>
          }
        >
          <SignInPanels initialMode={initialMode} />
        </Suspense>
      </div>
    </main>
  );
}
