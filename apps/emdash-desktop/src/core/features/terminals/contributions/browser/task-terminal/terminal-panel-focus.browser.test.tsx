import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalsPanel } from './terminal-panel';

const mocks = vi.hoisted(() => ({
  drawerScopeFocused: false,
  tabBarIsFocused: undefined as boolean | undefined,
}));

vi.mock('@core/features/tasks/api/browser/hooks/use-is-active-task', () => ({
  useIsActiveTask: () => true,
}));

vi.mock('@core/features/tasks/contributions/browser/task-view-context', () => ({
  useTaskViewContext: () => ({ projectId: 'project-1', taskId: 'task-1' }),
}));

vi.mock('@core/features/terminals/api/browser/use-terminal-shell-availability', () => ({
  useTerminalShellAvailability: () => ({
    data: [],
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@core/features/terminals/browser/task-terminal/terminal-drawer-tab-bar', () => ({
  TerminalDrawerTabBar: ({ isFocused }: { isFocused: boolean }) => {
    mocks.tabBarIsFocused = isFocused;
    return null;
  },
}));

vi.mock('@core/features/terminals/browser/task-terminal/terminal-panel-selection', () => ({
  resolveTerminalPanelActiveItem: () => ({ kind: 'terminal', id: '' }),
}));

vi.mock('@core/features/terminals/browser/task-terminal/terminal-pty-content', () => ({
  TerminalPtyContent: () => null,
}));

vi.mock('@core/features/workbench/api/browser/tabs/use-pane-scope', () => ({
  usePaneScope: () => ({
    attachRef: () => {},
    instance: undefined,
    isFocused: mocks.drawerScopeFocused,
  }),
}));

vi.mock('@core/features/workbench/api/browser/task-composition-context', () => ({
  useTaskComposition: () => ({
    terminalTabs: {
      tabs: [],
      activeTabId: undefined,
      setActiveTab: vi.fn(),
      removeTab: vi.fn(),
    },
    terminalDrawerActiveItem: undefined,
    isTerminalDrawerOpen: true,
    focusedRegion: 'bottom',
    paneLayout: { groups: [] },
    setFocusedRegion: vi.fn(),
    setTerminalDrawerActiveItem: vi.fn(),
    openNewTerminal: vi.fn(),
  }),
  useTerminals: () => ({
    hostAccess: null,
    sessions: new Map(),
    renameTerminal: vi.fn(),
  }),
  useWorkspace: () => ({
    get: () => null,
    sshConnectionId: null,
  }),
  useWorkspaceId: () => 'workspace-1',
}));

vi.mock('@core/features/workspaces/contributions/browser/workspace-stores', () => ({
  lifecycleScriptsStoreToken: Symbol('lifecycle-scripts'),
}));

vi.mock('@core/manifests/browser/project-availability-ui', () => ({
  projectAvailabilityUi: {
    getLiveActionDisabledReason: () => null,
    LiveActionGuard: ({ children }: { children: React.ReactNode }) => children,
  },
}));

vi.mock('@core/primitives/view-scopes/react', () => ({
  ViewScopeInstanceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('TerminalsPanel focus indicator', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.drawerScopeFocused = false;
    mocks.tabBarIsFocused = undefined;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('uses the live drawer scope instead of the remembered focused region', async () => {
    await act(async () => root.render(<TerminalsPanel key="unfocused" />));

    expect(mocks.tabBarIsFocused).toBe(false);

    mocks.drawerScopeFocused = true;
    await act(async () => root.render(<TerminalsPanel key="focused" />));

    expect(mocks.tabBarIsFocused).toBe(true);
  });
});
