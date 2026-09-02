'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  ShoppingBag, 
  UtensilsCrossed, 
  FolderTree, 
  QrCode, 
  Users, 
  BarChart3, 
  Settings, 
  ExternalLink,
  ChefHat,
  BellRing
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Boshqaruv Paneli', href: '/admin', icon: <LayoutDashboard className="w-4 h-4" /> },
  { label: 'Buyurtmalar & Tarix', href: '/admin/orders', icon: <ShoppingBag className="w-4 h-4" /> },
  { label: 'Menyu & Taomlar', href: '/admin/menu', icon: <UtensilsCrossed className="w-4 h-4" /> },
  { label: 'Kategoriyalar', href: '/admin/categories', icon: <FolderTree className="w-4 h-4" /> },
  { label: 'Stollar & QR Kodlar', href: '/admin/tables', icon: <QrCode className="w-4 h-4" /> },
  { label: 'Xodimlar & Rollar', href: '/admin/staff', icon: <Users className="w-4 h-4" /> },
  { label: 'Daromad & Tahlil', href: '/admin/analytics', icon: <BarChart3 className="w-4 h-4" /> },
  { label: 'Restoran Sozlamalari', href: '/admin/settings', icon: <Settings className="w-4 h-4" /> },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-[#110F0D] border-r border-surface-border flex flex-col justify-between flex-shrink-0 min-h-screen">
      {/* Brand Header */}
      <div>
        <div className="p-5 border-b border-surface-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-400 to-amber-600 flex items-center justify-center shadow-gold-glow">
            <UtensilsCrossed className="w-5 h-5 text-stone-950 font-bold" />
          </div>
          <div>
            <div className="font-serif font-bold text-sm text-gold-300 tracking-wider">
              FLAVORIA SAAS
            </div>
            <div className="text-[10px] text-stone-400 font-mono uppercase">
              Boshqaruv Markazi
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-gold-400/20 to-amber-500/10 text-gold-300 border border-gold-400/40 shadow-sm'
                    : 'text-stone-400 hover:text-stone-100 hover:bg-surface-100'
                }`}
              >
                <span className={isActive ? 'text-gold-400' : 'text-stone-500'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom Live Links */}
      <div className="p-4 border-t border-surface-border/80 space-y-2">
        <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-2">
          Jonli Ishchi Terminallar
        </div>

        <Link
          href="/kitchen"
          target="_blank"
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-100 text-stone-300 hover:text-white text-xs border border-surface-border group"
        >
          <div className="flex items-center gap-2">
            <ChefHat className="w-3.5 h-3.5 text-amber-400" />
            <span>Oshxona Ekrani</span>
          </div>
          <ExternalLink className="w-3 h-3 text-stone-500 group-hover:text-stone-300" />
        </Link>

        <Link
          href="/waiter"
          target="_blank"
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-100 text-stone-300 hover:text-white text-xs border border-surface-border group"
        >
          <div className="flex items-center gap-2">
            <BellRing className="w-3.5 h-3.5 text-blue-400" />
            <span>Ofitsiant Paneli</span>
          </div>
          <ExternalLink className="w-3 h-3 text-stone-500 group-hover:text-stone-300" />
        </Link>

        <Link
          href="/t/flavoria-t12"
          target="_blank"
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-gold-400/10 text-gold-300 hover:bg-gold-400/20 text-xs border border-gold-400/30 group"
        >
          <div className="flex items-center gap-2">
            <QrCode className="w-3.5 h-3.5 text-gold-400" />
            <span>Mijoz QR Menyusi</span>
          </div>
          <ExternalLink className="w-3 h-3 text-gold-400/60 group-hover:text-gold-300" />
        </Link>
      </div>
    </aside>
  );
}
