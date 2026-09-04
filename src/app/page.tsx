import { redirect } from 'next/navigation';

/**
 * Sayt manzili yagona kirish sahifasiga olib boradi. Xodim ham, oshpaz ham,
 * rahbar ham shu yerdan kiradi — kim qaysi manzilni ochishini bilishi shart emas.
 *
 * Mijoz esa bu sahifaga umuman kelmaydi — stoldagi QR kod uni bevosita
 * /t/[token] manziliga olib boradi.
 */
export default function RootPage() {
  redirect('/login');
}
