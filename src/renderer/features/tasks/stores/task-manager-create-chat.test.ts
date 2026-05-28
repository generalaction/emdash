import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { TaskManagerStore } from './task-manager';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  provisionTask: vi.fn(),
  getTasks: vi.fn().mockResolvedValue([]),
  mountProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: () => () => {} },
  rpc: {
    tasks: {
      createTask: mocks.createTask,
      provisionTask: mocks.provisionTask,
      getTasks: mocks.getTasks,
    },
    pullRequests: {
      getPullRequestsForTask: vi.fn().mockResolvedValue({ success: true, data: { prs: [] } }),
    },
    workspaces: {
      resolveBootstrap: vi.fn(),
    },
  },
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: () => ({
    mountProject: mocks.mountProject,
  }),
}));

vi.mock('@renderer/lib/stores/view-state-cache', () => ({
  viewStateCache: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./conversation-registry', () => ({
  conversationRegistry: { acquire: vi.fn(), release: vi.fn(), get: vi.fn() },
}));

vi.mock('./terminal-registry', () => ({
  terminalRegistry: { acquire: vi.fn(), release: vi.fn() },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    sshConnections: { start: vi.fn() },
    navigation: { navigate: vi.fn() },
  },
}));

function makeRepository(): RepositoryStore {
  return {
    defaultBranch: { type: 'local', branch: 'main' },
    currentBranch: 'main',
    pullRequestRepositoryUrl: null,
  } as unknown as RepositoryStore;
}

function makeSettings(): ProjectSettingsStore {
  return {
    pageData: { invalidate: vi.fn() },
  } as unknown as ProjectSettingsStore;
}

describe('TaskManagerStore.createChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTask.mockResolvedValue({
      success: true,
      data: {
        task: {
          id: '00000000-0000-4000-8000-0000000000c1',
          projectId: 'project-1',
          name: 'chat-may-27',
          kind: 'chat',
          status: 'in_progress',
          sourceBranch: { type: 'local', branch: 'main' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          statusChangedAt: '2026-01-01T00:00:00.000Z',
          isPinned: false,
          prs: [],
          conversations: {},
          workspaceId: 'ws-1',
        },
      },
    });
    mocks.provisionTask.mockResolvedValue({
      path: '/repo',
      workspaceId: 'ws-1',
    });
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-0000000000c1'
    );
  });

  it('calls rpc.tasks.createTask with kind chat and no-worktree strategy', async () => {
    const store = new TaskManagerStore('project-1', makeRepository(), makeSettings(), 'main');
    vi.spyOn(store, 'provisionTask').mockResolvedValue(undefined);
    const id = store.createChat();

    expect(id).toBe('00000000-0000-4000-8000-0000000000c1');
    await vi.waitFor(() => {
      expect(mocks.createTask).toHaveBeenCalled();
    });
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '00000000-0000-4000-8000-0000000000c1',
        projectId: 'project-1',
        kind: 'chat',
        strategy: { kind: 'no-worktree' },
        sourceBranch: { type: 'local', branch: 'main' },
      })
    );
  });

  it('adds an unregistered task before rpc resolves', async () => {
    let resolveCreate!: (value: unknown) => void;
    mocks.createTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        })
    );

    const store = new TaskManagerStore('project-1', makeRepository(), makeSettings(), 'main');
    vi.spyOn(store, 'provisionTask').mockResolvedValue(undefined);
    store.createChat();

    expect(store.tasks.has('00000000-0000-4000-8000-0000000000c1')).toBe(true);
    expect(store.tasks.get('00000000-0000-4000-8000-0000000000c1')?.state).toBe('unregistered');

    resolveCreate({
      success: true,
      data: {
        task: {
          id: '00000000-0000-4000-8000-0000000000c1',
          projectId: 'project-1',
          name: 'chat-may-27',
          kind: 'chat',
          status: 'in_progress',
          sourceBranch: { type: 'local', branch: 'main' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          statusChangedAt: '2026-01-01T00:00:00.000Z',
          isPinned: false,
          prs: [],
          conversations: {},
          workspaceId: 'ws-1',
        },
      },
    });

    await vi.waitFor(() => {
      expect(mocks.createTask).toHaveBeenCalled();
    });
  });
});
