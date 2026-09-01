// src/lib/orders/pricing.ts
import { applyBps, sumMoney, multiplyMoney, type Money } from '@/lib/money';
import type { CartLine, CartTotals } from '@/types/domain';

export interface FeeConfig {
  /** restaurants.service_fee_enabled */
  enabled: boolean;
  /** branches.service_fee_bps ?? restaurants.service_fee_bps */
  bps: number;
}

/**
 * ADVISORY. Renders the cart preview so the customer is not surprised at checkout.
 * The order's real totals are whatever public_place_order() returns, computed from
 * menu_items.price read inside the transaction. Brief §7: never trust prices from the frontend.
 */
export function priceCart(lines: readonly CartLine[], fee: FeeConfig): CartTotals {
  const subtotal = sumMoney(
    lines.map((line) => multiplyMoney(line.unitPrice + line.optionsTotal, line.quantity)),
  );
  const serviceFee = fee.enabled ? applyBps(subtotal, fee.bps) : 0;
  const discountTotal = 0; // MVP: promotions are display-only (doc 02 §2.6).
  return { subtotal, serviceFee, discountTotal, total: subtotal - discountTotal + serviceFee };
}
