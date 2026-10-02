import { sameAmount, toMollieAmount, type MollieAmount } from './lib/amounts';
import { capturePayment, getPayment, isPaymentId, type MolliePaymentStatus } from './lib/mollie';
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
 * Swell calls this twice per order: first with captured: false (confirm the payment is paid or held),
 * then with captured: true (capture a held payment). Mollie payments are created and paid on Mollie's
 * page before the order exists, so this never creates a payment; it only checks and captures one.
 */
export default async function (req: SwellRequest) {
  const input = req.data as ChargeInput;

  try {
    const id = paymentId(input);
    if (!id) throw new Error('No Mollie payment found for this order.');
    if (typeof input.amount !== 'number' || !input.currency) throw new Error('Missing amount or currency.');

    const settings = await mollieSettings(req.swell);
    const payment = await getPayment(settings.apiKey, id);
    const capturing = input.captured !== false;

    if (!capturing) {
      // Confirm: the shopper must have paid (or the payment is held) the exact order amount.
      if (payment.status !== 'paid' && payment.status !== 'authorized') {
        throw new Error(notPaid(payment.status));
      }
      if (!sameAmount(payment.amount, input.amount, input.currency)) {
        throw new Error(
          `The amount paid on Mollie (${formatAmount(payment.amount)}) doesn't match the order total (${formatAmount(
            toMollieAmount(input.amount, input.currency),
          )}).`,
        );
      }
      return { success: true, transaction_id: payment.id };
    }

    // Capture.
    if (payment.status === 'paid') {
      return { success: true, transaction_id: payment.id }; // Paid straight away (e.g. iDEAL) or already captured.
    }
    if (payment.status !== 'authorized') {
      throw new Error(notPaid(payment.status));
    }

    const requested = toMollieAmount(input.amount, input.currency);
    if (requested.currency !== payment.amount.currency.toUpperCase() || Number(requested.value) > Number(payment.amount.value)) {
      throw new Error(
        `Can't capture ${formatAmount(requested)}: Mollie only holds ${formatAmount(payment.amount)} for this payment.`,
      );
    }
    // Capture the full hold unless Swell asks for less.
    const partial = Number(requested.value) < Number(payment.amount.value) ? requested : undefined;
    const capture = await capturePayment(settings.apiKey, payment.id, partial);
    if (capture.status === 'failed') throw new Error('Mollie could not capture the payment.');

    return { success: true, transaction_id: payment.id };
  } catch (error) {
    return { success: false, error: { message: error instanceof Error ? error.message : String(error) } };
  }
}
