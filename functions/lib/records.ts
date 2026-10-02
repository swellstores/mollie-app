import type { MollieAmount } from './amounts';
import type { MollieMode, MolliePayment } from './mollie';

/** App collection with one record per Mollie payment (models/mollie-payments.json). */
export const PAYMENTS = '/mollie-payments';

export type Resolution = 'pending' | 'completed' | 'recovered' | 'unmatched' | 'resolved' | 'abandoned';

export interface PaymentRecord {
  id: string;
  mollie_id: string;
  mode?: MollieMode;
  cart_id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  mollie_status?: string;
  resolution: Resolution;
  date_created: string;
  date_paid?: string;
}

export function formatAmount(amount: MollieAmount): string {
  return `${amount.currency} ${amount.value}`;
}

/** Remember a new Mollie payment so the safety net can follow it up. Never throws: checkout must not fail on this. */
export async function recordNewPayment(
  swell: SwellAPI,
  payment: MolliePayment,
  details: { cartId: string; amount: number; currency: string; mode: MollieMode },
): Promise<void> {
  try {
    await swell.post(PAYMENTS, {
      mollie_id: payment.id,
      source: 'checkout',
      mode: details.mode,
      cart_id: details.cartId,
      amount: details.amount,
      currency: details.currency,
      mollie_status: payment.status,
      resolution: 'pending',
      amount_display: formatAmount(payment.amount),
      mollie_url: payment.dashboardUrl ?? undefined,
    });
  } catch {
    // Ignore: the payment itself works without the record; only the safety net loses track of it.
  }
}

export async function findRecord(swell: SwellAPI, mollieId: string): Promise<PaymentRecord | null> {
  const result = (await swell.get(PAYMENTS, { where: { mollie_id: mollieId }, limit: 1 })) as {
    results?: PaymentRecord[];
  } | null;
  return result?.results?.[0] ?? null;
}

/** Order number for display, or undefined when it can't be read. */
export async function orderNumber(swell: SwellAPI, orderId: string | undefined): Promise<string | undefined> {
  if (!orderId) return undefined;
  try {
    const order = (await swell.get(`/orders/${orderId}`, { fields: 'number' })) as { number?: string } | null;
    return order?.number ? `#${order.number}` : undefined;
  } catch {
    return undefined;
  }
}

/** Checkout placed the order for this payment: mark its record completed. Never throws. */
export async function markCompleted(
  swell: SwellAPI,
  mollieId: string,
  details: { orderId?: string; mollieStatus: string },
): Promise<void> {
  try {
    const record = await findRecord(swell, mollieId);
    if (!record || record.resolution !== 'pending') return;
    await swell.put(`${PAYMENTS}/${record.id}`, {
      resolution: 'completed',
      mollie_status: details.mollieStatus,
      order_id: details.orderId,
      order_number: await orderNumber(swell, details.orderId),
      date_resolved: new Date(Date.now()).toISOString(),
    });
  } catch {
    // Ignore: the cron will find the order through the cart and mark it then.
  }
}
