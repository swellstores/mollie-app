import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMockRequest } from '../helpers/mock-request';
import handler, { config } from '../../functions/get-intent';

const TEST_KEY = 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM';

function swellMock() {
  return { settings: vi.fn().mockResolvedValue({ mollie: { api_key: TEST_KEY } }) };
}

async function run(intent: object) {
  return handler(createMockRequest({ swell: swellMock() as unknown as SwellAPI, data: { intent } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('get-intent', () => {
  it('is bound to the Mollie extension and returns result or error', () => {
    expect(config.extension).toBe('mollie');
    expect(config.model?.events).toEqual(['after:payment.get_intent']);
  });

  it('returns only browser-safe payment details', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'tr_WDqYK6vllg',
            status: 'paid',
            amount: { currency: 'EUR', value: '42.50' },
            method: 'creditcard',
            metadata: { cart_id: 'cart_1', store_id: 'smpl' },
            details: { cardNumber: '6787' },
            _links: { dashboard: { href: 'https://my.mollie.com/…' } },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(run({ id: 'tr_WDqYK6vllg' })).resolves.toEqual({
      result: { id: 'tr_WDqYK6vllg', status: 'paid', amount: { currency: 'EUR', value: '42.50' }, method: 'creditcard' },
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api.mollie.com/v2/payments/tr_WDqYK6vllg');
  });

  it.each([{}, { id: '' }, { id: 'ord_123' }, { id: 'tr_../../methods' }])(
    'rejects an invalid payment id %j without calling Mollie',
    async (intent) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(run(intent)).resolves.toEqual({ error: 'Missing or invalid Mollie payment id.' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("returns Mollie's error for an unknown payment", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 404, detail: 'No payment exists with token tr_x.' }), { status: 404 })),
    );
    await expect(run({ id: 'tr_x' })).resolves.toEqual({ error: 'Mollie API 404: No payment exists with token tr_x..' });
  });
});
