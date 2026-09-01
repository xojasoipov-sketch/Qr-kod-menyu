/**
 * `/t/[token]/order/[orderToken]` — live order tracking.
 *
 * `orderToken` is `orders.public_code`. Both capabilities are required — the
 * table's QR token AND the order's own code — which is what makes a tracking
 * link forwarded outside the table useless on its own (doc 02 §2.6). This
 * Server Component does one fetch to seed a correct first paint; everything
 * live from here on is `<OrderProgressTracker>`'s job.
 */
import { notFound } from 'next/navigation'

import { OrderProgressTracker } from '@/components/customer/order-progress-tracker'
import { demoRepository } from '@/lib/demo/demo-mode'
import { isDemoMode } from '@/lib/env'
import { toOrderView } from '@/lib/mappers/order-mapper'
import { AppErrorException } from '@/lib/result'
import { getOrder } from '@/lib/rpc/public'
import { publicCodeSchema, qrTokenSchema } from '@/lib/validation/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'default-no-store'

interface OrderPageProps {
  params: Promise<{ token: string; orderToken: string }>
}

export default async function OrderPage({ params }: OrderPageProps): Promise<React.JSX.Element> {
  const { token, orderToken } = await params

  const parsedToken = qrTokenSchema.safeParse(token)
  const parsedCode = publicCodeSchema.safeParse(orderToken)
  if (!parsedToken.success || !parsedCode.success) notFound()

  const result = isDemoMode()
    ? await demoRepository.getOrder(parsedToken.data, parsedCode.data)
    : await getOrder(parsedToken.data, parsedCode.data)

  if (!result.ok) {
    // Covers both "never existed" (QR030) and "closed and no longer trackable"
    // (QR032) — neither has anything a retry could fix.
    if (result.error.code === 'NOT_FOUND') notFound()
    throw new AppErrorException(result.error)
  }

  const order = toOrderView(result.data, { qrToken: parsedToken.data })

  return (
    <main className="mx-auto flex w-full max-w-(--measure-prose) flex-col gap-4 px-4 pt-6 pb-32">
      <OrderProgressTracker token={parsedToken.data} initial={order} />
    </main>
  )
}
