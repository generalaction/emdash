import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import type { Task } from '@shared/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import { conversationRegistry } from './conversation-registry';
import type { TaskStore } from './task-store';
import { WorkspaceViewModel } from './workspace-view-model';

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: () => () => {} },
  rpc: {
    ssh: {
      getConnections: async () => [],
      getConnectionState: async () => ({}),
      getHealthStates: async () => ({}),
    },
  },
}));

type HydrationHarness = {
  openConversationIds: string[];
  syncConversationHydration(openIds: string[]): void;
};

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task 1',
    kind: 'task',
    status: 'todo',
    sourceBranch: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    isPinned: false,
    prs: [],
    conversations: {},
    workspaceId: 'workspace-1',
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: 'Conversation 1',
    lastInteractedAt: null,
    isInitialConversation: false,
    ...overrides,
  };
}

function makeViewModel(): WorkspaceViewModel {
  return new WorkspaceViewModel({ data: makeTask() } as unknown as TaskStore);
}

function asHydrationHarness(viewModel: WorkspaceViewModel): HydrationHarness {
  return viewModel as unknown as HydrationHarness;
}

afterEach(() => {
  conversationRegistry.release('task-1');
});

describe('WorkspaceViewModel.setSidebarTab', () => {
  it('ignores changes and files tabs for chat tasks', () => {
    const viewModel = new WorkspaceViewModel({
      data: makeTask({ kind: 'chat' }),
      state: 'unprovisioned',
      phase: 'provision',
    } as unknown as TaskStore);

    viewModel.setSidebarTab('changes');
    expect(viewModel.sidebarTab).toBe('conversations');

    viewModel.setSidebarTab('files');
    expect(viewModel.sidebarTab).toBe('conversations');

    viewModel.setSidebarTab('conversations');
    expect(viewModel.sidebarTab).toBe('conversations');
  });
});

describe('WorkspaceViewModel terminal drawer snapshot', () => {
  it('persists and restores the active terminal drawer item', () => {
    const source = makeViewModel();
    source.setTerminalDrawerActiveItem({ kind: 'script', id: 'script-lifecycle-run' });

    const restored = makeViewModel();
    restored.restoreSnapshot(source.snapshot);

    expect(restored.terminalDrawerActiveItem).toEqual({
      kind: 'script',
      id: 'script-lifecycle-run',
    });

    source.dispose();
    restored.dispose();
  });
});

describe('WorkspaceViewModel conversation hydration', () => {
  it('hydrates an opened conversation exactly once', async () => {
    const viewModel = makeViewModel();
    const conversations = conversationRegistry.acquire('task-1', 'project-1', [makeConversation()]);
    const hydrateConversation = vi.spyOn(conversations, 'hydrateConversation').mockResolvedValue();
    vi.spyOn(conversations, 'dehydrateConversation').mockResolvedValue();

    viewModel.tabManager.openConversation('conversation-1');
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );

    expect(hydrateConversation).toHaveBeenCalledTimes(1);
    expect(hydrateConversation).toHaveBeenCalledWith('conversation-1');

    await Promise.resolve();
    viewModel.dispose();
  });

  it('dehydrates the last closed conversation and preview replacement', async () => {
    const viewModel = makeViewModel();
    const conversations = conversationRegistry.acquire('task-1', 'project-1', [
      makeConversation({ id: 'conversation-1', title: 'Conversation 1' }),
      makeConversation({ id: 'conversation-2', title: 'Conversation 2' }),
    ]);
    vi.spyOn(conversations, 'hydrateConversation').mockResolvedValue();
    const dehydrateConversation = vi
      .spyOn(conversations, 'dehydrateConversation')
      .mockResolvedValue();

    viewModel.tabGroupManager.openConversationPreview('conversation-1');
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );
    await Promise.resolve();

    viewModel.tabGroupManager.openConversationPreview('conversation-2');
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );
    await Promise.resolve();

    expect(dehydrateConversation).toHaveBeenCalledTimes(1);
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-1');

    viewModel.tabManager.closeTab(viewModel.tabManager.resolvedActiveTabId!);
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );

    expect(dehydrateConversation).toHaveBeenCalledTimes(2);
    expect(dehydrateConversation).toHaveBeenLastCalledWith('conversation-2');

    viewModel.dispose();
  });

  it('keeps a conversation hydrated while it remains open in another pane', async () => {
    const viewModel = makeViewModel();
    const conversations = conversationRegistry.acquire('task-1', 'project-1', [makeConversation()]);
    const hydrateConversation = vi.spyOn(conversations, 'hydrateConversation').mockResolvedValue();
    const dehydrateConversation = vi
      .spyOn(conversations, 'dehydrateConversation')
      .mockResolvedValue();

    viewModel.restoreSnapshot({
      tabGroups: {
        activeGroupId: 'group-1',
        paneSizes: [50, 50],
        groups: [
          {
            groupId: 'group-1',
            tabManager: {
              activeTabId: 'tab-1',
              tabs: [
                {
                  kind: 'conversation',
                  tabId: 'tab-1',
                  conversationId: 'conversation-1',
                  isPreview: false,
                },
              ],
            },
          },
          {
            groupId: 'group-2',
            tabManager: {
              activeTabId: 'tab-2',
              tabs: [
                {
                  kind: 'conversation',
                  tabId: 'tab-2',
                  conversationId: 'conversation-1',
                  isPreview: false,
                },
              ],
            },
          },
        ],
      },
    } as TaskViewSnapshot);

    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );
    await Promise.resolve();

    expect(hydrateConversation).toHaveBeenCalledTimes(1);

    const [firstGroup, secondGroup] = viewModel.tabGroupManager.groups;
    firstGroup.tabManager.closeTab('tab-1');
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );

    expect(dehydrateConversation).not.toHaveBeenCalled();

    secondGroup.tabManager.closeTab('tab-2');
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );

    expect(dehydrateConversation).toHaveBeenCalledTimes(1);
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-1');

    viewModel.dispose();
  });

  it('dehydrates all hydrated conversations on suspend', async () => {
    const viewModel = makeViewModel();
    const conversations = conversationRegistry.acquire('task-1', 'project-1', [
      makeConversation({ id: 'conversation-1', title: 'Conversation 1' }),
      makeConversation({ id: 'conversation-2', title: 'Conversation 2' }),
    ]);
    vi.spyOn(conversations, 'hydrateConversation').mockResolvedValue();
    const dehydrateConversation = vi
      .spyOn(conversations, 'dehydrateConversation')
      .mockResolvedValue();

    viewModel.tabManager.openConversation('conversation-1');
    viewModel.tabManager.openConversation('conversation-2');
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );
    await Promise.resolve();

    viewModel.suspend();

    expect(dehydrateConversation).toHaveBeenCalledTimes(2);
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-1');
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-2');

    viewModel.dispose();
  });

  it('dehydrates a stale conversation when its hydrate finishes after the tab closed', async () => {
    const viewModel = makeViewModel();
    const conversations = conversationRegistry.acquire('task-1', 'project-1', [makeConversation()]);
    const hydrate = deferred();
    vi.spyOn(conversations, 'hydrateConversation').mockReturnValue(hydrate.promise);
    const dehydrateConversation = vi
      .spyOn(conversations, 'dehydrateConversation')
      .mockResolvedValue();

    viewModel.tabManager.openConversation('conversation-1');
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );

    viewModel.tabManager.closeTab(viewModel.tabManager.resolvedActiveTabId!);
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );

    expect(dehydrateConversation).not.toHaveBeenCalled();

    hydrate.resolve();
    await hydrate.promise;
    await Promise.resolve();

    expect(dehydrateConversation).toHaveBeenCalledTimes(1);
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-1');

    viewModel.dispose();
  });

  it('does not mark failed hydrations as hydrated and can retry', async () => {
    const viewModel = makeViewModel();
    const conversations = conversationRegistry.acquire('task-1', 'project-1', [makeConversation()]);
    const hydrateConversation = vi
      .spyOn(conversations, 'hydrateConversation')
      .mockRejectedValueOnce(new Error('hydrate failed'))
      .mockResolvedValueOnce(undefined);
    const dehydrateConversation = vi
      .spyOn(conversations, 'dehydrateConversation')
      .mockResolvedValue();

    viewModel.tabManager.openConversation('conversation-1');
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );
    await Promise.resolve();

    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );
    await Promise.resolve();

    expect(hydrateConversation).toHaveBeenCalledTimes(2);

    viewModel.tabManager.closeTab(viewModel.tabManager.resolvedActiveTabId!);
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );

    expect(dehydrateConversation).toHaveBeenCalledTimes(1);
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-1');

    viewModel.dispose();
  });
});
