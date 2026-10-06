import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { UsageOverview } from '../api/schemas';
import { UsageOverviewView } from './usage-overview-view';

describe('Usage settings', () => {
  it('renders remaining limits, unknown values, stale provenance and refresh controls', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const refresh = vi.fn();
    const overview: UsageOverview = {
      machines: [],
      accounts: [
        {
          key: 'account',
          providerId: 'claude',
          account: { email: 'one@example.com', plan: 'pro' },
          sources: [
            { machineId: 'laptop', machineName: 'Laptop', status: 'ready', refreshing: false },
            {
              machineId: 'server',
              machineName: 'Server',
              status: 'disconnected',
              refreshing: false,
            },
          ],
          windows: [
            {
              id: 'five_hour',
              label: '5-hour',
              usedPercent: 75,
              resetsAt: Date.now() + 100000,
              observedAt: Date.now(),
              sourceName: 'Laptop',
              stale: false,
            },
            {
              id: 'weekly',
              label: 'Weekly',
              usedPercent: null,
              resetsAt: null,
              observedAt: Date.now() - 600000,
              sourceName: 'Server',
              stale: true,
            },
          ],
        },
      ],
    };
    try {
      await act(async () =>
        root.render(
          <UsageOverviewView
            overview={overview}
            loading={false}
            refreshing={false}
            onRefresh={refresh}
            onMachines={() => {}}
          />
        )
      );
      expect(host.textContent).toContain('25% remaining');
      expect(host.textContent).toContain('Unknown');
      expect(host.textContent).toContain('Stale');
      expect(host.textContent).toContain('Server · Offline');
      const meters = host.querySelectorAll('[role="meter"]');
      expect(meters.length).toBe(1);
      expect(meters[0]?.getAttribute('aria-valuenow')).toBe('25');
      const button = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Refresh usage'
      );
      await act(async () => button?.click());
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
