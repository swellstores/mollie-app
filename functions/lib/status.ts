const MAX_LENGTH = 250;

export interface AppStatus {
  message: string;
  methods?: string;
}

function truncate(text: string): string {
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}

/**
 * Show the latest check on the app's settings page (Status panel).
 * Never throws: a status that fails to save must not break checkout or the check itself.
 */
export async function recordStatus(swell: SwellAPI, appId: string, status: AppStatus): Promise<void> {
  try {
    await swell.put(`/settings/${appId}`, {
      status: {
        message: truncate(status.message),
        methods: truncate(status.methods ?? ''),
        last_checked: new Date(Date.now()).toUTCString(),
      },
    });
  } catch {
    // Ignore: the next check tries again.
  }
}

export const statusMessages = {
  notConnected: 'Not connected. Add your Mollie API key above to accept payments.',
  invalidKey: "This isn't a Mollie API key. It should start with test_ or live_.",
  connected: (mode: 'test' | 'live') =>
    mode === 'test'
      ? 'Connected in test mode. Payments are simulated; no money is moved.'
      : 'Connected in live mode.',
  connectionFailed: (error: string) => `Couldn't reach Mollie: ${error} Trying again in 5 minutes.`,
  noMethods: 'None. Turn on payment methods in your Mollie dashboard: Settings → Website profiles → Payment methods.',
};
