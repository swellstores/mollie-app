import { trace } from './lib/trace';
import { sameAmount, toMollieAmount, type MollieAmount } from './lib/amounts';
import { capturePayment, getPayment, isPaymentId, type MolliePaymentStatus } from './lib/mollie';
import { markCompleted } from './lib/records';
import { mollieSettings } from './lib/settings';

export const config: SwellConfig = {
  extension: 'mollie',
  description: 'Confirm the Mollie payment when the order is placed, then capture it if it was only held',
  model: {
    events: ['after:payment.charge'],
    fields: ['success', 'error', 'transaction_id'],
  },
};

interface ChargeInput {
  amount?: number;
  currency?: string;
  captured?: boolean;
  transaction_id?: string;
  intent?: { mollie?: { id?: string } };
  mollie?: { token?: string };
  order_id?: string;
}

const NOT_PAID: Partial<Record<MolliePaymentStatus, string>> = {
  open: "The shopper hasn't completed the payment on Mollie yet.",
  pending: 'Mollie is still processing the payment.',
  canceled: 'The payment was canceled on Mollie.',
  expired: 'The payment expired on Mollie before it was completed.',
  failed: 'The payment failed on Mollie.',
};

function notPaid(status: MolliePaymentStatus): string {
  return NOT_PAID[status] ?? `The Mollie payment can't be used (status: ${status}).`;
}

function formatAmount(amount: MollieAmount): string {
  return `${amount.currency} ${amount.value}`;
}

/** The Mollie payment id: saved on the cart by the checkout component, or from the first charge call. */
function paymentId(input: ChargeInput): string | undefined {
  return [input.intent?.mollie?.id, input.transaction_id, input.mollie?.token].find(isPaymentId);
}

/**
 * Swell may call this twice per order (captured: false to confirm, then captured: true to capture) or
 * only once with captured: true, so every call checks the amount itself. Mollie payments are created
 * and paid on Mollie's page before the order exists: this never creates a payment, it only checks
 * and captures one.
 */
async function handle(req: SwellRequest) {
  const input = req.data as ChargeInput;

  try {
    const id = paymentId(input);
    if (!id) throw new Error('No Mollie payment found for this order.');
    if (typeof input.amount !== 'number' || !input.currency) throw new Error('Missing amount or currency.');

    const settings = await mollieSettings(req.swell);
    const payment = await getPayment(settings.apiKey, id);
    const requested = toMollieAmount(input.amount, input.currency);

    if (payment.status !== 'paid' && payment.status !== 'authorized') {
      throw new Error(notPaid(payment.status));
    }

    if (payment.status === 'paid' || input.captured === false) {
      // Paid straight away (e.g. iDEAL), already captured, or the confirm call:
      // the shopper must have paid (or the payment holds) exactly the order amount.
      if (!sameAmount(payment.amount, input.amount, input.currency)) {
        throw new Error(
          `The amount paid on Mollie (${formatAmount(payment.amount)}) doesn't match the order total (${formatAmount(
            requested,
          )}).`,
        );
      }
    } else {
      // Capture a held payment: never more than the hold, and only part of it if Swell asks for less.
      if (
        requested.currency !== payment.amount.currency.toUpperCase() ||
        Number(requested.value) > Number(payment.amount.value)
      ) {
        throw new Error(
          `Can't capture ${formatAmount(requested)}: Mollie only holds ${formatAmount(payment.amount)} for this payment.`,
        );
      }
      const partial = Number(requested.value) < Number(payment.amount.value) ? requested : undefined;
      const capture = await capturePayment(settings.apiKey, payment.id, partial);
      if (capture.status === 'failed') throw new Error('Mollie could not capture the payment.');
    }

    await markCompleted(req.swell, payment.id, { orderId: input.order_id, mollieStatus: payment.status });
    return { success: true, transaction_id: payment.id };
  } catch (error) {
    return { success: false, error: { message: error instanceof Error ? error.message : String(error) } };
  }
}

// TEMPORARY (1.0.5): trace calls during checkout. Remove before release.
export default async function (req: SwellRequest) {
  const result = await handle(req);
  const data = req.data as any;
  await trace(req, {
    fn: 'charge',
    captured: data.captured,
    amount: data.amount,
    currency: data.currency,
    order_id: data.order_id,
    transaction_id: data.transaction_id,
    intent_id: data.intent?.mollie?.id,
    success: result.success,
    error: (result as any).error?.message,
  });
  return result;
}
