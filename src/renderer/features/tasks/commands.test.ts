import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SHORTCUTS } from '@shared/shortcuts';
import { createTaskCommandProvider } from './commands';

const mocks = vi.hoisted(() => ({
  closeActiveTabWithConfirm: vi.fn(),
  getRegisteredTaskData: vi.fn(),
  getTaskGitStore: vi.fn(),
  getTaskStore: vi.fn(),
  getTaskView: vi.fn(),
  navigate: vi.fn(),
  showModal: vi.fn(),
  visibleTaskIdsForProject: vi.fn(),
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
});
