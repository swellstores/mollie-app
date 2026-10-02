import type { MollieAmount } from './amounts';

const MOLLIE_API_URL = 'https://api.mollie.com/v2';

export type MollieMode = 'test' | 'live';

export class MollieApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MollieApiError';
    this.status = status;
  }
}

/** Test or live, from the key's prefix. Null when it isn't a Mollie API key. */
export function keyMode(apiKey: string | undefined): MollieMode | null {
  const key = apiKey?.trim() ?? '';
  if (/^test_\w{20,}$/.test(key)) return 'test';
  if (/^live_\w{20,}$/.test(key)) return 'live';
  return null;
}

async function mollieRequest(apiKey: string, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${MOLLIE_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      Accept: 'application/hal+json',
      ...init.headers,
    },
  });

  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    // Mollie errors look like { status, title, detail, field? }.
    const detail = typeof body === 'object' && body ? body.detail || body.title : body;
    const hint = response.status === 401 ? ' Check the API key in the app settings.' : '';
    throw new MollieApiError(`Mollie API ${response.status}${detail ? `: ${detail}` : ''}.${hint}`, response.status);
  }
  return body;
}

export interface MollieMethod {
  id: string;
  description: string;
}

/** Payment methods the merchant has turned on in Mollie for this key's profile. */
export async function listMethods(apiKey: string): Promise<MollieMethod[]> {
  const body = await mollieRequest(apiKey, '/methods');
  const methods: any[] = body?._embedded?.methods ?? [];
  return methods.map((method) => ({ id: method.id, description: method.description }));
}

export type MolliePaymentStatus = 'open' | 'pending' | 'authorized' | 'paid' | 'canceled' | 'expired' | 'failed';

export interface MolliePayment {
  id: string;
  status: MolliePaymentStatus;
  amount: MollieAmount;
  method: string | null;
  metadata: Record<string, any> | null;
  checkoutUrl: string | null;
}

export interface CreatePaymentInput {
  amount: MollieAmount;
  description: string;
  redirectUrl: string;
  metadata: Record<string, string>;
  locale?: string;
}

/** Mollie payment ids look like tr_WDqYK6vllg. */
export function isPaymentId(id: unknown): id is string {
  return typeof id === 'string' && /^tr_[A-Za-z0-9]+$/.test(id);
}

function toPayment(body: any): MolliePayment {
  return {
    id: body.id,
    status: body.status,
    amount: body.amount,
    method: body.method ?? null,
    metadata: body.metadata ?? null,
    checkoutUrl: body._links?.checkout?.href ?? null,
  };
}

/** Create a payment on Mollie's hosted page. Without a method, the shopper chooses one there. */
export async function createPayment(apiKey: string, input: CreatePaymentInput): Promise<MolliePayment> {
  const body = await mollieRequest(apiKey, '/payments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return toPayment(body);
}

export async function getPayment(apiKey: string, id: string): Promise<MolliePayment> {
  if (!isPaymentId(id)) {
    throw new MollieApiError(`Not a Mollie payment id: ${id}`, 400);
  }
  return toPayment(await mollieRequest(apiKey, `/payments/${id}`));
}

export interface MollieCapture {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  amount: MollieAmount;
}

/**
 * Capture a held (authorized) payment. Without an amount, Mollie captures the full authorized amount.
 * Captures are processed asynchronously: the result starts as pending.
 */
export async function capturePayment(apiKey: string, id: string, amount?: MollieAmount): Promise<MollieCapture> {
  if (!isPaymentId(id)) {
    throw new MollieApiError(`Not a Mollie payment id: ${id}`, 400);
  }
  const body = await mollieRequest(apiKey, `/payments/${id}/captures`, {
    method: 'POST',
    body: JSON.stringify(amount ? { amount } : {}),
  });
  return { id: body.id, status: body.status, amount: body.amount };
}
