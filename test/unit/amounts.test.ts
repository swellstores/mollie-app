import { describe, it, expect } from 'vitest';
import { currencyDecimals, sameAmount, toMollieAmount } from '../../functions/lib/amounts';

describe('toMollieAmount', () => {
  it('formats amounts with two decimals', () => {
    expect(toMollieAmount(10, 'EUR')).toEqual({ currency: 'EUR', value: '10.00' });
    expect(toMollieAmount(10.5, 'eur')).toEqual({ currency: 'EUR', value: '10.50' });
    expect(toMollieAmount(0.1 + 0.2, 'USD')).toEqual({ currency: 'USD', value: '0.30' });
  });

  it('rounds to the currency precision', () => {
    expect(toMollieAmount(19.999, 'EUR').value).toBe('20.00');
    expect(toMollieAmount(1.005, 'EUR').value).toBe('1.01');
  });

  it('uses no decimals for JPY and ISK', () => {
    expect(currencyDecimals('JPY')).toBe(0);
    expect(toMollieAmount(1500, 'JPY')).toEqual({ currency: 'JPY', value: '1500' });
    expect(toMollieAmount(1499.6, 'ISK').value).toBe('1500');
  });

  it('rejects negative and non-numeric amounts', () => {
    expect(() => toMollieAmount(-1, 'EUR')).toThrow('Invalid amount: -1');
    expect(() => toMollieAmount(Number.NaN, 'EUR')).toThrow('Invalid amount');
  });
});

describe('sameAmount', () => {
  it('matches equal amounts in the same currency', () => {
    expect(sameAmount({ currency: 'EUR', value: '10.50' }, 10.5, 'EUR')).toBe(true);
    expect(sameAmount({ currency: 'EUR', value: '10.5' }, 10.5, 'eur')).toBe(true);
  });

  it('rejects a different amount or currency', () => {
    expect(sameAmount({ currency: 'EUR', value: '10.50' }, 10.51, 'EUR')).toBe(false);
    expect(sameAmount({ currency: 'USD', value: '10.50' }, 10.5, 'EUR')).toBe(false);
    expect(sameAmount(undefined, 10.5, 'EUR')).toBe(false);
  });
});
