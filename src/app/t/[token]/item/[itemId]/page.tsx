/**
 * src/app/t/[token]/item/[itemId]/page.tsx — product detail.
 * Source: docs/architecture/05-app-structure.md §3.3.2.
 *
 * A Server Component that resolves the table and the menu (through the same
 * request-scoped cache `../../data.ts` uses, so this costs no extra round trip
 * beyond what the layout already paid for), finds the dish, and hands it to
 * `ItemDetailSheet` — the only client component on this route.
 */
import { notFound } from 'next/navigation'

import { ItemDetailSheet } from '@/components/customer/item-detail-sheet'
import { AppErrorException } from '@/lib/result'
import { toMenuTree } from '@/lib/mappers/menu-mapper'
import { uuidSchema } from '@/lib/validation/common'
import { getCachedMenu } from '../../data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ItemParams {
  token: string
  itemId: string
}

export default async function ItemPage({
  params,
}: {
  params: Promise<ItemParams>
}): Promise<React.JSX.Element> {
  const { token, itemId } = await params
  if (!uuidSchema.safeParse(itemId).success) notFound()

  const menuResult = await getCachedMenu(token)
  if (!menuResult.ok) {
    if (menuResult.error.code === 'NOT_FOUND') notFound()
    throw new AppErrorException(menuResult.error)
  }

  const menu = toMenuTree(menuResult.data)
  const item = menu.itemsById[itemId]
  if (!item) notFound()

  return <ItemDetailSheet context={menu.context} item={item} />
}
