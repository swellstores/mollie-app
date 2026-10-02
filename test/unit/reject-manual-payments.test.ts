import { describe, it, expect } from 'vitest';
import { createMockRequest } from '../helpers/mock-request';
import handler, { config, MANUAL_PAYMENT_NOTE } from '../../functions/reject-manual-payments';

describe('reject-manual-payments', () => {
  it('runs before a Mollie payment record is created', () => {
    expect(config.model?.events).toEqual(['before:mollie-payment.created']);
  });

  it('leaves records created by the app unchanged', async () => {
    await expect(handler(createMockRequest({ data: { mollie_id: 'tr_1', source: 'checkout' } }))).resolves.toBeUndefined();
  });

  it.each([{ mollie_id: 'tr_1' }, { mollie_id: 'made up', source: 'dashboard' }])(
    'marks records added by hand as not paid %j',
    async (data) => {
      await expect(handler(createMockRequest({ data }))).resolves.toEqual({
        resolution: 'abandoned',
        reason: 'Added by hand',
        note: MANUAL_PAYMENT_NOTE,
      });
    },
  );
});
