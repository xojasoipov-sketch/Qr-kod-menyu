'use client';

import { useState } from 'react';
import { db } from '@/lib/db/store';
import { Staff, UserRole } from '@/types/database';
import { Users, Shield, Plus, Mail, X } from 'lucide-react';

const ROLE_BADGES: Record<UserRole, { label: string; bg: string; color: string; desc: string }> = {
  SUPER_ADMIN: { label: 'Platforma Asosiy Admini', bg: 'bg-purple-500/20 border-purple-500/30', color: 'text-purple-300', desc: 'To\'liq tizim va barcha filiallar' },
  RESTAURANT_OWNER: { label: 'Restoran Egasi', bg: 'bg-gold-500/20 border-gold-500/30', color: 'text-gold-300', desc: 'Moliyaviy tushum va to\'liq boshqaruv' },
  MANAGER: { label: 'Menejer (Administrator)', bg: 'bg-blue-500/20 border-blue-500/30', color: 'text-blue-300', desc: 'Menyu, stollar va xodimlar nazorati' },
  WAITER: { label: 'Ofitsiant', bg: 'bg-teal-500/20 border-teal-500/30', color: 'text-teal-300', desc: 'Stollarga xizmat va chaqiruvlarni qabul qilish' },
  KITCHEN: { label: 'Oshpaz (Oshxona)', bg: 'bg-amber-500/20 border-amber-500/30', color: 'text-amber-300', desc: 'Oshxona ekranida taomlarni qabul qilib pishirish' },
};

export default function AdminStaffPage() {
  const [restaurantId] = useState('rest-001');
  const [staff, setStaff] = useState<Staff[]>(() => db.staff);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('WAITER');

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) return;

    const newStaff: Staff = {
      id: `staff-${Date.now()}`,
      restaurant_id: restaurantId,
      branch_id: 'branch-001',
      user_id: `usr-${Date.now()}`,
      name,
      email,
      role,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.staff.push(newStaff);
    setStaff([...db.staff]);
    setIsInviteModalOpen(false);
    setName('');
    setEmail('');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
        <div>
          <h1 className="font-serif font-bold text-2xl sm:text-3xl text-white">
            Xodimlar va Huquqlar (Rollar)
          </h1>
          <p className="text-xs text-stone-400 mt-1">
            Restoran egasi, menejer, oshpaz va ofitsiantlar uchun alohida qulay huquqlar.
          </p>
        </div>

        <button
          onClick={() => setIsInviteModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-gold-400 to-amber-500 text-stone-950 font-bold text-xs shadow-gold-glow hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Yangi Xodim Qo&apos;shish</span>
        </button>
      </div>

      {/* Roles Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-surface-100 border border-surface-border">
          <div className="flex items-center gap-2 text-gold-300 font-serif font-bold text-sm mb-1">
            <Shield className="w-4 h-4 text-gold-400" />
            <span>Xavfsiz Kirish Nazorati</span>
          </div>
          <p className="text-xs text-stone-400 leading-relaxed">
            Har bir xodim faqat o&apos;ziga tegishli oynani (oshxona yoki ofitsiant paneli) ko&apos;radi.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-surface-100 border border-surface-border">
          <div className="flex items-center gap-2 text-amber-300 font-serif font-bold text-sm mb-1">
            <Shield className="w-4 h-4 text-amber-400" />
            <span>Filiallar Bo&apos;yicha Cheklov</span>
          </div>
          <p className="text-xs text-stone-400 leading-relaxed">
            Oshpazlar va ofitsiantlar faqat o&apos;z filialiga tegishli buyurtmalar bilan ishlaydi.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-surface-100 border border-surface-border">
          <div className="flex items-center gap-2 text-blue-300 font-serif font-bold text-sm mb-1">
            <Shield className="w-4 h-4 text-blue-400" />
            <span>Mijozlar Uchun Xavfsizlik</span>
          </div>
          <p className="text-xs text-stone-400 leading-relaxed">
            QR orqali kirgan mijozlar faqat o&apos;z stolining menyusini ko&apos;radi, ichki ma&apos;lumotlarga kira olmaydi.
          </p>
        </div>
      </div>

      {/* Staff Members List */}
      <div className="bg-surface-100 rounded-2xl border border-surface-border overflow-hidden shadow-luxury">
        <div className="p-4 bg-surface-50 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-gold-400" />
            <h2 className="font-serif font-bold text-sm text-white">
              Ro&apos;yxatdan O&apos;tgan Xodimlar ({staff.length} nafar)
            </h2>
          </div>
        </div>

        <div className="divide-y divide-surface-border/60">
          {staff.map((member) => {
            const roleInfo = ROLE_BADGES[member.role] || ROLE_BADGES.WAITER;

            return (
              <div key={member.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-surface-50 border border-surface-border flex items-center justify-center font-bold text-gold-300 text-sm">
                    {member.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-sm text-white">
                      {member.name}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-stone-400">
                      <Mail className="w-3 h-3 text-stone-500" />
                      <span>{member.email}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <div className="text-right">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${roleInfo.bg} ${roleInfo.color}`}>
                      {roleInfo.label}
                    </span>
                    <span className="text-[10px] text-stone-500 block mt-0.5">{roleInfo.desc}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invite Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-surface-100 border border-surface-border rounded-3xl p-6 shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between pb-4 border-b border-surface-border mb-4">
              <h2 className="font-serif font-bold text-lg text-white">Yangi Xodim Qo&apos;shish</h2>
              <button
                onClick={() => setIsInviteModalOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleInvite} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-stone-300 font-semibold mb-1">Ism va Familiya *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Masalan: Sardor Rustamov"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Elektron Pochta *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Masalan: sardor@flavoria.uz"
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                />
              </div>

              <div>
                <label className="block text-stone-300 font-semibold mb-1">Vazifasi (Roli) *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400"
                >
                  <option value="WAITER">OFITSIANT — Stol chaqiruvlari va xizmat</option>
                  <option value="KITCHEN">OSHPAZ — Oshxona ekrani</option>
                  <option value="MANAGER">MENEJER — Menyu va stollar nazorati</option>
                  <option value="RESTAURANT_OWNER">RESTORAN EGASI — To&apos;liq boshqaruv va hisobotlar</option>
                </select>
              </div>

              <div className="pt-4 border-t border-surface-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-surface-200 text-stone-300 hover:text-white"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gold-400 text-stone-950 font-bold hover:bg-gold-300"
                >
                  Biriktirish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
