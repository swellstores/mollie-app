import { sameAmount, toMollieAmount } from './amounts';
import { getPayment, type MolliePayment } from './mollie';
import { formatAmount, orderNumber, PAYMENTS, type PaymentRecord } from './records';

/** Leave a paid payment alone this long, so the shopper's own checkout can place the order first. */
export const GRACE_MS = 10 * 60 * 1000;
/** Follow up payments started in this window. Bank transfers can stay pending for days. */
export const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
/** Payments checked per run, and the time after which a run stops starting new checks (function limit is 10s). */
export const MAX_PER_RUN = 10;
export const TIME_BUDGET_MS = 6000;

export type Outcome = 'waiting' | 'abandoned' | 'completed' | 'recovered' | 'unmatched';

export interface RecoverySummary {
  checked: number;
  recovered: number;
  unmatched: number;
}

interface Cart {
  id?: string;
  order_id?: string;
  currency?: string;
  capture_total?: number;
  grand_total?: number;
}

function now(): Date {
  return new Date(Date.now());
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const body = (error as { body?: any }).body;
    const fromBody = body?.error?.message ?? body?.message;
    if (typeof fromBody === 'string') return fromBody;
    if (error instanceof Error) return error.message;
  }
  return String(error);
}

async function update(swell: SwellAPI, record: PaymentRecord, values: Record<string, unknown>): Promise<void> {
  await swell.put(`${PAYMENTS}/${record.id}`, values);
}

async function unmatched(swell: SwellAPI, record: PaymentRecord, payment: MolliePayment, note: string, orderId?: string) {
  await update(swell, record, {
    resolution: 'unmatched',
    mollie_status: payment.status,
    note,
    order_id: orderId,
    order_number: await orderNumber(swell, orderId),
  });
  return 'unmatched' as const;
}

/** Decide what to do with one pending payment, and do it. */
export async function followUp(swell: SwellAPI, apiKey: string, record: PaymentRecord): Promise<Outcome> {
  const payment = await getPayment(apiKey, record.mollie_id);

  if (payment.status === 'canceled' || payment.status === 'expired' || payment.status === 'failed') {
    await update(swell, record, {
      resolution: 'abandoned',
      mollie_status: payment.status,
      date_resolved: now().toISOString(),
    });
    return 'abandoned';
  }

  if (payment.status !== 'paid' && payment.status !== 'authorized') {
    if (payment.status !== record.mollie_status) await update(swell, record, { mollie_status: payment.status });
    return 'waiting';
  }

  // Paid (or held). Did checkout already place the order?
  const cart = record.cart_id ? ((await swell.get(`/carts/${record.cart_id}`)) as Cart | null) : null;
  if (cart?.order_id) {
    const order = (await swell.get(`/orders/${cart.order_id}`, { fields: 'number,paid,grand_total,currency' })) as {
      number?: string;
      paid?: boolean;
      grand_total?: number;
      currency?: string;
    } | null;
    if (order && order.paid === false) {
      // Checkout placed the order, but its payment was rejected (e.g. the cart grew after paying).
      const orderTotal =
        typeof order.grand_total === 'number' && order.currency
          ? formatAmount(toMollieAmount(order.grand_total, order.currency))
          : 'a different amount';
      return unmatched(
        swell,
        record,
        payment,
        `Order #${order.number} was placed but its payment failed: Mollie received ${formatAmount(
          payment.amount,
        )}, the order is ${orderTotal}.`,
        cart.order_id,
      );
    }
    await update(swell, record, {
      resolution: 'completed',
      mollie_status: payment.status,
      order_id: cart.order_id,
      order_number: order?.number ? `#${order.number}` : undefined,
      date_resolved: now().toISOString(),
    });
    return 'completed';
  }

  const paidAt = payment.paidAt ?? record.date_paid ?? now().toISOString();
  if (now().getTime() - new Date(paidAt).getTime() < GRACE_MS) {
    if (!record.date_paid || record.mollie_status !== payment.status) {
      await update(swell, record, { mollie_status: payment.status, date_paid: paidAt });
    }
    return 'waiting';
  }

  if (!cart?.id) {
    return unmatched(swell, record, payment, "The shopper's cart no longer exists, so the order can't be created from it.");
  }

  const total = cart.capture_total ?? cart.grand_total;
  if (typeof total !== 'number' || !cart.currency || !sameAmount(payment.amount, total, cart.currency)) {
    const cartTotal = typeof total === 'number' && cart.currency ? formatAmount(toMollieAmount(total, cart.currency)) : 'an unknown amount';
    return unmatched(
      swell,
      record,
      payment,
      `The cart changed after the shopper paid: Mollie received ${formatAmount(payment.amount)}, but the cart now totals ${cartTotal}.`,
    );
  }

  let order: { id?: string; number?: string; paid?: boolean } | null;
  try {
    // Point the cart at the paid payment: the shopper may have started another one since.
    await swell.put(`/carts/${cart.id}`, {
      billing: { method: 'mollie', mollie: { token: payment.id }, intent: { mollie: { id: payment.id } } },
    });
    order = (await swell.post('/orders', { cart_id: cart.id })) as typeof order;
  } catch (error) {
    return unmatched(swell, record, payment, `The app couldn't create the order: ${errorMessage(error)}`);
  }
  if (!order?.id) {
    return unmatched(swell, record, payment, "The app couldn't create the order from the shopper's cart.");
  }
  if (order.paid === false) {
    return unmatched(
      swell,
      record,
      payment,
      `The app created order #${order.number}, but the Mollie payment wasn't attached to it. Check the order's payment before shipping.`,
      order.id,
    );
  }

  await update(swell, record, {
    resolution: 'recovered',
    mollie_status: payment.status,
    order_id: order.id,
    order_number: order.number ? `#${order.number}` : undefined,
    note: 'The shopper paid but left before returning to checkout. The app created the order.',
    date_resolved: now().toISOString(),
  });
  return 'recovered';
}

/** Follow up pending payments, oldest first, within the time budget. One failure doesn't stop the others. */
export async function recoverPayments(swell: SwellAPI, apiKey: string): Promise<RecoverySummary> {
  const started = Date.now();
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const list = (await swell.get(PAYMENTS, {
    where: { resolution: 'pending', date_created: { $gte: since } },
    sort: 'date_created asc',
    limit: MAX_PER_RUN,
  })) as { results?: PaymentRecord[] } | null;

  const summary: RecoverySummary = { checked: 0, recovered: 0, unmatched: 0 };
  for (const record of list?.results ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    summary.checked += 1;
    try {
      const outcome = await followUp(swell, apiKey, record);
      if (outcome === 'recovered') summary.recovered += 1;
      if (outcome === 'unmatched') summary.unmatched += 1;
    } catch {
      // Try this payment again on the next run.
    }
  }
  return summary;
}

/** How many payments are waiting for the merchant. */
export async function countUnmatched(swell: SwellAPI): Promise<number> {
  const result = (await swell.get(PAYMENTS, { where: { resolution: 'unmatched' }, limit: 1 })) as { count?: number } | null;
  return result?.count ?? 0;
}
