import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserDiagnosticsStore } from '@renderer/features/browser/browser-diagnostics-store';
import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import { events } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import type { GitObjectRef } from '@shared/core/git/git';
import { browserOpenInNewTabChannel } from '@shared/events/browserEvents';
import { TabManagerStore } from './tab-manager-store';

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

function createTabManager(): TabManagerStore {
  return new TabManagerStore(() => null, 'workspace-1', 'project-1', 'task-1');
}

const ORIGINAL_REF: GitObjectRef = { kind: 'commit', sha: 'abc123' };

function workingTreeDiff(path = 'src/example.ts') {
  return {
    path,
    type: 'disk' as const,
    group: 'disk' as const,
    originalRef: ORIGINAL_REF,
  };
}

function stagedDiff(path = 'src/example.ts') {
  return {
    path,
    type: 'git' as const,
    group: 'staged' as const,
    originalRef: ORIGINAL_REF,
  };
}

describe('TabManagerStore browser tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelRegistry.dirtyUris.clear();
    vi.mocked(modelRegistry.isDirty).mockImplementation((uri: string) =>
      modelRegistry.dirtyUris.has(uri)
    );
    browserDiagnosticsStore.clear();
    browserSessionStore.clear();
  });

  it('opens browser tabs backed by isolated browser sessions', () => {
    const manager = createTabManager();

    manager.openBrowser('localhost:5173');

    const tab = manager.resolvedTabs[0];
    expect(tab).toMatchObject({
      kind: 'browser',
      isActive: true,
    });
    expect(tab?.kind === 'browser' ? tab.session.currentUrl : undefined).toBe(
      'http://localhost:5173/'
    );
    expect(tab?.kind === 'browser' ? tab.session.partition : undefined).toMatch(
      /^persist:emdash-browser-project-1-workspace-1-task-1-/
    );
  });

  it('snapshots and restores browser tabs through tab manager state', () => {
    const source = createTabManager();
    source.openBrowser('example.com');

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
    manager.openBrowser();
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
    manager.openBrowser();
    const oldTab = manager.resolvedTabs[0];
    const oldBrowserId = oldTab?.kind === 'browser' ? oldTab.browserId : '';

    manager.restoreSnapshot({ tabs: [], activeTabId: undefined });

    expect(browserSessionStore.getSession(oldBrowserId)).toBeUndefined();
    expect(manager.resolvedTabs).toEqual([]);
  });

  it('cleans up browser sessions on dispose', () => {
    const manager = createTabManager();
    manager.openBrowser();
    const tab = manager.resolvedTabs[0];
    const browserId = tab?.kind === 'browser' ? tab.browserId : '';

    manager.dispose();

    expect(browserSessionStore.getSession(browserId)).toBeUndefined();
  });

  it('detaches browser tabs for pane moves without removing session state', () => {
    const manager = createTabManager();
    manager.openBrowser();
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
    manager.openBrowser('https://source.example/');
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

describe('TabManagerStore diff tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelRegistry.dirtyUris.clear();
    vi.mocked(modelRegistry.isDirty).mockImplementation((uri: string) =>
      modelRegistry.dirtyUris.has(uri)
    );
  });

  it('exposes working-tree diff tabs as editable buffers', () => {
    const manager = createTabManager();
    const activeFile = workingTreeDiff();

    manager.openDiff(activeFile);
    const bufferUri = buildMonacoModelPath('workspace:workspace-1', activeFile.path);
    modelRegistry.dirtyUris.add(bufferUri);

    expect(manager.activeEditablePath).toBe(activeFile.path);
    expect(manager.openEditablePaths).toEqual([activeFile.path]);
    expect(manager.resolvedTabs[0]).toMatchObject({
      kind: 'diff',
      path: activeFile.path,
      isDirty: true,
      bufferUri,
    });
  });

  it('keeps a dirty working-tree diff preview instead of replacing it', () => {
    const manager = createTabManager();
    const first = workingTreeDiff('src/first.ts');
    const second = workingTreeDiff('src/second.ts');

    manager.openDiffPreview(first);
    modelRegistry.dirtyUris.add(buildMonacoModelPath('workspace:workspace-1', first.path));
    manager.openDiffPreview(second);

    expect(manager.resolvedTabs).toHaveLength(2);
    expect(manager.resolvedTabs[0]).toMatchObject({
      kind: 'diff',
      path: first.path,
      isPreview: false,
      isDirty: true,
    });
    expect(manager.resolvedTabs[1]).toMatchObject({
      kind: 'diff',
      path: second.path,
      isPreview: true,
      isDirty: false,
    });
  });

  it('does not expose buffer URIs for non-editable diff tabs', () => {
    const manager = createTabManager();
    const activeFile = stagedDiff();
    const bufferUri = buildMonacoModelPath('workspace:workspace-1', activeFile.path);

    manager.openDiff(activeFile);
    modelRegistry.dirtyUris.add(bufferUri);

    expect(manager.activeEditablePath).toBeNull();
    expect(manager.openEditablePaths).toEqual([]);
    expect(manager.resolvedTabs[0]).toMatchObject({
      kind: 'diff',
      path: activeFile.path,
      isDirty: false,
      bufferUri: '',
    });
  });
});
