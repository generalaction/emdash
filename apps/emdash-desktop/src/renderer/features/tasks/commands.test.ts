import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SHORTCUTS } from '@shared/shortcuts';
import { createTaskCommandProvider } from './commands';

const mocks = vi.hoisted(() => ({
  closeActiveTabWithConfirm: vi.fn(),
  focusUrl: vi.fn(),
  getRegisteredTaskData: vi.fn(),
  getTaskGitStore: vi.fn(),
  getTaskStore: vi.fn(),
  getTaskView: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  navigate: vi.fn(),
  openExternal: vi.fn(),
  reload: vi.fn(),
  showModal: vi.fn(),
  visibleTaskIdsForProject: vi.fn(),
}));

vi.mock('@renderer/features/browser/browser-controls-registry', () => ({
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

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getRegisteredTaskData: mocks.getRegisteredTaskData,
  getTaskGitStore: mocks.getTaskGitStore,
  getTaskStore: mocks.getTaskStore,
  getTaskView: mocks.getTaskView,
}));

vi.mock('@renderer/features/tasks/tabs/close-tab-with-confirm', () => ({
  closeActiveTabWithConfirm: mocks.closeActiveTabWithConfirm,
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  showModal: mocks.showModal,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openExternal: mocks.openExternal,
    },
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      navigate: mocks.navigate,
    },
  },
  sidebarStore: {
    visibleTaskIdsForProject: mocks.visibleTaskIdsForProject,
  },
}));

function activeBrowserTab() {
  return {
    kind: 'browser',
    tabId: 'browser-tab-1',
    browserId: 'browser-1',
    isActive: true,
    isPreview: false,
    session: {
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      partition: 'persist:emdash-browser-project-1-workspace-1-task-1-browser-1',
      currentUrl: 'example.com',
      title: 'Example',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

describe('createTaskCommandProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTaskStore.mockReturnValue({
      state: 'provisioned',
      setPinned: vi.fn(),
    });
    mocks.getTaskView.mockReturnValue({
      isSidebarCollapsed: false,
      isTerminalDrawerOpen: false,
      openNewTerminal: vi.fn(),
      setFocusedRegion: vi.fn(),
      setSidebarCollapsed: vi.fn(),
      setSidebarTab: vi.fn(),
      setTerminalDrawerOpen: vi.fn(),
      tabGroupManager: {
        openBrowser: vi.fn(),
        openConversation: vi.fn(),
        openConversationInRightSplit: vi.fn(),
      },
      tabManager: {
        resolvedTabs: [{ id: 'tab-1' }],
        setNextTabActive: vi.fn(),
        setPreviousTabActive: vi.fn(),
        setTabActiveIndex: vi.fn(),
      },
    });
    mocks.visibleTaskIdsForProject.mockReturnValue(['task-1', 'task-2']);
    mocks.getTaskGitStore.mockReturnValue(undefined);
    mocks.getRegisteredTaskData.mockReturnValue({
      id: 'task-1',
      isPinned: false,
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

    expect(taskView.tabGroupManager.openConversationInRightSplit).toHaveBeenCalledWith(
      'conversation-1'
    );
    expect(taskView.setFocusedRegion).toHaveBeenCalledWith('main');
  });

  it('opens a browser tab from the browser command', () => {
    const provider = createTaskCommandProvider('project-1', 'task-1');

    const command = provider.getCommands().find((candidate) => candidate.id === 'task.openBrowser');
    const taskView = mocks.getTaskView.mock.results.at(-1)?.value ?? mocks.getTaskView();

    command?.execute();

    expect(command?.shortcutKey).toBe('openBrowser');
    expect(taskView.tabGroupManager.openBrowser).toHaveBeenCalledWith();
    expect(taskView.setFocusedRegion).toHaveBeenCalledWith('main');
  });

  it('executes active browser commands through the browser controls registry', () => {
    const taskView = mocks.getTaskView();
    taskView.tabManager.resolvedTabs = [activeBrowserTab()];
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

    expect(mocks.reload).toHaveBeenCalledWith();
    expect(mocks.focusUrl).toHaveBeenCalledWith();
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('navigates browser history through the browser controls registry', () => {
    const taskView = mocks.getTaskView();
    const tab = activeBrowserTab();
    tab.session.canGoBack = true;
    tab.session.canGoForward = true;
    taskView.tabManager.resolvedTabs = [tab];
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
    taskView.tabManager.resolvedTabs = [activeBrowserTab()];
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
});
