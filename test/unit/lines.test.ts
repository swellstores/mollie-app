import { describe, it, expect } from 'vitest';
import { buildAddress, buildLines, type LinesCart } from '../../functions/lib/lines';

const eur = (value: string) => ({ currency: 'EUR', value });

function sum(lines: { totalAmount: { value: string } }[]): string {
  return (lines.reduce((acc, line) => acc + Math.round(Number(line.totalAmount.value) * 100), 0) / 100).toFixed(2);
}

const MUG = { quantity: 2, price: 12.5, product: { name: 'Mug', sku: 'MUG-1' } };

describe('buildLines', () => {
  it('turns items into lines that add up to the amount', () => {
    const lines = buildLines({ currency: 'EUR', capture_total: 25, items: [MUG] });
    expect(lines).toEqual([
      { type: 'physical', description: 'Mug', quantity: 2, unitPrice: eur('12.50'), totalAmount: eur('25.00'), sku: 'MUG-1' },
    ]);
  });

  it('adds the variant name and prefers the variant sku', () => {
    const [line] = buildLines({
      currency: 'EUR',
      capture_total: 12.5,
      items: [{ quantity: 1, price: 12.5, product: { name: 'Mug', sku: 'MUG' }, variant: { name: 'Blue', sku: 'MUG-BLUE' } }],
    })!;
    expect(line.description).toBe('Mug – Blue');
    expect(line.sku).toBe('MUG-BLUE');
  });

  it('marks items without shipping as digital', () => {
    const [line] = buildLines({ currency: 'EUR', capture_total: 5, items: [{ quantity: 1, price: 5, delivery: null, product: { name: 'E-book' } }] })!;
    expect(line.type).toBe('digital');
  });

  it('includes item discounts, shipping, extra tax and order discounts', () => {
    const cart: LinesCart = {
      currency: 'EUR',
      // items 25.00 - 2.50 item discount + shipping 4.95 - 1.00 shipping discount + tax 3.00 - 5.00 order discount
      capture_total: 24.45,
      discount_total: 8.5,
      shipment_total: 4.95,
      shipment_discount: 1,
      tax_total: 3,
      tax_included_total: 0,
      shipping: { service_name: 'PostNL' },
      items: [{ ...MUG, discount_total: 2.5 }],
    };
    const lines = buildLines(cart)!;

    expect(lines.map((line) => [line.type, line.description, line.totalAmount.value])).toEqual([
      ['physical', 'Mug', '22.50'],
      ['shipping_fee', 'PostNL', '3.95'],
      ['surcharge', 'Tax', '3.00'],
      ['discount', 'Discount', '-5.00'],
    ]);
    expect(lines[0].discountAmount).toEqual(eur('2.50'));
    expect(lines[1].discountAmount).toEqual(eur('1.00'));
    expect(sum(lines)).toBe('24.45');
  });

  it("doesn't add tax that's already in the prices", () => {
    const lines = buildLines({ currency: 'EUR', capture_total: 25, tax_total: 4.34, tax_included_total: 4.34, items: [MUG] })!;
    expect(lines.map((line) => line.type)).toEqual(['physical']);
  });

  it('subtracts gift cards and account credit from the amount to pay', () => {
    const lines = buildLines({
      currency: 'EUR',
      grand_total: 25,
      capture_total: 12,
      giftcard_total: 10,
      account_credit_amount: 3,
      items: [MUG],
    })!;
    expect(lines.slice(1).map((line) => [line.type, line.totalAmount.value])).toEqual([
      ['gift_card', '-10.00'],
      ['store_credit', '-3.00'],
    ]);
    expect(sum(lines)).toBe('12.00');
  });

  it('returns null when the lines would not add up', () => {
    expect(buildLines({ currency: 'EUR', capture_total: 30, items: [MUG] })).toBeNull();
  });

  it('returns null without items, currency or a valid quantity', () => {
    expect(buildLines({ currency: 'EUR', capture_total: 25, items: [] })).toBeNull();
    expect(buildLines({ capture_total: 25, items: [MUG] })).toBeNull();
    expect(buildLines({ currency: 'EUR', capture_total: 0, items: [{ ...MUG, quantity: 0 }] })).toBeNull();
  });

  it('uses no decimals for JPY', () => {
    const [line] = buildLines({ currency: 'JPY', capture_total: 3000, items: [{ quantity: 2, price: 1500, product: { name: 'Mug' } }] })!;
    expect(line.unitPrice).toEqual({ currency: 'JPY', value: '1500' });
    expect(line.totalAmount).toEqual({ currency: 'JPY', value: '3000' });
  });

  it('works in cents, so float prices still add up', () => {
    const lines = buildLines({ currency: 'EUR', capture_total: 0.3, items: [{ quantity: 3, price: 0.1, product: { name: 'Sticker' } }] });
    expect(lines?.[0].totalAmount).toEqual(eur('0.30'));
  });

  it('shortens long names and skus', () => {
    const [line] = buildLines({
      currency: 'EUR',
      capture_total: 1,
      items: [{ quantity: 1, price: 1, product: { name: 'x'.repeat(300), sku: 'S'.repeat(100) } }],
    })!;
    expect(line.description.length).toBeLessThanOrEqual(100);
    expect(line.sku).toHaveLength(64);
  });
});

describe('buildAddress', () => {
  const ACCOUNT = { email: 'sam@example.com', first_name: 'Sam', last_name: 'Jansen' };

  it('maps a full Swell address', () => {
    expect(
      buildAddress(
        { first_name: 'Sam', last_name: 'Jansen', address1: 'Damrak 1', address2: '3hg', city: 'Amsterdam', zip: '1012 LG', state: 'Noord-Holland', country: 'nl', phone: '+31 20 820 2070' },
        ACCOUNT,
      ),
    ).toEqual({
      email: 'sam@example.com',
      givenName: 'Sam',
      familyName: 'Jansen',
      streetAndNumber: 'Damrak 1',
      streetAdditional: '3hg',
      postalCode: '1012 LG',
      city: 'Amsterdam',
      region: 'Noord-Holland',
      country: 'NL',
      phone: '+31208202070',
    });
  });

  it('splits a single name field', () => {
    const address = buildAddress({ name: 'Anna Maria de Vries', address1: 'Damrak 1', city: 'Amsterdam', country: 'NL' }, { email: 'a@example.com' });
    expect(address).toMatchObject({ givenName: 'Anna Maria de', familyName: 'Vries' });
  });

  it('falls back to the account name', () => {
    const address = buildAddress({ address1: 'Damrak 1', city: 'Amsterdam', country: 'NL' }, ACCOUNT);
    expect(address).toMatchObject({ givenName: 'Sam', familyName: 'Jansen' });
  });

  it('sends only the email when the postal address is incomplete', () => {
    expect(buildAddress({ address1: 'Damrak 1' }, ACCOUNT)).toEqual({ email: 'sam@example.com' });
  });

  it('drops phone numbers that are not in international format', () => {
    const address = buildAddress({ address1: 'Damrak 1', city: 'Amsterdam', country: 'NL', phone: '020 820 2070' }, ACCOUNT);
    expect(address).not.toHaveProperty('phone');
  });

  it('returns undefined when there is nothing usable', () => {
    expect(buildAddress(undefined, undefined)).toBeUndefined();
    expect(buildAddress({ city: 'Amsterdam' }, {})).toBeUndefined();
  });
});
