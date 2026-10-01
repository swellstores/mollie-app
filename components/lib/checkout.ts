// Browser-safe helpers for the checkout component. No secrets, no server imports.

/** Query parameter added to the return address, so the component knows the shopper is back from Mollie. */
export const RETURN_PARAM = 'mollie_return';

export type PaymentStatus = 'open' | 'pending' | 'authorized' | 'paid' | 'canceled' | 'expired' | 'failed';

export interface IntentPayment {
  id: string;
  status: PaymentStatus;
  amount?: { currency: string; value: string };
}

/** Where Mollie sends the shopper back: this checkout page, with the return marker. */
export function returnUrl(location: { href: string }): string {
  const url = new URL(location.href);
  url.searchParams.delete(RETURN_PARAM);
  url.searchParams.set(RETURN_PARAM, '1');
  return url.toString();
}

export function isReturn(location: { href: string }): boolean {
  return new URL(location.href).searchParams.has(RETURN_PARAM);
}

/** The current address without the return marker, so a reload doesn't repeat the return handling. */
export function withoutReturnParam(location: { href: string }): string {
  const url = new URL(location.href);
  url.searchParams.delete(RETURN_PARAM);
  return url.toString();
}

/**
 * Read the payload from createIntent/getIntent. The checkout may hand back the function's
 * { result } wrapper or the result itself; an { error } is thrown as a shopper-readable message.
 */
export function unwrapIntent<T>(response: any): T {
  if (!response) throw new Error('No response from the payment service. Please try again.');
  if (response.error) {
    const message = typeof response.error === 'string' ? response.error : response.error.message;
    throw new Error(message || 'The payment could not be started. Please try again.');
  }
  return (response.result ?? response) as T;
}

const ZERO_DECIMAL = new Set(['ISK', 'JPY']);

/** True when the Mollie payment amount equals what the cart asks for now. */
export function amountMatches(payment: IntentPayment, total: number | undefined, currency: string | undefined): boolean {
  if (!payment.amount || total === undefined || !currency) return false;
  if (payment.amount.currency.toUpperCase() !== currency.toUpperCase()) return false;
  const decimals = ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
  const factor = 10 ** decimals;
  // Same rounding as the server (functions/lib/amounts.ts), so 1.005 compares as 1.01.
  const expected = Math.round(Number((total * factor).toPrecision(12))) / factor;
  return Number(payment.amount.value) === expected;
}

/** Paid, or held for capture: the order can be placed. */
export function isSettled(status: PaymentStatus): boolean {
  return status === 'paid' || status === 'authorized';
}

export type ReturnOutcome =
  | { kind: 'ready'; message: string }
  | { kind: 'processing'; message: string }
  | { kind: 'retry'; message: string };

/** What to tell the shopper after coming back from Mollie. */
export function returnOutcome(status: PaymentStatus): ReturnOutcome {
  switch (status) {
    case 'paid':
    case 'authorized':
      return { kind: 'ready', message: 'Payment received. Place your order to finish.' };
    case 'pending':
      return {
        kind: 'processing',
        message: "Your payment is being processed. You'll receive an order confirmation by email once it's complete.",
      };
    case 'open':
      return { kind: 'retry', message: "The payment wasn't completed. Place your order to try again." };
    case 'canceled':
      return { kind: 'retry', message: 'The payment was canceled. Place your order to try again.' };
    case 'expired':
      return { kind: 'retry', message: 'The payment expired. Place your order to try again.' };
    case 'failed':
    default:
      return { kind: 'retry', message: 'The payment failed. Place your order to try again, or choose another payment method.' };
  }
}
