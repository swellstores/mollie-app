import { toMollieAmount } from './lib/amounts';
import { isPaymentId, refundPayment } from './lib/mollie';
import { mollieSettings } from './lib/settings';

export const config: SwellConfig = {
  extension: 'mollie',
  description: 'Refund a Mollie payment from the Swell dashboard',
  model: {
    events: ['after:payment.refund'],
    fields: ['success', 'error', 'transaction_id'],
  },
};

interface RefundInput {
  amount?: number;
  currency?: string;
  transaction_id?: string;
  id?: string;
}

/**
 * The refund's transaction_id is the Mollie payment id (tr_…) that the charge function returned.
 * Mollie checks the rest: the payment must be paid, and the refund can't exceed what's left.
 */
export default async function (req: SwellRequest) {
  const input = req.data as RefundInput;

  try {
    if (!isPaymentId(input.transaction_id)) throw new Error('No Mollie payment found to refund.');
    if (typeof input.amount !== 'number' || !(input.amount > 0) || !input.currency) {
      throw new Error('Missing refund amount or currency.');
    }

    const settings = await mollieSettings(req.swell);
    const refund = await refundPayment(
      settings.apiKey,
      input.transaction_id,
      toMollieAmount(input.amount, input.currency),
      input.id ? { swell_refund_id: input.id } : undefined,
    );
    if (refund.status === 'failed' || refund.status === 'canceled') {
      throw new Error(`Mollie could not refund the payment (status: ${refund.status}).`);
    }

    return { success: true, transaction_id: refund.id };
  } catch (error) {
    return { success: false, error: { message: error instanceof Error ? error.message : String(error) } };
  }
}
