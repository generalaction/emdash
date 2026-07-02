import { makeObservable, observable, runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserDiagnosticsStore } from '@renderer/features/browser/browser-diagnostics-store';
import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import { events } from '@renderer/lib/ipc';
import { browserOpenInNewTabChannel } from '@shared/events/browserEvents';

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => () => {}),
  },
  rpc: {
    app: {
      readUserFile: vi.fn(),
    },
    browser: {
      unregisterSession: vi.fn(),
    },
    ssh: {
      getConnections: vi.fn(async () => []),
      getConnectionState: vi.fn(async () => ({})),
      getHealthStates: vi.fn(async () => ({})),
    },
  },
}));

vi.mock('@renderer/lib/monaco/monaco-model-registry', () => ({
  modelRegistry: {
    dirtyUris: new Set<string>(),
    isDirty: vi.fn(() => false),
    modelStatus: new Map<string, string>(),
    modelTotalSizes: new Map<string, number>(),
    toDiskUri: (uri: string) => uri,
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    projects: {
      projects: new Map(),
    },
    sshConnections: {
      healthFor: vi.fn(() => ({ status: 'ok' })),
    },
  },
  sidebarStore: {},
}));

vi.mock('@renderer/utils/telemetry-scope', () => ({
  setTelemetryConversationScope: vi.fn(),
}));

// Stub out the React UI components brought in by the definitions bootstrap so
// the test can run in the node Vitest project without a real DOM.
vi.mock('@renderer/features/browser/browser-tab-item', () => ({
  BrowserTabBarItem: () => null,
  BrowserTabBarItemDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/editor/file-tab-item', () => ({
  FileTabBarItem: () => null,
  FileTabBarItemDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/conversations/conversation-tab-item', () => ({
  ConversationTabBarItem: () => null,
  ConversationTabBarItemDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/diff-view/diff-tab-item', () => ({
  DiffTabBarItem: () => null,
  DiffTabBarItemDragPreview: () => null,
  diffGroupSuffix: (group: string) => `(${group})`,
}));
vi.mock('@renderer/features/tasks/conversations/conversation-title-utils', () => ({
  formatConversationTitleForDisplay: (_providerId: unknown, title: unknown) =>
    (title as string) ?? 'Conversation',
}));

// ACP imports chat-ui which calls document.createElement at module load time.
// Stub out the entire chat-store chain to avoid the DOM dependency in node tests.
vi.mock('@renderer/features/tasks/acp/acp-chat-store', () => ({
  AcpChatStore: class {
    conversationId = '';
    dispose() {}
    bootstrap() {}
  },
}));
vi.mock('@renderer/features/tasks/acp/acp-chat-panel', () => ({
  AcpChatPanel: () => null,
}));

import type { BrowserTabResource } from '@renderer/features/browser/browser-tab-resource';
import { terminalRegistry } from '@renderer/features/tasks/stores/terminal-registry';
import { taskTabView } from '@renderer/features/tasks/task-tab-registry';
import type {
  TerminalManagerStore,
  TerminalStore,
} from '@renderer/features/tasks/terminals/terminal-manager';
import type { ResolvedTab } from './core/tab-provider';
import { PaneStore } from './pane-store';

const testCtx = {
  viewId: 'task-1',
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  modelRootPath: 'workspace:workspace-1',
};

function createTabManager() {
  return new PaneStore(taskTabView.registry, testCtx);
}

function browserResource(tab: ResolvedTab | undefined): BrowserTabResource | undefined {
  return tab?.resource as BrowserTabResource | undefined;
}

class FakeTerminalManagerStore {
  terminals = observable.map<string, TerminalStore>();
  sessions = observable.map();
  isLoaded: boolean;
  dispose = vi.fn();

  constructor({ terminalIds, isLoaded }: { terminalIds: string[]; isLoaded: boolean }) {
    this.isLoaded = isLoaded;
    for (const id of terminalIds) {
      this.terminals.set(id, {
        data: {
          id,
          projectId: 'project-1',
          taskId: 'task-1',
          shellId: 'system',
          name: 'Terminal 1',
        },
      } as TerminalStore);
    }
    makeObservable(this, {
      terminals: observable,
      sessions: observable,
      isLoaded: observable,
    });
  }
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

describe('PaneStore browser tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserDiagnosticsStore.clear();
    browserSessionStore.clear();
  });

  afterEach(() => {
    terminalRegistry.release('task-1');
    terminalRegistryEntries().delete('task-1');
  });

  it('opens browser tabs backed by the default browser profile session', () => {
    const manager = createTabManager();

    manager.open('browser', { initialUrl: 'localhost:5173' });

    const tab = manager.resolvedTabs[0];
    expect(tab).toMatchObject({
      kind: 'browser',
      isActive: true,
    });
    expect(browserResource(tab)?.session?.currentUrl).toBe('http://localhost:5173/');
    expect(browserResource(tab)?.session?.partition).toBe('persist:emdash-browser-profile');
  });

  it('snapshots and restores browser tabs through tab manager state', () => {
    const source = createTabManager();
    source.open('browser', { initialUrl: 'example.com' });

    const snapshot = source.snapshot;
    const restored = createTabManager();
    browserSessionStore.clear();
    restored.restoreSnapshot(snapshot);

    expect(restored.snapshot).toMatchObject({
      activeTabId: snapshot.activeTabId,
      tabs: [
        {
          kind: 'browser',
          session: {
            currentUrl: 'https://example.com/',
            isLoading: false,
          },
        },
      ],
    });
    expect(restored.resolvedTabs[0]?.kind).toBe('browser');
  });

  it('cleans up browser session state on close', () => {
    const manager = createTabManager();
    manager.open('browser', {});
    const tab = manager.resolvedTabs[0];
    const browserId = browserResource(tab)?.browserId ?? '';
    browserDiagnosticsStore.append({
      browserId,
      level: 'error',
      source: 'console',
      message: 'failure',
    });

    manager.closeTab(tab?.tabId ?? '');

    expect(browserSessionStore.getSession(browserId)).toBeUndefined();
    expect(browserDiagnosticsStore.entriesForBrowser(browserId)).toEqual([]);
    expect(manager.resolvedTabs).toEqual([]);
  });

  it('cleans up replaced browser sessions on snapshot restore', () => {
    const manager = createTabManager();
    manager.open('browser', {});
    const oldTab = manager.resolvedTabs[0];
    const oldBrowserId = browserResource(oldTab)?.browserId ?? '';

    manager.restoreSnapshot({ tabs: [], activeTabId: undefined });

    expect(browserSessionStore.getSession(oldBrowserId)).toBeUndefined();
    expect(manager.resolvedTabs).toEqual([]);
  });

  it('cleans up browser sessions on dispose', () => {
    const manager = createTabManager();
    manager.open('browser', {});
    const tab = manager.resolvedTabs[0];
    const browserId = browserResource(tab)?.browserId ?? '';

    manager.dispose();

    expect(browserSessionStore.getSession(browserId)).toBeUndefined();
  });

  it('detaches browser tabs for pane moves without removing session state', () => {
    const manager = createTabManager();
    manager.open('browser', {});
    const tab = manager.resolvedTabs[0];
    const browserId = browserResource(tab)?.browserId ?? '';

    const detached = manager.detachTab(tab?.tabId ?? '');

    expect(detached?.entry?.kind).toBe('browser');
    expect(browserSessionStore.getSession(browserId)).toBeDefined();
    expect(manager.resolvedTabs).toEqual([]);
  });

  it('opens webview popup requests as sibling browser tabs', () => {
    const listeners: Array<(event: { sourceBrowserId: string; url: string }) => void> = [];
    vi.mocked(events.on).mockImplementation((channel, listener) => {
      if (channel === browserOpenInNewTabChannel) {
        listeners.push(listener as (event: { sourceBrowserId: string; url: string }) => void);
      }
      return () => {};
    });
    const manager = createTabManager();
    manager.open('browser', { initialUrl: 'https://source.example/' });
    const source = manager.resolvedTabs[0];
    const sourceBrowserId = browserResource(source)?.browserId ?? '';

    listeners[0]?.({
      sourceBrowserId,
      url: 'https://target.example/path',
    });

    expect(manager.resolvedTabs).toHaveLength(2);
    expect(manager.resolvedTabs[1]).toMatchObject({
      kind: 'browser',
      isActive: true,
    });
    expect(browserResource(manager.resolvedTabs[1])?.session?.currentUrl).toBe(
      'https://target.example/path'
    );
  });
});

describe('PaneStore terminal tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalRegistryEntries().set(
      'task-1',
      new FakeTerminalManagerStore({
        terminalIds: ['terminal-1'],
        isLoaded: true,
      }) as unknown as TerminalManagerStore
    );
  });

  afterEach(() => {
    terminalRegistry.release('task-1');
    terminalRegistryEntries().delete('task-1');
  });

  it('opens and snapshots an existing terminal as a task tab', () => {
    const manager = createTabManager();

    manager.open('terminal', { terminalId: 'terminal-1' });

    expect(manager.resolvedTabs[0]).toMatchObject({
      kind: 'terminal',
      isActive: true,
    });
    expect(manager.snapshot.tabs[0]).toMatchObject({
      kind: 'terminal',
      terminalId: 'terminal-1',
      isPreview: false,
    });
  });

  it('restores terminal tab descriptors without creating a new terminal runtime', () => {
    const restored = createTabManager();

    restored.restoreSnapshot({
      activeTabId: 'tab-terminal-1',
      tabs: [
        {
          kind: 'terminal',
          tabId: 'tab-terminal-1',
          terminalId: 'terminal-1',
          isPreview: false,
        },
      ],
    });

    expect(restored.resolvedTabs[0]).toMatchObject({
      kind: 'terminal',
      tabId: 'tab-terminal-1',
      isActive: true,
    });
    expect(terminalRegistry.get('task-1')?.terminals.has('terminal-1')).toBe(true);
  });

  it('closing a terminal task tab only closes the tab view', () => {
    const manager = createTabManager();
    manager.open('terminal', { terminalId: 'terminal-1' });

    manager.closeTab(manager.resolvedTabs[0]?.tabId ?? '');

    expect(manager.resolvedTabs).toEqual([]);
    expect(terminalRegistry.get('task-1')?.terminals.has('terminal-1')).toBe(true);
  });

  it('stale-closes terminal tabs when the drawer-owned terminal is removed', async () => {
    const manager = createTabManager();
    manager.open('terminal', { terminalId: 'terminal-1' });

    runInAction(() => {
      terminalRegistry.get('task-1')?.terminals.delete('terminal-1');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(manager.resolvedTabs).toEqual([]);
  });

  it('stale-closes restored terminal tabs after initialization finishes', async () => {
    const terminals = terminalRegistry.get('task-1') as unknown as FakeTerminalManagerStore;
    runInAction(() => {
      terminals.terminals.clear();
      terminals.isLoaded = true;
    });

    const restored = createTabManager();
    restored.restoreSnapshot({
      activeTabId: 'tab-terminal-1',
      tabs: [
        {
          kind: 'terminal',
          tabId: 'tab-terminal-1',
          terminalId: 'terminal-1',
          isPreview: false,
        },
      ],
    });

    expect(restored.resolvedTabs).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(restored.resolvedTabs).toEqual([]);
  });
});
