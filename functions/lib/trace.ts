// TEMPORARY diagnostic trace (version 1.0.5): records which payment functions Swell calls during
// checkout, in what order and with what amounts. Remove before release.

const MAX_ENTRIES = 30;

export async function trace(req: SwellRequest, entry: Record<string, unknown>): Promise<void> {
  try {
    const path = `/settings/${req.appId}`;
    const current = (await req.swell.get(path)) as { debug?: { trace?: unknown[] } } | null;
    const entries = Array.isArray(current?.debug?.trace) ? current!.debug!.trace! : [];
    const data = (req.data ?? {}) as Record<string, unknown>;
    entries.push({
      at: new Date(Date.now()).toISOString(),
      data_keys: Object.keys(data).filter((key) => key !== '$event').sort().join(','),
      hook: (data.$event as { hook?: string; type?: string } | undefined)?.hook,
      event: (data.$event as { type?: string } | undefined)?.type,
      ...entry,
    });
    await req.swell.put(path, { debug: { trace: entries.slice(-MAX_ENTRIES) } });
  } catch {
    // Diagnostics must never affect payments.
  }
}
