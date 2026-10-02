import { keyMode, listMethods } from './lib/mollie';
import { countUnmatched, recoverPayments } from './lib/recovery';
import { recordStatus, statusMessages } from './lib/status';

export const config: SwellConfig = {
  description:
    'Every 5 minutes: check the Mollie connection, and create orders for shoppers who paid but never returned to checkout',
  cron: {
    schedule: '*/5 * * * *',
  },
  timeout: 10000,
};

export default async function (req: SwellRequest) {
  const { swell, appId } = req;
  const settings = (await swell.settings()) as { mollie?: { api_key?: string } };
  const apiKey = settings?.mollie?.api_key?.trim();

  if (!apiKey) {
    await recordStatus(swell, appId, { message: statusMessages.notConnected });
    return;
  }

  const mode = keyMode(apiKey);
  if (!mode) {
    await recordStatus(swell, appId, { message: statusMessages.invalidKey });
    return;
  }

  let methods;
  try {
    methods = await listMethods(apiKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordStatus(swell, appId, { message: statusMessages.connectionFailed(message) });
    return;
  }

  // Safety net: shoppers who paid on Mollie but closed the page before returning.
  let attention: string | undefined;
  try {
    await recoverPayments(swell, apiKey);
    attention = statusMessages.attention(await countUnmatched(swell));
  } catch {
    attention = undefined; // The next run tries again; the connection status is still worth showing.
  }

  await recordStatus(swell, appId, {
    message: statusMessages.connected(mode),
    methods: methods.length ? methods.map((method) => method.description).join(', ') : statusMessages.noMethods,
    attention,
  });
}
