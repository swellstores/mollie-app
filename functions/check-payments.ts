import { keyMode, listMethods } from './lib/mollie';
import { recordStatus, statusMessages } from './lib/status';

export const config: SwellConfig = {
  description: 'Check the Mollie connection every 5 minutes and show it on the settings page',
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

  try {
    const methods = await listMethods(apiKey);
    await recordStatus(swell, appId, {
      message: statusMessages.connected(mode),
      methods: methods.length ? methods.map((method) => method.description).join(', ') : statusMessages.noMethods,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordStatus(swell, appId, { message: statusMessages.connectionFailed(message) });
  }
}
