import { describe, it, expect, vi } from 'vitest';
import { mollieSettings, paymentDescription, SettingsError } from '../../functions/lib/settings';

const TEST_KEY = 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM';

function swellWith(settings: object) {
  return { settings: vi.fn().mockResolvedValue(settings) } as unknown as SwellAPI;
}

describe('mollieSettings', () => {
  it('returns the trimmed key, its mode and the description', async () => {
    await expect(
      mollieSettings(swellWith({ mollie: { api_key: ` ${TEST_KEY} `, payment_description: ' My Shop ' } })),
    ).resolves.toEqual({ apiKey: TEST_KEY, mode: 'test', paymentDescription: 'My Shop' });
  });

  it('defaults to an empty description', async () => {
    const settings = await mollieSettings(swellWith({ mollie: { api_key: TEST_KEY, payment_description: null } }));
    expect(settings.paymentDescription).toBe('');
  });

  it('asks the merchant to connect when there is no key', async () => {
    const error = await mollieSettings(swellWith({})).catch((e) => e);
    expect(error).toBeInstanceOf(SettingsError);
    expect(error.message).toBe('Mollie is not connected. Add your Mollie API key in the Mollie app settings.');
  });

  it('rejects a key that is not a Mollie API key', async () => {
    await expect(mollieSettings(swellWith({ mollie: { api_key: 'pfl_abc' } }))).rejects.toThrow(
      "The Mollie API key in the app settings isn't valid. It should start with test_ or live_.",
    );
  });
});

describe('paymentDescription', () => {
  it("uses the merchant's text", () => {
    expect(paymentDescription('SMPL International', 'https://smpl.international')).toBe('SMPL International');
  });

  it("falls back to the store's domain", () => {
    expect(paymentDescription('', 'https://smpl.international/')).toBe('Order at smpl.international');
  });

  it('falls back to a generic text without a usable store address', () => {
    expect(paymentDescription('', undefined)).toBe('Online order');
    expect(paymentDescription('', 'not a url')).toBe('Online order');
  });

  it("keeps within Mollie's 255 character limit", () => {
    expect(paymentDescription('x'.repeat(300), undefined)).toHaveLength(255);
  });
});
