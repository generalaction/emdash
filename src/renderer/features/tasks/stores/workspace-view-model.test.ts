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

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task 1',
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
  it('hydrates an opened conversation exactly once', () => {
    const viewModel = makeViewModel();
    const conversations = conversationRegistry.acquire('task-1', 'project-1', [makeConversation()]);
    const hydrateConversation = vi.spyOn(conversations, 'hydrateConversation').mockResolvedValue();

    viewModel.tabManager.openConversation('conversation-1');
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );

    expect(hydrateConversation).toHaveBeenCalledTimes(1);
    expect(hydrateConversation).toHaveBeenCalledWith('conversation-1');

    viewModel.dispose();
  });

  it('dehydrates the last closed conversation and preview replacement', () => {
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
    viewModel.tabGroupManager.openConversationPreview('conversation-2');
    asHydrationHarness(viewModel).syncConversationHydration(
      asHydrationHarness(viewModel).openConversationIds
    );

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

  it('keeps a conversation hydrated while it remains open in another pane', () => {
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

  it('dehydrates all hydrated conversations on suspend', () => {
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

    viewModel.suspend();

    expect(dehydrateConversation).toHaveBeenCalledTimes(2);
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-1');
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-2');

    viewModel.dispose();
  });
});
