import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { UsageOverview } from '../api/schemas';
import { UsageOverviewView } from './usage-overview-view';

vi.mock('@core/features/agents/contributions/browser/agent-icon', () => ({
  AgentIcon: () => null,
}));

describe('Usage settings', () => {
  it('shows separate numbered subscriptions and puts account details in the popover', async () => {
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
    const first = overview.accounts[0]!;
    overview.accounts.push(
      {
        ...first,
        key: 'second-claude',
        account: { email: 'two@example.com', plan: 'Max' },
        windows: [{ ...first.windows[0]!, usedPercent: 14 }],
      },
      {
        ...first,
        key: 'codex',
        providerId: 'codex',
        account: { email: 'codex@example.com', plan: 'Pro' },
        windows: [{ ...first.windows[0]!, id: 'weekly', label: 'Weekly', usedPercent: 5 }],
      }
    );
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
      expect([...host.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
        'Codex',
        'Claude',
        'Claude (2)',
      ]);
      expect(host.textContent).toContain('25%');
      expect(host.textContent).toContain('86%');
      expect(host.textContent).toContain('unknown');
      expect(host.textContent).toContain('Stale');
      expect(host.textContent).not.toContain('one@example.com');
      expect(host.textContent).not.toContain('Laptop');
      const meters = host.querySelectorAll('[role="meter"]');
      expect([...meters].map((meter) => meter.getAttribute('aria-valuenow'))).toEqual([
        '95',
        '25',
        '86',
      ]);
      const button = [...host.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === 'Refresh usage'
      );
      await act(async () => button?.click());
      expect(refresh).toHaveBeenCalledOnce();
      const details = host.querySelector<HTMLElement>(
        '[aria-label="Claude Session: 25% left. Account details"]'
      );
      expect(details).not.toBeNull();
      await act(async () => details?.click());
      expect(document.body.textContent).toContain('one@example.com');
      expect(document.body.textContent).toContain('Laptop, Server (offline)');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
