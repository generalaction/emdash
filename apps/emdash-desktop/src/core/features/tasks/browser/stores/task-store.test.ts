import { describe, expect, it, vi } from 'vitest';
import type { Task } from '@core/primitives/tasks/api';
import { createUnprovisionedTask } from './task-store';

vi.mock('@core/manifests/browser/task-scoped-stores', () => ({
  taskStoreContributions: [],
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task 1',
    status: 'todo',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    isPinned: false,
    prs: [],
    conversations: {},
    workspaceId: 'workspace-1',
    type: 'task',
    ...overrides,
  };
}

describe('TaskStore provision state', () => {
  it('records and clears workspace handoff data without owning workspace stores', () => {
    const task = makeTask();
    const store = createUnprovisionedTask(task);

    store.transitionToProvisioned(task, '/tmp/workspace-1', 'workspace-1', 'ssh-1');
    expect(store.state).toBe('provisioned');
    expect(store.workspaceId).toBe('workspace-1');
    expect(store.workspacePath).toBe('/tmp/workspace-1');
    expect(store.workspaceSshConnectionId).toBe('ssh-1');

    store.transitionToUnprovisioned(task);
    expect(store.state).toBe('unprovisioned');
    expect(store.workspaceId).toBeNull();
    expect(store.workspacePath).toBeNull();
    expect(store.workspaceSshConnectionId).toBeUndefined();
  });

  it('disposes contributed stores exactly once', () => {
    const dispose = vi.fn();
    const store = createUnprovisionedTask(makeTask());
    (store as unknown as { stores: { dispose(): void } }).stores = { dispose };

    store.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
