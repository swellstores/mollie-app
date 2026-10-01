export interface MollieAmount {
  currency: string;
  value: string;
}

/** Currencies Mollie expects without decimals. Every other currency uses two. */
const ZERO_DECIMAL_CURRENCIES = new Set(['ISK', 'JPY']);

export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

/** Swell amount (a number like 10.5) → Mollie amount ({ currency: 'EUR', value: '10.50' }). */
export function toMollieAmount(amount: number, currency: string): MollieAmount {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const code = currency.toUpperCase();
  const decimals = currencyDecimals(code);
  const factor = 10 ** decimals;
  // Round in minor units. toPrecision first so 1.005 * 100 (= 100.49999…) rounds to 101, not 100.
  const rounded = Math.round(Number((amount * factor).toPrecision(12))) / factor;
  return { currency: code, value: rounded.toFixed(decimals) };
}

/** True when a Mollie amount equals a Swell amount in the same currency, to the currency's precision. */
export function sameAmount(mollie: MollieAmount | undefined, amount: number, currency: string): boolean {
  if (!mollie) return false;
  const expected = toMollieAmount(amount, currency);
  return mollie.currency.toUpperCase() === expected.currency && Number(mollie.value) === Number(expected.value);
}
