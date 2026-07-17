import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { APP_SHORTCUTS } from '@core/primitives/commands/api/shortcuts';
import { createTaskCommandProvider } from './commands';

// ACP imports chat-ui which calls document.createElement at module load time.
// Stub out the entire chat-store chain to avoid the DOM dependency in node tests.
vi.mock('@core/features/conversations/browser/acp/acp-chat-store', () => ({
  AcpChatStore: class {
    conversationId = '';
    dispose() {}
    bootstrap() {}
  },
}));
vi.mock('@core/features/conversations/browser/acp/acp-chat-panel', () => ({
  AcpChatPanel: () => null,
}));
vi.mock('@core/features/browser/browser/browser-tab-item', () => ({
  BrowserTabBarItem: () => null,
  BrowserTabBarItemDragPreview: () => null,
}));
vi.mock('@core/features/tasks/browser/editor/file-tab-item', () => ({
  FileTabBarItem: () => null,
  FileTabBarItemDragPreview: () => null,
}));
vi.mock('@core/features/conversations/browser/conversation-tab-item', () => ({
  ConversationTabBarItem: () => null,
  ConversationTabBarItemDragPreview: () => null,
}));
vi.mock('@core/features/tasks/browser/diff-view/diff-tab-item', () => ({
  DiffTabBarItem: () => null,
  DiffTabBarItemDragPreview: () => null,
  diffGroupSuffix: (group: string) => `(${group})`,
}));
vi.mock('@core/features/conversations/browser/conversation-title-utils', () => ({
  formatConversationTitleForDisplay: (_providerId: unknown, title: unknown) =>
    (title as string) ?? 'Conversation',
}));

const mocks = vi.hoisted(() => ({
  focusUrl: vi.fn(),
  getRegisteredTaskData: vi.fn(),
  getTaskGitCheckoutStore: vi.fn(),
  getTaskManagerStore: vi.fn(),
  getTaskStore: vi.fn(),
  getTaskView: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  navigate: vi.fn(),
  openExternal: vi.fn(),
  reload: vi.fn(),
  showModal: vi.fn(),
  toast: vi.fn(),
  visibleTaskEntries: [
    { projectId: 'project-1', taskId: 'task-1' },
    { projectId: 'project-1', taskId: 'task-2' },
  ],
  writeText: vi.fn(() => Promise.resolve()),
}));

vi.mock('@core/features/browser/browser/browser-controls-registry', () => ({
  browserControlsRegistry: {
    get: vi.fn(() => ({
      adapter: {
        canGoBack: () => true,
        canGoForward: () => true,
        goBack: mocks.goBack,
        goForward: mocks.goForward,
        reload: mocks.reload,
      },
      focusUrl: mocks.focusUrl,
    })),
  },
}));

vi.mock('@core/features/tasks/browser/stores/task-selectors', () => ({
  getRegisteredTaskData: mocks.getRegisteredTaskData,
  getTaskGitCheckoutStore: mocks.getTaskGitCheckoutStore,
  getTaskManagerStore: mocks.getTaskManagerStore,
  getTaskStore: mocks.getTaskStore,
  getTaskView: mocks.getTaskView,
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  showModal: mocks.showModal,
}));

vi.mock('@renderer/lib/runtime/desktop-host-client', () => ({
  rpc: {
    app: {
      openExternal: mocks.openExternal,
    },
  },
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: mocks.toast,
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      navigate: mocks.navigate,
    },
  },
  sidebarStore: {
    get visibleTaskEntries() {
      return mocks.visibleTaskEntries;
    },
  },
}));

function activeBrowserTab() {
  const session = {
    browserId: 'browser-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    profileId: 'default',
    partition: 'persist:emdash-browser-profile',
    currentUrl: 'example.com',
    title: 'Example',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    kind: 'browser',
    tabId: 'browser-tab-1',
    isActive: true,
    isPreview: false,
    state: { initialUrl: 'example.com', session },
    resource: { session },
  };
}

describe('createTaskCommandProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTaskStore.mockReturnValue({
      state: 'provisioned',
      setPinned: vi.fn(),
    });
    mocks.getTaskManagerStore.mockReturnValue({
      archiveTask: vi.fn(),
    });
    mocks.getTaskView.mockReturnValue({
      isSidebarCollapsed: false,
      isTerminalDrawerOpen: false,
      openNewTerminal: vi.fn(),
      setFocusedRegion: vi.fn(),
      setSidebarCollapsed: vi.fn(),
      setSidebarTab: vi.fn(),
      setTerminalDrawerOpen: vi.fn(),
      paneLayout: {
        open: vi.fn(),
      },
      terminalTabs: {
        tabs: [],
      },
      activePane: {
        resolvedTabs: [{ id: 'tab-1' }],
        setNextTabActive: vi.fn(),
        setPreviousTabActive: vi.fn(),
        setTabActiveIndex: vi.fn(),
      },
    });
    mocks.visibleTaskEntries = [
      { projectId: 'project-1', taskId: 'task-1' },
      { projectId: 'project-1', taskId: 'task-2' },
    ];
    mocks.getTaskGitCheckoutStore.mockReturnValue(undefined);
    mocks.getRegisteredTaskData.mockReturnValue({
      id: 'task-1',
      isPinned: false,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mocks.writeText,
      },
    });
  });

  it('only exposes settings-backed shortcut keys to the command palette', () => {
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const commands = provider.getCommands();

    expect(commands.find((command) => command.id === 'task.tab1')?.shortcutKey).toBeUndefined();
    expect(commands.filter((command) => command.shortcutKey != null)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task.tabClose', shortcutKey: 'tabClose' }),
      ])
    );
    for (const command of commands) {
      if (command.shortcutKey != null) {
        expect(command.shortcutKey in APP_SHORTCUTS).toBe(true);
      }
    }
  });

  it('opens a new conversation in a right split from the split command', () => {
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const command = provider
      .getCommands()
      .find((candidate) => candidate.id === 'task.newConversationSplitRight');

    const taskView = mocks.getTaskView.mock.results.at(-1)?.value ?? mocks.getTaskView();

    command?.execute();

    expect(command?.shortcutKey).toBe('newConversationSplitRight');
    expect(mocks.showModal).toHaveBeenCalledWith('createConversationModal', {
      projectId: 'project-1',
      taskId: 'task-1',
      onSuccess: expect.any(Function),
    });

    const modalOptions = mocks.showModal.mock.calls[0][1];
    modalOptions.onSuccess({ conversationId: 'conversation-1' });

    expect(taskView.paneLayout.open).toHaveBeenCalledWith(
      'conversation',
      { conversationId: 'conversation-1' },
      { preview: false, target: 'right' }
    );
    expect(taskView.setFocusedRegion).toHaveBeenCalledWith('main');
  });

  it('opens a browser tab from the browser command', () => {
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const command = provider.getCommands().find((candidate) => candidate.id === 'task.openBrowser');
    const taskView = mocks.getTaskView.mock.results.at(-1)?.value ?? mocks.getTaskView();

    command?.execute();

    expect(command?.shortcutKey).toBe('openBrowser');
    expect(taskView.paneLayout.open).toHaveBeenCalledWith('browser', {});
    expect(taskView.setFocusedRegion).toHaveBeenCalledWith('main');
  });

  it('executes active browser commands through the browser controls registry', () => {
    const taskView = mocks.getTaskView();
    taskView.activePane.resolvedTabs = [activeBrowserTab()];
    mocks.getTaskView.mockReturnValue(taskView);
    const provider = createTaskCommandProvider('project-1', 'task-1');

    provider
      .getCommands()
      .find((candidate) => candidate.id === 'task.browserReload')
      ?.execute();
    provider
      .getCommands()
      .find((candidate) => candidate.id === 'task.browserFocusUrl')
      ?.execute();
    provider
      .getCommands()
      .find((candidate) => candidate.id === 'task.browserOpenExternal')
      ?.execute();
    provider
      .getCommands()
      .find((candidate) => candidate.id === 'task.browserCopyUrl')
      ?.execute();

    expect(mocks.reload).toHaveBeenCalledWith();
    expect(mocks.focusUrl).toHaveBeenCalledWith();
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/');
    expect(mocks.writeText).toHaveBeenCalledWith('https://example.com/');
  });

  it('navigates browser history through the browser controls registry', () => {
    const taskView = mocks.getTaskView();
    const tab = activeBrowserTab();
    tab.resource.session.canGoBack = true;
    tab.resource.session.canGoForward = true;
    taskView.activePane.resolvedTabs = [tab];
    mocks.getTaskView.mockReturnValue(taskView);
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const commands = provider.getCommands();
    const goBack = commands.find((candidate) => candidate.id === 'task.browserGoBack');
    const goForward = commands.find((candidate) => candidate.id === 'task.browserGoForward');

    expect(goBack?.enabled).toBe(true);
    expect(goForward?.enabled).toBe(true);

    goBack?.execute();
    goForward?.execute();

    expect(mocks.goBack).toHaveBeenCalledWith();
    expect(mocks.goForward).toHaveBeenCalledWith();
  });

  it('disables browser history commands when the session has no history', () => {
    const taskView = mocks.getTaskView();
    taskView.activePane.resolvedTabs = [activeBrowserTab()];
    mocks.getTaskView.mockReturnValue(taskView);
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const commands = provider.getCommands();

    expect(commands.find((candidate) => candidate.id === 'task.browserGoBack')?.enabled).toBe(
      false
    );
    expect(commands.find((candidate) => candidate.id === 'task.browserGoForward')?.enabled).toBe(
      false
    );
  });

  it('creates the default terminal when the terminal drawer shortcut opens an empty drawer', () => {
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const command = provider
      .getCommands()
      .find((candidate) => candidate.id === 'task.toggleTerminalDrawer');
    const taskView = mocks.getTaskView.mock.results.at(-1)?.value ?? mocks.getTaskView();

    command?.execute();

    expect(taskView.openNewTerminal).toHaveBeenCalledTimes(1);
    expect(taskView.openNewTerminal).toHaveBeenCalledWith();
    expect(taskView.paneLayout.open).not.toHaveBeenCalled();
    expect(taskView.setTerminalDrawerOpen).not.toHaveBeenCalled();
  });

  it('delegates archive navigation to the task manager', async () => {
    const archiveTask = vi.fn(() => Promise.resolve());
    mocks.getTaskManagerStore.mockReturnValue({ archiveTask });
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const command = provider.getCommands().find((candidate) => candidate.id === 'task.archive');

    expect(command?.shortcutKey).toBe('archiveTask');
    expect(command?.enabled).toBe(true);
    command?.execute();
    await Promise.resolve();

    expect(archiveTask).toHaveBeenCalledWith('task-1');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('keeps archived tasks from running the archive command', () => {
    mocks.getRegisteredTaskData.mockReturnValue({
      id: 'task-1',
      isPinned: false,
      archivedAt: '2026-07-09T00:00:00.000Z',
    });
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const command = provider.getCommands().find((candidate) => candidate.id === 'task.archive');

    expect(command?.enabled).toBe(false);
  });

  it('shows an error and stays on the task when archiving fails', async () => {
    const archiveTask = vi.fn(() => Promise.reject(new Error('archive failed')));
    mocks.getTaskManagerStore.mockReturnValue({ archiveTask });
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const command = provider.getCommands().find((candidate) => candidate.id === 'task.archive');

    command?.execute();
    await Promise.resolve();
    await Promise.resolve();

    expect(archiveTask).toHaveBeenCalledWith('task-1');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Could not archive task',
      variant: 'destructive',
    });
  });

  it('navigates to the next visible task across project boundaries', () => {
    mocks.visibleTaskEntries = [
      { projectId: 'project-1', taskId: 'task-1' },
      { projectId: 'project-2', taskId: 'task-2' },
    ];
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const command = provider.getCommands().find((candidate) => candidate.id === 'task.nextTask');

    expect(command?.enabled).toBe(true);
    command?.execute();

    expect(mocks.navigate).toHaveBeenCalledWith(
      taskViewDef({
        projectId: 'project-2',
        taskId: 'task-2',
      })
    );
  });

  it('navigates to the previous visible task across project boundaries', () => {
    mocks.visibleTaskEntries = [
      { projectId: 'project-1', taskId: 'task-1' },
      { projectId: 'project-2', taskId: 'task-2' },
    ];
    const provider = createTaskCommandProvider('project-2', 'task-2');

    const command = provider.getCommands().find((candidate) => candidate.id === 'task.prevTask');

    expect(command?.enabled).toBe(true);
    command?.execute();

    expect(mocks.navigate).toHaveBeenCalledWith(
      taskViewDef({
        projectId: 'project-1',
        taskId: 'task-1',
      })
    );
  });
});
