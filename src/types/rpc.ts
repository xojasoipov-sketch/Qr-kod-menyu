/**
 * The public wire types.
 *
 * Inferred from the zod schemas rather than declared separately, so the runtime
 * validator and the compile-time type can never disagree — if they were written
 * twice they would eventually differ, and the type would be the one that lied.
 *
 * These are the shapes as they come off the wire. `src/lib/mappers/*` turns
 * them into the view models in `src/types/domain.ts`; components see those.
 */
export type {
  PublicTableContext,
  PublicMenu,
  PublicMenuCategory,
  PublicMenuItem,
  PublicMenuOption,
  PublicOptionGroup,
  PublicPromotion,
  PublicOrder,
  PublicOrderLine,
  WaiterCallResult,
  PlaceOrderInput,
  PlaceOrderPayload,
} from '@/lib/rpc/schemas'
