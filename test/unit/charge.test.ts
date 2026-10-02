import { describe, it, expect, vi } from 'vitest';
import { createMockRequest } from '../helpers/mock-request';
import handler, { config } from '../../functions/charge';

const TEST_KEY = 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM';
const PAYMENT_ID = 'tr_WDqYK6vllg';

interface MollieState {
  status: string;
  value?: string;
  currency?: string;
  captureStatus?: string;
}

/** Fake Mollie API: GET returns the payment, POST /captures records the capture. */
function mollie({ status, value = '42.50', currency = 'EUR', captureStatus = 'pending' }: MollieState) {
  const captures: any[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST' && url.endsWith(`/payments/${PAYMENT_ID}/captures`)) {
      const body = JSON.parse(init.body as string);
      captures.push(body);
      return new Response(
        JSON.stringify({ resource: 'capture', id: 'cpt_1', status: captureStatus, amount: body.amount ?? { currency, value } }),
        { status: 201 },
      );
    }
    if (url.endsWith(`/payments/${PAYMENT_ID}`)) {
      return new Response(JSON.stringify({ id: PAYMENT_ID, status, amount: { currency, value } }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: 404, detail: 'Not found' }), { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, captures };
}

function swellMock(record: object | null = null) {
  return {
    settings: vi.fn().mockResolvedValue({ mollie: { api_key: TEST_KEY } }),
    get: vi.fn(async (url: string) => {
      if (url === '/mollie-payments') return { results: record ? [record] : [] };
      if (url === '/orders/order_1') return { number: '100001' };
      return null;
    }),
    put: vi.fn().mockResolvedValue({}),
  };
}

const ORDER = { amount: 42.5, currency: 'EUR', intent: { mollie: { id: PAYMENT_ID } }, mollie: { token: PAYMENT_ID } };

async function charge(data: object, swell = swellMock()) {
  return handler(createMockRequest({ swell: swell as unknown as SwellAPI, data }));
}

describe('charge: config', () => {
  it('is bound to the Mollie extension and returns the charge contract fields', () => {
    expect(config.extension).toBe('mollie');
    expect(config.model?.events).toEqual(['after:payment.charge']);
    expect(config.model?.fields).toEqual(['success', 'error', 'transaction_id']);
  });
});

describe('charge: first call (captured: false)', () => {
  it.each(['paid', 'authorized'])('accepts a %s payment for the order total', async (status) => {
    const { captures } = mollie({ status });
    await expect(charge({ ...ORDER, captured: false })).resolves.toEqual({ success: true, transaction_id: PAYMENT_ID });
    expect(captures).toEqual([]);
  });

  it.each([
    ['open', "The shopper hasn't completed the payment on Mollie yet."],
    ['pending', 'Mollie is still processing the payment.'],
    ['canceled', 'The payment was canceled on Mollie.'],
    ['expired', 'The payment expired on Mollie before it was completed.'],
    ['failed', 'The payment failed on Mollie.'],
  ])('rejects a payment that is %s', async (status, message) => {
    mollie({ status });
    await expect(charge({ ...ORDER, captured: false })).resolves.toEqual({ success: false, error: { message } });
  });

  it('rejects a payment for a different amount', async () => {
    mollie({ status: 'paid', value: '10.00' });
    await expect(charge({ ...ORDER, captured: false })).resolves.toEqual({
      success: false,
      error: { message: "The amount paid on Mollie (EUR 10.00) doesn't match the order total (EUR 42.50)." },
    });
  });

  it('rejects a payment in a different currency', async () => {
    mollie({ status: 'paid', currency: 'USD' });
    const result = await charge({ ...ORDER, captured: false });
    expect(result.success).toBe(false);
  });

  it('finds the payment from the token or transaction id when the intent is missing', async () => {
    mollie({ status: 'paid' });
    await expect(
      charge({ amount: 42.5, currency: 'EUR', captured: false, mollie: { token: PAYMENT_ID } }),
    ).resolves.toEqual({ success: true, transaction_id: PAYMENT_ID });
    await expect(
      charge({ amount: 42.5, currency: 'EUR', captured: false, transaction_id: PAYMENT_ID }),
    ).resolves.toEqual({ success: true, transaction_id: PAYMENT_ID });
  });

  it('fails without a Mollie payment id', async () => {
    const { fetchMock } = mollie({ status: 'paid' });
    await expect(charge({ amount: 42.5, currency: 'EUR', captured: false, intent: { mollie: { id: 'cart_1' } } })).resolves.toEqual({
      success: false,
      error: { message: 'No Mollie payment found for this order.' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails without an amount', async () => {
    mollie({ status: 'paid' });
    await expect(charge({ ...ORDER, amount: undefined, captured: false })).resolves.toEqual({
      success: false,
      error: { message: 'Missing amount or currency.' },
    });
  });
});

describe('charge: payment record', () => {
  const NOW = new Date('2026-10-02T10:25:00.000Z').getTime();

  it('marks the pending record completed with the order', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    mollie({ status: 'paid' });
    const swell = swellMock({ id: 'rec_1', mollie_id: PAYMENT_ID, resolution: 'pending' });

    await charge({ ...ORDER, captured: false, order_id: 'order_1' }, swell);

    expect(swell.put).toHaveBeenCalledWith('/mollie-payments/rec_1', {
      resolution: 'completed',
      mollie_status: 'paid',
      order_id: 'order_1',
      order_number: '#100001',
      date_resolved: '2026-10-02T10:25:00.000Z',
    });
    vi.restoreAllMocks();
  });

  it('leaves records the safety net already handled', async () => {
    mollie({ status: 'paid' });
    const swell = swellMock({ id: 'rec_1', mollie_id: PAYMENT_ID, resolution: 'recovered' });
    await charge({ ...ORDER, captured: false, order_id: 'order_1' }, swell);
    expect(swell.put).not.toHaveBeenCalledWith('/mollie-payments/rec_1', expect.anything());
  });

  it('still succeeds when the record cannot be updated', async () => {
    mollie({ status: 'paid' });
    const swell = swellMock({ id: 'rec_1', mollie_id: PAYMENT_ID, resolution: 'pending' });
    swell.put.mockRejectedValue(new Error('Collection unavailable'));
    await expect(charge({ ...ORDER, captured: false }, swell)).resolves.toEqual({
      success: true,
      transaction_id: PAYMENT_ID,
    });
  });

  it('marks the record completed when Swell only makes the capture call', async () => {
    mollie({ status: 'paid' });
    const swell = swellMock({ id: 'rec_1', mollie_id: PAYMENT_ID, resolution: 'pending' });
    await charge({ ...ORDER, captured: true, order_id: 'order_1' }, swell);
    expect(swell.put).toHaveBeenCalledWith('/mollie-payments/rec_1', expect.objectContaining({ resolution: 'completed' }));
  });
});

describe('charge: second call (captured: true)', () => {
  it('captures the full amount of a held payment', async () => {
    const { captures } = mollie({ status: 'authorized' });
    await expect(charge({ ...ORDER, captured: true })).resolves.toEqual({ success: true, transaction_id: PAYMENT_ID });
    expect(captures).toEqual([{}]);
  });

  it('treats a missing captured flag as a capture', async () => {
    const { captures } = mollie({ status: 'authorized' });
    await expect(charge(ORDER)).resolves.toEqual({ success: true, transaction_id: PAYMENT_ID });
    expect(captures).toHaveLength(1);
  });

  it('captures part of the hold when Swell asks for less', async () => {
    const { captures } = mollie({ status: 'authorized' });
    await expect(charge({ ...ORDER, amount: 30, captured: true })).resolves.toEqual({
      success: true,
      transaction_id: PAYMENT_ID,
    });
    expect(captures).toEqual([{ amount: { currency: 'EUR', value: '30.00' } }]);
  });

  it('refuses to capture more than Mollie holds', async () => {
    const { captures } = mollie({ status: 'authorized' });
    await expect(charge({ ...ORDER, amount: 50, captured: true })).resolves.toEqual({
      success: false,
      error: { message: "Can't capture EUR 50.00: Mollie only holds EUR 42.50 for this payment." },
    });
    expect(captures).toEqual([]);
  });

  it('rejects a paid payment for less than the order total (cart changed after paying)', async () => {
    // Found in testing: shopper paid EUR 10, the cart grew to EUR 20, and Swell only made the capture call.
    const { captures } = mollie({ status: 'paid', value: '10.00' });
    await expect(charge({ ...ORDER, amount: 20, captured: true })).resolves.toEqual({
      success: false,
      error: { message: "The amount paid on Mollie (EUR 10.00) doesn't match the order total (EUR 20.00)." },
    });
    expect(captures).toEqual([]);
  });

  it('rejects a paid payment for more than the order total', async () => {
    mollie({ status: 'paid', value: '42.50' });
    const result = await charge({ ...ORDER, amount: 30, captured: true });
    expect(result.success).toBe(false);
  });

  it('succeeds without capturing a payment that is already paid', async () => {
    const { captures } = mollie({ status: 'paid' });
    await expect(charge({ ...ORDER, captured: true })).resolves.toEqual({ success: true, transaction_id: PAYMENT_ID });
    expect(captures).toEqual([]);
  });

  it('returns the same transaction id as the first call', async () => {
    mollie({ status: 'authorized' });
    const first = await charge({ ...ORDER, captured: false });
    const second = await charge({ ...ORDER, captured: true, transaction_id: first.transaction_id });
    expect(second.transaction_id).toBe(first.transaction_id);
  });

  it('reports a capture that failed', async () => {
    mollie({ status: 'authorized', captureStatus: 'failed' });
    await expect(charge({ ...ORDER, captured: true })).resolves.toEqual({
      success: false,
      error: { message: 'Mollie could not capture the payment.' },
    });
  });

  it.each(['expired', 'canceled'])('fails when the hold has %s', async (status) => {
    const { captures } = mollie({ status });
    const result = await charge({ ...ORDER, captured: true });
    expect(result.success).toBe(false);
    expect(captures).toEqual([]);
  });

  it("returns Mollie's error when the API call fails", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 401, detail: 'Invalid API key' }), { status: 401 })),
    );
    await expect(charge({ ...ORDER, captured: true })).resolves.toEqual({
      success: false,
      error: { message: 'Mollie API 401: Invalid API key. Check the API key in the app settings.' },
    });
  });
});
