import {
  taskChromeMemento,
  taskDiffPreferencesMemento,
  taskDiffSelectionMemento,
  taskEditorTreeMemento,
  taskPaneLayoutMemento,
  taskTerminalSelectionMemento,
  type ActiveFile,
  type TabGroupsSnapshot,
  type TerminalDrawerActiveItem,
} from '@core/features/tasks/contributions/mementos';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import type { MementoDef } from '@core/primitives/mementos/api';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import type { Subject, SubjectDef } from '@core/primitives/subjects/api';
import { comparer, makeObservable, observable, reaction, runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { ConversationStore } from '@renderer/features/conversations/conversation-manager';
import { conversationRegistry } from '@renderer/features/conversations/stores/conversation-registry';
import { releaseConversationSessionManager } from '@renderer/features/conversations/stores/conversation-session-manager';
import type { Conversation } from '@shared/core/conversations/conversations';
import type { Task } from '@shared/core/tasks/tasks';
import type { Terminal } from '@shared/core/terminals/terminals';
import type { TerminalManagerStore, TerminalStore } from '../terminals/terminal-manager';
import type { TaskStore } from './task-store';
import { terminalRegistry } from './terminal-registry';
import { workspaceRegistry } from './workspace-registry';
import { sanitizeDiffSelection, WorkspaceViewModel } from './workspace-view-model';

const mementoMocks = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

vi.mock('@renderer/lib/mementos', () => ({
  getMementoClient: mementoMocks.getClient,
}));

vi.mock('@renderer/features/browser/browser-tab-item', () => ({
  BrowserTabBarItem: () => null,
  BrowserTabBarItemDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/editor/file-tab-item', () => ({
  FileTabBarItem: () => null,
  FileTabBarItemDragPreview: () => null,
}));
vi.mock('@renderer/features/conversations/conversation-tab-item', () => ({
  ConversationTabBarItem: () => null,
  ConversationTabBarItemDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/diff-view/diff-tab-item', () => ({
  DiffTabBarItem: () => null,
  DiffTabBarItemDragPreview: () => null,
  diffGroupSuffix: (group: string) => `(${group})`,
}));
vi.mock('@renderer/features/conversations/conversation-title-utils', () => ({
  formatConversationTitleForDisplay: (_providerId: unknown, title: unknown) =>
    (title as string) ?? 'Conversation',
}));

// ACP imports chat-ui which calls document.createElement at module load time.
// Stub out the entire chat-store chain to avoid the DOM dependency in node tests.
vi.mock('@renderer/features/conversations/acp/acp-chat-store', () => ({
  AcpChatStore: class {
    conversationId = '';
    dispose() {}
    bootstrap() {}
  },
}));
vi.mock('@renderer/features/conversations/acp/acp-chat-panel', () => ({
  AcpChatPanel: () => null,
}));

// Logger uses window.electronAPI which doesn't exist in the node test environment.
vi.mock('@renderer/utils/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: () => () => {} },
  rpc: {
    ssh: {
      getConnections: async () => [],
      getConnectionState: async () => ({}),
      getHealthStates: async () => ({}),
    },
    conversations: {
      markConversationSeen: vi.fn().mockResolvedValue(undefined),
    },
    repository: {
      resolveProvider: vi.fn().mockResolvedValue({ success: false }),
    },
  },
}));

class FakeMementoHandle<TValue> implements MementoHandle<TValue> {
  readonly ready = Promise.resolve();
  readonly isPending = false;
  hasStoredValue = false;
  private readonly cell;

  constructor(private readonly defaultValue: TValue) {
    this.cell = observable.box(defaultValue, { deep: false });
  }

  get value(): TValue {
    return this.cell.get();
  }

  read(): TValue {
    return this.value;
  }

  update(next: TValue | ((current: TValue) => TValue)): void {
    this.hasStoredValue = true;
    this.cell.set(
      typeof next === 'function' ? (next as (value: TValue) => TValue)(this.value) : next
    );
  }

  async reset(): Promise<void> {
    this.hasStoredValue = false;
    this.cell.set(this.defaultValue);
  }

  async flush(): Promise<void> {}

  autoPersist(read: () => TValue) {
    return reaction(read, (value) => this.update(value), { equals: comparer.structural });
  }

  async dispose(): Promise<void> {}
}

class FakeMementoClient {
  private readonly handles = new Map<string, unknown>();

  subject(subject: Subject) {
    return {
      subject,
      ready: Promise.resolve(),
      handle: <TValue>(definition: MementoDef<TValue, SubjectDef<string, z.ZodType>>) =>
        this.handle(subject, definition),
      release: async () => {},
    };
  }

  handle<TValue>(
    subject: Subject,
    definition: MementoDef<TValue, SubjectDef<string, z.ZodType>>
  ): FakeMementoHandle<TValue> {
    const key = `${subject.kind}:${subject.key}:${definition.id}`;
    let handle = this.handles.get(key) as FakeMementoHandle<TValue> | undefined;
    if (!handle) {
      handle = new FakeMementoHandle(definition.default);
      this.handles.set(key, handle);
    }
    return handle;
  }

  clear(): void {
    this.handles.clear();
  }

  reportError(): void {}
}

const fakeMementos = new FakeMementoClient();

type LegacyTaskViewState = {
  sidebarTab?: 'conversations' | 'changes' | 'files';
  isSidebarCollapsed?: boolean;
  focusedRegion?: 'main' | 'bottom';
  isTerminalDrawerOpen?: boolean;
  terminalDrawerActiveItem?: TerminalDrawerActiveItem;
  terminals?: { tabOrder: string[]; activeTabId?: string };
  editor?: { expandedPaths: string[] };
  diffView?: {
    diffStyle?: 'unified' | 'split';
    commitAction?: 'commit' | 'commit-push' | 'commit-pr' | null;
    prTab?: 'files' | 'commits' | 'checks';
    activeFile?: ActiveFile;
  };
  tabGroups?: TabGroupsSnapshot;
};

type FakeTerminalManager = TerminalManagerStore & {
  isLoaded: boolean;
  createDefaultTerminal: ReturnType<typeof vi.fn>;
};

class FakeTerminalManagerStore {
  terminals = observable.map<string, TerminalStore>();
  isLoaded: boolean;
  createDefaultTerminal = vi.fn().mockResolvedValue(undefined);
  dispose = vi.fn();

  constructor({ terminalIds, isLoaded }: { terminalIds: string[]; isLoaded: boolean }) {
    this.isLoaded = isLoaded;
    for (const id of terminalIds) {
      this.terminals.set(id, makeTerminal(id));
    }
    makeObservable(this, {
      terminals: observable,
      isLoaded: observable,
    });
  }
}

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

function addConversation(
  conversations: ReturnType<typeof conversationRegistry.acquire>,
  overrides: Partial<Conversation> = {}
): void {
  const conversation = makeConversation(overrides);
  conversations.conversations.set(conversation.id, new ConversationStore(conversation));
}

function conversationTabIds(viewModel: WorkspaceViewModel): string[] {
  return viewModel.activePane.resolvedTabs.flatMap((tab) => {
    if (tab.kind !== 'conversation') return [];
    // resource is ConversationTabResource which holds the store
    const id = (tab.resource as unknown as { store?: { data?: { id?: string } } })?.store?.data?.id;
    return id ? [id] : [];
  });
}

function makeViewModel(): WorkspaceViewModel {
  return new WorkspaceViewModel({ data: makeTask() } as unknown as TaskStore);
}

function makeProvisionedViewModel(): WorkspaceViewModel {
  return new WorkspaceViewModel({
    data: makeTask(),
    workspaceId: 'workspace-1',
  } as unknown as TaskStore);
}

function applyViewState(viewModel: WorkspaceViewModel, state: LegacyTaskViewState): void {
  const subject = taskSubject({ taskId: viewModel.taskId });
  fakeMementos.handle(subject, taskChromeMemento).update((current) => ({
    ...current,
    sidebarTab: state.sidebarTab ?? current.sidebarTab,
    sidebarCollapsed: state.isSidebarCollapsed ?? current.sidebarCollapsed,
    terminalDrawerOpen: state.isTerminalDrawerOpen ?? current.terminalDrawerOpen,
  }));
  if (state.terminals || state.terminalDrawerActiveItem) {
    fakeMementos.handle(subject, taskTerminalSelectionMemento).update((current) => ({
      ...current,
      activeItem: state.terminalDrawerActiveItem ?? current.activeItem,
      tabOrder: state.terminals?.tabOrder ?? current.tabOrder,
      activeTabId: state.terminals?.activeTabId ?? current.activeTabId,
    }));
  }
  if (state.editor) {
    fakeMementos.handle(subject, taskEditorTreeMemento).update((current) => ({
      ...current,
      expandedPaths: state.editor!.expandedPaths,
    }));
  }
  if (state.diffView) {
    fakeMementos.handle(subject, taskDiffPreferencesMemento).update((current) => ({
      ...current,
      diffStyle: state.diffView?.diffStyle ?? current.diffStyle,
      commitAction: state.diffView?.commitAction ?? current.commitAction,
      prTab: state.diffView?.prTab ?? current.prTab,
    }));
    fakeMementos.handle(subject, taskDiffSelectionMemento).update((current) => ({
      ...current,
      activeFile: state.diffView?.activeFile ?? current.activeFile,
    }));
  }
  if (state.focusedRegion) viewModel.setFocusedRegion(state.focusedRegion);
  if (state.tabGroups) {
    fakeMementos.handle(subject, taskPaneLayoutMemento).update({
      version: '1',
      ...state.tabGroups,
    });
    viewModel.hydrate();
  }
}

function makeTerminal(id: string, name = 'Terminal 1'): TerminalStore {
  return {
    data: {
      id,
      projectId: 'project-1',
      taskId: 'task-1',
      shellId: 'system',
      name,
    } satisfies Terminal,
  } as TerminalStore;
}

function makeTerminalManager({
  terminalIds,
  isLoaded,
}: {
  terminalIds: string[];
  isLoaded: boolean;
}): FakeTerminalManager {
  return new FakeTerminalManagerStore({ terminalIds, isLoaded }) as unknown as FakeTerminalManager;
}

function terminalRegistryEntries(): {
  set(taskId: string, manager: TerminalManagerStore): void;
  delete(taskId: string): boolean;
} {
  return (
    terminalRegistry as unknown as {
      entries: {
        set(taskId: string, manager: TerminalManagerStore): void;
        delete(taskId: string): boolean;
      };
    }
  ).entries;
}

beforeEach(() => {
  fakeMementos.clear();
  mementoMocks.getClient.mockReturnValue(fakeMementos);
});

describe('sanitizeDiffSelection', () => {
  const selection = {
    version: '1' as const,
    activeFile: {
      path: '/repo/src/index.ts',
      type: 'disk' as const,
      group: 'disk' as const,
      originalRef: { kind: 'commit' as const, sha: 'HEAD' },
    },
  };

  it('preserves and normalizes an absolute path when its relative change is live', () => {
    expect(
      sanitizeDiffSelection(selection, {
        workspacePath: '/repo',
        validPaths: new Set(['src/index.ts']),
      }).activeFile?.path
    ).toBe('/repo/src/index.ts');
  });

  it('drops a disk selection after its relative change disappears', () => {
    expect(
      sanitizeDiffSelection(selection, {
        workspacePath: '/repo',
        validPaths: new Set(),
      }).activeFile
    ).toBeUndefined();
  });
});

afterEach(() => {
  // Release the session manager first so the reconciler disposes cleanly.
  releaseConversationSessionManager('task-1');
  conversationRegistry.release('task-1');
  terminalRegistry.release('task-1');
  terminalRegistryEntries().delete('task-1');
  workspaceRegistry.release('project-1', 'workspace-1');
});

describe('WorkspaceViewModel terminal drawer snapshot', () => {
  it('persists and restores the active terminal drawer item', () => {
    const source = makeViewModel();
    source.setTerminalDrawerActiveItem({ kind: 'script', id: 'script-lifecycle-run' });

    const restored = makeViewModel();

    expect(restored.terminalDrawerActiveItem).toEqual({
      kind: 'script',
      id: 'script-lifecycle-run',
    });

    source.dispose();
    restored.dispose();
  });

  it('does not auto-create a terminal when stale restored tabs are empty but terminal records load', async () => {
    const terminals = makeTerminalManager({ terminalIds: ['terminal-1'], isLoaded: false });
    terminalRegistryEntries().set('task-1', terminals);
    workspaceRegistry.acquire('project-1', 'workspace-1', '/tmp/emdash-test-workspace', {
      settings: {},
    } as never);

    const viewModel = makeProvisionedViewModel();
    applyViewState(viewModel, {
      focusedRegion: 'bottom',
      isTerminalDrawerOpen: true,
      terminals: {
        tabOrder: [],
        activeTabId: undefined,
      },
    });

    viewModel.initialize();

    runInAction(() => {
      terminals.isLoaded = true;
    });
    await Promise.resolve();

    expect(terminals.createDefaultTerminal).not.toHaveBeenCalled();

    viewModel.dispose();
  });

  it('closes a restored empty terminal drawer after terminal state is loaded', async () => {
    const terminals = makeTerminalManager({ terminalIds: [], isLoaded: true });
    terminalRegistryEntries().set('task-1', terminals);
    workspaceRegistry.acquire(
      'project-1',
      'workspace-1',
      '/tmp/emdash-test-workspace',
      { settings: {} } as never,
      'main'
    );

    const viewModel = makeProvisionedViewModel();
    applyViewState(viewModel, {
      focusedRegion: 'bottom',
      isTerminalDrawerOpen: true,
      terminals: {
        tabOrder: [],
        activeTabId: undefined,
      },
    });

    viewModel.initialize();
    await Promise.resolve();

    expect(terminals.createDefaultTerminal).not.toHaveBeenCalled();
    expect(viewModel.isTerminalDrawerOpen).toBe(false);
    expect(viewModel.focusedRegion).toBe('main');
    expect(viewModel.terminalDrawerActiveItem).toBeUndefined();

    viewModel.dispose();
  });

  it('closes a restored empty terminal drawer when empty terminal state finishes loading', async () => {
    const terminals = makeTerminalManager({ terminalIds: [], isLoaded: false });
    terminalRegistryEntries().set('task-1', terminals);
    workspaceRegistry.acquire(
      'project-1',
      'workspace-1',
      '/tmp/emdash-test-workspace',
      { settings: {} } as never,
      'main'
    );

    const viewModel = makeProvisionedViewModel();
    applyViewState(viewModel, {
      focusedRegion: 'bottom',
      isTerminalDrawerOpen: true,
      terminals: {
        tabOrder: [],
        activeTabId: undefined,
      },
    });

    viewModel.initialize();

    runInAction(() => {
      terminals.isLoaded = true;
    });
    await Promise.resolve();

    expect(terminals.createDefaultTerminal).not.toHaveBeenCalled();
    expect(viewModel.isTerminalDrawerOpen).toBe(false);
    expect(viewModel.focusedRegion).toBe('main');
    expect(viewModel.terminalDrawerActiveItem).toBeUndefined();

    viewModel.dispose();
  });

  it('closes the terminal drawer after the user closes the last terminal', async () => {
    const terminals = makeTerminalManager({ terminalIds: ['terminal-1'], isLoaded: true });
    terminalRegistryEntries().set('task-1', terminals);
    workspaceRegistry.acquire(
      'project-1',
      'workspace-1',
      '/tmp/emdash-test-workspace',
      { settings: {} } as never,
      'main'
    );

    const viewModel = makeProvisionedViewModel();
    applyViewState(viewModel, {
      focusedRegion: 'bottom',
      isTerminalDrawerOpen: true,
      terminals: {
        tabOrder: ['terminal-1'],
        activeTabId: 'terminal-1',
      },
    });

    viewModel.initialize();

    runInAction(() => {
      terminals.terminals.delete('terminal-1');
    });
    await Promise.resolve();

    expect(terminals.createDefaultTerminal).not.toHaveBeenCalled();
    expect(viewModel.isTerminalDrawerOpen).toBe(false);
    expect(viewModel.focusedRegion).toBe('main');

    viewModel.dispose();
  });
});

describe('WorkspaceViewModel default conversation tab', () => {
  it('opens the initial conversation for a new task without restored tab state', async () => {
    const conversations = conversationRegistry.acquire('task-1', 'project-1', []);
    const viewModel = makeViewModel();

    runInAction(() => {
      addConversation(conversations, { id: 'conversation-1', isInitialConversation: true });
    });
    await Promise.resolve();

    expect(conversationTabIds(viewModel)).toEqual(['conversation-1']);

    viewModel.dispose();
  });

  it('does not reopen a closed initial conversation when a later conversation is created', async () => {
    const conversations = conversationRegistry.acquire('task-1', 'project-1', []);
    const viewModel = makeViewModel();

    runInAction(() => {
      addConversation(conversations, { id: 'conversation-1', isInitialConversation: true });
      viewModel.activePane.open(
        'conversation',
        { conversationId: 'conversation-1' },
        { preview: false }
      );
    });
    await Promise.resolve();

    viewModel.activePane.closeTab(viewModel.activePane.resolvedActiveTabId!);
    expect(viewModel.activePane.resolvedTabs).toHaveLength(0);

    runInAction(() => {
      addConversation(conversations, { id: 'conversation-2', title: 'Conversation 2' });
    });
    await Promise.resolve();

    expect(viewModel.activePane.resolvedTabs).toHaveLength(0);

    viewModel.activePane.open(
      'conversation',
      { conversationId: 'conversation-2' },
      { preview: false }
    );

    expect(conversationTabIds(viewModel)).toEqual(['conversation-2']);

    viewModel.dispose();
  });

  it('preserves a restored empty tab state instead of opening the initial conversation', async () => {
    const conversations = conversationRegistry.acquire('task-1', 'project-1', [
      makeConversation({ id: 'conversation-1', isInitialConversation: true }),
    ]);
    const viewModel = makeViewModel();
    applyViewState(viewModel, {
      focusedRegion: 'main',
      tabGroups: {
        groups: [
          {
            groupId: 'group-1',
            tabManager: {
              tabs: [],
              activeTabId: undefined,
            },
          },
        ],
        activeGroupId: 'group-1',
        paneSizes: [100],
      },
    });
    await Promise.resolve();

    expect(viewModel.activePane.resolvedTabs).toHaveLength(0);

    runInAction(() => {
      addConversation(conversations, { id: 'conversation-2', title: 'Conversation 2' });
    });
    await Promise.resolve();

    expect(viewModel.activePane.resolvedTabs).toHaveLength(0);

    viewModel.dispose();
  });

  it('does not reopen a closed initial conversation if provision finishes during the next create flow', async () => {
    workspaceRegistry.acquire('project-1', 'workspace-1', '/tmp/emdash-test-workspace', {
      settings: {},
    } as never);
    const conversations = conversationRegistry.acquire('task-1', 'project-1', []);
    vi.spyOn(conversations, 'hydrateConversation').mockResolvedValue();
    vi.spyOn(conversations, 'dehydrateConversation').mockResolvedValue();
    const viewModel = makeProvisionedViewModel();

    runInAction(() => {
      addConversation(conversations, { id: 'conversation-1', isInitialConversation: true });
      viewModel.activePane.open(
        'conversation',
        { conversationId: 'conversation-1' },
        { preview: false }
      );
    });
    await Promise.resolve();

    viewModel.activePane.closeTab(viewModel.activePane.resolvedActiveTabId!);

    runInAction(() => {
      addConversation(conversations, { id: 'conversation-2', title: 'Conversation 2' });
    });
    viewModel.initialize();
    viewModel.activePane.open(
      'conversation',
      { conversationId: 'conversation-2' },
      { preview: false }
    );

    expect(conversationTabIds(viewModel)).toEqual(['conversation-2']);

    viewModel.dispose();
  });
});

describe('WorkspaceViewModel conversation hydration', () => {
  it('hydrates an opened conversation exactly once', async () => {
    const viewModel = makeViewModel();
    const conversations = conversationRegistry.acquire('task-1', 'project-1', [makeConversation()]);
    const hydrateConversation = vi.spyOn(conversations, 'hydrateConversation').mockResolvedValue();
    vi.spyOn(conversations, 'dehydrateConversation').mockResolvedValue();

    // Hydration happens automatically when the tab is opened (via initialize → acquire).
    viewModel.activePane.open(
      'conversation',
      { conversationId: 'conversation-1' },
      { preview: false }
    );

    expect(hydrateConversation).toHaveBeenCalledTimes(1);
    expect(hydrateConversation).toHaveBeenCalledWith('conversation-1');

    // Opening the same tab again (no-op due to single-mount dedup in the pane) should not
    // hydrate a second time.
    viewModel.activePane.open(
      'conversation',
      { conversationId: 'conversation-1' },
      { preview: false }
    );
    expect(hydrateConversation).toHaveBeenCalledTimes(1);

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

    // Open conv-1 as preview; initialize() hydrates it.
    viewModel.paneLayout.open(
      'conversation',
      { conversationId: 'conversation-1' },
      { preview: true }
    );
    await Promise.resolve();

    // Open conv-2 as preview; this retargets the preview slot, disposing conv-1 (dehydrate)
    // and initializing conv-2 (hydrate).
    viewModel.paneLayout.open(
      'conversation',
      { conversationId: 'conversation-2' },
      { preview: true }
    );
    await Promise.resolve();

    expect(dehydrateConversation).toHaveBeenCalledTimes(1);
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-1');

    // Close conv-2; dispose() dehydrates it.
    viewModel.activePane.closeTab(viewModel.activePane.resolvedActiveTabId!);

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

    // Restore two panes each with the same conversation (bypasses single-mount dedup).
    // initialize() is called for each pane's tab, but ConversationSessionManager ref-counts
    // so hydrateConversation is only called once.
    applyViewState(viewModel, {
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
    });

    await Promise.resolve();

    expect(hydrateConversation).toHaveBeenCalledTimes(1);

    const [firstGroup, secondGroup] = viewModel.paneLayout.groups;
    // Closing tab in pane-1 does NOT dehydrate because pane-2 still holds a ref.
    firstGroup.pane.closeTab('tab-1');
    expect(dehydrateConversation).not.toHaveBeenCalled();

    // Closing the last tab triggers dehydration.
    secondGroup.pane.closeTab('tab-2');
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

    // Open two conversations; each initialize() acquires the session.
    viewModel.activePane.open(
      'conversation',
      { conversationId: 'conversation-1' },
      { preview: false }
    );
    viewModel.activePane.open(
      'conversation',
      { conversationId: 'conversation-2' },
      { preview: false }
    );
    // Both hydrate() continuations are scheduled as microtasks (mock resolves immediately).
    // Two awaits drain both, bringing each to 'running' state before dispose().
    await Promise.resolve();
    await Promise.resolve();

    // dispose() calls paneLayout.dispose() which _disposeEntry()s all tabs.
    // Each entry's provider.dispose() triggers release() → reconciler.sync({}) →
    // dehydrate (since state='running').
    viewModel.dispose();

    expect(dehydrateConversation).toHaveBeenCalledTimes(2);
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-1');
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-2');
  });

  it('dehydrates a stale conversation when its hydrate finishes after the tab closed', async () => {
    const viewModel = makeViewModel();
    const conversations = conversationRegistry.acquire('task-1', 'project-1', [makeConversation()]);
    const hydrate = deferred();
    vi.spyOn(conversations, 'hydrateConversation').mockReturnValue(hydrate.promise);
    const dehydrateConversation = vi
      .spyOn(conversations, 'dehydrateConversation')
      .mockResolvedValue();

    // Open tab; hydrateConversation starts but is still pending.
    viewModel.activePane.open(
      'conversation',
      { conversationId: 'conversation-1' },
      { preview: false }
    );

    // Close tab while hydration is still in-flight; release() removes from desired set.
    viewModel.activePane.closeTab(viewModel.activePane.resolvedActiveTabId!);

    // Dehydration hasn't happened yet because hydration hasn't resolved.
    expect(dehydrateConversation).not.toHaveBeenCalled();

    // When the hydrate promise resolves, the reconciler sees the conversation is no longer
    // desired and dehydrates it. Two extra microtask drains let the reconciler's hydrate()
    // continuation run and then the dehydrate() body run.
    hydrate.resolve();
    await hydrate.promise;
    await Promise.resolve();
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

    // First open: hydration fails.
    viewModel.activePane.open(
      'conversation',
      { conversationId: 'conversation-1' },
      { preview: false }
    );
    await Promise.resolve();

    // Closing and reopening triggers a second initialize() → acquire() → retry.
    viewModel.activePane.closeTab(viewModel.activePane.resolvedActiveTabId!);
    viewModel.activePane.open(
      'conversation',
      { conversationId: 'conversation-1' },
      { preview: false }
    );
    await Promise.resolve();

    expect(hydrateConversation).toHaveBeenCalledTimes(2);

    // Close again to dehydrate.
    viewModel.activePane.closeTab(viewModel.activePane.resolvedActiveTabId!);

    expect(dehydrateConversation).toHaveBeenCalledTimes(1);
    expect(dehydrateConversation).toHaveBeenCalledWith('conversation-1');

    viewModel.dispose();
  });
});

describe('WorkspaceViewModel tab persistence adapter', () => {
  const PERSISTOR_TASK_ID = 'task-persistor';

  function makePersistorViewModel(): WorkspaceViewModel {
    return new WorkspaceViewModel({
      data: makeTask({ id: PERSISTOR_TASK_ID }),
    } as unknown as TaskStore);
  }

  it('restores tabs from the pane-layout memento', () => {
    const viewModel = makePersistorViewModel();
    applyViewState(viewModel, {
      focusedRegion: 'main',
      tabGroups: {
        groups: [
          {
            groupId: 'group-1',
            tabManager: { tabs: [], activeTabId: undefined },
          },
        ],
        activeGroupId: 'group-1',
        paneSizes: [100],
      },
    });

    expect(viewModel.paneLayout.groups).toHaveLength(1);
    expect(viewModel.paneLayout.groups[0].paneId).toBe('group-1');
    viewModel.dispose();
  });

  it('gates default-conversation auto-open when tab state is restored', () => {
    const conversations = conversationRegistry.acquire(PERSISTOR_TASK_ID, 'project-1', [
      makeConversation({
        id: 'conversation-1',
        isInitialConversation: true,
        taskId: PERSISTOR_TASK_ID,
      }),
    ]);
    const viewModel = makePersistorViewModel();

    applyViewState(viewModel, {
      focusedRegion: 'main',
      tabGroups: {
        groups: [
          {
            groupId: 'group-1',
            tabManager: { tabs: [], activeTabId: undefined },
          },
        ],
        activeGroupId: 'group-1',
        paneSizes: [100],
      },
    });

    // Conversation list changes should not open a default conversation when tabs were restored.
    runInAction(() => {
      const conv = makeConversation({
        id: 'conversation-2',
        title: 'Conversation 2',
        taskId: PERSISTOR_TASK_ID,
      });
      conversations.conversations.set(conv.id, new ConversationStore(conv));
    });

    expect(conversationTabIds(viewModel)).toHaveLength(0);
    viewModel.dispose();
    conversationRegistry.release(PERSISTOR_TASK_ID);
  });

  it('marks restored pane-layout state as stored', () => {
    const viewModel = makePersistorViewModel();
    applyViewState(viewModel, {
      focusedRegion: 'main',
      tabGroups: {
        groups: [{ groupId: 'g1', tabManager: { tabs: [], activeTabId: undefined } }],
        activeGroupId: 'g1',
        paneSizes: [100],
      },
    });

    const handle = fakeMementos.handle(
      taskSubject({ taskId: PERSISTOR_TASK_ID }),
      taskPaneLayoutMemento
    );
    expect(handle.hasStoredValue).toBe(true);
    expect(handle.value.groups).toHaveLength(1);
    viewModel.dispose();
  });
});
