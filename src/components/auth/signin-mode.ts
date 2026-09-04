/**
 * Kirish usulini shu qurilma uchun eslab qolish.
 *
 * Nega localStorage emas, cookie? Chunki tanlovni server ham bilishi kerak:
 * sahifaning BIRINCHI chizilishi darhol to'g'ri yorliq bilan ochilsin. Aks
 * holda planshet avval raqamli klaviaturani ko'rsatib, so'ng parol maydoniga
 * "sakrab" o'tadi — ish vaqtida bu bezovta qiladi.
 *
 * Muhim: bu yerga faqat odam yorliqni O'ZI bosgani yoziladi. Manzildagi
 * `?mode=` yoki `?next=` hech qachon yozilmaydi — aks holda zaldagi umumiy
 * planshetda bitta rahbarning `/admin` havolasi hamma uchun odatiy ekranni
 * parol maydoniga aylantirib qo'yardi.
 */

export type SignInMode = 'pin' | 'admin';

export const SIGNIN_MODE_COOKIE = 'signin-mode';

/** Bir yil — planshet smenadan smenaga o'z holicha to'g'ri ochiladi. */
const REMEMBER_SECONDS = 365 * 24 * 60 * 60;

export function isSignInMode(value: unknown): value is SignInMode {
  return value === 'pin' || value === 'admin';
}

/** Cookie yo'q yoki buzilgan bo'lsa — xodim rejimi (eng ko'p ishlatiladigani). */
export function parseSignInMode(value: string | null | undefined): SignInMode {
  return isSignInMode(value) ? value : 'pin';
}

/** Faqat brauzerda chaqiriladi. */
export function rememberSignInMode(mode: SignInMode): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SIGNIN_MODE_COOKIE}=${mode}; Path=/; Max-Age=${REMEMBER_SECONDS}; SameSite=Lax${secure}`;
}
