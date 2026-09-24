// @vitest-environment jsdom

import { observable, runInAction } from 'mobx';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationType } from '@core/primitives/conversations/api';
import { runNotificationOpenHandler } from '@core/primitives/notifications/browser/open-handlers';
import { createTabRegistry } from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider-registry';
import { PaneLayoutStore } from '@core/primitives/workbench-shell/browser/tabs/pane-layout-store';
import { useRegisterNotificationOpenHandlers } from './notification-open-handlers';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getTaskComposition: vi.fn(),
  getConversations: vi.fn(),
}));

vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@core/features/workbench/api/browser/task-composition-selectors', () => ({
  getTaskComposition: mocks.getTaskComposition,
}));

vi.mock('@core/features/conversations/api/browser/stores/conversation-registry', () => ({
  conversationRegistry: { get: mocks.getConversations },
}));

vi.mock('@core/features/updates/contributions/app-stores', () => ({
  getUpdateStore: () => ({ install: vi.fn() }),
}));

const target = {
  kind: 'task' as const,
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'codex-conversation',
};

const modes = [
  { type: 'acp', kind: 'acp-chat' },
  { type: 'pty', kind: 'conversation' },
] as const;

function NotificationHandlers() {
  useRegisterNotificationOpenHandlers();
  return null;
}

function createLayout() {
  // Use the real pane layout and single-mount lookup, without starting agent processes.
  const registry = createTabRegistry(
    modes.map(({ kind }) => ({
      kind,
      mount: 'single' as const,
      resourceKey: (state: { conversationId: string }) => state.conversationId,
      initialize: () => ({ dispose() {} }),
      dispose() {},
      TabBarItem: () => null,
      TabBarItemDragPreview: () => null,
      TabContent: () => null,
    }))
  );
  return new PaneLayoutStore(registry, { viewId: 'task' });
}

describe('notification conversation navigation', () => {
  let root: Root;
  let container: HTMLDivElement;
  let layout: ReturnType<typeof createLayout>;
  const composition = observable.box<{ paneLayout: PaneLayoutStore } | undefined>(undefined, {
    deep: false,
  });
  const conversations = observable.map<string, { data: { type: ConversationType } }>();

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.navigate.mockReset();
    layout = createLayout();
    runInAction(() => {
      composition.set({ paneLayout: layout });
      conversations.clear();
    });
    mocks.getTaskComposition.mockImplementation(() => composition.get());
    mocks.getConversations.mockImplementation(() => ({ conversations }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(createElement(NotificationHandlers)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    layout.dispose();
    vi.unstubAllGlobals();
  });

  function addConversation(type: ConversationType) {
    runInAction(() => conversations.set(target.conversationId, { data: { type } }));
  }

  function clickNotification() {
    runNotificationOpenHandler(target, 'notification-1');
  }

  it.each(modes)(
    'focuses the existing $type tab without creating a blank duplicate',
    ({ type, kind }) => {
      addConversation(type);
      layout.open(kind, { conversationId: target.conversationId }, { preview: true });
      const chatTabId = layout.focusedPane.activeTabId;
      layout.open('conversation', { conversationId: 'another-conversation' });

      clickNotification();

      expect(layout.focusedPane.tabOrder).toHaveLength(2);
      expect(layout.focusedPane.activeTabId).toBe(chatTabId);
      expect(layout.focusedPane.activeEntry?.isPreview).toBe(false);
      expect(mocks.navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          viewId: 'task',
          params: { projectId: target.projectId, taskId: target.taskId },
        })
      );
    }
  );

  it.each(modes)('focuses an existing $type tab in another pane', ({ type, kind }) => {
    addConversation(type);
    layout.open(kind, { conversationId: target.conversationId });
    const chatPaneId = layout.activePaneId;
    const chatTabId = layout.focusedPane.activeTabId;
    layout.open('conversation', { conversationId: 'another-conversation' }, { target: 'right' });
    expect(layout.activePaneId).not.toBe(chatPaneId);

    clickNotification();

    expect(layout.groups.flatMap(({ pane }) => pane.tabOrder)).toHaveLength(2);
    expect(layout.activePaneId).toBe(chatPaneId);
    expect(layout.focusedPane.activeTabId).toBe(chatTabId);
  });

  it.each(modes)(
    'reopens a closed $type conversation using its correct tab type',
    ({ type, kind }) => {
      addConversation(type);

      clickNotification();

      expect(layout.focusedPane.tabOrder).toHaveLength(1);
      expect(layout.focusedPane.activeEntry).toMatchObject({
        kind,
        state: { conversationId: target.conversationId },
        isPreview: false,
      });
    }
  );

  it('waits for the task and conversation data before opening a chat tab', () => {
    runInAction(() => composition.set(undefined));

    clickNotification();
    expect(layout.focusedPane.tabOrder).toHaveLength(0);

    runInAction(() => composition.set({ paneLayout: layout }));
    expect(layout.focusedPane.tabOrder).toHaveLength(0);

    addConversation('acp');
    expect(layout.focusedPane.activeEntry).toMatchObject({
      kind: 'acp-chat',
      state: { conversationId: target.conversationId },
    });
  });

  it('does not create a terminal tab for an unknown conversation', () => {
    clickNotification();

    expect(layout.focusedPane.tabOrder).toHaveLength(0);
  });

  it('expires an unavailable notification target without throwing or opening a late tab', () => {
    vi.useFakeTimers();
    try {
      clickNotification();

      expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
      addConversation('acp');
      expect(layout.focusedPane.tabOrder).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('only navigates when the notification has no conversation', () => {
    runNotificationOpenHandler(
      { kind: 'task', projectId: target.projectId, taskId: target.taskId },
      'notification-1'
    );

    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(layout.focusedPane.tabOrder).toHaveLength(0);
  });

  it('cancels a pending open when the notification handlers unmount', async () => {
    runInAction(() => composition.set(undefined));
    clickNotification();

    await act(async () => root.render(null));
    addConversation('acp');
    runInAction(() => composition.set({ paneLayout: layout }));

    expect(layout.focusedPane.tabOrder).toHaveLength(0);
  });
});
