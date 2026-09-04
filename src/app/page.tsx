import { redirect } from 'next/navigation';

/**
 * Sayt manzili to'g'ridan-to'g'ri xizmat terminaliga (PIN kod) olib boradi —
 * ofitsiant/oshxona uchun eng qisqa yo'l shu. Ilgari bu yerda umumiy
 * reklama sahifasi turardi (eski andozadan qolgan, "RESTAURANT QR OS" nomi
 * bilan, real restoran bilan bog'liq emas edi) va kirish qayerdan
 * boshlanishini hech kim topolmasdi.
 *
 * Admin o'zining alohida havolasi (/login) orqali kiradi — u yerga /pin
 * sahifasidagi kichik "Ma'muriyat kirishi" havolasidan yoki to'g'ridan-to'g'ri
 * o'sha manzilni ochib o'tiladi.
 *
 * Mijoz esa bu sahifaga umuman kelmaydi — stoldagi QR kod uni bevosita
 * /t/[token] manziliga olib boradi.
 */
export default function RootPage() {
  redirect('/pin');
}
