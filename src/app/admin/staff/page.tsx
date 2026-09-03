'use client';

import { useState, useEffect } from 'react';
import { Staff, UserRole, NotificationChannel, NotificationLog } from '@/types/database';
import { getStaff } from '@/lib/api';
import {
  Users,
  Shield,
  Plus,
  Mail,
  Phone,
  X,
  KeyRound,
  Eye,
  EyeOff,
  ChefHat,
  ConciergeBell,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  CircleSlash,
  Terminal,
  MessageSquare,
  Send,
} from 'lucide-react';

const ROLE_BADGES: Record<UserRole, { label: string; bg: string; color: string; desc: string }> = {
  SUPER_ADMIN: { label: 'Platforma Asosiy Admini', bg: 'bg-purple-500/20 border-purple-500/30', color: 'text-purple-300', desc: 'To\'liq tizim va barcha filiallar' },
  RESTAURANT_OWNER: { label: 'Restoran Egasi', bg: 'bg-gold-500/20 border-gold-500/30', color: 'text-gold-300', desc: 'Moliyaviy tushum va to\'liq boshqaruv' },
  MANAGER: { label: 'Menejer (Administrator)', bg: 'bg-blue-500/20 border-blue-500/30', color: 'text-blue-300', desc: 'Menyu, stollar va xodimlar nazorati' },
  WAITER: { label: 'Ofitsiant', bg: 'bg-teal-500/20 border-teal-500/30', color: 'text-teal-300', desc: 'Stollarga xizmat va chaqiruvlarni qabul qilish' },
  KITCHEN: { label: 'Oshpaz (Oshxona)', bg: 'bg-amber-500/20 border-amber-500/30', color: 'text-amber-300', desc: 'Oshxona ekranida taomlarni qabul qilib pishirish' },
};

/** Har bir rol uchun restoran hayotidan olingan belgi — signage kabi, o'yin nishoni emas. */
const ROLE_ICONS: Record<UserRole, typeof ChefHat> = {
  SUPER_ADMIN: ShieldCheck,
  RESTAURANT_OWNER: KeyRound,
  MANAGER: ShieldCheck,
  WAITER: ConciergeBell,
  KITCHEN: ChefHat,
};

/** Bildirishnoma kanallarining o'zbekcha nomi va belgisi. */
const CHANNEL_META: Record<NotificationChannel, { label: string; icon: typeof Mail }> = {
  email: { label: 'Elektron pochta', icon: Mail },
  sms: { label: 'SMS', icon: MessageSquare },
  telegram: { label: 'Telegram', icon: Send },
  console: { label: 'Server jurnali', icon: Terminal },
};

const CHANNEL_ORDER: NotificationChannel[] = ['email', 'sms', 'telegram', 'console'];

function statusLabel(status: NotificationLog['status']): string {
  if (status === 'sent') return 'Yuborildi';
  if (status === 'failed') return 'Xato';
  return 'Sozlanmagan';
}

function StatusPill({ status }: { status: NotificationLog['status'] }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <CheckCircle2 className="w-3 h-3" />
        {statusLabel(status)}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/15 text-red-300 border border-red-500/30">
        <XCircle className="w-3 h-3" />
        {statusLabel(status)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-200 text-stone-400 border border-surface-border">
      <CircleSlash className="w-3 h-3" />
      {statusLabel(status)}
    </span>
  );
}

interface InviteResult {
  staff: Staff;
  deliveries: NotificationLog[];
}

interface CreateStaffResponse {
  success: boolean;
  staff: Staff;
  deliveries: NotificationLog[];
}

async function postStaff(input: {
  restaurant_id: string;
  branch_id?: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  pin?: string;
}): Promise<CreateStaffResponse> {
  const res = await fetch('/api/staff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `So'rov bajarilmadi (${res.status})`;
    throw new Error(message);
  }

  return body as CreateStaffResponse;
}

export default function AdminStaffPage() {
  const [restaurantId] = useState('rest-001');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [revealedPins, setRevealedPins] = useState<Record<string, boolean>>({});

  // Server is the source of truth: the staff list is pulled from the API, never from a client store copy.
  useEffect(() => {
    let cancelled = false;
    getStaff(restaurantId)
      .then((next) => {
        if (!cancelled) setStaff(next);
      })
      .catch((err: unknown) => {
        console.error("Xodimlarni yuklab bo'lmadi:", err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<UserRole>('WAITER');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);

  const resetInviteForm = () => {
    setName('');
    setEmail('');
    setPhone('');
    setPin('');
    setRole('WAITER');
    setInviteError(null);
  };

  const closeInviteModal = () => {
    setIsInviteModalOpen(false);
    setInviteResult(null);
    resetInviteForm();
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) return;

    if (pin && !/^\d{4}$/.test(pin.trim())) {
      setInviteError("PIN kod aynan 4 ta raqamdan iborat bo'lishi kerak.");
      return;
    }

    setIsInviting(true);
    setInviteError(null);
    try {
      // Persisted server-side: the new staff member is visible on reload and in other tabs.
      const response = await postStaff({
        restaurant_id: restaurantId,
        branch_id: 'branch-001',
        name,
        email,
        role,
        phone: phone.trim() || undefined,
        pin: pin.trim() || undefined,
      });
      setStaff((prev) => [...prev, response.staff]);
      setInviteResult({ staff: response.staff, deliveries: response.deliveries });
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : "Xodimni biriktirib bo'lmadi");
    } finally {
      setIsInviting(false);
    }
  };

  const togglePinVisible = (staffId: string) => {
    setRevealedPins((prev) => ({ ...prev, [staffId]: !prev[staffId] }));
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
        <div className="p-4 bg-surface-50 border-b border-surface-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-gold-400" />
            <h2 className="font-serif font-bold text-sm text-white">
              Ro&apos;yxatdan O&apos;tgan Xodimlar ({staff.length} nafar)
            </h2>
          </div>
          <p className="text-[11px] text-stone-500 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-stone-500" />
            PIN kod <span className="font-mono text-stone-400">/pin</span> sahifasida kiritiladi — xodim bir marta kirgach, seansi doimiy saqlanadi.
          </p>
        </div>

        <div className="divide-y divide-surface-border/60">
          {isLoading && staff.length === 0 && (
            <div className="p-4 text-xs text-stone-400">Yuklanmoqda...</div>
          )}
          {staff.map((member) => {
            const roleInfo = ROLE_BADGES[member.role] || ROLE_BADGES.WAITER;
            const RoleIcon = ROLE_ICONS[member.role] || ConciergeBell;
            const isPinVisible = !!revealedPins[member.id];

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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-400 mt-0.5">
                      <span className="flex items-center gap-1.5">
                        <Mail className="w-3 h-3 text-stone-500" />
                        <span>{member.email}</span>
                      </span>
                      {member.phone && (
                        <span className="flex items-center gap-1.5">
                          <Phone className="w-3 h-3 text-stone-500" />
                          <span className="font-mono">{member.phone}</span>
                        </span>
                      )}
                      {member.pin && (
                        <span className="flex items-center gap-1.5">
                          <KeyRound className="w-3 h-3 text-gold-500/70" />
                          <span className="font-mono tracking-[0.25em] text-stone-300">
                            {isPinVisible ? member.pin : '••••'}
                          </span>
                          <button
                            type="button"
                            onClick={() => togglePinVisible(member.id)}
                            className="text-stone-500 hover:text-gold-300 transition-colors"
                            title={isPinVisible ? 'PIN kodni yashirish' : 'PIN kodni ko\'rsatish'}
                          >
                            {isPinVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <div className="text-right">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold border inline-flex items-center gap-1.5 ${roleInfo.bg} ${roleInfo.color}`}>
                      <RoleIcon className="w-3.5 h-3.5" />
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
              <h2 className="font-serif font-bold text-lg text-white">
                {inviteResult ? 'Xodim Qoʼshildi' : 'Yangi Xodim Qoʼshish'}
              </h2>
              <button
                onClick={closeInviteModal}
                className="w-8 h-8 rounded-full bg-surface-200 text-stone-300 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {inviteResult ? (
              <div className="space-y-4 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-surface-50 border border-surface-border flex items-center justify-center font-bold text-gold-300 text-sm">
                    {inviteResult.staff.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-sm text-white">{inviteResult.staff.name}</h3>
                    <span
                      className={`inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                        (ROLE_BADGES[inviteResult.staff.role] || ROLE_BADGES.WAITER).bg
                      } ${(ROLE_BADGES[inviteResult.staff.role] || ROLE_BADGES.WAITER).color}`}
                    >
                      {(ROLE_BADGES[inviteResult.staff.role] || ROLE_BADGES.WAITER).label}
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-surface-50 border border-surface-border text-center">
                  <p className="text-[10px] uppercase tracking-wider text-stone-500 flex items-center justify-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-gold-500/70" />
                    Kirish PIN kodi
                  </p>
                  <p className="font-mono text-3xl tracking-[0.4em] text-gold-300 mt-2">
                    {inviteResult.staff.pin || '----'}
                  </p>
                  <p className="text-[11px] text-stone-500 mt-2 leading-relaxed">
                    Bu kodni xodimga ayting — u <span className="font-mono text-stone-400">/pin</span> sahifasida
                    kiritadi va bir marta kirgach, seansi doimiy saqlanadi.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">
                    Taklif xabari qayerga yuborildi
                  </p>
                  <div className="rounded-2xl border border-surface-border divide-y divide-surface-border/60 overflow-hidden">
                    {CHANNEL_ORDER.map((channel) => {
                      const delivery = inviteResult.deliveries.find((d) => d.channel === channel);
                      const meta = CHANNEL_META[channel];
                      const ChannelIcon = meta.icon;
                      return (
                        <div key={channel} className="p-2.5 flex items-center justify-between bg-surface-50">
                          <span className="flex items-center gap-2 text-stone-300">
                            <ChannelIcon className="w-3.5 h-3.5 text-stone-500" />
                            {meta.label}
                          </span>
                          <StatusPill status={delivery?.status ?? 'skipped'} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={closeInviteModal}
                    className="px-5 py-2 rounded-xl bg-gold-400 text-stone-950 font-bold hover:bg-gold-300"
                  >
                    Yopish
                  </button>
                </div>
              </div>
            ) : (
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
                  <label className="block text-stone-300 font-semibold mb-1">Telefon Raqami</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+998 90 123 45 67"
                    className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400 font-mono"
                  />
                  <p className="text-[10px] text-stone-500 mt-1">SMS orqali taklif shu raqamga yuboriladi.</p>
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

                <div>
                  <label className="block text-stone-300 font-semibold mb-1 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-stone-500" />
                    PIN Kod (ixtiyoriy)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Masalan: 7412"
                    className="w-full p-2.5 rounded-xl bg-surface-50 border border-surface-border text-stone-100 focus:outline-none focus:border-gold-400 font-mono tracking-[0.3em]"
                  />
                  <p className="text-[10px] text-stone-500 mt-1">
                    Bo&apos;sh qoldirilsa, tizim band bo&apos;lmagan 4 xonali kod o&apos;zi tanlaydi.
                  </p>
                </div>

                {inviteError && (
                  <p className="text-red-400 text-xs">{inviteError}</p>
                )}

                <div className="pt-4 border-t border-surface-border flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeInviteModal}
                    className="px-4 py-2 rounded-xl bg-surface-200 text-stone-300 hover:text-white"
                  >
                    Bekor qilish
                  </button>
                  <button
                    type="submit"
                    disabled={isInviting}
                    className="px-5 py-2 rounded-xl bg-gold-400 text-stone-950 font-bold hover:bg-gold-300 disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {isInviting ? 'Biriktirilmoqda...' : 'Biriktirish'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
