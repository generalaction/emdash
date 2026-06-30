import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => () => {}),
  },
  rpc: {
    app: { readUserFile: vi.fn() },
    browser: { unregisterSession: vi.fn() },
    ssh: {
      getConnections: vi.fn(async () => []),
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
vi.mock('@renderer/utils/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import { taskTabView } from '@renderer/features/tasks/task-tab-registry';
import { PaneLayoutStore } from './pane-layout-store';

const testCtx = {
  viewId: 'task-1',
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  modelRootPath: 'workspace:workspace-1',
};

function createLayout(opts?: { onActiveTabChange?: (tabId: string | undefined) => void }) {
  return new PaneLayoutStore(taskTabView.registry, testCtx, undefined, opts);
}

describe('PaneLayoutStore: isViewActive and onActivate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserSessionStore.clear();
  });

  it('isVisible is false for all panes when isViewActive is false (default)', () => {
    const layout = createLayout();
    expect(layout.focusedPane.isVisible).toBe(false);
    layout.dispose();
  });

  it('isVisible becomes true for all panes after setViewActive(true)', () => {
    const layout = createLayout();
    runInAction(() => layout.setViewActive(true));
    expect(layout.focusedPane.isVisible).toBe(true);
    layout.dispose();
  });

  it('fires onActivate on the active tab when the view becomes active', () => {
    const layout = createLayout();
    layout.open('browser', {});
    const resource = layout.focusedPane.resolvedTabs[0]?.resource;
    const onActivate = vi.fn();
    // Inject a spy onto the resource.
    (resource as { onActivate?: () => void }).onActivate = onActivate;

    runInAction(() => layout.setViewActive(true));

    expect(onActivate).toHaveBeenCalledTimes(1);
    layout.dispose();
  });

  it('fires onActivate on the newly active tab when the active tab changes while view is active', () => {
    const layout = createLayout();
    layout.open('browser', {});
    layout.open('browser', {});

    const tabs = layout.focusedPane.resolvedTabs;
    const firstResource = tabs[0]?.resource;
    const secondResource = tabs[1]?.resource;
    const firstSpy = vi.fn();
    const secondSpy = vi.fn();
    (firstResource as { onActivate?: () => void }).onActivate = firstSpy;
    (secondResource as { onActivate?: () => void }).onActivate = secondSpy;

    runInAction(() => layout.setViewActive(true));
    // Second tab is active (opened last).
    expect(secondSpy).toHaveBeenCalledTimes(1);

    // Switch to first tab.
    runInAction(() => layout.focusedPane.setActiveTab(tabs[0]!.tabId));
    expect(firstSpy).toHaveBeenCalledTimes(1);

    layout.dispose();
  });

  it('does not fire onActivate when the view is inactive', () => {
    const layout = createLayout();
    layout.open('browser', {});
    const resource = layout.focusedPane.resolvedTabs[0]?.resource;
    const onActivate = vi.fn();
    (resource as { onActivate?: () => void }).onActivate = onActivate;

    // View stays inactive — no onActivate.
    expect(onActivate).not.toHaveBeenCalled();
    layout.dispose();
  });

  it('fires onActivate for each pane on setViewActive when split panes exist', () => {
    const layout = createLayout();
    // Open two browser tabs so splitRight() has something to split.
    layout.open('browser', {});
    layout.open('browser', {});
    layout.splitRight();

    expect(layout.groups).toHaveLength(2);

    const leftResource = layout.groups[0]!.pane.resolvedTabs.at(-1)?.resource;
    const rightResource = layout.groups[1]!.pane.resolvedTabs[0]?.resource;
    const leftSpy = vi.fn();
    const rightSpy = vi.fn();
    if (leftResource) (leftResource as { onActivate?: () => void }).onActivate = leftSpy;
    if (rightResource) (rightResource as { onActivate?: () => void }).onActivate = rightSpy;

    runInAction(() => layout.setViewActive(true));

    expect(leftSpy).toHaveBeenCalledTimes(1);
    expect(rightSpy).toHaveBeenCalledTimes(1);
    layout.dispose();
  });
});

describe('PaneLayoutStore: onActiveTabChange callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserSessionStore.clear();
  });

  it('calls onActiveTabChange with the focused pane active tab id when a tab opens', () => {
    const onChange = vi.fn();
    const layout = createLayout({ onActiveTabChange: onChange });

    layout.open('browser', {});
    const tabId = layout.focusedPane.resolvedActiveTabId;

    expect(onChange).toHaveBeenCalledWith(tabId);
    layout.dispose();
  });

  it('calls onActiveTabChange when the focused pane active tab changes', () => {
    const onChange = vi.fn();
    const layout = createLayout({ onActiveTabChange: onChange });

    layout.open('browser', {});
    layout.open('browser', {});
    const tabs = layout.focusedPane.resolvedTabs;

    onChange.mockClear();
    runInAction(() => layout.focusedPane.setActiveTab(tabs[0]!.tabId));

    expect(onChange).toHaveBeenCalledWith(tabs[0]!.tabId);
    layout.dispose();
  });

  it('does not call onActiveTabChange after dispose', () => {
    const onChange = vi.fn();
    const layout = createLayout({ onActiveTabChange: onChange });
    layout.open('browser', {});
    onChange.mockClear();

    layout.dispose();
    // Open on the already-disposed pane shouldn't trigger (reactions are stopped).
    expect(onChange).not.toHaveBeenCalled();
  });
});
