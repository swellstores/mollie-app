import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMockRequest } from '../helpers/mock-request';
import handler, { config } from '../../functions/create-intent';

const TEST_KEY = 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM';
const RETURN_URL = 'https://shop.example.com/checkout/abc?mollie_return=1';

const CART = { id: 'cart_1', currency: 'EUR', capture_total: 42.5, grand_total: 45 };

function swellMock({ cart = CART as object | null, apiKey = TEST_KEY as string | null } = {}) {
  return {
    settings: vi.fn().mockResolvedValue(apiKey ? { mollie: { api_key: apiKey, payment_description: '' } } : {}),
    get: vi.fn().mockResolvedValue(cart),
  };
}

function mollieCreated(body: object = {}) {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: 'tr_WDqYK6vllg',
          status: 'open',
          amount: { currency: 'EUR', value: '42.50' },
          _links: { checkout: { href: 'https://www.mollie.com/checkout/select-method/WDqYK6vllg' } },
          ...body,
        }),
        { status: 201 },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function run(swell: ReturnType<typeof swellMock>, intent: object) {
  return handler(
    createMockRequest({
      swell: swell as unknown as SwellAPI,
      data: { intent },
      store: { id: 'smpl', url: 'https://smpl.international' },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('create-intent', () => {
  it('is bound to the Mollie extension and returns result or error', () => {
    expect(config.extension).toBe('mollie');
    expect(config.model?.events).toEqual(['after:payment.create_intent']);
    expect(config.model?.fields).toEqual(['result', 'error']);
  });

  it('creates a Mollie payment for the cart total and returns the payment page', async () => {
    const fetchMock = mollieCreated();
    const swell = swellMock();

    const response = await run(swell, { cart_id: 'cart_1', redirect_url: RETURN_URL });

    expect(response).toEqual({
      result: {
        id: 'tr_WDqYK6vllg',
        status: 'open',
        checkout_url: 'https://www.mollie.com/checkout/select-method/WDqYK6vllg',
      },
    });
    expect(swell.get).toHaveBeenCalledWith('/carts/cart_1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mollie.com/v2/payments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      amount: { currency: 'EUR', value: '42.50' },
      description: 'Order at smpl.international',
      redirectUrl: RETURN_URL,
      metadata: { cart_id: 'cart_1', store_id: 'smpl' },
    });
  });

  it('charges the amount from the cart, not from the browser', async () => {
    const fetchMock = mollieCreated();
    await run(swellMock(), { cart_id: 'cart_1', redirect_url: RETURN_URL, amount: 1 });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.amount.value).toBe('42.50');
  });

  it('falls back to the grand total when the cart has no capture total', async () => {
    const fetchMock = mollieCreated();
    await run(swellMock({ cart: { id: 'cart_1', currency: 'EUR', grand_total: 45 } }), {
      cart_id: 'cart_1',
      redirect_url: RETURN_URL,
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.amount.value).toBe('45.00');
  });

  it.each([
    [{ redirect_url: RETURN_URL }, 'Missing cart.'],
    [{ cart_id: 'cart_1' }, 'Missing or invalid return address.'],
    [{ cart_id: 'cart_1', redirect_url: 'javascript:alert(1)' }, 'Missing or invalid return address.'],
  ])('rejects incomplete input %j', async (intent, error) => {
    const fetchMock = mollieCreated();
    await expect(run(swellMock(), intent)).resolves.toEqual({ error });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains a missing API key', async () => {
    const response = await run(swellMock({ apiKey: null }), { cart_id: 'cart_1', redirect_url: RETURN_URL });
    expect(response).toEqual({
      error: 'Mollie is not connected. Add your Mollie API key in the Mollie app settings.',
    });
  });

  it('rejects a missing cart or an empty cart total', async () => {
    mollieCreated();
    await expect(run(swellMock({ cart: null }), { cart_id: 'x', redirect_url: RETURN_URL })).resolves.toEqual({
      error: 'Cart not found.',
    });
    await expect(
      run(swellMock({ cart: { ...CART, capture_total: 0 } }), { cart_id: 'cart_1', redirect_url: RETURN_URL }),
    ).resolves.toEqual({ error: 'There is nothing to pay for this cart.' });
  });

  it("returns Mollie's error message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: 422, detail: 'The amount is lower than the minimum' }), { status: 422 }),
      ),
    );
    await expect(run(swellMock(), { cart_id: 'cart_1', redirect_url: RETURN_URL })).resolves.toEqual({
      error: 'Mollie API 422: The amount is lower than the minimum.',
    });
  });

  it('fails when Mollie returns no payment page', async () => {
    mollieCreated({ _links: {} });
    await expect(run(swellMock(), { cart_id: 'cart_1', redirect_url: RETURN_URL })).resolves.toEqual({
      error: "Mollie didn't return a payment page.",
    });
  });
});
