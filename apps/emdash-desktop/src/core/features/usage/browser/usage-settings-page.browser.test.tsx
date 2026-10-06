import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { UsageOverview } from '../api/schemas';
import { UsageOverviewView } from './usage-overview-view';

vi.mock('@core/features/agents/contributions/browser/agent-icon', () => ({
  AgentIcon: () => null,
}));

describe('Usage settings', () => {
  it('groups limits in subscription cards with visible identities and a refresh action', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const refresh = vi.fn();
    const overview: UsageOverview = {
      machines: [{ id: 'preparing', name: 'Preparing remote', status: 'checking', providers: [] }],
      accounts: [
        {
          key: 'account',
          providerId: 'claude',
          account: { email: 'one@example.com', plan: 'Claude Max', organization: 'Design team' },
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
            {
              id: 'weekly_fable',
              label: 'Weekly · Fable',
              usedPercent: 40,
              resetsAt: Date.now() + 100000,
              observedAt: Date.now(),
              sourceName: 'Laptop',
              stale: false,
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
        account: { email: 'codex@example.com', plan: 'ChatGPT Pro' },
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
          />
        )
      );
      expect([...host.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
        'Codex Pro (codex@example.com)',
        'Claude Max (Design team)',
        'Claude Max (two@example.com)',
      ]);
      const cards = host.querySelectorAll('[data-slot="settings-card"]');
      expect(cards).toHaveLength(3);
      expect(cards[1]?.querySelector('h3')?.textContent).toBe('Claude Max (Design team)');
      expect(cards[1]?.textContent).toContain('Session');
      expect(cards[1]?.textContent).toContain('Weekly');
      expect(cards[1]?.textContent).toContain('Weekly · Fable');
      expect(cards[1]?.querySelectorAll('[role="meter"]')).toHaveLength(2);
      expect(host.textContent).toContain('25%');
      expect(host.textContent).toContain('86%');
      expect(host.textContent).toContain('Usage unavailable');
      expect(host.textContent).toContain('Reset time unavailable');
      expect(host.textContent).toContain('Stale');
      expect(host.textContent).not.toContain('one@example.com');
      expect(host.textContent).not.toContain('Laptop');
      expect(host.textContent).not.toContain('Manage machines');
      expect(host.querySelector('[aria-haspopup="dialog"]')).toBeNull();
      const meters = host.querySelectorAll('[role="meter"]');
      expect([...meters].map((meter) => meter.getAttribute('aria-valuenow'))).toEqual([
        '95',
        '25',
        '60',
        '86',
      ]);
      const button = [...host.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === 'Refresh usage'
      );
      expect(button?.disabled).toBe(false);
      expect(button?.textContent).toContain('Refresh');
      expect(button?.textContent).not.toContain('Refreshing');
      await act(async () => button?.click());
      expect(refresh).toHaveBeenCalledOnce();
      await act(async () =>
        root.render(
          <UsageOverviewView overview={overview} loading={false} refreshing onRefresh={refresh} />
        )
      );
      expect(button?.disabled).toBe(true);
      expect(button?.textContent).toContain('Refreshing');
      await act(async () => button?.click());
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps unidentified subscriptions separate and numbers duplicate headings', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <UsageOverviewView
            overview={{
              machines: [],
              accounts: ['one', 'two'].map((key) => ({
                key,
                providerId: 'claude',
                account: {},
                sources: [],
                windows: [],
              })),
            }}
            loading={false}
            refreshing={false}
            onRefresh={() => {}}
          />
        )
      );
      expect([...host.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
        'Claude',
        'Claude (2)',
      ]);
      expect(host.querySelectorAll('[data-slot="settings-card"]')).toHaveLength(2);
      expect(host.querySelectorAll('[role="meter"]')).toHaveLength(0);
      expect(host.textContent).toContain('Subscription limits are unavailable.');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
