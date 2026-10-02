import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  countUnmatched,
  followUp,
  GRACE_MS,
  LOOKBACK_MS,
  MAX_PER_RUN,
  recoverPayments,
} from '../../functions/lib/recovery';
import type { PaymentRecord } from '../../functions/lib/records';

const NOW = new Date('2026-10-02T12:00:00.000Z').getTime();
const TEST_KEY = 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM';
const PAID_LONG_AGO = new Date(NOW - GRACE_MS - 60_000).toISOString();
const PAID_JUST_NOW = new Date(NOW - 60_000).toISOString();

function record(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'rec_1',
    mollie_id: 'tr_1',
    cart_id: 'cart_1',
    amount: 10,
    currency: 'EUR',
    mollie_status: 'open',
    resolution: 'pending',
    date_created: new Date(NOW - 30 * 60_000).toISOString(),
    ...overrides,
  };
}

/** Fake Mollie: GET /payments/<id> answers from the map. */
function mollie(payments: Record<string, { status: string; value?: string; currency?: string; paidAt?: string }>) {
  const fetchMock = vi.fn(async (url: string) => {
    const id = url.split('/').pop()!;
    const p = payments[id];
    if (!p) return new Response(JSON.stringify({ status: 404, detail: 'Not found' }), { status: 404 });
    return new Response(
      JSON.stringify({
        id,
        status: p.status,
        amount: { currency: p.currency ?? 'EUR', value: p.value ?? '10.00' },
        paidAt: p.paidAt,
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

interface SwellState {
  records?: PaymentRecord[];
  carts?: Record<string, object | null>;
  order?: object | Error;
  orders?: Record<string, object>;
  unmatchedCount?: number;
}

function swellMock({ records = [], carts = {}, order, orders = {}, unmatchedCount = 0 }: SwellState = {}) {
  return {
    get: vi.fn(async (url: string, query: any = {}) => {
      if (url === '/mollie-payments') {
        if (query.where?.resolution === 'unmatched') return { count: unmatchedCount, results: [] };
        return { count: records.length, results: records.slice(0, query.limit) };
      }
      if (url.startsWith('/carts/')) return carts[url.slice('/carts/'.length)] ?? null;
      if (url.startsWith('/orders/')) return orders[url.slice('/orders/'.length)] ?? null;
      return null;
    }),
    post: vi.fn(async () => {
      if (order instanceof Error) throw order;
      return order ?? null;
    }),
    put: vi.fn().mockResolvedValue({}),
  };
}

type Swell = ReturnType<typeof swellMock>;

/** The single update made to the payment record (cart updates are ignored). */
function saved(swell: Swell) {
  const calls = swell.put.mock.calls.filter(([url]: [string]) => url.startsWith('/mollie-payments/'));
  expect(calls).toHaveLength(1);
  const [url, values] = calls[0];
  expect(url).toBe('/mollie-payments/rec_1');
  return values;
}

const CART = { id: 'cart_1', currency: 'EUR', capture_total: 10 };

async function follow(swell: Swell, rec = record()) {
  return followUp(swell as unknown as SwellAPI, TEST_KEY, rec);
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('followUp: payments that are not paid', () => {
  it.each(['canceled', 'expired', 'failed'])('marks a %s payment as not paid', async (status) => {
    mollie({ tr_1: { status } });
    const swell = swellMock();
    await expect(follow(swell)).resolves.toBe('abandoned');
    expect(saved(swell)).toEqual({
      resolution: 'abandoned',
      mollie_status: status,
      date_resolved: '2026-10-02T12:00:00.000Z',
    });
  });

  it('keeps waiting for an open payment without rewriting the record', async () => {
    mollie({ tr_1: { status: 'open' } });
    const swell = swellMock();
    await expect(follow(swell)).resolves.toBe('waiting');
    expect(swell.put).not.toHaveBeenCalled();
  });

  it('notes when a payment becomes pending', async () => {
    mollie({ tr_1: { status: 'pending' } });
    const swell = swellMock();
    await expect(follow(swell)).resolves.toBe('waiting');
    expect(saved(swell)).toEqual({ mollie_status: 'pending' });
  });
});

describe('followUp: paid payments', () => {
  it('marks the payment completed when checkout already placed the order', async () => {
    mollie({ tr_1: { status: 'paid', paidAt: PAID_JUST_NOW } });
    const swell = swellMock({
      carts: { cart_1: { ...CART, order_id: 'order_1' } },
      orders: { order_1: { number: '100001', paid: true } },
    });
    await expect(follow(swell)).resolves.toBe('completed');
    expect(saved(swell)).toEqual({
      resolution: 'completed',
      mollie_status: 'paid',
      order_id: 'order_1',
      order_number: '#100001',
      date_resolved: '2026-10-02T12:00:00.000Z',
    });
    expect(swell.post).not.toHaveBeenCalled();
  });

  it('flags a payment whose order was placed but not paid', async () => {
    // Found in testing: checkout placed order #100004 for EUR 20, the charge rejected the EUR 10 payment,
    // and checkout still showed the shopper a confirmation.
    mollie({ tr_1: { status: 'paid', paidAt: PAID_JUST_NOW } });
    const swell = swellMock({
      carts: { cart_1: { ...CART, capture_total: 20, order_id: 'order_4' } },
      orders: { order_4: { number: '100004', paid: false, grand_total: 20, currency: 'EUR' } },
    });

    await expect(follow(swell)).resolves.toBe('unmatched');
    expect(saved(swell)).toEqual({
      resolution: 'unmatched',
      mollie_status: 'paid',
      note: 'Order #100004 was placed but its payment failed: Mollie received EUR 10.00, the order is EUR 20.00.',
      order_id: 'order_4',
      order_number: '#100004',
    });
    expect(swell.post).not.toHaveBeenCalled();
  });

  it("treats an order without an explicit paid: true as unpaid", async () => {
    mollie({ tr_1: { status: 'paid', paidAt: PAID_JUST_NOW } });
    const swell = swellMock({
      carts: { cart_1: { ...CART, order_id: 'order_4' } },
      orders: { order_4: { number: '100004', grand_total: 10, currency: 'EUR' } },
    });
    await expect(follow(swell)).resolves.toBe('unmatched');
  });

  it('gives the shopper time to return before creating the order', async () => {
    mollie({ tr_1: { status: 'paid', paidAt: PAID_JUST_NOW } });
    const swell = swellMock({ carts: { cart_1: CART } });
    await expect(follow(swell)).resolves.toBe('waiting');
    expect(saved(swell)).toEqual({ mollie_status: 'paid', date_paid: PAID_JUST_NOW });
    expect(swell.post).not.toHaveBeenCalled();
  });

  it('creates the order from the cart once the shopper has had time to return', async () => {
    mollie({ tr_1: { status: 'paid', paidAt: PAID_LONG_AGO } });
    const swell = swellMock({ carts: { cart_1: CART }, order: { id: 'order_2', number: '100002', paid: true } });

    await expect(follow(swell)).resolves.toBe('recovered');
    expect(swell.put).toHaveBeenCalledWith('/carts/cart_1', {
      billing: { method: 'mollie', mollie: { token: 'tr_1' }, intent: { mollie: { id: 'tr_1' } } },
    });
    expect(swell.post).toHaveBeenCalledWith('/orders', { cart_id: 'cart_1' });
    // The cart is pointed at the paid payment before the order is created.
    expect(swell.put.mock.invocationCallOrder[0]).toBeLessThan(swell.post.mock.invocationCallOrder[0]);
    expect(saved(swell)).toEqual({
      resolution: 'recovered',
      mollie_status: 'paid',
      order_id: 'order_2',
      order_number: '#100002',
      note: 'The shopper paid but left before returning to checkout. The app created the order.',
      date_resolved: '2026-10-02T12:00:00.000Z',
    });
  });

  it('recovers a held (authorized) payment too', async () => {
    mollie({ tr_1: { status: 'authorized', paidAt: PAID_LONG_AGO } });
    const swell = swellMock({ carts: { cart_1: CART }, order: { id: 'order_2', number: '100002', paid: true } });
    await expect(follow(swell)).resolves.toBe('recovered');
  });

  it('uses the first time it saw the payment as paid when Mollie gives no date', async () => {
    mollie({ tr_1: { status: 'paid' } });
    const swell = swellMock({ carts: { cart_1: CART }, order: { id: 'order_2', number: '100002', paid: true } });
    await expect(follow(swell, record({ date_paid: PAID_LONG_AGO }))).resolves.toBe('recovered');
  });

  it("flags a payment whose cart changed after paying, and doesn't create an order", async () => {
    mollie({ tr_1: { status: 'paid', paidAt: PAID_LONG_AGO } });
    const swell = swellMock({ carts: { cart_1: { ...CART, capture_total: 15 } } });

    await expect(follow(swell)).resolves.toBe('unmatched');
    expect(swell.post).not.toHaveBeenCalled();
    expect(swell.put).not.toHaveBeenCalledWith('/carts/cart_1', expect.anything());
    expect(saved(swell)).toEqual({
      resolution: 'unmatched',
      mollie_status: 'paid',
      note: 'The cart changed after the shopper paid: Mollie received EUR 10.00, but the cart now totals EUR 15.00.',
      order_id: undefined,
      order_number: undefined,
    });
  });

  it('flags a payment whose cart is gone', async () => {
    mollie({ tr_1: { status: 'paid', paidAt: PAID_LONG_AGO } });
    const swell = swellMock({ carts: { cart_1: null } });
    await expect(follow(swell)).resolves.toBe('unmatched');
    expect(saved(swell).note).toBe("The shopper's cart no longer exists, so the order can't be created from it.");
  });

  it("flags a payment when Swell can't create the order, with Swell's reason", async () => {
    mollie({ tr_1: { status: 'paid', paidAt: PAID_LONG_AGO } });
    const error = Object.assign(new Error('{"errors":…}'), {
      body: { message: 'Product [Sample] Mollie test product is out of stock' },
    });
    const swell = swellMock({ carts: { cart_1: CART }, order: error });

    await expect(follow(swell)).resolves.toBe('unmatched');
    expect(saved(swell).note).toBe(
      "The app couldn't create the order: Product [Sample] Mollie test product is out of stock",
    );
  });

  it('flags an order that was created without the payment, and links it', async () => {
    mollie({ tr_1: { status: 'paid', paidAt: PAID_LONG_AGO } });
    const swell = swellMock({
      carts: { cart_1: CART },
      order: { id: 'order_2', number: '100002', paid: false },
      orders: { order_2: { number: '100002' } },
    });

    await expect(follow(swell)).resolves.toBe('unmatched');
    expect(saved(swell)).toMatchObject({
      resolution: 'unmatched',
      order_id: 'order_2',
      order_number: '#100002',
      note: "The app created order #100002, but the Mollie payment wasn't attached to it. Check the order's payment before shipping.",
    });
  });
});

describe('recoverPayments', () => {
  it('follows up pending payments from the lookback window, oldest first', async () => {
    mollie({ tr_1: { status: 'open' } });
    const swell = swellMock({ records: [record()] });
    await recoverPayments(swell as unknown as SwellAPI, TEST_KEY);

    expect(swell.get).toHaveBeenCalledWith('/mollie-payments', {
      where: { resolution: 'pending', date_created: { $gte: new Date(NOW - LOOKBACK_MS).toISOString() } },
      sort: 'date_created asc',
      limit: MAX_PER_RUN,
    });
  });

  it('counts recovered and unmatched payments', async () => {
    mollie({
      tr_1: { status: 'paid', paidAt: PAID_LONG_AGO },
      tr_2: { status: 'paid', paidAt: PAID_LONG_AGO, value: '99.00' },
      tr_3: { status: 'open' },
    });
    const swell = swellMock({
      records: [
        record({ id: 'rec_1', mollie_id: 'tr_1', cart_id: 'cart_1' }),
        record({ id: 'rec_2', mollie_id: 'tr_2', cart_id: 'cart_2' }),
        record({ id: 'rec_3', mollie_id: 'tr_3', cart_id: 'cart_3' }),
      ],
      carts: { cart_1: CART, cart_2: { ...CART, id: 'cart_2' } },
      order: { id: 'order_2', number: '100002', paid: true },
    });

    await expect(recoverPayments(swell as unknown as SwellAPI, TEST_KEY)).resolves.toEqual({
      checked: 3,
      recovered: 1,
      unmatched: 1,
    });
  });

  it('keeps going when one payment fails', async () => {
    mollie({ tr_2: { status: 'canceled' } }); // tr_1 answers 404
    const swell = swellMock({
      records: [record({ id: 'rec_1', mollie_id: 'tr_1' }), record({ id: 'rec_2', mollie_id: 'tr_2' })],
    });
    await expect(recoverPayments(swell as unknown as SwellAPI, TEST_KEY)).resolves.toEqual({
      checked: 2,
      recovered: 0,
      unmatched: 0,
    });
    expect(swell.put).toHaveBeenCalledWith('/mollie-payments/rec_2', expect.objectContaining({ resolution: 'abandoned' }));
  });

  it('stops starting new checks when the time budget runs out', async () => {
    mollie({ tr_1: { status: 'open' }, tr_2: { status: 'open' } });
    const swell = swellMock({
      records: [record({ id: 'rec_1', mollie_id: 'tr_1' }), record({ id: 'rec_2', mollie_id: 'tr_2' })],
    });
    let calls = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (calls++ < 2 ? NOW : NOW + 60_000));
    const summary = await recoverPayments(swell as unknown as SwellAPI, TEST_KEY);
    expect(summary.checked).toBeLessThan(2);
  });
});

describe('countUnmatched', () => {
  it('returns the number of payments waiting for the merchant', async () => {
    const swell = swellMock({ unmatchedCount: 2 });
    await expect(countUnmatched(swell as unknown as SwellAPI)).resolves.toBe(2);
    expect(swell.get).toHaveBeenCalledWith('/mollie-payments', { where: { resolution: 'unmatched' }, limit: 1 });
  });
});
