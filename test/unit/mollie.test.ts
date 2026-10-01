import { afterEach, describe, it, expect, vi } from 'vitest';
import { keyMode, listMethods, MollieApiError } from '../../functions/lib/mollie';

const TEST_KEY = 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM';

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('keyMode', () => {
  it('reads test and live keys from their prefix', () => {
    expect(keyMode(TEST_KEY)).toBe('test');
    expect(keyMode('live_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM')).toBe('live');
  });

  it('ignores surrounding spaces', () => {
    expect(keyMode(`  ${TEST_KEY} `)).toBe('test');
  });

  it('rejects anything that is not an API key', () => {
    expect(keyMode(undefined)).toBeNull();
    expect(keyMode('')).toBeNull();
    expect(keyMode('pfl_QkEhN94Ba')).toBeNull();
    expect(keyMode('access_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM')).toBeNull();
    expect(keyMode('test_short')).toBeNull();
  });
});

describe('listMethods', () => {
  it('returns the enabled methods and sends the key as a bearer token', async () => {
    const fetchMock = mockFetch(200, {
      count: 2,
      _embedded: {
        methods: [
          { id: 'ideal', description: 'iDEAL', status: 'activated' },
          { id: 'creditcard', description: 'Card', status: 'activated' },
        ],
      },
    });

    await expect(listMethods(TEST_KEY)).resolves.toEqual([
      { id: 'ideal', description: 'iDEAL' },
      { id: 'creditcard', description: 'Card' },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mollie.com/v2/methods');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_KEY}`);
  });

  it('returns an empty list when no methods are enabled', async () => {
    mockFetch(200, { count: 0, _embedded: { methods: [] } });
    await expect(listMethods(TEST_KEY)).resolves.toEqual([]);
  });

  it("explains a rejected key using Mollie's error detail", async () => {
    mockFetch(401, { status: 401, title: 'Unauthorized Request', detail: 'Missing authentication, or failed to authenticate' });

    const error = await listMethods(TEST_KEY).catch((e) => e);
    expect(error).toBeInstanceOf(MollieApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe(
      'Mollie API 401: Missing authentication, or failed to authenticate. Check the API key in the app settings.',
    );
  });

  it('handles error responses that are not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    await expect(listMethods(TEST_KEY)).rejects.toThrow('Mollie API 502: Bad gateway.');
  });
});
