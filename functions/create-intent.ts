import { toMollieAmount } from './lib/amounts';
import { createPayment } from './lib/mollie';
import { mollieSettings, paymentDescription } from './lib/settings';

export const config: SwellConfig = {
  extension: 'mollie',
  description: "Create a Mollie payment and return the link to Mollie's payment page",
  model: {
    events: ['after:payment.create_intent'],
    fields: ['result', 'error'],
  },
};

interface IntentInput {
  cart_id?: string;
  redirect_url?: string;
}

function validRedirectUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default async function (req: SwellRequest) {
  const { swell } = req;
  const intent = (req.data.intent ?? {}) as IntentInput;

  try {
    const cartId = typeof intent.cart_id === 'string' ? intent.cart_id : '';
    if (!cartId) throw new Error('Missing cart.');
    const redirectUrl = validRedirectUrl(intent.redirect_url);
    if (!redirectUrl) throw new Error('Missing or invalid return address.');

    const settings = await mollieSettings(swell);

    // The amount always comes from the cart on the server, never from the browser.
    const cart = (await swell.get(`/carts/${cartId}`)) as {
      id?: string;
      currency?: string;
      capture_total?: number;
      grand_total?: number;
    } | null;
    if (!cart?.id) throw new Error('Cart not found.');

    const total = cart.capture_total ?? cart.grand_total ?? 0;
    if (!(total > 0)) throw new Error('There is nothing to pay for this cart.');
    if (!cart.currency) throw new Error('The cart has no currency.');

    const payment = await createPayment(settings.apiKey, {
      amount: toMollieAmount(total, cart.currency),
      description: paymentDescription(settings.paymentDescription, req.store?.url),
      redirectUrl,
      metadata: { cart_id: cart.id, store_id: req.store?.id ?? '' },
    });

    if (!payment.checkoutUrl) throw new Error("Mollie didn't return a payment page.");

    return { result: { id: payment.id, status: payment.status, checkout_url: payment.checkoutUrl } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
