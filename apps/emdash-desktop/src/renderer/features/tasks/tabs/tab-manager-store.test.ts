import { beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@renderer/features/tasks/view/tab-bar/browser-tab-item', () => ({
  BrowserTabItem: () => null,
  BrowserTabDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/view/tab-bar/file-tab-item', () => ({
  FileTabItem: () => null,
  FileTabDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/view/tab-bar/conversation-tab-item', () => ({
  ConversationTabItem: () => null,
  ConversationTabDragPreview: () => null,
}));
vi.mock('@renderer/features/tasks/view/tab-bar/diff-tab-item', () => ({
  DiffTabItem: () => null,
  DiffTabDragPreview: () => null,
  diffGroupSuffix: (group: string) => `(${group})`,
}));
vi.mock('@renderer/features/tasks/conversations/conversation-title-utils', () => ({
  formatConversationTitleForDisplay: (_providerId: unknown, title: unknown) =>
    (title as string) ?? 'Conversation',
}));

// Register all built-in tab kinds before any PaneStore is constructed.
import '@renderer/features/tasks/tabs/providers';
import { PaneStore } from './pane-store';

function createTabManager(): PaneStore {
  return new PaneStore(() => null, 'workspace-1', 'project-1', 'task-1');
}

describe('PaneStore browser tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserDiagnosticsStore.clear();
    browserSessionStore.clear();
  });

  it('opens browser tabs backed by the default browser profile session', () => {
    const manager = createTabManager();

    manager.open('browser', { initialUrl: 'localhost:5173' });

    const tab = manager.resolvedTabs[0];
    expect(tab).toMatchObject({
      kind: 'browser',
      isActive: true,
    });
    expect(tab?.kind === 'browser' ? tab.session.currentUrl : undefined).toBe(
      'http://localhost:5173/'
    );
    expect(tab?.kind === 'browser' ? tab.session.partition : undefined).toBe(
      'persist:emdash-browser-profile'
    );
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
    const browserId = tab?.kind === 'browser' ? tab.browserId : '';
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
    const oldBrowserId = oldTab?.kind === 'browser' ? oldTab.browserId : '';

    manager.restoreSnapshot({ tabs: [], activeTabId: undefined });

    expect(browserSessionStore.getSession(oldBrowserId)).toBeUndefined();
    expect(manager.resolvedTabs).toEqual([]);
  });

  it('cleans up browser sessions on dispose', () => {
    const manager = createTabManager();
    manager.open('browser', {});
    const tab = manager.resolvedTabs[0];
    const browserId = tab?.kind === 'browser' ? tab.browserId : '';

    manager.dispose();

    expect(browserSessionStore.getSession(browserId)).toBeUndefined();
  });

  it('detaches browser tabs for pane moves without removing session state', () => {
    const manager = createTabManager();
    manager.open('browser', {});
    const tab = manager.resolvedTabs[0];
    const browserId = tab?.kind === 'browser' ? tab.browserId : '';

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
    const source = manager.resolvedTabs[0];
    const sourceBrowserId = source?.kind === 'browser' ? source.browserId : '';

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
      manager.resolvedTabs[1]?.kind === 'browser' ? manager.resolvedTabs[1].session.currentUrl : ''
    ).toBe('https://target.example/path');
  });
});
