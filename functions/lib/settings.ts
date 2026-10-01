import { keyMode, type MollieMode } from './mollie';

export interface MollieSettings {
  apiKey: string;
  mode: MollieMode;
  paymentDescription: string;
}

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

const MAX_DESCRIPTION = 255;

/** The merchant's Mollie settings. Throws a SettingsError the merchant can act on when the key is missing or wrong. */
export async function mollieSettings(swell: SwellAPI): Promise<MollieSettings> {
  const settings = (await swell.settings()) as { mollie?: { api_key?: string; payment_description?: string } };
  const apiKey = settings?.mollie?.api_key?.trim() ?? '';
  if (!apiKey) {
    throw new SettingsError('Mollie is not connected. Add your Mollie API key in the Mollie app settings.');
  }
  const mode = keyMode(apiKey);
  if (!mode) {
    throw new SettingsError("The Mollie API key in the app settings isn't valid. It should start with test_ or live_.");
  }
  return { apiKey, mode, paymentDescription: settings?.mollie?.payment_description?.trim() ?? '' };
}

/** Text for the payment page and bank statement: the merchant's own, or "Order at <store domain>". */
export function paymentDescription(custom: string, storeUrl: string | undefined): string {
  let text = custom;
  if (!text) {
    let host = '';
    try {
      host = storeUrl ? new URL(storeUrl).host : '';
    } catch {
      host = '';
    }
    text = host ? `Order at ${host}` : 'Online order';
  }
  return text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION) : text;
}
