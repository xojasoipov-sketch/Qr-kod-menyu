import { redirect } from 'next/navigation';
import { firstSearchParam, safeNextPath } from '@/components/auth/next-path';

/**
 * Eski xodimlar manzili. Kirish endi yagona `/login` sahifasida, lekin bu yo'l
 * ishlashda davom etadi: xodimga yuborilgan taklifnomada (`src/lib/notify`),
 * planshetlarning xatcho'plarida va chop etilgan qog'ozlarda aynan `/pin` yozilgan.
 *
 * Foydalanuvchi o'sha "Xizmat kodi" ekranini ko'radi — faqat manzil almashadi.
 */

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function StaffPinPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const next = safeNextPath(firstSearchParam(params.next));

  const target = new URLSearchParams({ mode: 'pin' });
  if (next) target.set('next', next);

  redirect(`/login?${target.toString()}`);
}
