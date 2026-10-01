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

export default async function (req: SwellRequest) {
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
