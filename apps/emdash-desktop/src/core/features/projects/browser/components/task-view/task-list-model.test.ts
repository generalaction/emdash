import { observable, runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStatus } from '@core/primitives/agents/api';
import { createTaskListView, type ReadyTask, type TaskListTab } from './task-list-model';

const agentStatuses = new Map<string, AgentStatus>();

vi.mock('@core/features/conversations/api/browser/conversation-selectors', () => ({
  taskAgentStatus: (task: ReadyTask) => agentStatuses.get(task.data.id) ?? null,
}));

type PrFixture = { status: string; isDraft: boolean; createdAt: string };

function task(overrides: {
  id: string;
  name?: string;
  archivedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  lastInteractedAt?: string;
  prs?: PrFixture[];
}): ReadyTask {
  return {
    state: 'provisioned',
    data: {
      id: overrides.id,
      name: overrides.name ?? overrides.id,
      archivedAt: overrides.archivedAt,
      createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
      updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00Z',
      lastInteractedAt: overrides.lastInteractedAt,
      prs: overrides.prs ?? [],
      type: 'task',
    },
  } as unknown as ReadyTask;
}

const selection = {
  selectedIds: new Set<string>(),
  count: 0,
  isSelected: () => false,
  toggle: () => {},
  selectRange: () => {},
  selectAll: () => {},
  clear: () => {},
};

function createView(tasks: ReadyTask[], options?: { tab?: TaskListTab; sortBy?: string }) {
  const box = observable.box(tasks, { deep: false });
  const view = createTaskListView({
    getTasks: () => box.get(),
    initialTab: options?.tab ?? 'active',
    initialSortBy: (options?.sortBy ?? 'updated-at') as 'updated-at',
    selection,
  });
  return { view, box };
}

function visibleIds(view: ReturnType<typeof createView>['view']) {
  return view.store.visibleItems.map((task) => task.data.id);
}

beforeEach(() => {
  agentStatuses.clear();
});

describe('createTaskListView', () => {
  it('shows only the current tab and switches with the filter model', () => {
    const { view } = createView([
      task({ id: 'a' }),
      task({ id: 'b', archivedAt: '2026-02-01T00:00:00Z' }),
      task({ id: 'c' }),
    ]);

    expect(visibleIds(view)).toEqual(['a', 'c']);

    view.store.filter?.set({ tab: 'archived' });
    expect(visibleIds(view)).toEqual(['b']);
  });

  it('searches by task name', () => {
    const { view } = createView([
      task({ id: 'a', name: 'Fix login bug' }),
      task({ id: 'b', name: 'Refactor sidebar' }),
    ]);

    view.store.search?.setQuery('sidebar');
    expect(visibleIds(view)).toEqual(['b']);
  });

  it('orders by recency with id tiebreak for the default sort', () => {
    const { view } = createView([
      task({ id: 'old', updatedAt: '2026-01-01T00:00:00Z' }),
      task({
        id: 'touched',
        updatedAt: '2026-01-01T00:00:00Z',
        lastInteractedAt: '2026-03-01T00:00:00Z',
      }),
      task({ id: 'new', updatedAt: '2026-02-01T00:00:00Z' }),
      task({ id: 'also-old', updatedAt: '2026-01-01T00:00:00Z' }),
    ]);

    expect(visibleIds(view)).toEqual(['touched', 'new', 'also-old', 'old']);
  });

  it('orders newest-created first for the created-at sort', () => {
    const { view } = createView(
      [
        task({ id: 'a', createdAt: '2026-01-01T00:00:00Z' }),
        task({ id: 'b', createdAt: '2026-03-01T00:00:00Z' }),
        task({ id: 'c', createdAt: '2026-02-01T00:00:00Z' }),
      ],
      { sortBy: 'created-at' }
    );

    expect(visibleIds(view)).toEqual(['b', 'c', 'a']);
  });

  it('ranks merged, open, closed, draft, then no PR for the pr-status sort', () => {
    const pr = (status: string, isDraft = false): PrFixture[] => [
      { status, isDraft, createdAt: '2026-01-01T00:00:00Z' },
    ];
    const { view } = createView(
      [
        task({ id: 'none' }),
        task({ id: 'draft', prs: pr('open', true) }),
        task({ id: 'closed', prs: pr('closed') }),
        task({ id: 'open', prs: pr('open') }),
        task({ id: 'merged', prs: pr('merged') }),
      ],
      { sortBy: 'pr-status' }
    );

    expect(visibleIds(view)).toEqual(['merged', 'open', 'closed', 'draft', 'none']);
  });

  it('puts tasks needing attention first for the unread sort', () => {
    agentStatuses.set('waiting', 'awaiting-input');
    agentStatuses.set('running', 'working');
    const { view } = createView(
      [task({ id: 'plain' }), task({ id: 'waiting' }), task({ id: 'running' })],
      { sortBy: 'unread' }
    );

    expect(visibleIds(view)).toEqual(['waiting', 'plain', 'running']);
  });

  it('re-derives when the source getter changes', () => {
    const { view, box } = createView([task({ id: 'a' })]);

    expect(visibleIds(view)).toEqual(['a']);

    runInAction(() => box.set([task({ id: 'a' }), task({ id: 'b' })]));
    expect(visibleIds(view)).toEqual(['a', 'b']);
  });
});
