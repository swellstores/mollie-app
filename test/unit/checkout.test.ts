import { describe, it, expect } from 'vitest';
import {
  amountMatches,
  isReturn,
  isSettled,
  returnOutcome,
  returnUrl,
  unwrapIntent,
  withoutReturnParam,
} from '../../components/lib/checkout';

const at = (href: string) => ({ href });

describe('return address', () => {
  it('adds the return marker and keeps the rest of the checkout address', () => {
    expect(returnUrl(at('https://shop.example.com/checkout/abc?step=payment'))).toBe(
      'https://shop.example.com/checkout/abc?step=payment&mollie_return=1',
    );
  });

  it('does not add the marker twice', () => {
    expect(returnUrl(at('https://shop.example.com/checkout?mollie_return=1'))).toBe(
      'https://shop.example.com/checkout?mollie_return=1',
    );
  });

  it('recognizes and removes the marker', () => {
    expect(isReturn(at('https://shop.example.com/checkout?mollie_return=1'))).toBe(true);
    expect(isReturn(at('https://shop.example.com/checkout?step=payment'))).toBe(false);
    expect(withoutReturnParam(at('https://shop.example.com/checkout?step=payment&mollie_return=1'))).toBe(
      'https://shop.example.com/checkout?step=payment',
    );
  });
});

describe('unwrapIntent', () => {
  it('accepts the function result with or without its wrapper', () => {
    expect(unwrapIntent({ result: { id: 'tr_1' } })).toEqual({ id: 'tr_1' });
    expect(unwrapIntent({ id: 'tr_1' })).toEqual({ id: 'tr_1' });
  });

  it('throws the error message for the shopper', () => {
    expect(() => unwrapIntent({ error: 'Cart not found.' })).toThrow('Cart not found.');
    expect(() => unwrapIntent({ error: { message: 'Declined' } })).toThrow('Declined');
    expect(() => unwrapIntent(null)).toThrow('No response from the payment service. Please try again.');
  });
});

describe('amountMatches', () => {
  const payment = { id: 'tr_1', status: 'paid' as const, amount: { currency: 'EUR', value: '42.50' } };

  it('matches the current cart total', () => {
    expect(amountMatches(payment, 42.5, 'EUR')).toBe(true);
    expect(amountMatches(payment, 42.499999, 'eur')).toBe(true);
    expect(amountMatches({ ...payment, amount: { currency: 'EUR', value: '1.01' } }, 1.005, 'EUR')).toBe(true);
  });

  it('detects a cart that changed after paying', () => {
    expect(amountMatches(payment, 50, 'EUR')).toBe(false);
    expect(amountMatches(payment, 42.5, 'USD')).toBe(false);
    expect(amountMatches(payment, undefined, 'EUR')).toBe(false);
    expect(amountMatches({ id: 'tr_1', status: 'paid' }, 42.5, 'EUR')).toBe(false);
  });

  it('compares zero-decimal currencies without decimals', () => {
    expect(amountMatches({ id: 'tr_1', status: 'paid', amount: { currency: 'JPY', value: '1500' } }, 1500, 'JPY')).toBe(
      true,
    );
  });
});

describe('payment outcome', () => {
  it('lets the order go ahead once paid or held', () => {
    expect(isSettled('paid')).toBe(true);
    expect(isSettled('authorized')).toBe(true);
    expect(isSettled('pending')).toBe(false);
    expect(isSettled('open')).toBe(false);
    expect(returnOutcome('paid').kind).toBe('ready');
    expect(returnOutcome('authorized').kind).toBe('ready');
  });

  it('tells the shopper a pending payment is being processed', () => {
    expect(returnOutcome('pending')).toEqual({
      kind: 'processing',
      message: "Your payment is being processed. You'll receive an order confirmation by email once it's complete.",
    });
  });

  it.each([
    ['open', "The payment wasn't completed. Place your order to try again."],
    ['canceled', 'The payment was canceled. Place your order to try again.'],
    ['expired', 'The payment expired. Place your order to try again.'],
    ['failed', 'The payment failed. Place your order to try again, or choose another payment method.'],
  ] as const)('asks the shopper to try again after %s', (status, message) => {
    expect(returnOutcome(status)).toEqual({ kind: 'retry', message });
  });
});
