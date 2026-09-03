/**
 * Next.js server ko'tarilganda bir marta ishlaydigan ilgak (hook).
 *
 * Shu yerda keep-alive tsikli boshlanadi — ish vaqtida (09:00–00:00, Toshkent)
 * server o'zini chertib turadi va Render'ning bepul tarifi uni uxlatib
 * qo'ymaydi. Batafsil izoh: src/lib/keep-alive.ts.
 */
export async function register(): Promise<void> {
  // Faqat Node.js ish muhitida — Edge runtime'da setInterval/fetch tsikli
  // uzoq yashamaydi va u yerda bunga hojat ham yo'q.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startKeepAlive } = await import('@/lib/keep-alive');
  startKeepAlive();
}
