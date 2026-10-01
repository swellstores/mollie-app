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
