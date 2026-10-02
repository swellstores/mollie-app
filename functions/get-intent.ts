import { trace } from './lib/trace';
import { getPayment, isPaymentId } from './lib/mollie';
import { mollieSettings } from './lib/settings';

export const config: SwellConfig = {
  extension: 'mollie',
  description: 'Look up a Mollie payment when the shopper comes back from the payment page',
  model: {
    events: ['after:payment.get_intent'],
    fields: ['result', 'error'],
  },
};

async function handle(req: SwellRequest) {
  const { swell } = req;
  const intent = (req.data.intent ?? {}) as { id?: string };

  try {
    if (!isPaymentId(intent.id)) throw new Error('Missing or invalid Mollie payment id.');

    const settings = await mollieSettings(swell);
    const payment = await getPayment(settings.apiKey, intent.id);

    // Only what the browser needs: no metadata, no links.
    return {
      result: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        method: payment.method,
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// TEMPORARY (1.0.5): trace calls during checkout. Remove before release.
export default async function (req: SwellRequest) {
  const result = await handle(req);
  const data = req.data as any;
  await trace(req, { fn: 'get-intent', id: data.intent?.id, result: result.error ?? (result as any).result?.status, mollie_amount: (result as any).result?.amount?.value });
  return result;
}
