import { OrderStatus } from '@/types/database';

export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // Oshxona ofitsiant tasdiqlamagan buyurtmani ola olmaydi: 'preparing' bu yerdan olib tashlandi.
  // 'confirmed' ham shu ro'yxatda yo'q — buyurtmani faqat ofitsiant, `POST /api/orders/[id]/accept`
  // orqali tasdiqlay oladi (u `accepted_at` ni ham to'ldiradi). Aks holda oshxona
  // holatni to'g'ridan-to'g'ri 'confirmed' ga o'tkazib, tasdiqlash bosqichini chetlab o'tar edi.
  pending: ['cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered', 'completed'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
};

export class OrderStateMachineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderStateMachineError';
  }
}

export function validateStatusTransition(
  currentStatus: OrderStatus,
  targetStatus: OrderStatus
): boolean {
  if (currentStatus === targetStatus) return true;
  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  return allowed.includes(targetStatus);
}

export function assertValidTransition(
  currentStatus: OrderStatus,
  targetStatus: OrderStatus
): void {
  if (!validateStatusTransition(currentStatus, targetStatus)) {
    throw new OrderStateMachineError(
      `Buyurtma holatini "${currentStatus}" dan "${targetStatus}" ga o'tkazib bo'lmaydi.`
    );
  }
}

export const STATUS_DISPLAY_INFO: Record<
  OrderStatus,
  { label: string; description: string; step: number; color: string; bg: string }
> = {
  pending: {
    label: 'Ofitsiant tasdiqlashini kutmoqda',
    description:
      'Buyurtmangiz ofitsiantga yuborildi. U tasdiqlagach oshxona tayyorlashni boshlaydi.',
    step: 1,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/30',
  },
  confirmed: {
    label: 'Tasdiqlandi',
    description: 'Oshxona jamoasi buyurtmangizni qabul qildi.',
    step: 2,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/30',
  },
  preparing: {
    label: 'Tayyorlanmoqda',
    description: 'Oshpazlarimiz taomingizni mehr bilan pishirmoqda.',
    step: 3,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10 border-yellow-500/30',
  },
  ready: {
    label: 'Dasturxonga tayyor!',
    description: 'Taomingiz yangi pishdi va stolingizga olib borilmoqda!',
    step: 4,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
  },
  delivered: {
    label: 'Yetkazildi',
    description: 'Yoqimli ishtaha! Maroqli hordiq va yoqimli taom tilaymiz.',
    step: 5,
    color: 'text-gold-400',
    bg: 'bg-gold-500/10 border-gold-500/30',
  },
  completed: {
    label: 'Yakunlandi',
    description: 'Buyurtma to\'liq bajarildi. Tashrifingiz uchun rahmat!',
    step: 6,
    color: 'text-gray-400',
    bg: 'bg-stone-800/40 border-stone-700/40',
  },
  cancelled: {
    label: 'Bekor qilindi',
    description: 'Ushbu buyurtma bekor qilingan.',
    step: 0,
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/30',
  },
};
