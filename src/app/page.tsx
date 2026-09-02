'use client';

import Link from 'next/link';
import { 
  QrCode, 
  ChefHat, 
  BellRing, 
  LayoutDashboard, 
  Sparkles, 
  ShieldCheck, 
  Zap, 
  Smartphone, 
  ArrowRight,
  UtensilsCrossed,
  Layers
} from 'lucide-react';

export default function HomePage() {
  const demoTables = [
    { name: '12-stol (Yozgi Terrasa)', token: 'flavoria-t12', zone: 'Terrasa', guests: '4 kishilik' },
    { name: '7-stol (VIP Xona)', token: 'k9F3PqA7xL', zone: 'VIP Zal', guests: '6 kishilik' },
    { name: '4-stol (Asosiy Zal)', token: 'a8F3kP9x', zone: 'Asosiy Zal', guests: '4 kishilik' },
  ];

  return (
    <main className="min-h-screen bg-[#0C0A09] text-[#FAF5EE] overflow-x-hidden">
      {/* Orqa fon nuri */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-gold-500/10 rounded-full blur-[140px]" />
        <div className="absolute bottom-[10%] right-[15%] w-[450px] h-[450px] bg-amber-600/10 rounded-full blur-[140px]" />
      </div>

      {/* Yuqori Menyu */}
      <header className="sticky top-0 z-50 glass-nav px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-400 to-amber-600 flex items-center justify-center shadow-gold-glow">
            <UtensilsCrossed className="w-5 h-5 text-stone-950 font-bold" />
          </div>
          <div>
            <div className="font-serif text-lg font-bold tracking-wider text-gold-300">RESTAURANT QR OS</div>
            <div className="text-[10px] text-stone-400 uppercase tracking-widest font-mono">Restoran Boshqaruv Tizimi</div>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm text-stone-300">
          <Link href="/kitchen" className="hover:text-gold-300 transition-colors flex items-center gap-1.5">
            <ChefHat className="w-4 h-4 text-gold-400" /> Oshxona (KDS)
          </Link>
          <Link href="/waiter" className="hover:text-gold-300 transition-colors flex items-center gap-1.5">
            <BellRing className="w-4 h-4 text-gold-400" /> Ofitsiant Paneli
          </Link>
          <Link href="/admin" className="hover:text-gold-300 transition-colors flex items-center gap-1.5">
            <LayoutDashboard className="w-4 h-4 text-gold-400" /> Admin Paneli
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/t/flavoria-t12"
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-gold-400 to-amber-500 text-stone-950 font-semibold text-xs tracking-wide shadow-gold-glow hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
          >
            <Smartphone className="w-4 h-4" />
            <span>Mijoz QR Menyusi</span>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative px-6 pt-16 pb-20 max-w-6xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gold-400/10 border border-gold-400/30 text-gold-300 text-xs font-medium mb-6">
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          <span>Ishlab Chiqarishga Tayyor Zamonaviy Restoran Tizimi</span>
        </div>

        <h1 className="font-serif text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-tight">
          Mukammal Lazzat & <br className="hidden sm:inline" />
          <span className="gold-gradient-text">Tezkor Oshxona Boshqaruvi</span>
        </h1>

        <p className="max-w-2xl mx-auto text-stone-400 text-sm sm:text-base mb-10 leading-relaxed font-light">
          Mijozlar stoldagi QR kodni skanerlab ilova yuklab olmasdan to&apos;g&apos;ridan-to&apos;g&apos;ri buyurtma beradi. Buyurtma bir lahzada oshxona ekraniga va ofitsiantga ovozli signal bilan yetib boradi.
        </p>

        {/* 4 Asosiy Oyna */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left max-w-5xl mx-auto">
          {/* 1. Mijoz */}
          <Link
            href="/t/flavoria-t12"
            className="group p-5 rounded-2xl bg-surface-100/80 border border-surface-border hover:border-gold-400/50 hover:bg-surface-200 transition-all duration-300 relative overflow-hidden shadow-luxury flex flex-col justify-between"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-gold-400/5 rounded-full blur-2xl group-hover:bg-gold-400/15 transition-all" />
            <div>
              <div className="w-12 h-12 rounded-xl bg-gold-400/10 border border-gold-400/30 flex items-center justify-center mb-4 text-gold-400 group-hover:scale-110 transition-transform">
                <QrCode className="w-6 h-6" />
              </div>
              <div className="font-serif font-bold text-base text-white mb-1 group-hover:text-gold-300 transition-colors">
                1. Mijoz QR Menyusi
              </div>
              <p className="text-xs text-stone-400 leading-relaxed">
                Telefon uchun qulay interfeys, taom qo&apos;shimchalari, savatcha, ofitsiantni chaqirish va jonli buyurtma holati.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-surface-border flex items-center justify-between text-xs font-semibold text-gold-400">
              <span>12-stol menyusini ochish</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* 2. Oshxona KDS */}
          <Link
            href="/kitchen"
            className="group p-5 rounded-2xl bg-surface-100/80 border border-surface-border hover:border-amber-500/50 hover:bg-surface-200 transition-all duration-300 relative overflow-hidden shadow-luxury flex flex-col justify-between"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/15 transition-all" />
            <div>
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4 text-amber-400 group-hover:scale-110 transition-transform">
                <ChefHat className="w-6 h-6" />
              </div>
              <div className="font-serif font-bold text-base text-white mb-1 group-hover:text-amber-300 transition-colors">
                2. Oshxona Ekrani (KDS)
              </div>
              <p className="text-xs text-stone-400 leading-relaxed">
                Oshpazlar uchun 3 ustunli doska (Yangi, Pishirilmoqda, Tayyor), ovozli qo&apos;ng&apos;iroq va daqiqa taymerlari.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-surface-border flex items-center justify-between text-xs font-semibold text-amber-400">
              <span>Oshxona ekranini ochish</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* 3. Ofitsiant */}
          <Link
            href="/waiter"
            className="group p-5 rounded-2xl bg-surface-100/80 border border-surface-border hover:border-blue-400/50 hover:bg-surface-200 transition-all duration-300 relative overflow-hidden shadow-luxury flex flex-col justify-between"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-400/5 rounded-full blur-2xl group-hover:bg-blue-400/15 transition-all" />
            <div>
              <div className="w-12 h-12 rounded-xl bg-blue-400/10 border border-blue-400/30 flex items-center justify-center mb-4 text-blue-400 group-hover:scale-110 transition-transform">
                <BellRing className="w-6 h-6" />
              </div>
              <div className="font-serif font-bold text-base text-white mb-1 group-hover:text-blue-300 transition-colors">
                3. Ofitsiant Paneli
              </div>
              <p className="text-xs text-stone-400 leading-relaxed">
                Stollardan chaqiruvlarni qabul qilish, oshxonadan pishgan taomlarni stolga yetkazish va zaldagi stollar holati.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-surface-border flex items-center justify-between text-xs font-semibold text-blue-400">
              <span>Ofitsiant panelini ochish</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* 4. Admin */}
          <Link
            href="/admin"
            className="group p-5 rounded-2xl bg-surface-100/80 border border-surface-border hover:border-emerald-400/50 hover:bg-surface-200 transition-all duration-300 relative overflow-hidden shadow-luxury flex flex-col justify-between"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-400/5 rounded-full blur-2xl group-hover:bg-emerald-400/15 transition-all" />
            <div>
              <div className="w-12 h-12 rounded-xl bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center mb-4 text-emerald-400 group-hover:scale-110 transition-transform">
                <LayoutDashboard className="w-6 h-6" />
              </div>
              <div className="font-serif font-bold text-base text-white mb-1 group-hover:text-emerald-300 transition-colors">
                4. Admin & Boshqaruv
              </div>
              <p className="text-xs text-stone-400 leading-relaxed">
                Tushum hisoboti, taomlar va narxlar boshqaruvi, stollar uchun akril QR stendlarni chop etish va xodimlar.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-surface-border flex items-center justify-between text-xs font-semibold text-emerald-400">
              <span>Admin panelini ochish</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        </div>
      </section>

      {/* Stolni tanlab sinab ko'rish */}
      <section className="px-6 py-12 max-w-4xl mx-auto border-t border-surface-border/60">
        <div className="text-center mb-8">
          <h2 className="font-serif text-xl sm:text-2xl font-bold text-white mb-2">
            Mijoz Sifatida Stol QR Menyusini Sinab Ko&apos;ring
          </h2>
          <p className="text-stone-400 text-xs sm:text-sm">
            Quyidagi stollardan birini tanlang va buyurtma berish jarayonini ko&apos;ring:
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {demoTables.map((t) => (
            <Link
              key={t.token}
              href={`/t/${t.token}`}
              className="p-4 rounded-xl bg-surface-100 border border-surface-border hover:border-gold-400/60 hover:bg-surface-200 transition-all flex items-center justify-between group"
            >
              <div>
                <div className="text-xs text-gold-400 font-mono tracking-wider font-semibold">{t.zone}</div>
                <div className="font-serif font-bold text-sm text-stone-100 group-hover:text-gold-300">{t.name}</div>
                <div className="text-[11px] text-stone-500">{t.guests} • Kod: <code className="text-stone-300">{t.token}</code></div>
              </div>
              <div className="w-9 h-9 rounded-lg bg-gold-400/10 flex items-center justify-center text-gold-400 group-hover:scale-110 transition-transform">
                <QrCode className="w-5 h-5" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Afzalliklar */}
      <section className="px-6 py-16 max-w-5xl mx-auto border-t border-surface-border/60">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-surface-100/50 border border-surface-border">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 mb-4">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-serif font-bold text-base text-stone-100 mb-2">100% Aniq Hisob-Kitob</h3>
            <p className="text-xs text-stone-400 leading-relaxed">
              Narxlar va xizmat haqi serverda qayta hisoblanadi. Mijoz hech qachon noto&apos;g&apos;ri narx bilan buyurtma bera olmaydi.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-surface-100/50 border border-surface-border">
            <div className="w-10 h-10 rounded-xl bg-gold-400/10 flex items-center justify-center text-gold-400 mb-4">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="font-serif font-bold text-base text-stone-100 mb-2">Jonli Real-Vaqt Oqimi</h3>
            <p className="text-xs text-stone-400 leading-relaxed">
              Sahifani yangilash shart emas. Oshxona holatni o&apos;zgartirsa, mijoz telefonida daqiqasiga mos yangilanadi.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-surface-100/50 border border-surface-border">
            <div className="w-10 h-10 rounded-xl bg-blue-400/10 flex items-center justify-center text-blue-400 mb-4">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="font-serif font-bold text-base text-stone-100 mb-2">Oson va Tezkor QR Chop Etish</h3>
            <p className="text-xs text-stone-400 leading-relaxed">
              Admin panel orqali har bir stol uchun tayyor akril stend dizaynini darhol printerdan chiqarish mumkin.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-surface-border text-center text-xs text-stone-500">
        <div className="flex items-center justify-center gap-2 mb-2 font-serif text-stone-400">
          <span>RESTAURANT QR OS</span> • <span>Zamonaviy Restoran Texnologiyalari</span>
        </div>
        <p>Next.js 15, TypeScript va Real-vaqtli Server Oqimi asosida yaratilgan.</p>
      </footer>
    </main>
  );
}
