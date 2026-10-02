import { currencyDecimals, type MollieAmount } from './amounts';

// Order lines and addresses for Mollie. Klarna, in3, Riverty, Billie and vouchers need them;
// other methods ignore them. Mollie rejects a payment whose lines don't add up to its amount,
// so everything is computed in minor units (cents) and lines are only sent when they add up exactly.

export type LineType = 'physical' | 'digital' | 'shipping_fee' | 'discount' | 'store_credit' | 'gift_card' | 'surcharge';

export interface MollieLine {
  type: LineType;
  description: string;
  quantity: number;
  unitPrice: MollieAmount;
  discountAmount?: MollieAmount;
  totalAmount: MollieAmount;
  sku?: string;
}

export interface MollieAddress {
  givenName?: string;
  familyName?: string;
  streetAndNumber?: string;
  streetAdditional?: string;
  postalCode?: string;
  city?: string;
  region?: string;
  country?: string;
  email?: string;
  phone?: string;
}

interface SwellAddress {
  name?: string;
  first_name?: string;
  last_name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  service_name?: string;
}

export interface LinesCart {
  currency?: string;
  capture_total?: number;
  grand_total?: number;
  discount_total?: number;
  shipment_total?: number;
  shipment_discount?: number;
  tax_total?: number;
  tax_included_total?: number;
  giftcard_total?: number;
  account_credit_amount?: number;
  items?: {
    quantity?: number;
    price?: number;
    discount_total?: number;
    delivery?: string | null;
    product_name?: string;
    product?: { name?: string; sku?: string };
    variant?: { name?: string; sku?: string };
  }[];
  shipping?: SwellAddress;
  billing?: SwellAddress;
  account?: { email?: string; first_name?: string; last_name?: string };
}

const MAX_TEXT = 100;
const MAX_SKU = 64;

function minor(amount: number | undefined, decimals: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 0;
  return Math.round(Number((amount * 10 ** decimals).toPrecision(12)));
}

function money(units: number, currency: string, decimals: number): MollieAmount {
  return { currency, value: (units / 10 ** decimals).toFixed(decimals) };
}

function text(value: string | undefined, max = MAX_TEXT): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Lines that add up exactly to the cart's capture total, or null when they can't be built
 * (missing data, unexpected totals). Callers send the payment without lines in that case.
 */
export function buildLines(cart: LinesCart): MollieLine[] | null {
  const currency = cart.currency?.toUpperCase();
  const items = cart.items ?? [];
  if (!currency || items.length === 0) return null;

  const d = currencyDecimals(currency);
  const amount = (units: number) => money(units, currency, d);
  const lines: MollieLine[] = [];
  let itemDiscounts = 0;

  for (const item of items) {
    const quantity = Math.round(item.quantity ?? 0);
    if (quantity < 1) return null;
    const unit = minor(item.price, d);
    const discount = Math.max(0, minor(item.discount_total, d));
    itemDiscounts += discount;
    const name = [text(item.product?.name ?? item.product_name), text(item.variant?.name)].filter(Boolean).join(' – ');
    lines.push({
      type: item.delivery === 'shipment' || item.delivery === undefined ? 'physical' : 'digital',
      description: text(name) ?? 'Item',
      quantity,
      unitPrice: amount(unit),
      ...(discount > 0 ? { discountAmount: amount(discount) } : {}),
      totalAmount: amount(unit * quantity - discount),
      ...(text(item.variant?.sku ?? item.product?.sku, MAX_SKU) ? { sku: text(item.variant?.sku ?? item.product?.sku, MAX_SKU) } : {}),
    });
  }

  const shipping = minor(cart.shipment_total, d);
  const shippingDiscount = Math.max(0, minor(cart.shipment_discount, d));
  if (shipping > 0) {
    lines.push({
      type: 'shipping_fee',
      description: text(cart.shipping?.service_name) ?? 'Shipping',
      quantity: 1,
      unitPrice: amount(shipping),
      ...(shippingDiscount > 0 ? { discountAmount: amount(shippingDiscount) } : {}),
      totalAmount: amount(shipping - shippingDiscount),
    });
  }

  // Tax not already included in prices.
  const extraTax = minor(cart.tax_total, d) - minor(cart.tax_included_total, d);
  if (extraTax > 0) {
    lines.push({ type: 'surcharge', description: 'Tax', quantity: 1, unitPrice: amount(extraTax), totalAmount: amount(extraTax) });
  }

  // Order-level discounts that aren't on an item or on shipping.
  const orderDiscount = minor(cart.discount_total, d) - itemDiscounts - (shipping > 0 ? shippingDiscount : 0);
  if (orderDiscount > 0) {
    lines.push({ type: 'discount', description: 'Discount', quantity: 1, unitPrice: amount(-orderDiscount), totalAmount: amount(-orderDiscount) });
  }

  for (const [type, description, value] of [
    ['gift_card', 'Gift card', cart.giftcard_total],
    ['store_credit', 'Account credit', cart.account_credit_amount],
  ] as const) {
    const units = minor(value, d);
    if (units > 0) {
      lines.push({ type, description, quantity: 1, unitPrice: amount(-units), totalAmount: amount(-units) });
    }
  }

  // Exact or nothing.
  const total = cart.capture_total ?? cart.grand_total;
  const sum = lines.reduce((acc, line) => acc + Math.round(Number(line.totalAmount.value) * 10 ** d), 0);
  return sum === minor(total, d) && sum > 0 ? lines : null;
}

function splitName(address: SwellAddress | undefined, account: LinesCart['account']) {
  const first = text(address?.first_name) ?? text(account?.first_name);
  const last = text(address?.last_name) ?? text(account?.last_name);
  if (first || last) return { givenName: first, familyName: last };
  const parts = (address?.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { givenName: parts[0] };
  return { givenName: parts.slice(0, -1).join(' '), familyName: parts[parts.length - 1] };
}

/** A Mollie address from a Swell address, or undefined when there's nothing usable. */
export function buildAddress(address: SwellAddress | undefined, account: LinesCart['account']): MollieAddress | undefined {
  const email = text(account?.email, 254);
  const country = text(address?.country)?.toUpperCase();
  const hasPostal = Boolean(text(address?.address1) && text(address?.city) && country && /^[A-Z]{2}$/.test(country));
  if (!hasPostal && !email) return undefined;

  const result: MollieAddress = { email };
  if (hasPostal) {
    Object.assign(result, splitName(address, account), {
      streetAndNumber: text(address?.address1),
      streetAdditional: text(address?.address2),
      postalCode: text(address?.zip, 20),
      city: text(address?.city),
      region: text(address?.state),
      country,
    });
  }
  const phone = address?.phone?.replace(/[\s()-]/g, '');
  if (phone && /^\+[1-9]\d{6,14}$/.test(phone)) result.phone = phone;

  // Drop empty fields; Mollie rejects empty strings for some of them.
  for (const key of Object.keys(result) as (keyof MollieAddress)[]) {
    if (!result[key]) delete result[key];
  }
  return Object.keys(result).length ? result : undefined;
}
