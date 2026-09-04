/**
 * Kirish sahifasi uchun kichik yordamchilar. Bu fayl ataylab "use client"
 * emas — bir xil mantiq ham server komponentida (sessiya bor bo'lsa darhol
 * yo'naltirish), ham brauzerda (formani yuborgandan keyin) ishlatiladi.
 */

/**
 * Brauzer manzilni o'qishdan OLDIN tabulyatsiya, satr ko'chirish va boshqa
 * boshqaruv belgilarini tashlab yuboradi. Ya'ni "/<tab>/tashqi.sayt" uning
 * uchun "//tashqi.sayt" — ya'ni butunlay boshqa sayt. Shuning uchun bunday
 * belgisi bor qiymatni umuman qabul qilmaymiz.
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * Ochiq qayta yo'naltirishning (open redirect) oldini olamiz:
 * faqat bitta '/' bilan boshlanadigan ichki yo'llarga ruxsat.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (hasControlChars(value)) return null;
  if (!value.startsWith('/')) return null;
  // '//tashqi.sayt' va '/\tashqi.sayt' — brauzer uchun tashqi manzil.
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}

/** Bir xil nomli bir nechta parametr kelsa — birinchisini olamiz. */
export function firstSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Yo'l shu bo'limga tegishlimi: '/admin', '/admin/...' yoki '/admin?...'. */
export function isUnderSection(path: string, section: string): boolean {
  return path === section || path.startsWith(`${section}/`) || path.startsWith(`${section}?`);
}
