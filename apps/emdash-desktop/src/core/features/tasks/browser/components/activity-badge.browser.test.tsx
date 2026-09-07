import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLifecycleStepInfo } from '@core/primitives/tasks/api';
import { ActivityBadgeView } from './activity-badge';

// The Activity badge's presentational seam (spec: workspace-lifecycle-v2, Activity
// badge): lifecycle steps from a record fixture go in; badge state, ordered rows
// with derived copy, conditional visibility, and click-through callbacks come out.

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0);

function step(
  id: WorkspaceLifecycleStepInfo['id'],
  status: WorkspaceLifecycleStepInfo['status'],
  overrides: Partial<WorkspaceLifecycleStepInfo> = {}
): WorkspaceLifecycleStepInfo {
  return {
    id,
    status,
    startedAt: NOW - 10 * 60_000,
    finishedAt: status === 'succeeded' || status === 'failed' ? NOW - 5 * 60_000 : null,
    params: {},
    ...overrides,
  };
}

describe('ActivityBadgeView', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render(
    steps: WorkspaceLifecycleStepInfo[],
    handlers: {
      onOpenScript?: (script: string) => void;
      onRetryPush?: () => void;
      onRetryScript?: (script: string) => void;
    } = {}
  ) {
    await act(async () => {
      root.render(
        <ActivityBadgeView
          steps={steps}
          onOpenScript={handlers.onOpenScript ?? (() => {})}
          onRetryPush={handlers.onRetryPush ?? (() => {})}
          onRetryScript={handlers.onRetryScript ?? (() => {})}
          now={NOW}
        />
      );
    });
  }

  function badge(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('[aria-label="Workspace activity"]');
  }

  async function openPopover(): Promise<void> {
    // The popover survives re-renders; clicking an open trigger would toggle it closed.
    if (rows().length === 0) await act(async () => badge()!.click());
  }

  function rows(): HTMLElement[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>('[data-step]'));
  }

  it('renders nothing when there are no steps to show', async () => {
    await render([]);
    expect(badge()).toBeNull();
    // fetch-refs is durable but never displayed; skipped steps are hidden too.
    await render([step('fetch-refs', 'pending'), step('copy-artifacts', 'skipped')]);
    expect(badge()).toBeNull();
  });

  it('shows a spinner while any step runs and error emphasis once one failed', async () => {
    await render([
      step('create-worktree', 'succeeded'),
      step('copy-artifacts', 'running', { finishedAt: null }),
    ]);
    expect(badge()!.dataset.activityState).toBe('running');

    await render([
      step('create-worktree', 'succeeded'),
      step('push-branch', 'failed', { message: 'no upstream' }),
    ]);
    expect(badge()!.dataset.activityState).toBe('failed');
    expect(badge()!.className).toContain('destructive');

    // Everything settled: quiet badge, still reachable.
    await render([step('create-worktree', 'succeeded')]);
    expect(badge()!.dataset.activityState).toBe('settled');
    expect(badge()!.className).not.toContain('destructive');
  });

  it('lists steps in order with derived copy, relative dates, and a started time for run', async () => {
    await render([
      step('fetch-remote-base', 'succeeded', { params: { base: 'origin/main' } }),
      step('create-worktree', 'succeeded', {
        params: { path: '/tmp/wt', branch: 'feature/x', branchCreated: true },
      }),
      step('copy-artifacts', 'succeeded', { params: { fileCount: 3 } }),
      step('fetch-refs', 'succeeded'),
      step('run', 'running', { startedAt: NOW - 60_000, finishedAt: null }),
    ]);
    await openPopover();

    const visible = rows();
    expect(visible.map((row) => row.dataset.step)).toEqual([
      'fetch-remote-base',
      'create-worktree',
      'copy-artifacts',
      'run',
    ]);
    expect(visible[0]!.textContent).toContain('Fetch remote base origin/main');
    expect(visible[0]!.textContent).toContain('5m ago');
    expect(visible[1]!.textContent).toContain(
      'Adding worktree at /tmp/wt using newly created branch feature/x'
    );
    expect(visible[2]!.textContent).toContain('Copying 3 artifacts defined in preservePatterns');
    // Run shows its started time — it keeps running.
    expect(visible[3]!.textContent).toContain('Starting run scripts');
    expect(visible[3]!.textContent).toContain('1m ago');
  });

  it('describes an adopted worktree and an existing branch distinctly', async () => {
    await render([
      step('adopt-worktree', 'succeeded', { params: { branch: 'feature/x', path: '/tmp/wt' } }),
    ]);
    await openPopover();
    expect(rows()[0]!.textContent).toContain('Worktree with feature/x already exists at /tmp/wt');

    await render([
      step('create-worktree', 'succeeded', {
        params: { path: '/tmp/wt', branch: 'feature/x', branchCreated: false },
      }),
    ]);
    await openPopover();
    expect(rows()[0]!.textContent).toContain(
      'Adding worktree at /tmp/wt using existing branch feature/x'
    );
  });

  it('a failed push-branch row exposes its message and a retry action', async () => {
    const onRetryPush = vi.fn();
    await render(
      [
        step('push-branch', 'failed', {
          message: 'remote rejected',
          params: { branch: 'feature/x', remote: 'fork' },
        }),
      ],
      { onRetryPush }
    );
    await openPopover();

    const row = rows()[0]!;
    expect(row.textContent).toContain('Pushing feature/x to fork');
    expect(row.textContent).toContain('remote rejected');
    const retry = Array.from(row.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Retry')
    );
    await act(async () => retry!.click());
    expect(onRetryPush).toHaveBeenCalledTimes(1);
  });

  it('clicking a script step drives the drawer click-through callback', async () => {
    const onOpenScript = vi.fn();
    await render(
      [
        step('prepare', 'succeeded'),
        step('setup', 'failed', { message: 'exit 1' }),
        step('run', 'pending', { startedAt: null }),
      ],
      { onOpenScript }
    );
    await openPopover();

    const setupRow = rows().find((row) => row.dataset.step === 'setup')!;
    const open = setupRow.querySelector<HTMLButtonElement>('button[title="Open script output"]')!;
    await act(async () => open.click());
    expect(onOpenScript).toHaveBeenCalledWith('setup');
  });

  it('a failed script step exposes a retry action that starts a fresh manual run', async () => {
    const onRetryScript = vi.fn();
    await render([step('prepare', 'succeeded'), step('setup', 'failed', { message: 'exit 1' })], {
      onRetryScript,
    });
    await openPopover();

    // Succeeded script rows stay retry-free; only the failure gets the affordance.
    const prepareRow = rows().find((row) => row.dataset.step === 'prepare')!;
    expect(prepareRow.textContent).not.toContain('Retry');

    const setupRow = rows().find((row) => row.dataset.step === 'setup')!;
    const retry = Array.from(setupRow.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Retry')
    );
    await act(async () => retry!.click());
    expect(onRetryScript).toHaveBeenCalledWith('setup');
  });
});
