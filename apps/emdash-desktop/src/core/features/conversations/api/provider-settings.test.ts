import { describe, expect, it } from 'vitest';
import { providerPreferencePatchSchema } from './provider-settings';

describe('provider preference patches', () => {
  it.each([
    { transport: 'acp', options: { model: 'provider-default', 'native-fast': false } },
    { transport: 'pty', autoApprove: false },
  ])('accepts explicit selections for $transport', (patch) => {
    expect(providerPreferencePatchSchema.parse(patch)).toEqual(patch);
  });

  it.each([
    { transport: 'acp', autoApprove: true },
    { transport: 'acp', options: {}, autoApprove: false },
    { transport: 'pty', options: { model: 'astra' } },
    { transport: 'pty', autoApprove: false, options: {} },
    { transport: 'acp' },
    { transport: 'pty' },
  ])('rejects invalid transport fields: %j', (patch) => {
    expect(providerPreferencePatchSchema.safeParse(patch).success).toBe(false);
  });
});
