import { describe, it, expect, vi } from 'vitest';
import { createMockRequest } from '../helpers/mock-request';
import handler, { config } from '../../functions/refund';

const TEST_KEY = 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM';
const PAYMENT_ID = 'tr_LpbmWBXB79LWMRX8A8bXJ';

function mollieRefund(status = 'pending', httpStatus = 201, body?: object) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit = {}) => {
    const request = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify(body ?? { resource: 'refund', id: 're_4qqhO89gsT', status, amount: request.amount, paymentId: PAYMENT_ID }),
      { status: httpStatus },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof mollieRefund>) {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(init.body as string) };
}

async function refund(data: object) {
  const swell = { settings: vi.fn().mockResolvedValue({ mollie: { api_key: TEST_KEY } }) };
  return handler(createMockRequest({ swell: swell as unknown as SwellAPI, data }));
}

describe('refund', () => {
  it('is bound to the Mollie extension and returns the refund contract fields', () => {
    expect(config.extension).toBe('mollie');
    expect(config.model?.events).toEqual(['after:payment.refund']);
    expect(config.model?.fields).toEqual(['success', 'error', 'transaction_id']);
  });

  it('refunds the requested amount and returns the Mollie refund id', async () => {
    const fetchMock = mollieRefund();
    await expect(
      refund({ id: 'refund_1', amount: 10, currency: 'EUR', transaction_id: PAYMENT_ID }),
    ).resolves.toEqual({ success: true, transaction_id: 're_4qqhO89gsT' });

    expect(sent(fetchMock)).toEqual({
      url: `https://api.mollie.com/v2/payments/${PAYMENT_ID}/refunds`,
      method: 'POST',
      body: { amount: { currency: 'EUR', value: '10.00' }, metadata: { swell_refund_id: 'refund_1' } },
    });
  });

  it('supports partial refunds', async () => {
    const fetchMock = mollieRefund();
    await refund({ amount: 2.5, currency: 'EUR', transaction_id: PAYMENT_ID });
    expect(sent(fetchMock).body).toEqual({ amount: { currency: 'EUR', value: '2.50' } });
  });

  it.each(['queued', 'pending', 'processing', 'refunded'])('accepts a refund that is %s', async (status) => {
    mollieRefund(status);
    const result = await refund({ amount: 10, currency: 'EUR', transaction_id: PAYMENT_ID });
    expect(result.success).toBe(true);
  });

  it('reports a refund Mollie marked as failed', async () => {
    mollieRefund('failed');
    await expect(refund({ amount: 10, currency: 'EUR', transaction_id: PAYMENT_ID })).resolves.toEqual({
      success: false,
      error: { message: 'Mollie could not refund the payment (status: failed).' },
    });
  });

  it.each([
    [{ amount: 10, currency: 'EUR' }, 'No Mollie payment found to refund.'],
    [{ amount: 10, currency: 'EUR', transaction_id: 'ch_123' }, 'No Mollie payment found to refund.'],
    [{ currency: 'EUR', transaction_id: PAYMENT_ID }, 'Missing refund amount or currency.'],
    [{ amount: 0, currency: 'EUR', transaction_id: PAYMENT_ID }, 'Missing refund amount or currency.'],
    [{ amount: 10, transaction_id: PAYMENT_ID }, 'Missing refund amount or currency.'],
  ])('rejects incomplete input %j without calling Mollie', async (data, message) => {
    const fetchMock = mollieRefund();
    await expect(refund(data)).resolves.toEqual({ success: false, error: { message } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes on Mollie's reason when it refuses a refund", async () => {
    mollieRefund('pending', 422, {
      status: 422,
      title: 'Unprocessable Entity',
      detail: 'The amount requested is higher than the remaining refundable amount',
    });
    await expect(refund({ amount: 20, currency: 'EUR', transaction_id: PAYMENT_ID })).resolves.toEqual({
      success: false,
      error: { message: 'Mollie API 422: The amount requested is higher than the remaining refundable amount.' },
    });
  });
});
