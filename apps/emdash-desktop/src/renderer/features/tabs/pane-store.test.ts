import { observable, runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserDiagnosticsStore } from '@renderer/features/browser/browser-diagnostics-store';
import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import { terminalRegistry } from '@renderer/features/tasks/stores/terminal-registry';
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

vi.mock('@renderer/utils/telemetry-scope', () => ({
  setTelemetryConversationScope: vi.fn(),
}));

// Stub out the React UI components brought in by the definitions bootstrap so
// the test can run in the node Vitest project without a real DOM.
vi.mock('@renderer/features/browser/browser-tab-item', () => ({
  BrowserTabItem: () => null,
  BrowserTabDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/editor/file-tab-item', () => ({
  FileTabItem: () => null,
  FileTabDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/conversations/conversation-tab-item', () => ({
  ConversationTabItem: () => null,
  ConversationTabDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/diff-view/diff-tab-item', () => ({
  DiffTabItem: () => null,
  DiffTabDragPreview: () => null,
  diffGroupSuffix: (group: string) => `(${group})`,
}));
vi.mock('@renderer/features/tasks/terminals/terminal-tab-item', () => ({
  TerminalTabItem: () => null,
  TerminalTabDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/conversations/conversation-title-utils', () => ({
  formatConversationTitleForDisplay: (_providerId: unknown, title: unknown) =>
    (title as string) ?? 'Conversation',
}));

import type { BrowserResolvedData } from '@renderer/features/browser/browser-tab-provider';
import { taskTabView } from '@renderer/features/tasks/task-tab-registry';
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

function terminalRegistryEntries(): Map<string, unknown> {
  return (
    terminalRegistry as unknown as {
      entries: Map<string, unknown>;
    }
  ).entries;
}

function setTerminalRegistry(ids: string[], renameTerminal = vi.fn()) {
  const terminals = observable.map(
    ids.map((id) => [
      id,
      {
        data: {
          id,
          projectId: 'project-1',
          taskId: 'task-1',
          shellId: 'system',
          name: id === 'terminal-1' ? 'Terminal 1' : 'Terminal 2',
        },
      },
    ])
  );
  terminalRegistryEntries().set('task-1', {
    terminals,
    sessions: observable.map(),
    renameTerminal,
  });
  return { terminals, renameTerminal };
}

describe('PaneStore browser tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserDiagnosticsStore.clear();
    browserSessionStore.clear();
    terminalRegistryEntries().delete('task-1');
  });

  it('opens browser tabs backed by the default browser profile session', () => {
    const manager = createTabManager();

    manager.open('browser', { initialUrl: 'localhost:5173' });

    const tab = manager.resolvedTabs[0] as ResolvedTab<BrowserResolvedData> | undefined;
    expect(tab).toMatchObject({
      kind: 'browser',
      isActive: true,
    });
    expect(tab?.session.currentUrl).toBe('http://localhost:5173/');
    expect(tab?.session.partition).toBe('persist:emdash-browser-profile');
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
    const tab = manager.resolvedTabs[0] as ResolvedTab<BrowserResolvedData> | undefined;
    const browserId = tab?.browserId ?? '';
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
    const oldBrowserId = (oldTab as ResolvedTab<BrowserResolvedData> | undefined)?.browserId ?? '';

    manager.restoreSnapshot({ tabs: [], activeTabId: undefined });

    expect(browserSessionStore.getSession(oldBrowserId)).toBeUndefined();
    expect(manager.resolvedTabs).toEqual([]);
  });

  it('cleans up browser sessions on dispose', () => {
    const manager = createTabManager();
    manager.open('browser', {});
    const tab = manager.resolvedTabs[0] as ResolvedTab<BrowserResolvedData> | undefined;
    const browserId = tab?.browserId ?? '';

    manager.dispose();

    expect(browserSessionStore.getSession(browserId)).toBeUndefined();
  });

  it('detaches browser tabs for pane moves without removing session state', () => {
    const manager = createTabManager();
    manager.open('browser', {});
    const tab = manager.resolvedTabs[0] as ResolvedTab<BrowserResolvedData> | undefined;
    const browserId = tab?.browserId ?? '';

    const entry = manager.detachTab(tab?.tabId ?? '');

    expect(entry?.kind).toBe('browser');
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
    const source = manager.resolvedTabs[0] as ResolvedTab<BrowserResolvedData> | undefined;
    const sourceBrowserId = source?.browserId ?? '';

    listeners[0]?.({
      sourceBrowserId,
      url: 'https://target.example/path',
    });

    expect(manager.resolvedTabs).toHaveLength(2);
    expect(manager.resolvedTabs[1]).toMatchObject({
      kind: 'browser',
      isActive: true,
    });
    expect(
      (manager.resolvedTabs[1] as ResolvedTab<BrowserResolvedData> | undefined)?.session.currentUrl
    ).toBe('https://target.example/path');
  });

  it('opens terminal tabs backed by task terminal records', () => {
    setTerminalRegistry(['terminal-1']);
    const manager = createTabManager();

    manager.open('terminal', { terminalId: 'terminal-1' });

    expect(manager.resolvedTabs[0]).toMatchObject({
      kind: 'terminal',
      terminalId: 'terminal-1',
      isActive: true,
    });
    expect(manager.snapshot.tabs).toEqual([
      expect.objectContaining({
        kind: 'terminal',
        terminalId: 'terminal-1',
        isPreview: false,
      }),
    ]);
  });

  it('restores terminal tab descriptors through tab manager state', () => {
    setTerminalRegistry(['terminal-1']);
    const manager = createTabManager();

    manager.restoreSnapshot({
      tabs: [
        {
          kind: 'terminal',
          tabId: 'tab-terminal-1',
          terminalId: 'terminal-1',
          isPreview: false,
        },
      ],
      activeTabId: 'tab-terminal-1',
    });

    expect(manager.resolvedTabs).toEqual([
      expect.objectContaining({
        kind: 'terminal',
        tabId: 'tab-terminal-1',
        terminalId: 'terminal-1',
        isActive: true,
      }),
    ]);
  });

  it('closes terminal tabs when the backing terminal is deleted', () => {
    const { terminals } = setTerminalRegistry(['terminal-1']);
    const manager = createTabManager();
    manager.open('terminal', { terminalId: 'terminal-1' });

    runInAction(() => {
      terminals.delete('terminal-1');
    });

    expect(manager.resolvedTabs).toEqual([]);
    expect(manager.tabOrder).toEqual([]);
  });
});
