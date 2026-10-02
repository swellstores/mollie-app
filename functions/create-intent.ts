import { toMollieAmount } from './lib/amounts';
import { buildAddress, buildLines, type LinesCart } from './lib/lines';
import { createPayment, MollieApiError } from './lib/mollie';
import { recordNewPayment } from './lib/records';
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

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
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
    const cart = (await swell.get(`/carts/${cartId}`, { expand: ['items.product', 'items.variant', 'account'] })) as
      | (LinesCart & { id?: string })
      | null;
    if (!cart?.id) throw new Error('Cart not found.');

    const total = cart.capture_total ?? cart.grand_total ?? 0;
    if (!(total > 0)) throw new Error('There is nothing to pay for this cart.');
    if (!cart.currency) throw new Error('The cart has no currency.');

    const basics = {
      amount: toMollieAmount(total, cart.currency),
      description: paymentDescription(settings.paymentDescription, req.store?.url),
      redirectUrl,
      metadata: { cart_id: cart.id, store_id: req.store?.id ?? '' },
    };
    // Lines and addresses let Mollie offer Klarna, in3 and Riverty. They're optional for other methods.
    const lines = buildLines(cart);
    const extras = {
      ...(lines ? { lines } : {}),
      ...optional('billingAddress', buildAddress(cart.billing, cart.account)),
      ...optional('shippingAddress', cart.shipping?.address1 ? buildAddress(cart.shipping, cart.account) : undefined),
    };

    let payment;
    try {
      payment = await createPayment(settings.apiKey, { ...basics, ...extras });
    } catch (error) {
      // If Mollie refuses the extra details, pay without them rather than block checkout.
      const rejected = error instanceof MollieApiError && error.status === 422 && Object.keys(extras).length > 0;
      if (!rejected) throw error;
      payment = await createPayment(settings.apiKey, basics);
    }

    if (!payment.checkoutUrl) throw new Error("Mollie didn't return a payment page.");

    // Remember the payment for the safety net (shoppers who pay and close the page).
    await recordNewPayment(swell, payment, {
      cartId: cart.id,
      amount: total,
      currency: cart.currency,
      mode: settings.mode,
    });

    return { result: { id: payment.id, status: payment.status, checkout_url: payment.checkoutUrl } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
