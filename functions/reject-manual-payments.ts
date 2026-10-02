export const config: SwellConfig = {
  description: "Mark Mollie payment records added by hand from the dashboard as not paid, so the safety net ignores them",
  model: {
    events: ['before:mollie-payment.created'],
  },
};

export const MANUAL_PAYMENT_NOTE = 'Added by hand. Mollie payments are added automatically at checkout.';

/**
 * The dashboard always shows a "New mollie payment" button on app collections, and a thrown error
 * doesn't cancel the create (tested on swell-apps). Instead, records without the app's source mark
 * are saved as "Not paid", so the safety net never follows up a payment that doesn't exist.
 */
export default async function (req: SwellRequest) {
  if ((req.data as { source?: string }).source === 'checkout') return;
  return { resolution: 'abandoned', reason: 'Added by hand', note: MANUAL_PAYMENT_NOTE };
}
