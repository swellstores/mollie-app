import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createMockRequest } from '../helpers/mock-request';
import handler from '../../functions/check-payments';
import { statusMessages } from '../../functions/lib/status';

const NOW = new Date('2026-10-01T12:00:00.000Z').getTime();
const TEST_KEY = 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM';
const LIVE_KEY = 'live_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM';

function swellMock(apiKey?: string, { unmatched = 0 } = {}) {
  return {
    settings: vi.fn().mockResolvedValue(apiKey === undefined ? {} : { mollie: { api_key: apiKey } }),
    put: vi.fn().mockResolvedValue({}),
    // No pending payments to follow up; `unmatched` payments waiting for the merchant.
    get: vi.fn(async (_url: string, query: any) =>
      query?.where?.resolution === 'unmatched' ? { count: unmatched, results: [] } : { count: 0, results: [] },
    ),
  };
}

function savedStatus(swell: ReturnType<typeof swellMock>) {
  expect(swell.put).toHaveBeenCalledTimes(1);
  const [url, body] = swell.put.mock.calls[0];
  expect(url).toBe('/settings/mollie');
  return body.status;
}

function mollieMethods(methods: { id: string; description: string }[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ _embedded: { methods } }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function run(swell: ReturnType<typeof swellMock>) {
  await handler(createMockRequest({ swell: swell as unknown as SwellAPI, appId: 'mollie' }));
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('check-payments: connection status', () => {
  it('asks for an API key when none is set', async () => {
    const fetchMock = mollieMethods([]);
    const swell = swellMock();
    await run(swell);

    expect(savedStatus(swell)).toEqual({
      message: statusMessages.notConnected,
      methods: '',
      attention: '',
      last_checked: 'Thu, 01 Oct 2026 12:00:00 GMT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a blank key as not connected', async () => {
    const swell = swellMock('   ');
    await run(swell);
    expect(savedStatus(swell).message).toBe(statusMessages.notConnected);
  });

  it("flags a value that isn't a Mollie API key without calling Mollie", async () => {
    const fetchMock = mollieMethods([]);
    const swell = swellMock('pfl_QkEhN94Ba');
    await run(swell);

    expect(savedStatus(swell).message).toBe(statusMessages.invalidKey);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows test mode and the enabled methods', async () => {
    mollieMethods([
      { id: 'ideal', description: 'iDEAL' },
      { id: 'creditcard', description: 'Card' },
      { id: 'bancontact', description: 'Bancontact' },
    ]);
    const swell = swellMock(TEST_KEY);
    await run(swell);

    const status = savedStatus(swell);
    expect(status.message).toBe(statusMessages.connected('test'));
    expect(status.methods).toBe('iDEAL, Card, Bancontact');
  });

  it('reports no payments needing attention', async () => {
    mollieMethods([{ id: 'ideal', description: 'iDEAL' }]);
    const swell = swellMock(TEST_KEY);
    await run(swell);
    expect(savedStatus(swell).attention).toBe('None.');
  });

  it('counts payments needing attention', async () => {
    mollieMethods([{ id: 'ideal', description: 'iDEAL' }]);
    const one = swellMock(TEST_KEY, { unmatched: 1 });
    await run(one);
    expect(savedStatus(one).attention).toBe(
      '1 Mollie payment needs attention: the shopper paid but has no paid order. See Orders → Mollie payments.',
    );

    const three = swellMock(TEST_KEY, { unmatched: 3 });
    await run(three);
    expect(savedStatus(three).attention).toBe(
      '3 Mollie payments need attention: the shopper paid but has no paid order. See Orders → Mollie payments.',
    );
  });

  it('still shows the connection when the safety net fails', async () => {
    mollieMethods([{ id: 'ideal', description: 'iDEAL' }]);
    const swell = swellMock(TEST_KEY);
    swell.get.mockRejectedValue(new Error('Collection unavailable'));
    await run(swell);
    expect(savedStatus(swell)).toMatchObject({ message: statusMessages.connected('test'), attention: '' });
  });

  it('skips the safety net when Mollie is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down.')));
    const swell = swellMock(TEST_KEY);
    await run(swell);
    expect(swell.get).not.toHaveBeenCalled();
  });

  it('shows live mode for a live key', async () => {
    mollieMethods([{ id: 'ideal', description: 'iDEAL' }]);
    const swell = swellMock(LIVE_KEY);
    await run(swell);
    expect(savedStatus(swell).message).toBe('Connected in live mode.');
  });

  it('tells the merchant to turn on methods when none are enabled', async () => {
    mollieMethods([]);
    const swell = swellMock(TEST_KEY);
    await run(swell);
    expect(savedStatus(swell).methods).toBe(statusMessages.noMethods);
  });

  it('reports a rejected key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 401, detail: 'Invalid API key' }), { status: 401 })),
    );
    const swell = swellMock(TEST_KEY);
    await run(swell);

    expect(savedStatus(swell).message).toBe(
      "Couldn't reach Mollie: Mollie API 401: Invalid API key. Check the API key in the app settings. Trying again in 5 minutes.",
    );
  });

  it('reports network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down.')));
    const swell = swellMock(TEST_KEY);
    await run(swell);
    expect(savedStatus(swell).message).toBe("Couldn't reach Mollie: Network down. Trying again in 5 minutes.");
  });

  it('does not fail when the status cannot be saved', async () => {
    mollieMethods([{ id: 'ideal', description: 'iDEAL' }]);
    const swell = swellMock(TEST_KEY);
    swell.put.mockRejectedValue(new Error('Settings unavailable'));
    await expect(run(swell)).resolves.toBeUndefined();
  });

  it('shortens very long messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'x'.repeat(400) }), { status: 500 })),
    );
    const swell = swellMock(TEST_KEY);
    await run(swell);

    const { message } = savedStatus(swell);
    expect(message).toHaveLength(250);
    expect(message.endsWith('…')).toBe(true);
  });
});
