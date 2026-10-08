import { createScope, type Scope } from '@emdash/shared/concurrency';
import { waitFor } from '@emdash/shared/testing';
import { cell, observe, peek, remote } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import { usageContract } from '../api/contract';
import type { UsageOverview } from '../api/schemas';
import { createUsageWireController } from './wire-controller';

describe('Usage Wire overview', () => {
  it('exposes updates, delegates refresh and releases demand when the view closes', async () => {
    const scope = createScope({ label: 'usage-controller-test' });
    const value = cell<UsageOverview>({ accounts: [], machines: [] });
    const release = vi.fn();
    const usage = {
      observe: vi.fn((owner: Scope) => {
        owner.add(release);
        return value;
      }),
      refresh: vi.fn(async () => {}),
    };
    const wire = createTestWire(usageContract, createUsageWireController({ scope, usage }));
    const view = scope.child('view');
    const model = remote(usageContract.overview, wire.client.overview, { scope: view });
    const overview = model(undefined).states.current;
    observe(overview, () => {}, { scope: view });
    try {
      await waitFor(() => peek(overview) !== undefined);
      expect(usage.observe).toHaveBeenCalledTimes(1);
      value.set({ accounts: [], machines: [], error: 'Discovery failed' });
      await waitFor(() => peek(overview)?.error === 'Discovery failed');
      await wire.client.refresh();
      expect(usage.refresh).toHaveBeenCalledTimes(1);

      await view.dispose();
      await waitFor(() => release.mock.calls.length === 1);
    } finally {
      await scope.dispose();
      await wire.dispose();
    }
  });
});
